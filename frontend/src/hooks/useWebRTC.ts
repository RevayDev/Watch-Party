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
  const ignoreOffer = useRef<Map<string, boolean>>(new Map());

  // Helper to attach/replace local tracks on all active peer connections
  const updateTracksOnPeers = useCallback((stream: MediaStream) => {
    peerConnections.current.forEach((pc, targetSocketId) => {
      const senders = pc.getSenders();
      stream.getTracks().forEach((track) => {
        const sender = senders.find((s) => s.track?.kind === track.kind);
        if (sender) {
          sender.replaceTrack(track).catch((err) => {
            console.warn(`[WebRTC] replaceTrack error for ${targetSocketId}:`, err);
          });
        } else {
          try {
            pc.addTrack(track, stream);
          } catch (err) {
            console.warn(`[WebRTC] addTrack error for ${targetSocketId}:`, err);
          }
        }
      });
    });
  }, []);

  // Request/Update local MediaStream (Microphone and/or Camera)
  const enableMedia = useCallback(
    async (audioRequested: boolean, videoRequested: boolean): Promise<MediaStream | null> => {
      try {
        setMediaError(null);

        // If neither is requested, just mute tracks if they exist
        if (!audioRequested && !videoRequested) {
          if (localStreamRef.current) {
            localStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = false));
            localStreamRef.current.getVideoTracks().forEach((t) => (t.enabled = false));
          }
          setIsMicOn(false);
          setIsCameraOn(false);
          return localStreamRef.current;
        }

        const constraints: MediaStreamConstraints = {
          audio: audioRequested
            ? {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              }
            : false,
          video: videoRequested
            ? {
                width: { ideal: 640, max: 1280 },
                height: { ideal: 480, max: 720 },
                frameRate: { ideal: 30 },
                facingMode: 'user',
              }
            : false,
        };

        const newStream = await navigator.mediaDevices.getUserMedia(constraints);
        const combinedTracks: MediaStreamTrack[] = [];

        // Add audio track
        const newAudio = newStream.getAudioTracks()[0];
        if (newAudio) {
          newAudio.enabled = audioRequested;
          combinedTracks.push(newAudio);
          localStreamRef.current?.getAudioTracks().forEach((t) => {
            if (t !== newAudio) t.stop();
          });
        } else if (localStreamRef.current) {
          localStreamRef.current.getAudioTracks().forEach((t) => {
            t.enabled = audioRequested;
            combinedTracks.push(t);
          });
        }

        // Add video track
        const newVideo = newStream.getVideoTracks()[0];
        if (newVideo) {
          newVideo.enabled = videoRequested;
          combinedTracks.push(newVideo);
          localStreamRef.current?.getVideoTracks().forEach((t) => {
            if (t !== newVideo) t.stop();
          });
        } else if (localStreamRef.current) {
          localStreamRef.current.getVideoTracks().forEach((t) => {
            t.enabled = videoRequested;
            combinedTracks.push(t);
          });
        }

        const activeStream = new MediaStream(combinedTracks);
        localStreamRef.current = activeStream;
        setLocalStream(activeStream);
        setIsMicOn(audioRequested);
        setIsCameraOn(videoRequested);

        updateTracksOnPeers(activeStream);
        return activeStream;
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
    [updateTracksOnPeers]
  );

  // Toggle Microphone
  const toggleMic = useCallback(async () => {
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    if (audioTrack) {
      const nextState = !audioTrack.enabled;
      audioTrack.enabled = nextState;
      setIsMicOn(nextState);
    } else {
      await enableMedia(!isMicOn, isCameraOn);
    }
  }, [isMicOn, isCameraOn, enableMedia]);

  // Toggle Camera
  const toggleCamera = useCallback(async () => {
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (videoTrack) {
      const nextState = !videoTrack.enabled;
      videoTrack.enabled = nextState;
      setIsCameraOn(nextState);
    } else {
      await enableMedia(isMicOn, !isCameraOn);
    }
  }, [isCameraOn, isMicOn, enableMedia]);

  // Apply queued ICE candidates once remote description is set
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

  // Create & configure RTCPeerConnection for target peer
  const getOrCreatePeerConnection = useCallback(
    (targetSocketId: string, targetName: string, targetIsHost: boolean): RTCPeerConnection => {
      peerMeta.current.set(targetSocketId, { userName: targetName, isHost: targetIsHost });

      if (peerConnections.current.has(targetSocketId)) {
        return peerConnections.current.get(targetSocketId)!;
      }

      console.log(`[WebRTC] Creating RTCPeerConnection for ${targetName} (${targetSocketId})`);
      const pc = new RTCPeerConnection(ICE_SERVERS);
      peerConnections.current.set(targetSocketId, pc);

      // Add existing local tracks
      if (localStreamRef.current && localStreamRef.current.getTracks().length > 0) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      // Add transceivers for audio & video to receive remote media
      try {
        const senders = pc.getSenders();
        if (!senders.some(s => s.track?.kind === 'audio')) {
          pc.addTransceiver('audio', { direction: 'sendrecv' });
        }
        if (!senders.some(s => s.track?.kind === 'video')) {
          pc.addTransceiver('video', { direction: 'sendrecv' });
        }
      } catch (err) {
        console.warn('[WebRTC] Transceiver setup error:', err);
      }

      // Send local ICE candidates to remote peer via Socket.IO
      pc.onicecandidate = (event) => {
        if (event.candidate && socket) {
          socket.emit('webrtc-ice-candidate', {
            targetSocketId,
            candidate: event.candidate,
          });
        }
      };

      // Handle receiving remote tracks
      pc.ontrack = (event) => {
        console.log(`[WebRTC] Received remote track (${event.track.kind}) from ${targetSocketId}`);
        const remoteStream = event.streams[0] || new MediaStream([event.track]);
        const meta = peerMeta.current.get(targetSocketId) || { userName: targetName, isHost: targetIsHost };

        setRemotePeers((prev) => {
          const index = prev.findIndex((p) => p.socketId === targetSocketId);
          if (index !== -1) {
            const updated = [...prev];
            updated[index] = {
              ...updated[index],
              stream: remoteStream,
              userName: meta.userName || updated[index].userName,
            };
            return updated;
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
      };

      pc.onconnectionstatechange = () => {
        console.log(`[WebRTC] Connection with ${targetSocketId} → ${pc.connectionState}`);
        if (pc.connectionState === 'closed') {
          peerConnections.current.delete(targetSocketId);
          pendingCandidates.current.delete(targetSocketId);
          setRemotePeers((prev) => prev.filter((p) => p.socketId !== targetSocketId));
        }
      };

      return pc;
    },
    [socket]
  );

  // Setup Socket signaling listeners
  useEffect(() => {
    if (!socket) return;

    // Helper: Determine if we are the "polite" peer.
    // The polite peer rolls back its offer when a collision (glare) occurs.
    const isPolitePeer = (targetSocketId: string) => {
      return (socket.id || '').localeCompare(targetSocketId) > 0;
    };

    // Helper to send an offer
    const initiateOffer = async (targetSocketId: string, targetName: string, targetIsHost: boolean) => {
      const pc = getOrCreatePeerConnection(targetSocketId, targetName, targetIsHost);
      try {
        makingOffer.current.set(targetSocketId, true);
        const offer = await pc.createOffer();
        if (pc.signalingState !== 'stable') return;
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

    // 1. A new user joined the room -> The existing peer initiates the offer
    const handleUserJoined = async (data: { socketId: string; userName: string; isHost: boolean }) => {
      if (!data.socketId || data.socketId === socket.id) return;
      console.log(`[WebRTC] New user joined room: ${data.userName} (${data.socketId}) -> Initiating offer`);
      await initiateOffer(data.socketId, data.userName, data.isHost);
    };

    // 2. Initial list of existing peers from room-state
    const handleRoomState = async (state: {
      peers?: Array<{ socketId: string; userName: string; isHost: boolean }>;
    }) => {
      if (!state.peers || state.peers.length === 0) return;
      console.log(`[WebRTC] Received ${state.peers.length} existing peers from room-state`);
      for (const peer of state.peers) {
        if (!peer.socketId || peer.socketId === socket.id) continue;
        // Register peer connection locally so transceivers and ICE are ready
        getOrCreatePeerConnection(peer.socketId, peer.userName, peer.isHost);
      }
    };

    // 3. Received WebRTC Offer from a remote peer (W3C Perfect Negotiation Pattern)
    const handleWebRTCOffer = async (data: {
      senderSocketId: string;
      offer: RTCSessionDescriptionInit;
      callerName: string;
      callerIsHost: boolean;
    }) => {
      console.log(`[WebRTC] Received offer from ${data.callerName} (${data.senderSocketId})`);
      const pc = getOrCreatePeerConnection(data.senderSocketId, data.callerName, data.callerIsHost);
      const isPolite = isPolitePeer(data.senderSocketId);

      try {
        const isOfferCollision =
          data.offer.type === 'offer' &&
          (makingOffer.current.get(data.senderSocketId) || pc.signalingState !== 'stable');

        ignoreOffer.current.set(data.senderSocketId, !isPolite && isOfferCollision);
        if (ignoreOffer.current.get(data.senderSocketId)) {
          console.log(`[WebRTC] Impolite peer ignoring colliding offer from ${data.senderSocketId}`);
          return;
        }

        if (isOfferCollision && isPolite) {
          console.log(`[WebRTC] Polite peer rolling back colliding offer for ${data.senderSocketId}`);
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
      if (pc) {
        try {
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            await drainPendingCandidates(data.senderSocketId, pc);
          } else {
            console.warn(`[WebRTC] Skipping answer from ${data.senderSocketId}, state: ${pc.signalingState}`);
          }
        } catch (err) {
          console.error(`[WebRTC] Error setting remote answer from ${data.senderSocketId}:`, err);
        }
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
          console.warn(`[WebRTC] Error adding ICE candidate from ${data.senderSocketId}:`, err);
        }
      } else {
        const queue = pendingCandidates.current.get(data.senderSocketId) || [];
        queue.push(data.candidate);
        pendingCandidates.current.set(data.senderSocketId, queue);
      }
    };

    // 6. Remote peer left the room
    const handleUserLeft = (data: { socketId: string }) => {
      console.log(`[WebRTC] Peer disconnected: ${data.socketId}`);
      const pc = peerConnections.current.get(data.socketId);
      if (pc) {
        pc.close();
        peerConnections.current.delete(data.socketId);
        pendingCandidates.current.delete(data.socketId);
        peerMeta.current.delete(data.socketId);
        makingOffer.current.delete(data.socketId);
        ignoreOffer.current.delete(data.socketId);
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

  // Clean up all Peer Connections and local tracks on unmount
  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      peerConnections.current.forEach((pc) => pc.close());
      peerConnections.current.clear();
      pendingCandidates.current.clear();
      peerMeta.current.clear();
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


