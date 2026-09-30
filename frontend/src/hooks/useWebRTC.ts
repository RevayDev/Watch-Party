import { useEffect, useRef, useState, useCallback } from 'react';
import { Socket } from 'socket.io-client';

export interface RemotePeer {
  socketId: string;
  userName: string;
  isHost: boolean;
  stream: MediaStream;
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

export function useWebRTC(socket: Socket | null, userName: string, isHost: boolean) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]);
  const [isMicOn, setIsMicOn] = useState<boolean>(false);
  const [isCameraOn, setIsCameraOn] = useState<boolean>(false);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const peerMeta = useRef<Map<string, { userName: string; isHost: boolean }>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const makingOffer = useRef<Map<string, boolean>>(new Map());
  // Track negotiation-needed debouncing per peer
  const negotiationNeeded = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Keep refs for mic/camera state accessible in callbacks
  const isMicOnRef = useRef(false);
  const isCameraOnRef = useRef(false);

  // ── Helper: replace or add track on ALL peer connections ──────────────
  const replaceTrackOnAllPeers = useCallback((track: MediaStreamTrack, stream: MediaStream) => {
    peerConnections.current.forEach((pc, peerId) => {
      const senders = pc.getSenders();
      const existingSender = senders.find((s) => s.track?.kind === track.kind);
      if (existingSender) {
        existingSender.replaceTrack(track).catch((err) => {
          console.warn(`[WebRTC] replaceTrack(${track.kind}) error for ${peerId}:`, err);
        });
      } else {
        // No existing sender for this kind — find a transceiver to reuse
        const transceiver = pc.getTransceivers().find(
          (t) => t.receiver.track?.kind === track.kind && !t.sender.track
        );
        if (transceiver) {
          transceiver.sender.replaceTrack(track).catch((err) => {
            console.warn(`[WebRTC] replaceTrack on transceiver(${track.kind}) error for ${peerId}:`, err);
          });
        } else {
          try {
            pc.addTrack(track, stream);
          } catch (err) {
            console.warn(`[WebRTC] addTrack(${track.kind}) error for ${peerId}:`, err);
          }
        }
      }
    });
  }, []);

  // ── enableMedia: get or update local media stream ────────────────────
  const enableMedia = useCallback(
    async (audioRequested: boolean, videoRequested: boolean): Promise<MediaStream | null> => {
      try {
        setMediaError(null);

        // If neither requested, disable existing tracks (don't stop them)
        if (!audioRequested && !videoRequested) {
          if (localStreamRef.current) {
            localStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = false));
            localStreamRef.current.getVideoTracks().forEach((t) => (t.enabled = false));
          }
          setIsMicOn(false); isMicOnRef.current = false;
          setIsCameraOn(false); isCameraOnRef.current = false;
          return localStreamRef.current;
        }

        // Build constraints only for newly requested media types
        const needNewAudio = audioRequested && (
          !localStreamRef.current ||
          localStreamRef.current.getAudioTracks().length === 0 ||
          localStreamRef.current.getAudioTracks().every((t) => t.readyState === 'ended')
        );

        const needNewVideo = videoRequested && (
          !localStreamRef.current ||
          localStreamRef.current.getVideoTracks().length === 0 ||
          localStreamRef.current.getVideoTracks().every((t) => t.readyState === 'ended')
        );

        // Re-enable existing tracks if they are still alive
        if (!needNewAudio && audioRequested && localStreamRef.current) {
          localStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = true));
        }
        if (!needNewVideo && videoRequested && localStreamRef.current) {
          localStreamRef.current.getVideoTracks().forEach((t) => (t.enabled = true));
        }

        // Disable tracks that are not requested
        if (!audioRequested && localStreamRef.current) {
          localStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = false));
        }
        if (!videoRequested && localStreamRef.current) {
          localStreamRef.current.getVideoTracks().forEach((t) => (t.enabled = false));
        }

        // If we need new tracks from getUserMedia
        if (needNewAudio || needNewVideo) {
          const constraints: MediaStreamConstraints = {
            audio: needNewAudio
              ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
              : false,
            video: needNewVideo
              ? {
                  width: { ideal: 640, max: 1280 },
                  height: { ideal: 480, max: 720 },
                  frameRate: { ideal: 30 },
                  facingMode: 'user',
                }
              : false,
          };

          const newStream = await navigator.mediaDevices.getUserMedia(constraints);

          // Initialize combined stream from existing or create fresh
          let currentStream = localStreamRef.current;
          if (!currentStream) {
            currentStream = new MediaStream();
          }

          // Process new audio track
          if (needNewAudio) {
            const newAudioTrack = newStream.getAudioTracks()[0];
            if (newAudioTrack) {
              // Stop old audio tracks
              currentStream.getAudioTracks().forEach((t) => {
                currentStream!.removeTrack(t);
                t.stop();
              });
              newAudioTrack.enabled = audioRequested;
              currentStream.addTrack(newAudioTrack);
              // Push to all peer connections
              replaceTrackOnAllPeers(newAudioTrack, currentStream);
            }
          }

          // Process new video track
          if (needNewVideo) {
            const newVideoTrack = newStream.getVideoTracks()[0];
            if (newVideoTrack) {
              // Stop old video tracks
              currentStream.getVideoTracks().forEach((t) => {
                currentStream!.removeTrack(t);
                t.stop();
              });
              newVideoTrack.enabled = videoRequested;
              currentStream.addTrack(newVideoTrack);
              // Push to all peer connections
              replaceTrackOnAllPeers(newVideoTrack, currentStream);
            }
          }

          localStreamRef.current = currentStream;
          setLocalStream(new MediaStream(currentStream.getTracks()));
        } else {
          // No new tracks needed, just re-set the React state to trigger UI update
          if (localStreamRef.current) {
            setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
          }
        }

        setIsMicOn(audioRequested); isMicOnRef.current = audioRequested;
        setIsCameraOn(videoRequested); isCameraOnRef.current = videoRequested;

        return localStreamRef.current;
      } catch (err: any) {
        console.warn('⚠️ Error de acceso a cámara/micrófono:', err.name, err.message);
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setMediaError('Permiso denegado. Permite el acceso a la cámara y micrófono en la barra de direcciones de tu navegador.');
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          setMediaError('No se detectó cámara o micrófono en este dispositivo.');
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          setMediaError('La cámara o micrófono está siendo usado por otra aplicación.');
        } else {
          setMediaError(`Error: ${err.message || err.name}`);
        }
        return null;
      }
    },
    [replaceTrackOnAllPeers]
  );

  // ── Toggle Microphone ──────────────────────────────────────────────────
  const toggleMic = useCallback(async () => {
    const currentStream = localStreamRef.current;
    const audioTrack = currentStream?.getAudioTracks()[0];

    if (audioTrack && audioTrack.readyState === 'live') {
      // Track is alive — just toggle enabled
      const nextState = !audioTrack.enabled;
      audioTrack.enabled = nextState;
      setIsMicOn(nextState); isMicOnRef.current = nextState;
      // Force UI update
      setLocalStream(new MediaStream(currentStream!.getTracks()));
    } else {
      // No audio track or it ended — request new one
      const wantMic = !isMicOnRef.current;
      await enableMedia(wantMic, isCameraOnRef.current);
    }
  }, [enableMedia]);

  // ── Toggle Camera ──────────────────────────────────────────────────────
  const toggleCamera = useCallback(async () => {
    const currentStream = localStreamRef.current;
    const videoTrack = currentStream?.getVideoTracks()[0];

    if (videoTrack && videoTrack.readyState === 'live') {
      // Track is alive — just toggle enabled
      const nextState = !videoTrack.enabled;
      videoTrack.enabled = nextState;
      setIsCameraOn(nextState); isCameraOnRef.current = nextState;
      // Force UI update
      setLocalStream(new MediaStream(currentStream!.getTracks()));
    } else {
      // No video track or it ended — request new one
      const wantCam = !isCameraOnRef.current;
      await enableMedia(isMicOnRef.current, wantCam);
    }
  }, [enableMedia]);

  // ── Drain pending ICE candidates once remote description is set ──────
  const drainPendingCandidates = async (socketId: string, pc: RTCPeerConnection) => {
    const queue = pendingCandidates.current.get(socketId);
    if (queue && queue.length > 0) {
      for (const candidate of queue) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.warn(`[WebRTC] Failed to add queued ICE candidate for ${socketId}:`, e);
        }
      }
      pendingCandidates.current.delete(socketId);
    }
  };

  // ── Create & configure RTCPeerConnection for a remote peer ───────────
  const getOrCreatePeerConnection = useCallback(
    (targetSocketId: string, targetName: string, targetIsHost: boolean): RTCPeerConnection => {
      peerMeta.current.set(targetSocketId, { userName: targetName, isHost: targetIsHost });

      if (peerConnections.current.has(targetSocketId)) {
        return peerConnections.current.get(targetSocketId)!;
      }

      console.log(`[WebRTC] Creating RTCPeerConnection for ${targetName} (${targetSocketId})`);
      const pc = new RTCPeerConnection(ICE_SERVERS);
      peerConnections.current.set(targetSocketId, pc);

      // ── Add transceivers FIRST (before adding tracks) so both sides have matching m-lines
      const existingKinds = new Set(pc.getTransceivers().map((t) => t.receiver.track?.kind));
      if (!existingKinds.has('audio')) {
        pc.addTransceiver('audio', { direction: 'sendrecv' });
      }
      if (!existingKinds.has('video')) {
        pc.addTransceiver('video', { direction: 'sendrecv' });
      }

      // ── Add existing local tracks (replace on the transceivers we just created)
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          if (track.readyState === 'live') {
            const transceiver = pc.getTransceivers().find(
              (t) => t.receiver.track?.kind === track.kind && !t.sender.track
            );
            if (transceiver) {
              transceiver.sender.replaceTrack(track).catch((err) => {
                console.warn(`[WebRTC] Initial replaceTrack error:`, err);
              });
              transceiver.direction = 'sendrecv';
            } else {
              try {
                pc.addTrack(track, localStreamRef.current!);
              } catch (err) {
                console.warn(`[WebRTC] Initial addTrack error:`, err);
              }
            }
          }
        });
      }

      // ── ICE candidates → send to remote via Socket.IO
      pc.onicecandidate = (event) => {
        if (event.candidate && socket) {
          socket.emit('webrtc-ice-candidate', {
            targetSocketId,
            candidate: event.candidate,
          });
        }
      };

      // ── Handle receiving remote tracks
      pc.ontrack = (event) => {
        console.log(`[WebRTC] Received remote track (${event.track.kind}) from ${targetSocketId}`);

        // Use the stream from the event, or wrap the track
        const remoteStream = event.streams[0] || new MediaStream([event.track]);
        const meta = peerMeta.current.get(targetSocketId) || { userName: targetName, isHost: targetIsHost };

        setRemotePeers((prev) => {
          const existing = prev.find((p) => p.socketId === targetSocketId);
          if (existing) {
            // Add the track to the existing stream object to keep it in sync
            const existingTrackIds = existing.stream.getTracks().map((t) => t.id);
            if (!existingTrackIds.includes(event.track.id)) {
              existing.stream.addTrack(event.track);
            }
            // Force React update by creating new array
            return prev.map((p) =>
              p.socketId === targetSocketId
                ? { ...p, stream: existing.stream, userName: meta.userName || p.userName }
                : p
            );
          }
          return [
            ...prev,
            {
              socketId: targetSocketId,
              userName: meta.userName || targetName || 'Participante',
              isHost: meta.isHost,
              stream: remoteStream,
            },
          ];
        });
      };

      pc.oniceconnectionstatechange = () => {
        console.log(`[WebRTC] ICE connection with ${targetSocketId} → ${pc.iceConnectionState}`);
        if (pc.iceConnectionState === 'failed') {
          pc.restartIce();
        }
        if (pc.iceConnectionState === 'disconnected') {
          // Give it a few seconds to recover before cleanup
          setTimeout(() => {
            if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
              pc.restartIce();
            }
          }, 3000);
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(`[WebRTC] Connection with ${targetSocketId} → ${pc.connectionState}`);
        if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
          peerConnections.current.delete(targetSocketId);
          pendingCandidates.current.delete(targetSocketId);
          setRemotePeers((prev) => prev.filter((p) => p.socketId !== targetSocketId));
        }
      };

      return pc;
    },
    [socket]
  );

  // ── Setup Socket signaling listeners ─────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    // W3C Perfect Negotiation: the "polite" peer is the one whose socket.id
    // is lexicographically greater. The polite peer yields (rolls back) on collision.
    const isPolitePeer = (targetSocketId: string) => {
      return (socket.id || '').localeCompare(targetSocketId) > 0;
    };

    // ── Send an offer to a target peer ───────────────────────────────
    const initiateOffer = async (targetSocketId: string, targetName: string, targetIsHost: boolean) => {
      const pc = getOrCreatePeerConnection(targetSocketId, targetName, targetIsHost);
      try {
        makingOffer.current.set(targetSocketId, true);
        const offer = await pc.createOffer();
        // Re-check signaling state after async createOffer
        if (pc.signalingState !== 'stable') {
          console.warn(`[WebRTC] Signaling state not stable after createOffer for ${targetSocketId}, aborting.`);
          return;
        }
        await pc.setLocalDescription(offer);
        socket.emit('webrtc-offer', {
          targetSocketId,
          offer: pc.localDescription,
          callerName: userName,
          callerIsHost: isHost,
        });
      } catch (err) {
        console.error('[WebRTC] Error creating offer:', err);
      } finally {
        makingOffer.current.set(targetSocketId, false);
      }
    };

    // 1. A new user joined → existing users initiate offers
    const handleUserJoined = async (data: { socketId: string; userName: string; isHost: boolean }) => {
      if (!data.socketId || data.socketId === socket.id) return;
      console.log(`[WebRTC] New user joined: ${data.userName} (${data.socketId}) → Sending offer`);
      await initiateOffer(data.socketId, data.userName, data.isHost);
    };

    // 2. Room state with existing peers — the NEW joiner creates connections
    //    but does NOT initiate offers (existing peers will send offers via user-joined)
    const handleRoomState = async (state: {
      peers?: Array<{ socketId: string; userName: string; isHost: boolean }>;
    }) => {
      if (!state.peers || state.peers.length === 0) return;
      console.log(`[WebRTC] Room has ${state.peers.length} existing peer(s)`);
      for (const peer of state.peers) {
        if (!peer.socketId || peer.socketId === socket.id) continue;
        // Pre-create the peer connection so it's ready when the offer arrives
        getOrCreatePeerConnection(peer.socketId, peer.userName, peer.isHost);
      }
    };

    // 3. Received WebRTC Offer — Perfect Negotiation Pattern
    const handleWebRTCOffer = async (data: {
      senderSocketId: string;
      offer: RTCSessionDescriptionInit;
      callerName: string;
      callerIsHost: boolean;
    }) => {
      console.log(`[WebRTC] Received offer from ${data.callerName} (${data.senderSocketId})`);
      const pc = getOrCreatePeerConnection(data.senderSocketId, data.callerName, data.callerIsHost);
      const polite = isPolitePeer(data.senderSocketId);

      try {
        const offerCollision =
          data.offer.type === 'offer' &&
          (makingOffer.current.get(data.senderSocketId) || pc.signalingState !== 'stable');

        if (offerCollision) {
          if (!polite) {
            // Impolite peer ignores the incoming offer
            console.log(`[WebRTC] Impolite peer ignoring colliding offer from ${data.senderSocketId}`);
            return;
          }
          // Polite peer rolls back its own pending offer
          console.log(`[WebRTC] Polite peer rolling back for ${data.senderSocketId}`);
          await pc.setLocalDescription({ type: 'rollback' });
        }

        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        await drainPendingCandidates(data.senderSocketId, pc);

        if (data.offer.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit('webrtc-answer', {
            targetSocketId: data.senderSocketId,
            answer: pc.localDescription,
          });
        }
      } catch (err) {
        console.error(`[WebRTC] Error handling offer from ${data.senderSocketId}:`, err);
      }
    };

    // 4. Received WebRTC Answer
    const handleWebRTCAnswer = async (data: {
      senderSocketId: string;
      answer: RTCSessionDescriptionInit;
    }) => {
      console.log(`[WebRTC] Received answer from ${data.senderSocketId}`);
      const pc = peerConnections.current.get(data.senderSocketId);
      if (!pc) return;

      try {
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
          await drainPendingCandidates(data.senderSocketId, pc);
        } else {
          console.warn(`[WebRTC] Ignoring answer from ${data.senderSocketId}, state: ${pc.signalingState}`);
        }
      } catch (err) {
        console.error(`[WebRTC] Error setting remote answer from ${data.senderSocketId}:`, err);
      }
    };

    // 5. Received ICE Candidate
    const handleWebRTCIce = async (data: {
      senderSocketId: string;
      candidate: RTCIceCandidateInit;
    }) => {
      if (!data.candidate) return;
      const pc = peerConnections.current.get(data.senderSocketId);

      if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
          // Non-critical: can happen during renegotiation
          if (!(err instanceof DOMException && err.name === 'InvalidStateError')) {
            console.warn(`[WebRTC] Error adding ICE candidate from ${data.senderSocketId}:`, err);
          }
        }
      } else {
        // Queue for later
        const queue = pendingCandidates.current.get(data.senderSocketId) || [];
        queue.push(data.candidate);
        pendingCandidates.current.set(data.senderSocketId, queue);
      }
    };

    // 6. Remote peer left
    const handleUserLeft = (data: { socketId: string }) => {
      console.log(`[WebRTC] Peer disconnected: ${data.socketId}`);
      const pc = peerConnections.current.get(data.socketId);
      if (pc) {
        pc.close();
        peerConnections.current.delete(data.socketId);
        pendingCandidates.current.delete(data.socketId);
        peerMeta.current.delete(data.socketId);
        makingOffer.current.delete(data.socketId);
      }
      setRemotePeers((prev) => prev.filter((p) => p.socketId !== data.socketId));
    };

    socket.on('user-joined', handleUserJoined);
    socket.on('room-state', handleRoomState);
    socket.on('webrtc-offer', handleWebRTCOffer);
    socket.on('webrtc-answer', handleWebRTCAnswer);
    socket.on('webrtc-ice-candidate', handleWebRTCIce);
    socket.on('user-left', handleUserLeft);

    return () => {
      socket.off('user-joined', handleUserJoined);
      socket.off('room-state', handleRoomState);
      socket.off('webrtc-offer', handleWebRTCOffer);
      socket.off('webrtc-answer', handleWebRTCAnswer);
      socket.off('webrtc-ice-candidate', handleWebRTCIce);
      socket.off('user-left', handleUserLeft);
    };
  }, [socket, userName, isHost, getOrCreatePeerConnection]);

  // ── Clean up all connections and tracks on unmount ────────────────────
  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      peerConnections.current.forEach((pc) => pc.close());
      peerConnections.current.clear();
      pendingCandidates.current.clear();
      peerMeta.current.clear();
      negotiationNeeded.current.forEach((timer) => clearTimeout(timer));
      negotiationNeeded.current.clear();
    };
  }, []);

  return {
    localStream,
    remotePeers,
    isMicOn,
    isCameraOn,
    mediaError,
    toggleMic,
    toggleCamera,
    enableMedia,
  };
}
