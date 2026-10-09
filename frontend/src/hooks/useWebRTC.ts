import { useEffect, useRef, useState, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import {
  assessQuality,
  assessPeerSignal,
  collectPeerSample,
  collectPeerReception,
  nextRestartDelayMs,
  stepLevel,
  QUALITY_LADDER,
  MAX_QUALITY_LEVEL,
  MAX_ICE_RESTARTS,
  REMOTE_FROZEN_AFTER_MS,
  type PeerSignalState,
  type QualitySample,
  type QualityLevel,
} from '../shared/webrtc-quality';

// NOTA DE RESILIENCIA (Rol A): este hook SOLO gestiona cámaras/micrófonos
// WebRTC (pistas getUserMedia + mallas P2P). NUNCA toca el <video> principal
// de la película (stream HTTP en VideoPlayer): ningún error, ICE restart o
// desconexión de aquí pausa, desmonta o recarga la película ni su audio.

export interface RemotePeer {
  socketId: string;
  userName: string;
  isLeader: boolean;
  stream: MediaStream;
}

export interface PeerMediaState {
  isCameraOn: boolean;
  isMicOn: boolean;
  userName?: string;
}

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ],
  iceCandidatePoolSize: 10,
};

export function useWebRTC(socket: Socket | null, roomId: string, userName: string, isLeader: boolean) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]);
  const [peerMediaStates, setPeerMediaStates] = useState<Record<string, PeerMediaState>>({});
  const [isMicOn, setIsMicOn] = useState<boolean>(false);
  const [isCameraOn, setIsCameraOn] = useState<boolean>(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  // Escalera de calidad ante señal débil (0 normal → 3 solo-audio).
  // El audio sigue siempre; el video propio se degrada por pasos, nunca se corta.
  const [qualityLevel, setQualityLevel] = useState<QualityLevel>(0);
  const lowBandwidth = qualityLevel >= MAX_QUALITY_LEVEL;
  // Señal por peer remoto (key = socketId): con `weak` el tile muestra avatar
  // + "señal débil"; con `critical` además se oculta su <video> (audio-only
  // en recepción; su <audio> nunca se pausa ni desmonta).
  const [peerSignalStates, setPeerSignalStates] = useState<Record<string, PeerSignalState>>({});

  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const dataChannels = useRef<Map<string, RTCDataChannel>>(new Map());
  const peerMeta = useRef<Map<string, { userName: string; isLeader: boolean }>>(new Map());
  const remoteStreams = useRef<Map<string, MediaStream>>(new Map());
  const pendingCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const makingOfferRef = useRef<Map<string, boolean>>(new Map());
  // Reintentos de ICE restart por peer + timers de espera en 'disconnected'.
  const restartAttempts = useRef<Map<string, number>>(new Map());
  const disconnectTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Último conteo de frames entrantes por peer (detección de frame congelado).
  const lastFramesRef = useRef<Map<string, { frames: number; at: number }>>(new Map());

  // Master local media tracks (live hardware)
  const localVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  const localAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const isMicOnRef = useRef(false);
  const isCameraOnRef = useRef(false);

  // ── Sync remote peers state ───────────────────────────────────────────────
  const syncRemotePeersState = useCallback(() => {
    const list: RemotePeer[] = [];
    remoteStreams.current.forEach((stream, socketId) => {
      const meta = peerMeta.current.get(socketId) || { userName: 'Participante', isLeader: false };
      list.push({
        socketId,
        userName: meta.userName,
        isLeader: meta.isLeader,
        stream: new MediaStream(stream.getTracks()),
      });
    });
    setRemotePeers(list);
  }, []);

  // ── Update Peer Media State directly in state ─────────────────────────────
  const updatePeerMediaState = useCallback((targetSocketId: string, state: { isCameraOn: boolean; isMicOn: boolean; userName?: string }) => {
    setPeerMediaStates((prev) => {
      const next = {
        ...prev,
        [targetSocketId]: { isCameraOn: state.isCameraOn, isMicOn: state.isMicOn, userName: state.userName },
      };
      if (state.userName) {
        next[state.userName.trim().toLowerCase()] = { isCameraOn: state.isCameraOn, isMicOn: state.isMicOn, userName: state.userName };
      }
      return next;
    });
  }, []);

  // ── Broadcast Media State across Direct P2P DataChannels ──────────────────
  const broadcastMediaStateP2P = useCallback((camState: boolean, micState: boolean) => {
    const payload = JSON.stringify({
      type: 'media-state',
      isCameraOn: camState,
      isMicOn: micState,
      userName,
    });
    dataChannels.current.forEach((dc) => {
      if (dc.readyState === 'open') {
        try { dc.send(payload); } catch {}
      }
    });
  }, [userName]);

  // ── Setup RTCDataChannel ──────────────────────────────────────────────────
  const setupDataChannel = useCallback((dc: RTCDataChannel, targetSocketId: string) => {
    dataChannels.current.set(targetSocketId, dc);
    dc.onopen = () => {
      try {
        dc.send(JSON.stringify({
          type: 'media-state',
          isCameraOn: isCameraOnRef.current,
          isMicOn: isMicOnRef.current,
          userName,
        }));
      } catch {}
    };
    dc.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === 'media-state') {
          updatePeerMediaState(targetSocketId, data);
        }
      } catch {}
    };
    dc.onclose = () => {
      dataChannels.current.delete(targetSocketId);
    };
  }, [userName, updatePeerMediaState]);

  // ── Drain pending ICE candidates ──────────────────────────────────────────
  const drainPendingCandidates = async (socketId: string, pc: RTCPeerConnection) => {
    const queue = pendingCandidates.current.get(socketId);
    if (!queue || queue.length === 0) return;
    for (const c of queue) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch {}
    }
    pendingCandidates.current.delete(socketId);
  };

  // ── Attach Current Local Tracks to a PeerConnection ─────────────────────────
  const attachLocalTracksToPC = useCallback((pc: RTCPeerConnection) => {
    // 1. Audio Track / Transceiver
    const audioSender = pc.getSenders().find((s) => s.track?.kind === 'audio');
    if (localAudioTrackRef.current) {
      if (audioSender) {
        audioSender.replaceTrack(localAudioTrackRef.current).catch(() => {});
      } else {
        try { pc.addTrack(localAudioTrackRef.current, localStreamRef.current || new MediaStream()); } catch {}
      }
    } else {
      if (audioSender) {
        audioSender.replaceTrack(null).catch(() => {});
      } else {
        const audioTxr = pc.getTransceivers().find((t) => t.receiver.track?.kind === 'audio');
        if (!audioTxr) {
          pc.addTransceiver('audio', { direction: 'sendrecv' });
        }
      }
    }

    // 2. Video Track / Transceiver
    const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
    if (localVideoTrackRef.current) {
      if (videoSender) {
        videoSender.replaceTrack(localVideoTrackRef.current).catch(() => {});
      } else {
        try { pc.addTrack(localVideoTrackRef.current, localStreamRef.current || new MediaStream()); } catch {}
      }
    } else {
      if (videoSender) {
        videoSender.replaceTrack(null).catch(() => {});
      } else {
        const videoTxr = pc.getTransceivers().find((t) => t.receiver.track?.kind === 'video');
        if (!videoTxr) {
          pc.addTransceiver('video', { direction: 'sendrecv' });
        }
      }
    }
  }, []);

  // ── Libera un peer por completo (usado al fallar tras reintentos o al salir) ──
  // Solo libera la cámara/mic de ESE peer: jamás toca el <video> principal.
  const cleanupPeer = useCallback((targetSocketId: string) => {
    const pc = peerConnections.current.get(targetSocketId);
    if (pc) {
      try { pc.close(); } catch {}
      peerConnections.current.delete(targetSocketId);
    }
    dataChannels.current.delete(targetSocketId);
    peerMeta.current.delete(targetSocketId);
    pendingCandidates.current.delete(targetSocketId);
    remoteStreams.current.delete(targetSocketId);
    makingOfferRef.current.delete(targetSocketId);
    restartAttempts.current.delete(targetSocketId);
    lastFramesRef.current.delete(targetSocketId);
    const timer = disconnectTimers.current.get(targetSocketId);
    if (timer) {
      clearTimeout(timer);
      disconnectTimers.current.delete(targetSocketId);
    }
    setPeerSignalStates((prev) => {
      if (!(targetSocketId in prev)) return prev;
      const next = { ...prev };
      delete next[targetSocketId];
      return next;
    });
    syncRemotePeersState();
  }, [syncRemotePeersState]);

  // Se asigna tras definir sendOffer (referencia estable para el monitor de ICE).
  const restartPeerRef = useRef<(targetSocketId: string) => void>(() => {});

  // ── Create or retrieve RTCPeerConnection ──────────────────────────────────
  const getOrCreatePeerConnection = useCallback(
    (targetSocketId: string, targetName: string, targetLeader: boolean): RTCPeerConnection => {
      if (targetName) {
        peerMeta.current.set(targetSocketId, { userName: targetName, isLeader: targetLeader });
      }

      const existing = peerConnections.current.get(targetSocketId);
      if (existing && existing.connectionState !== 'closed' && existing.connectionState !== 'failed') {
        return existing;
      }
      if (existing) {
        try { existing.close(); } catch {}
        peerConnections.current.delete(targetSocketId);
        dataChannels.current.delete(targetSocketId);
      }

      console.log(`[WebRTC] Initializing connection with ${targetName} (${targetSocketId})`);
      const pc = new RTCPeerConnection(ICE_SERVERS);
      peerConnections.current.set(targetSocketId, pc);

      // Create DataChannel for instant P2P state
      try {
        const dc = pc.createDataChannel('media-state');
        setupDataChannel(dc, targetSocketId);
      } catch {}

      pc.ondatachannel = (ev) => {
        setupDataChannel(ev.channel, targetSocketId);
      };

      attachLocalTracksToPC(pc);

      // ICE candidate handler
      pc.onicecandidate = (ev) => {
        if (ev.candidate && socket) {
          socket.emit('webrtc-ice-candidate', { targetSocketId, candidate: ev.candidate });
        }
      };

      // Remote track received
      pc.ontrack = (ev) => {
        console.log(`[WebRTC] Received remote track (${ev.track.kind}) from ${targetSocketId}`);
        let st = remoteStreams.current.get(targetSocketId);
        if (!st) {
          st = new MediaStream();
          remoteStreams.current.set(targetSocketId, st);
        }

        // Remove old track of kind and add incoming track
        const oldTracks = st.getTracks().filter((t) => t.kind === ev.track.kind);
        oldTracks.forEach((t) => st!.removeTrack(t));
        st.addTrack(ev.track);

        ev.track.onunmute = () => {
          console.log(`[WebRTC] Remote track unmuted: ${ev.track.kind} (${targetSocketId})`);
          syncRemotePeersState();
        };
        ev.track.onmute = () => {
          console.log(`[WebRTC] Remote track muted: ${ev.track.kind} (${targetSocketId})`);
          syncRemotePeersState();
        };
        ev.track.onended = () => {
          syncRemotePeersState();
        };

        syncRemotePeersState();
      };

      // Monitor connection state (resiliente: reintenta antes de soltar).
      // 'disconnected' puede recuperarse solo (handoff WiFi/datos): se espera
      // 8 s y se reintenta ICE; 'failed' reintenta con backoff (tope 3).
      // La película principal no se ve afectada en ningún caso.
      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        console.log(`[WebRTC] Peer ${targetSocketId} state: ${state}`);
        if (state === 'connected') {
          restartAttempts.current.delete(targetSocketId);
          const timer = disconnectTimers.current.get(targetSocketId);
          if (timer) {
            clearTimeout(timer);
            disconnectTimers.current.delete(targetSocketId);
          }
          syncRemotePeersState();
          return;
        }
        if (state === 'disconnected') {
          // Puede recuperarse solo (handoff WiFi/datos): esperar antes de actuar.
          if (!disconnectTimers.current.has(targetSocketId)) {
            const timer = setTimeout(() => {
              disconnectTimers.current.delete(targetSocketId);
              const current = peerConnections.current.get(targetSocketId);
              if (current && current.connectionState === 'disconnected') {
                console.log(`[WebRTC] Peer ${targetSocketId} sigue desconectado: reintentando ICE`);
                restartPeerRef.current(targetSocketId);
              }
            }, 8000);
            disconnectTimers.current.set(targetSocketId, timer);
          }
          return;
        }
        if (state === 'failed') {
          const timer = disconnectTimers.current.get(targetSocketId);
          if (timer) {
            clearTimeout(timer);
            disconnectTimers.current.delete(targetSocketId);
          }
          restartPeerRef.current(targetSocketId);
          return;
        }
        if (state === 'closed') {
          cleanupPeer(targetSocketId);
        }
      };

      return pc;
    },
    [socket, attachLocalTracksToPC, setupDataChannel, syncRemotePeersState, cleanupPeer]
  );

  // ── Send Offer (Initial or Renegotiation) ──────────────────────────────────
  const sendOffer = useCallback(
    async (targetId: string, name: string, leader: boolean) => {
      const pc = getOrCreatePeerConnection(targetId, name, leader);
      try {
        makingOfferRef.current.set(targetId, true);
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        await pc.setLocalDescription(offer);
        if (socket) {
          socket.emit('webrtc-offer', {
            targetSocketId: targetId,
            offer: pc.localDescription,
            callerName: userName,
            callerIsLeader: isLeader,
          });
        }
      } catch (err) {
        console.error(`[WebRTC] Error sending offer to ${targetId}:`, err);
      } finally {
        makingOfferRef.current.set(targetId, false);
      }
    },
    [getOrCreatePeerConnection, socket, userName, isLeader]
  );

  // ── ICE restart ante señal caída: re-oferta sobre la misma PC si vive,
  // si no recreación completa. Con backoff y tope (luego se suelta al peer).
  const restartPeerConnection = useCallback(
    async (targetSocketId: string) => {
      const pc = peerConnections.current.get(targetSocketId);
      const meta = peerMeta.current.get(targetSocketId);
      const name = meta?.userName ?? 'Participante';
      const leader = meta?.isLeader ?? false;
      if (!pc || pc.connectionState === 'closed') {
        if (pc) {
          try { pc.close(); } catch {}
          peerConnections.current.delete(targetSocketId);
        }
        restartAttempts.current.delete(targetSocketId);
        sendOffer(targetSocketId, name, leader);
        return;
      }
      const attempts = restartAttempts.current.get(targetSocketId) ?? 0;
      if (attempts >= MAX_ICE_RESTARTS) {
        console.log(`[WebRTC] Peer ${targetSocketId} sin recuperación tras ${attempts} reintentos: se suelta`);
        cleanupPeer(targetSocketId);
        return;
      }
      const delay = nextRestartDelayMs(attempts);
      restartAttempts.current.set(targetSocketId, attempts + 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
      const current = peerConnections.current.get(targetSocketId);
      if (!current || current.connectionState === 'connected') {
        return;
      }
      try {
        makingOfferRef.current.set(targetSocketId, true);
        current.restartIce();
        const offer = await current.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        await current.setLocalDescription(offer);
        socket?.emit('webrtc-offer', {
          targetSocketId,
          offer: current.localDescription,
          callerName: userName,
          callerIsLeader: isLeader,
        });
      } catch {
        cleanupPeer(targetSocketId);
      } finally {
        makingOfferRef.current.set(targetSocketId, false);
      }
    },
    [socket, userName, isLeader, sendOffer, cleanupPeer]
  );

  // Referencia estable para el monitor de ICE (definido antes que sendOffer).
  useEffect(() => {
    restartPeerRef.current = restartPeerConnection;
  }, [restartPeerConnection]);

  // ── Renegotiate with all peers ────────────────────────────────────────────
  const renegotiateAllPeers = useCallback(() => {
    peerConnections.current.forEach((pc, socketId) => {
      const meta = peerMeta.current.get(socketId) || { userName: 'Participante', isLeader: false };
      attachLocalTracksToPC(pc);
      sendOffer(socketId, meta.userName, meta.isLeader);
    });
  }, [attachLocalTracksToPC, sendOffer]);

  // ── Enable / Disable Media Dynamically with Hardware Switching ────────────
  const enableMedia = useCallback(
    async (audioRequested: boolean, videoRequested: boolean): Promise<MediaStream | null> => {
      try {
        setMediaError(null);

        // 1. Handle Microphone
        if (audioRequested !== isMicOnRef.current) {
          if (audioRequested) {
            const stream = await navigator.mediaDevices.getUserMedia({
              audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            });
            const realAudioTrack = stream.getAudioTracks()[0];
            if (realAudioTrack) {
              if (localAudioTrackRef.current && localAudioTrackRef.current.readyState === 'live') {
                localAudioTrackRef.current.stop();
              }
              localAudioTrackRef.current = realAudioTrack;
            }
          } else {
            if (localAudioTrackRef.current) {
              localAudioTrackRef.current.stop();
              localAudioTrackRef.current = null;
            }
          }
          setIsMicOn(audioRequested);
          isMicOnRef.current = audioRequested;
        }

        // 2. Handle Camera
        if (videoRequested !== isCameraOnRef.current) {
          if (videoRequested) {
            const stream = await navigator.mediaDevices.getUserMedia({
              video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
            });
            const realVideoTrack = stream.getVideoTracks()[0];
            if (realVideoTrack) {
              if (localVideoTrackRef.current && localVideoTrackRef.current.readyState === 'live') {
                localVideoTrackRef.current.stop();
              }
              localVideoTrackRef.current = realVideoTrack;
            }
          } else {
            if (localVideoTrackRef.current) {
              localVideoTrackRef.current.stop();
              localVideoTrackRef.current = null;
            }
          }
          setIsCameraOn(videoRequested);
          isCameraOnRef.current = videoRequested;
        }

        // 3. Update master local stream state
        const tracks: MediaStreamTrack[] = [];
        if (localAudioTrackRef.current) tracks.push(localAudioTrackRef.current);
        if (localVideoTrackRef.current) tracks.push(localVideoTrackRef.current);
        const updatedStream = tracks.length > 0 ? new MediaStream(tracks) : null;
        localStreamRef.current = updatedStream;
        setLocalStream(updatedStream ? new MediaStream(tracks) : null);

        // 4. Update tracks across all peer connections and renegotiate
        renegotiateAllPeers();

        // 5. Broadcast instant state over Direct P2P DataChannels
        broadcastMediaStateP2P(videoRequested, audioRequested);

        // 6. Broadcast state via Socket.io
        if (socket) {
          socket.emit('peer-media-state', {
            roomId,
            userName,
            isCameraOn: videoRequested,
            isMicOn: audioRequested,
          });
        }

        return updatedStream;
      } catch (err: any) {
        console.warn('⚠️ Media access error:', err.name, err.message);
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setMediaError('Permiso denegado. Permite el acceso a la cámara y micrófono en tu navegador.');
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          setMediaError('No se detectó cámara o micrófono disponible.');
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          setMediaError('La cámara o micrófono está siendo usado por otra aplicación.');
        } else {
          setMediaError(`Error de dispositivo: ${err.message || err.name}`);
        }
        return null;
      }
    },
    [socket, roomId, userName, renegotiateAllPeers, broadcastMediaStateP2P]
  );

  // ── Toggle Microphone ──────────────────────────────────────────────────────
  const toggleMic = useCallback(async () => {
    await enableMedia(!isMicOnRef.current, isCameraOnRef.current);
  }, [enableMedia]);

  // ── Toggle Camera ──────────────────────────────────────────────────────────
  const toggleCamera = useCallback(async () => {
    await enableMedia(isMicOnRef.current, !isCameraOnRef.current);
  }, [enableMedia]);

  // ──────────────────────────────────────────────────────────────────────────
  // Monitor de calidad propia: sube/baja UN escalón por evaluación (cada 6 s).
  // Solo degrada la cámara LOCAL (bitrate/resolución/solo-audio). El audio
  // sigue siempre y la película principal jamás se toca.
  // ──────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const windowSamples: QualitySample[] = [];
    let current: 'good' | 'poor' = 'good';

    const worstOf = (samples: QualitySample[]): QualitySample => ({
      rttMs: samples.reduce<number | null>(
        (acc, s) => (s.rttMs !== null ? Math.max(acc ?? -Infinity, s.rttMs) : acc),
        null
      ),
      audioLossPct: samples.reduce<number | null>(
        (acc, s) => (s.audioLossPct !== null ? Math.max(acc ?? -Infinity, s.audioLossPct) : acc),
        null
      ),
      videoLossPct: samples.reduce<number | null>(
        (acc, s) => (s.videoLossPct !== null ? Math.max(acc ?? -Infinity, s.videoLossPct) : acc),
        null
      ),
    });

    const tick = async () => {
      if (stopped) return;
      try {
        const live = [...peerConnections.current.values()].filter(
          (pc) => pc.connectionState === 'connected'
        );
        if (live.length > 0) {
          const round: QualitySample[] = [];
          for (const pc of live) {
            const sample = await collectPeerSample(pc);
            if (sample) round.push(sample);
          }
          if (round.length > 0) {
            windowSamples.push(worstOf(round));
            if (windowSamples.length > 6) windowSamples.shift();
            const verdict = assessQuality(windowSamples, current);
            current = verdict;
            setQualityLevel((prev) => {
              const next = stepLevel(prev, verdict);
              if (next !== prev) {
                console.log(`[WebRTC] Calidad ${verdict}: nivel ${prev} → ${next}`);
              }
              return next;
            });
          }
        }
      } catch {}
      if (!stopped) {
        timer = setTimeout(tick, 6000);
      }
    };
    timer = setTimeout(tick, 6000);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Aplica el escalón: bitrate por sender (sin renegociar), captura
  // reducida por constraints y, al final, video pausado (audio intacto).
  useEffect(() => {
    const cfg = QUALITY_LADDER[qualityLevel];
    for (const pc of peerConnections.current.values()) {
      try {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender && cfg.maxBitrateBps !== null) {
          const params = sender.getParameters();
          sender.setParameters({
            ...params,
            encodings: [{ ...(params.encodings?.[0] ?? {}), maxBitrate: cfg.maxBitrateBps }],
            degradationPreference: qualityLevel >= 2 ? 'maintain-framerate' : 'balanced',
          }).catch(() => {});
        }
      } catch {}
    }
    const track = localVideoTrackRef.current;
    if (track && isCameraOnRef.current && track.readyState === 'live') {
      track.enabled = cfg.videoEnabled;
      if (cfg.captureWidth !== null) {
        track
          .applyConstraints({
            width: { ideal: cfg.captureWidth },
            height: { ideal: cfg.captureHeight ?? 480 },
            frameRate: { ideal: cfg.captureFrameRate ?? 30 },
          })
          .catch(() => {});
      }
    }
  }, [qualityLevel, isCameraOn]);

  // ──────────────────────────────────────────────────────────────────────────
  // Monitor de señal por peer remoto (Rol A, cada 4 s): getStats de recepción
  // (pérdida/jitter de video) + detección de frame congelado (frames que no
  // avanzan ≥ REMOTE_FROZEN_AFTER_MS). Con `weak` el tile muestra avatar +
  // "señal débil"; con `critical` se fuerza audio-only en recepción (se
  // oculta su <video>; su <audio> sigue sonando siempre).
  // ──────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (stopped) return;
      try {
        const entries = [...peerConnections.current.entries()].filter(
          ([, pc]) => pc.connectionState !== 'closed' && pc.connectionState !== 'failed'
        );
        if (entries.length > 0) {
          const now = Date.now();
          const next: Record<string, PeerSignalState> = {};
          for (const [socketId, pc] of entries) {
            try {
              const reception = await collectPeerReception(pc);
              if (!reception) continue;
              let frozen = false;
              if (reception.framesReceived !== null) {
                const prev = lastFramesRef.current.get(socketId);
                if (!prev || prev.frames !== reception.framesReceived) {
                  lastFramesRef.current.set(socketId, { frames: reception.framesReceived, at: now });
                } else if (now - prev.at >= REMOTE_FROZEN_AFTER_MS) {
                  frozen = true;
                }
              }
              next[socketId] = assessPeerSignal({
                videoLossPct: reception.videoLossPct,
                jitterMs: reception.jitterMs,
                frozen,
              });
            } catch {}
          }
          setPeerSignalStates((prev) => {
            const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
            for (const k of keys) {
              const a = prev[k];
              const b = next[k];
              if (!a || !b || a.weak !== b.weak || a.critical !== b.critical || a.frozen !== b.frozen) {
                return next;
              }
            }
            return prev;
          });
        }
      } catch {}
      if (!stopped) {
        timer = setTimeout(tick, 4000);
      }
    };
    timer = setTimeout(tick, 4000);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // ──────────────────────────────────────────────────────────────────────────
  // Socket.IO signaling event listeners
  // ──────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    // 1. Initial room state: Newcomer initiates offers to ALL existing peers
    const onRoomState = (s: {
      peers?: Array<{ socketId: string; userName: string; isLeader: boolean }>;
      mediaStates?: Record<string, { isCameraOn: boolean; isMicOn: boolean; userName?: string }>;
    }) => {
      if (s.peers && s.peers.length > 0) {
        console.log(`[WebRTC] Room state received: connecting to ${s.peers.length} peers`);
        for (const p of s.peers) {
          if (p.socketId && p.socketId !== socket.id) {
            sendOffer(p.socketId, p.userName, p.isLeader);
          }
        }
      }
      if (s.mediaStates) {
        setPeerMediaStates((prev) => ({ ...prev, ...s.mediaStates }));
      }
    };

    // 2. User Joined: prepare connection and announce our media state
    const onUserJoined = (d: { socketId: string; userName: string; isLeader: boolean }) => {
      if (!d.socketId || d.socketId === socket.id) return;
      console.log(`[WebRTC] User joined room: ${d.userName} (${d.socketId})`);
      getOrCreatePeerConnection(d.socketId, d.userName, d.isLeader);
      socket.emit('peer-media-state', {
        roomId,
        userName,
        isCameraOn: isCameraOnRef.current,
        isMicOn: isMicOnRef.current,
      });
    };

    // 3. Receive Offer -> Create Answer
    const onOffer = async (d: {
      senderSocketId: string;
      offer: RTCSessionDescriptionInit;
      callerName: string;
      callerIsLeader: boolean;
    }) => {
      console.log(`[WebRTC] Received offer from ${d.callerName} (${d.senderSocketId})`);
      const pc = getOrCreatePeerConnection(d.senderSocketId, d.callerName, d.callerIsLeader);
      try {
        const isPolite = (socket.id || '') < d.senderSocketId;
        const isMakingOffer = makingOfferRef.current.get(d.senderSocketId) || false;
        const offerCollision = isMakingOffer || pc.signalingState !== 'stable';

        if (offerCollision && !isPolite) {
          console.warn(`[WebRTC] Impolite peer ignoring colliding offer from ${d.senderSocketId}`);
          return;
        }

        await pc.setRemoteDescription(new RTCSessionDescription(d.offer));
        await drainPendingCandidates(d.senderSocketId, pc);

        attachLocalTracksToPC(pc);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit('webrtc-answer', {
          targetSocketId: d.senderSocketId,
          answer: pc.localDescription,
        });
      } catch (err) {
        console.error(`[WebRTC] Error processing offer from ${d.senderSocketId}:`, err);
      }
    };

    // 4. Receive Answer
    const onAnswer = async (d: { senderSocketId: string; answer: RTCSessionDescriptionInit }) => {
      console.log(`[WebRTC] Received answer from ${d.senderSocketId}`);
      const pc = peerConnections.current.get(d.senderSocketId);
      if (!pc) return;
      try {
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(d.answer));
          await drainPendingCandidates(d.senderSocketId, pc);
        }
      } catch (err) {
        console.error(`[WebRTC] Error setting answer from ${d.senderSocketId}:`, err);
      }
    };

    // 5. Receive ICE Candidate
    const onIceCandidate = async (d: { senderSocketId: string; candidate: RTCIceCandidateInit }) => {
      if (!d.candidate) return;
      const pc = peerConnections.current.get(d.senderSocketId);
      if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(d.candidate));
        } catch {}
      } else {
        const q = pendingCandidates.current.get(d.senderSocketId) || [];
        q.push(d.candidate);
        pendingCandidates.current.set(d.senderSocketId, q);
      }
    };

    // 6. Peer Media State updated
    const onPeerMediaState = (d: {
      socketId: string;
      userName: string;
      isCameraOn: boolean;
      isMicOn: boolean;
    }) => {
      if (!d.socketId || d.socketId === socket.id) return;
      // Keep the peer display name fresh (used to match peers with participants)
      const meta = peerMeta.current.get(d.socketId);
      if (meta && d.userName && meta.userName !== d.userName) {
        meta.userName = d.userName;
        syncRemotePeersState();
      }
      updatePeerMediaState(d.socketId, d);
    };

    // 6.1 Participant renamed: refresh peer names so camera tiles stay in sync
    const onParticipantRenamed = (d: { oldName?: string; newName?: string }) => {
      const oldK = (d.oldName || '').trim().toLowerCase();
      const newK = (d.newName || '').trim().toLowerCase();
      if (!oldK || !newK || oldK === newK) return;

      let changed = false;
      peerMeta.current.forEach((meta) => {
        if (meta.userName.trim().toLowerCase() === oldK) {
          meta.userName = d.newName!.trim();
          changed = true;
        }
      });

      setPeerMediaStates((prev) => {
        if (!prev[oldK]) return prev;
        const next = { ...prev };
        next[newK] = { ...next[oldK], userName: d.newName!.trim() };
        delete next[oldK];
        return next;
      });

      if (changed) syncRemotePeersState();
    };

    // 7. Peer Left
    const onUserLeft = (d: { socketId: string; userName?: string }) => {
      console.log(`[WebRTC] Peer disconnected: ${d.socketId}`);
      const pc = peerConnections.current.get(d.socketId);
      if (pc) {
        try { pc.close(); } catch {}
        peerConnections.current.delete(d.socketId);
      }
      dataChannels.current.delete(d.socketId);
      peerMeta.current.delete(d.socketId);
      pendingCandidates.current.delete(d.socketId);
      remoteStreams.current.delete(d.socketId);
      makingOfferRef.current.delete(d.socketId);
      restartAttempts.current.delete(d.socketId);
      lastFramesRef.current.delete(d.socketId);
      const timer = disconnectTimers.current.get(d.socketId);
      if (timer) {
        clearTimeout(timer);
        disconnectTimers.current.delete(d.socketId);
      }
      setPeerSignalStates((prev) => {
        if (!(d.socketId in prev)) return prev;
        const next = { ...prev };
        delete next[d.socketId];
        return next;
      });
      syncRemotePeersState();

      setPeerMediaStates((prev) => {
        const next = { ...prev };
        delete next[d.socketId];
        if (d.userName) delete next[d.userName.trim().toLowerCase()];
        return next;
      });
    };

    socket.on('room-state', onRoomState);
    socket.on('user-joined', onUserJoined);
    socket.on('webrtc-offer', onOffer);
    socket.on('webrtc-answer', onAnswer);
    socket.on('webrtc-ice-candidate', onIceCandidate);
    socket.on('peer-media-state', onPeerMediaState);
    socket.on('user-left', onUserLeft);
    socket.on('participant-renamed', onParticipantRenamed);

    return () => {
      socket.off('room-state', onRoomState);
      socket.off('user-joined', onUserJoined);
      socket.off('webrtc-offer', onOffer);
      socket.off('webrtc-answer', onAnswer);
      socket.off('webrtc-ice-candidate', onIceCandidate);
      socket.off('peer-media-state', onPeerMediaState);
      socket.off('user-left', onUserLeft);
      socket.off('participant-renamed', onParticipantRenamed);
    };
  }, [socket, roomId, userName, sendOffer, getOrCreatePeerConnection, attachLocalTracksToPC, syncRemotePeersState, updatePeerMediaState]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (localAudioTrackRef.current) {
        try { localAudioTrackRef.current.stop(); } catch {}
      }
      if (localVideoTrackRef.current) {
        try { localVideoTrackRef.current.stop(); } catch {}
      }
      peerConnections.current.forEach((pc) => {
        try { pc.close(); } catch {}
      });
      dataChannels.current.clear();
      peerConnections.current.clear();
      pendingCandidates.current.clear();
      peerMeta.current.clear();
      remoteStreams.current.clear();
      makingOfferRef.current.clear();
      restartAttempts.current.clear();
      lastFramesRef.current.clear();
      disconnectTimers.current.forEach((timer) => clearTimeout(timer));
      disconnectTimers.current.clear();
    };
  }, []);

  return {
    localStream,
    remotePeers,
    peerMediaStates,
    peerSignalStates,
    qualityLevel,
    lowBandwidth,
    isMicOn,
    isCameraOn,
    mediaError,
    toggleMic,
    toggleCamera,
    enableMedia,
  };
}
