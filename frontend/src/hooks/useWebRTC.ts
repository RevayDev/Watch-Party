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
  ],
};

export function useWebRTC(socket: Socket | null, userName: string, isHost: boolean) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]);
  const [isMicOn, setIsMicOn] = useState<boolean>(false);
  const [isCameraOn, setIsCameraOn] = useState<boolean>(false);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  // Track pending ICE candidates for before remote description is set
  const pendingCandidates = useRef<Map<string, RTCIceCandidate[]>>(new Map());

  // Enable media (audio + video)
  const enableMedia = useCallback(async (audio = true, video = true): Promise<MediaStream | null> => {
    try {
      setMediaError(null);

      // Stop existing tracks first
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }

      const constraints: MediaStreamConstraints = {
        audio: audio
          ? {
              echoCancellation: true,
              noiseSuppression: true,
              sampleRate: 48000,
            }
          : false,
        video: video
          ? {
              width: { ideal: 640, max: 1280 },
              height: { ideal: 480, max: 720 },
              frameRate: { ideal: 24 },
              facingMode: 'user',
            }
          : false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      // Apply initial enabled states
      stream.getAudioTracks().forEach((track) => {
        track.enabled = audio;
      });
      stream.getVideoTracks().forEach((track) => {
        track.enabled = video;
      });

      localStreamRef.current = stream;
      setLocalStream(stream);
      setIsMicOn(audio);
      setIsCameraOn(video);

      // Replace tracks in all existing peer connections (renegotiation)
      peerConnections.current.forEach((pc) => {
        const senders = pc.getSenders();
        stream.getTracks().forEach((newTrack) => {
          const existingSender = senders.find((s) => s.track?.kind === newTrack.kind);
          if (existingSender) {
            existingSender.replaceTrack(newTrack).catch(console.warn);
          } else {
            pc.addTrack(newTrack, stream);
          }
        });
      });

      return stream;
    } catch (err: any) {
      console.warn('⚠️ No se pudo acceder a la cámara/micrófono:', err.name, err.message);
      if (err.name === 'NotAllowedError') {
        setMediaError('Permiso denegado. Permite el acceso en la barra de tu navegador.');
      } else if (err.name === 'NotFoundError') {
        setMediaError('No se encontró cámara o micrófono en este dispositivo.');
      } else {
        setMediaError(`Error: ${err.message}`);
      }
      return null;
    }
  }, []);

  // Toggle Microphone
  const toggleMic = useCallback(async () => {
    if (!localStreamRef.current) {
      // No stream yet: request audio only first, then video if camera was on
      await enableMedia(true, isCameraOn);
      return;
    }
    const audioTracks = localStreamRef.current.getAudioTracks();
    if (audioTracks.length > 0) {
      const newState = !audioTracks[0].enabled;
      audioTracks[0].enabled = newState;
      setIsMicOn(newState);
    } else {
      // Audio track missing, re-request
      await enableMedia(true, isCameraOn);
    }
  }, [isCameraOn, enableMedia]);

  // Toggle Camera
  const toggleCamera = useCallback(async () => {
    if (!localStreamRef.current) {
      await enableMedia(isMicOn, true);
      return;
    }
    const videoTracks = localStreamRef.current.getVideoTracks();
    if (videoTracks.length > 0) {
      const newState = !videoTracks[0].enabled;
      videoTracks[0].enabled = newState;
      setIsCameraOn(newState);
    } else {
      await enableMedia(isMicOn, true);
    }
  }, [isMicOn, enableMedia]);

  // Create WebRTC Peer Connection for a peer
  const createPeerConnection = useCallback(
    (targetSocketId: string, targetName: string, targetIsHost: boolean): RTCPeerConnection => {
      if (peerConnections.current.has(targetSocketId)) {
        return peerConnections.current.get(targetSocketId)!;
      }

      const pc = new RTCPeerConnection(ICE_SERVERS);
      peerConnections.current.set(targetSocketId, pc);

      // Add local tracks immediately if we have a stream
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      // Send ICE candidates as they are discovered
      pc.onicecandidate = (event) => {
        if (event.candidate && socket) {
          socket.emit('webrtc-ice-candidate', {
            targetSocketId,
            candidate: event.candidate,
          });
        }
      };

      pc.onicegatheringstatechange = () => {
        console.log(`[WebRTC] ICE gathering state → ${pc.iceGatheringState} for ${targetSocketId}`);
      };

      pc.onconnectionstatechange = () => {
        console.log(`[WebRTC] Connection state → ${pc.connectionState} for ${targetSocketId}`);
        if (
          pc.connectionState === 'disconnected' ||
          pc.connectionState === 'failed' ||
          pc.connectionState === 'closed'
        ) {
          peerConnections.current.delete(targetSocketId);
          pendingCandidates.current.delete(targetSocketId);
          setRemotePeers((prev) => prev.filter((p) => p.socketId !== targetSocketId));
        }
      };

      // Handle incoming remote tracks - this is the critical part
      pc.ontrack = (event) => {
        console.log(`[WebRTC] Received remote track from ${targetSocketId}:`, event.track.kind);
        // Use streams[0] if available, otherwise build from track
        const remoteStream = event.streams[0] ?? new MediaStream([event.track]);

        setRemotePeers((prev) => {
          const existing = prev.find((p) => p.socketId === targetSocketId);
          if (existing) {
            return prev.map((p) =>
              p.socketId === targetSocketId ? { ...p, stream: remoteStream } : p
            );
          }
          return [
            ...prev,
            {
              socketId: targetSocketId,
              userName: targetName || 'Invitado',
              isHost: targetIsHost,
              stream: remoteStream,
            },
          ];
        });
      };

      return pc;
    },
    [socket]
  );

  // Apply pending ICE candidates after remote description is set
  const applyPendingCandidates = async (socketId: string, pc: RTCPeerConnection) => {
    const pending = pendingCandidates.current.get(socketId);
    if (pending && pending.length > 0) {
      console.log(`[WebRTC] Applying ${pending.length} pending ICE candidates for ${socketId}`);
      for (const candidate of pending) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (e) {
          console.warn('[WebRTC] Error applying pending ICE candidate:', e);
        }
      }
      pendingCandidates.current.delete(socketId);
    }
  };

  // Set up socket listeners for WebRTC signaling
  useEffect(() => {
    if (!socket) return;

    // 1. New user joined this room: WE send them an offer
    const handleUserJoined = async (data: { socketId: string; userName: string; isHost: boolean }) => {
      if (!data.socketId || data.socketId === socket.id) return;
      console.log(`[WebRTC] New user joined: ${data.userName} (${data.socketId}), sending offer`);

      const pc = createPeerConnection(data.socketId, data.userName, data.isHost);
      try {
        const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
        await pc.setLocalDescription(offer);

        socket.emit('webrtc-offer', {
          targetSocketId: data.socketId,
          offer: pc.localDescription,
          callerName: userName,
          callerIsHost: isHost,
        });
      } catch (e) {
        console.error('[WebRTC] Error creating offer:', e);
      }
    };

    // 2. Room state with existing peers: connect to each
    const handleRoomState = async (state: {
      peers?: Array<{ socketId: string; userName: string; isHost: boolean }>;
    }) => {
      if (!state.peers || state.peers.length === 0) return;
      console.log(`[WebRTC] Room state: ${state.peers.length} existing peers`);

      for (const peer of state.peers) {
        if (peer.socketId === socket.id) continue;
        console.log(`[WebRTC] Connecting to existing peer: ${peer.userName} (${peer.socketId})`);
        const pc = createPeerConnection(peer.socketId, peer.userName, peer.isHost);
        try {
          const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
          await pc.setLocalDescription(offer);

          socket.emit('webrtc-offer', {
            targetSocketId: peer.socketId,
            offer: pc.localDescription,
            callerName: userName,
            callerIsHost: isHost,
          });
        } catch (e) {
          console.error('[WebRTC] Error creating offer for existing peer:', e);
        }
      }
    };

    // 3. Incoming offer: respond with answer
    const handleWebRTCOffer = async (data: {
      senderSocketId: string;
      offer: RTCSessionDescriptionInit;
      callerName: string;
      callerIsHost: boolean;
    }) => {
      console.log(`[WebRTC] Received offer from ${data.callerName} (${data.senderSocketId})`);
      const pc = createPeerConnection(data.senderSocketId, data.callerName, data.callerIsHost);
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        await applyPendingCandidates(data.senderSocketId, pc);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit('webrtc-answer', {
          targetSocketId: data.senderSocketId,
          answer: pc.localDescription,
        });
      } catch (e) {
        console.error('[WebRTC] Error handling offer:', e);
      }
    };

    // 4. Incoming answer: set remote description
    const handleWebRTCAnswer = async (data: { senderSocketId: string; answer: RTCSessionDescriptionInit }) => {
      console.log(`[WebRTC] Received answer from ${data.senderSocketId}`);
      const pc = peerConnections.current.get(data.senderSocketId);
      if (pc) {
        try {
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            await applyPendingCandidates(data.senderSocketId, pc);
          } else {
            console.warn(`[WebRTC] Ignoring answer in state: ${pc.signalingState}`);
          }
        } catch (e) {
          console.error('[WebRTC] Error setting remote answer:', e);
        }
      }
    };

    // 5. ICE Candidate: add or queue if remote description not set yet
    const handleWebRTCIce = async (data: { senderSocketId: string; candidate: RTCIceCandidateInit }) => {
      const pc = peerConnections.current.get(data.senderSocketId);
      if (!data.candidate) return;

      const iceCandidate = new RTCIceCandidate(data.candidate);

      if (pc && pc.remoteDescription) {
        try {
          await pc.addIceCandidate(iceCandidate);
        } catch (e) {
          console.warn('[WebRTC] Error adding ICE candidate:', e);
        }
      } else {
        // Queue the candidate until remote description is set
        const queue = pendingCandidates.current.get(data.senderSocketId) ?? [];
        queue.push(iceCandidate);
        pendingCandidates.current.set(data.senderSocketId, queue);
      }
    };

    // 6. User left
    const handleUserLeft = (data: { socketId: string }) => {
      console.log(`[WebRTC] Peer disconnected: ${data.socketId}`);
      const pc = peerConnections.current.get(data.socketId);
      if (pc) {
        pc.close();
        peerConnections.current.delete(data.socketId);
        pendingCandidates.current.delete(data.socketId);
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
  }, [socket, userName, isHost, createPeerConnection]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      peerConnections.current.forEach((pc) => pc.close());
      peerConnections.current.clear();
      pendingCandidates.current.clear();
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
