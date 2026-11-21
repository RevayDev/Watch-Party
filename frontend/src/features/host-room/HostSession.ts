import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import type { WebRTCTransport } from '../../hooks/useWebRTC';
import {
  applyHostCommand, CHUNK_BYTES, commandSchema, envelopeSchema, MAX_HOST_MEMBERS, MAX_VIDEO_BYTES,
  type HostCommand, type HostEnvelope, type HostMember, type HostRoomOptions, type HostSnapshot, type HostVideo,
} from './protocol';

export interface HostSessionView {
  id: string;
  state: HostSnapshot | null;
  status: string;
  error: string;
  fileUrl: string | null;
  fileProgress: number;
  replicas: number;
}

interface IncomingFile {
  video: HostVideo;
  chunks: ArrayBuffer[];
  received: number;
}

const digest = async (blob: Blob) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
  .map((byte) => byte.toString(16).padStart(2, '0')).join('');

export class HostSession implements WebRTCTransport {
  id = '';
  connected = false;
  private peer: Peer | null = null;
  private directory: Peer | null = null;
  private directoryConnection: DataConnection | null = null;
  private connections = new Map<string, DataConnection>();
  private pendingConnections = new Map<string, DataConnection>();
  private authorized = new Map<DataConnection, HostMember>();
  private listeners = new Map<string, Map<unknown, (data: unknown) => void>>();
  private state: HostSnapshot | null = null;
  private status = 'Conectando con la señalización…';
  private error = '';
  private stopped = false;
  private lastHostSeen = Date.now();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastJoin = 0;
  private startedAt = Date.now();
  private joinedAt = Date.now();
  private files = new Map<string, Blob>();
  private incoming = new Map<DataConnection, IncomingFile>();
  private sending = new Map<DataConnection, string>();
  private ready = new Map<string, string>();
  private announced = new Set<string>();
  private offlineSince = new Map<string, number>();
  private pendingChat = new Map<string, Extract<HostCommand, { type: 'chat' }>>();
  private fileUrl: string | null = null;
  private fileId: string | null = null;
  private fileProgress = 0;
  private claiming = false;
  private claimAt = 0;
  private peerOptions: PeerOptions;
  private authenticationKey: Promise<CryptoKey>;
  private hellos = new Map<DataConnection, Promise<void>>();

  constructor(private options: HostRoomOptions, private update: (view: HostSessionView) => void, peerOptions?: PeerOptions) {
    this.authenticationKey = crypto.subtle.importKey(
      'raw', new TextEncoder().encode(options.key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
    );
    const host = import.meta.env.VITE_PEER_HOST as string | undefined;
    this.peerOptions = peerOptions ?? (host ? {
      host, port: Number(import.meta.env.VITE_PEER_PORT || 443),
      path: import.meta.env.VITE_PEER_PATH || '/', secure: true,
    } : {});
  }

  get snapshot() { return this.state; }
  get isHost() { return !!this.id && this.state?.hostId === this.id; }
  private get directoryId() { return `watch-party-${this.options.roomId}`; }
  private get self(): HostMember { return { id: this.id, name: this.options.name, joinedAt: this.joinedAt }; }

  on<Args extends unknown[]>(event: string, listener: (...args: Args) => void) {
    const listeners = this.listeners.get(event) ?? new Map<unknown, (data: unknown) => void>();
    listeners.set(listener, (data) => Reflect.apply(listener, undefined, [data]));
    this.listeners.set(event, listeners);
    if (event === 'room-state') {
      // React may subscribe after the data mesh has already opened.
      void Promise.resolve().then(() => {
        if (this.stopped || !this.listeners.get(event)?.has(listener) || !this.state) return;
        Reflect.apply(listener, undefined, [{
          peers: this.state.members.filter((member) => member.id !== this.id && this.connections.get(member.id)?.open)
            .map((member) => ({ socketId: member.id, userName: member.name, isLeader: member.id === this.state!.hostId })),
        }]);
      });
    }
  }
  off<Args extends unknown[]>(event: string, listener: (...args: Args) => void) { this.listeners.get(event)?.delete(listener); }
  private publish(event: string, data?: unknown) {
    this.listeners.get(event)?.forEach((listener) => listener(data));
  }
  private notify() {
    if (this.stopped) return;
    this.update({
      id: this.id, state: this.state, status: this.status, error: this.error,
      fileUrl: this.fileUrl, fileProgress: this.fileProgress,
      replicas: [...this.ready].filter(([member, videoId]) =>
        member !== this.id && videoId === this.state?.video?.id && this.state?.members.some((entry) => entry.id === member)).length,
    });
  }

  start() {
    const peer = new Peer(this.peerOptions);
    this.peer = peer;
    peer.on('open', (id) => {
      if (this.stopped) return;
      this.id = id;
      this.connected = true;
      this.notify();
      if (this.options.create && !this.state) this.claimDirectory();
      else this.findHost();
    });
    peer.on('connection', (connection) => this.attach(connection));
    peer.on('disconnected', () => {
      if (this.stopped) return;
      this.status = 'Reconectando señalización. Las conexiones activas pueden continuar.';
      this.notify();
    });
    peer.on('error', (error) => {
      if (this.stopped) return;
      if (error.type !== 'peer-unavailable') {
        this.error = 'No se pudo establecer una conexión entre navegadores. Revisa la red y la señalización.';
        this.notify();
      }
    });
    this.timer = setInterval(() => this.tick(), 2000);
    return this;
  }

  private send(connection: DataConnection | undefined | null, packet: HostEnvelope) {
    if (!connection?.open) return;
    if (packet.type === 'hello') {
      connection.send(packet);
    } else {
      void this.hellos.get(connection)?.then(() => {
        if (connection.open && !this.stopped) connection.send(packet);
      });
    }
  }
  private broadcast(packet: HostEnvelope) {
    for (const connection of this.connections.values()) this.send(connection, packet);
  }

  private findHost() {
    if (!this.peer?.open || this.stopped || this.directoryConnection) return;
    this.lastJoin = Date.now();
    const connection = this.peer.connect(this.directoryId, { reliable: true });
    this.directoryConnection = connection;
    this.attach(connection, true);
  }

  private claimDirectory() {
    if (this.stopped || this.claiming || !this.peer?.open || this.directory?.open) return;
    this.claiming = true;
    this.claimAt = Date.now();
    const directory = new Peer(this.directoryId, this.peerOptions);
    this.directory = directory;
    directory.on('open', () => {
      if (this.stopped) return;
      this.claiming = false;
      const previousHost = this.state?.hostId;
      const members = this.state?.members.filter((member) => member.id !== previousHost || member.id === this.id) ?? [];
      if (!members.some((member) => member.id === this.id)) members.push(this.self);
      this.state = this.state ? {
        ...this.state, revision: this.state.revision + 1, hostId: this.id, members,
      } : {
        revision: 0, hostId: this.id, members, messages: [], video: null, playback: null,
        automaticMigration: true, replicateVideo: true,
        musicQueue: [], musicNowPlaying: null,
      };
      this.status = 'Servidor en tu navegador';
      this.error = '';
      this.commit();
      this.flushChat();
      if (previousHost && previousHost !== this.id) {
        this.publish('user-left', { socketId: previousHost });
      }
    });
    directory.on('connection', (connection) => this.attach(connection, false, true));
    directory.on('disconnected', () => {
      if (!this.stopped && !directory.destroyed) directory.reconnect();
    });
    directory.on('error', () => {
      if (this.directory !== directory || this.stopped) return;
      this.claiming = false;
      directory.destroy();
      this.directory = null;
      this.findHost();
    });
  }

  private authenticationInput(senderEndpoint: string, receiverEndpoint: string, member: HostMember) {
    return new TextEncoder().encode(JSON.stringify([this.options.roomId, senderEndpoint, receiverEndpoint, member]));
  }

  private attach(connection: DataConnection, discovery = false, directoryEndpoint = false) {
    const localEndpoint = directoryEndpoint ? this.directoryId : this.id;
    let authenticate: Promise<boolean> | undefined;
    const timeout = setTimeout(() => {
      if (!this.authorized.has(connection)) {
        if (this.pendingConnections.get(connection.peer) === connection) this.pendingConnections.delete(connection.peer);
        if (this.directoryConnection === connection) this.directoryConnection = null;
        connection.close();
      }
    }, 10_000);
    connection.on('open', () => {
      const hello = (async () => {
        const signature = await crypto.subtle.sign('HMAC', await this.authenticationKey,
          this.authenticationInput(localEndpoint, connection.peer, this.self));
        const proof = [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
        this.send(connection, { type: 'hello', proof, member: this.self });
      })().catch(() => connection.close());
      this.hellos.set(connection, hello);
    });
    connection.on('data', async (input) => {
      if (this.stopped) return;
      const packet = envelopeSchema.safeParse(input);
      if (!packet.success) {
        this.publish('protocol-error', packet.error.issues.map((issue) => ({ path: issue.path, code: issue.code })));
        connection.close();
        return;
      }
      const message = packet.data;
      if (message.type === 'hello') {
        if (authenticate || this.authorized.has(connection)) return;
        authenticate = (async () => {
          const signature = Uint8Array.from(message.proof.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
          return crypto.subtle.verify('HMAC', await this.authenticationKey, signature,
            this.authenticationInput(connection.peer, localEndpoint, message.member));
        })().catch(() => false);
        if (!await authenticate || this.stopped || !connection.open || (!discovery && message.member.id !== connection.peer)) {
          connection.close();
          return;
        }
        clearTimeout(timeout);
        this.authorized.set(connection, message.member);
        if (discovery) return;
        const existing = this.connections.get(message.member.id);
        if (existing && existing !== connection && existing.open) {
          connection.close();
          return;
        }
        if (!this.state?.members.some((member) => member.id === message.member.id)) {
          if (!this.isHost || !this.directory?.open) { connection.close(); return; }
          if ((this.state?.members.length ?? 0) >= MAX_HOST_MEMBERS) {
            this.send(connection, { type: 'error', message: 'Esta sala admite hasta 8 participantes.' });
            setTimeout(() => connection.close(), 250);
            return;
          }
          if (this.state!.members.some((member) => member.name.toLowerCase() === message.member.name.toLowerCase())) {
            this.send(connection, { type: 'error', message: 'Ya existe alguien con ese nombre. Entra con otro.' });
            setTimeout(() => connection.close(), 250);
            return;
          }
          this.state = { ...this.state!, revision: this.state!.revision + 1, members: [...this.state!.members, message.member] };
        }
        this.connections.set(message.member.id, connection);
        if (this.pendingConnections.get(message.member.id) === connection) this.pendingConnections.delete(message.member.id);
        this.offlineSince.delete(message.member.id);
        if (!this.announced.has(message.member.id)) {
          this.announced.add(message.member.id);
          this.publish('room-state', { peers: [{
            socketId: message.member.id, userName: message.member.name,
            isLeader: message.member.id === this.state?.hostId,
          }] });
        }
        if (this.isHost) this.commit();
        if (message.member.id === this.state?.hostId) this.flushChat();
        if (this.fileId) this.send(connection, { type: 'file-ready', videoId: this.fileId });
        return;
      }
      if (authenticate) await authenticate;
      const sender = this.authorized.get(connection);
      if (!sender) return;
      if (message.type === 'error') {
        this.error = message.message;
        this.notify();
        return;
      }
      if (message.type === 'snapshot') {
        if (message.state.hostId !== sender.id) return;
        const currentHostAlive = this.connections.get(this.state?.hostId ?? '')?.open;
        if (!discovery && this.state && sender.id !== this.state.hostId && currentHostAlive) return;
        if (this.state?.hostId === sender.id && message.state.revision < this.state.revision) return;
        this.accept(message.state);
        if (discovery) {
          this.directoryConnection = null;
          connection.close();
        }
        return;
      }
      if (discovery || !this.state?.members.some((member) => member.id === sender.id)) return;
      if (sender.id === this.state.hostId) this.lastHostSeen = Date.now();
      if (message.type === 'ping') { this.send(connection, { type: 'pong' }); return; }
      if (message.type === 'pong') return;
      if (message.type === 'command') {
        if (!this.isHost) return;
        this.state = applyHostCommand(this.state, sender.id, message.command);
        this.commit();
      } else if (message.type === 'signal') {
        this.publish(message.event, { ...message.payload, senderSocketId: sender.id, socketId: sender.id, userName: sender.name, callerName: sender.name });
      } else {
        void this.receiveFile(connection, sender, message).catch(() => {
          this.incoming.delete(connection);
          this.error = 'La copia del video falló. Puedes reintentar desde Servidor.';
          this.notify();
        });
      }
    });
    connection.on('close', () => {
      clearTimeout(timeout);
      this.incoming.delete(connection);
      this.hellos.delete(connection);
      if (this.pendingConnections.get(connection.peer) === connection) this.pendingConnections.delete(connection.peer);
      const member = this.authorized.get(connection);
      this.authorized.delete(connection);
      if (member && this.connections.get(member.id) === connection) {
        this.connections.delete(member.id);
        this.ready.delete(member.id);
        this.announced.delete(member.id);
        this.offlineSince.set(member.id, Date.now());
        this.publish('user-left', { socketId: member.id, userName: member.name });
      }
      if (this.directoryConnection === connection) this.directoryConnection = null;
      this.notify();
    });
    connection.on('error', () => connection.close());
  }

  private accept(state: HostSnapshot) {
    this.state = state;
    for (const message of state.messages) this.pendingChat.delete(message.id);
    this.lastHostSeen = Date.now();
    this.status = `Servidor de ${state.members.find((member) => member.id === state.hostId)?.name ?? 'otro participante'}`;
    this.error = '';
    this.reconcile();
    this.refreshFile();
    this.flushChat();
    this.notify();
  }

  private reconcile() {
    if (!this.peer?.open || !this.state) return;
    for (const member of this.state.members) {
      if (member.id === this.id || this.connections.get(member.id)?.open || this.pendingConnections.has(member.id)) continue;
      // One side initiates each mesh edge to avoid duplicate data channels.
      if (this.id < member.id) {
        const connection = this.peer.connect(member.id, { reliable: true });
        this.pendingConnections.set(member.id, connection);
        this.attach(connection);
      }
    }
  }

  private commit() {
    if (!this.state) return;
    this.reconcile();
    this.broadcast({ type: 'snapshot', state: this.state });
    this.refreshFile();
    this.notify();
  }

  command(command: HostCommand) {
    const parsed = commandSchema.safeParse(command);
    if (!parsed.success || !this.state) return;
    if (this.isHost) {
      this.state = applyHostCommand(this.state, this.id, parsed.data);
      this.commit();
    } else {
      if (parsed.data.type === 'chat') {
        if (this.pendingChat.size >= 20 && !this.pendingChat.has(parsed.data.id)) {
          this.error = 'Hay varios mensajes esperando conexión. Espera al relevo antes de enviar más.';
          this.notify();
          return;
        }
        this.pendingChat.set(parsed.data.id, parsed.data);
      }
      const host = this.connections.get(this.state.hostId);
      if (!host?.open) {
        this.error = 'Esperando el relevo del servidor. Los mensajes pendientes se enviarán al reconectar.';
        this.notify();
        return;
      }
      this.send(host, { type: 'command', command: parsed.data });
    }
  }

  private flushChat() {
    if (!this.state) return;
    for (const [id, command] of this.pendingChat) {
      if (this.state.messages.some((message) => message.id === id)) {
        this.pendingChat.delete(id);
      } else if (this.isHost) {
        this.state = applyHostCommand(this.state, this.id, command);
        this.pendingChat.delete(id);
      } else {
        this.send(this.connections.get(this.state.hostId), { type: 'command', command });
      }
    }
  }

  requestTakeover() {
    if (!this.state || this.isHost) return;
    if (Date.now() - this.lastHostSeen < 12_000) {
      this.error = 'El servidor actual todavía responde.';
      this.notify();
      return;
    }
    this.claimDirectory();
  }

  emit(event: string, data: unknown) {
    if (!data || typeof data !== 'object' || !this.state) return;
    // RTCSessionDescription and RTCIceCandidate expose toJSON(). Normalize
    // them before PeerJS binary serialization, as Socket.IO already does.
    const serialized: unknown = JSON.parse(JSON.stringify(data));
    if (!serialized || typeof serialized !== 'object' || Array.isArray(serialized)) return;
    const payload = serialized as Record<string, unknown>;
    if (event === 'reaction' && typeof payload.emoji === 'string' && payload.emoji.length <= 32) {
      const reaction = { id: crypto.randomUUID(), emoji: payload.emoji, userName: this.self.name };
      this.broadcast({ type: 'signal', event, payload: reaction });
      this.publish(event, reaction);
    } else if (event === 'peer-media-state') {
      this.broadcast({ type: 'signal', event, payload });
    } else if (event === 'webrtc-offer' || event === 'webrtc-answer' || event === 'webrtc-ice-candidate') {
      if (typeof payload.targetSocketId === 'string') {
        this.send(this.connections.get(payload.targetSocketId), { type: 'signal', event, payload });
      }
    }
  }

  private tick() {
    if (this.stopped) return;
    if (this.peer?.disconnected && !this.peer.destroyed) this.peer.reconnect();
    if (this.claiming && Date.now() - this.claimAt > 10_000) {
      this.directory?.destroy();
      this.directory = null;
      this.claiming = false;
    }
    if (!this.state) {
      if (Date.now() - this.startedAt > 20_000 && !this.error) {
        this.error = 'La señalización está tardando demasiado. Comprueba tu conexión o reintenta la sala.';
        this.status = 'No se pudo conectar con la sala';
      }
      if (Date.now() - this.lastJoin > 10_000) this.findHost();
      this.notify();
      return;
    }
    this.reconcile();
    this.flushChat();
    if (this.isHost && this.directory?.open) {
      const removed = this.state.members.filter((member) => member.id !== this.id &&
        !this.connections.get(member.id)?.open && Date.now() - (this.offlineSince.get(member.id) ?? member.joinedAt) > 15_000);
      if (removed.length > 0) {
        this.state = {
          ...this.state, revision: this.state.revision + 1,
          members: this.state.members.filter((member) => !removed.some((entry) => entry.id === member.id)),
        };
      }
      this.broadcast({ type: 'ping' });
      this.commit();
      return;
    }
    const host = this.connections.get(this.state.hostId);
    if (host?.open && Date.now() - this.lastHostSeen < 12_000) {
      this.send(host, { type: 'ping' });
      return;
    }
    this.status = this.state.automaticMigration ? 'Buscando un participante para el relevo…' : 'Servidor desconectado. El relevo automático está desactivado.';
    if (Date.now() - this.lastJoin > 4000) this.findHost();
    if (this.state.automaticMigration) {
      const candidates = this.state.members.filter((member) =>
        member.id !== this.state!.hostId && (member.id === this.id || this.connections.get(member.id)?.open))
        .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
      const rank = candidates.findIndex((member) => member.id === this.id);
      if (rank >= 0 && Date.now() - this.lastHostSeen > 12_000 + rank * 4000) this.claimDirectory();
    }
    this.notify();
  }

  async selectFile(file: File) {
    if (!this.isHost) return;
    if (!file.type.startsWith('video/') || file.size <= 0 || file.size > MAX_VIDEO_BYTES) {
      throw new Error('Elige un video de hasta 256 MB para compartir entre navegadores.');
    }
    const video: HostVideo = { id: crypto.randomUUID(), name: file.name.slice(0, 200), source: 'file', size: file.size, mime: file.type };
    this.files.set(video.id, file);
    this.command({ type: 'video', video });
    if (this.state?.replicateVideo) this.retryVideo();
  }

  retryVideo() {
    if (!this.state?.video || this.state.video.source !== 'file') return;
    if (!this.files.has(this.state.video.id)) {
      this.incoming.clear();
      this.fileProgress = 0;
    }
    for (const connection of this.connections.values()) {
      if (this.files.has(this.state.video.id)) void this.sendFile(connection, this.state.video);
      else this.send(connection, { type: 'file-request', videoId: this.state.video.id });
    }
  }

  private refreshFile() {
    const video = this.state?.video;
    for (const [connection, transfer] of this.incoming) {
      if (transfer.video.id !== video?.id) this.incoming.delete(connection);
    }
    if (this.fileId === video?.id) return;
    if (video?.source === 'file' && !this.files.has(video.id) && [...this.incoming.values()].some((transfer) => transfer.video.id === video.id)) return;
    if (this.fileUrl) URL.revokeObjectURL(this.fileUrl);
    this.fileUrl = null;
    this.fileId = null;
    this.fileProgress = 0;
    for (const cachedId of this.files.keys()) if (cachedId !== video?.id) this.files.delete(cachedId);
    if (video?.source !== 'file') return;
    const file = this.files.get(video.id);
    if (file) {
      this.fileId = video.id;
      this.fileUrl = URL.createObjectURL(file);
      this.fileProgress = 100;
      this.ready.set(this.id, video.id);
      this.broadcast({ type: 'file-ready', videoId: video.id });
    } else if (this.state?.replicateVideo) {
      for (const connection of this.connections.values()) this.send(connection, { type: 'file-request', videoId: video.id });
    }
  }

  private async sendFile(connection: DataConnection, video: HostVideo) {
    const file = this.files.get(video.id);
    if (!file || this.sending.has(connection) || this.ready.get(connection.peer) === video.id || !connection.open) return;
    this.sending.set(connection, video.id);
    try {
      this.send(connection, { type: 'file-start', video });
      for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
        if (this.stopped || !connection.open || this.state?.video?.id !== video.id) return;
        while (connection.dataChannel.bufferedAmount > CHUNK_BYTES * 8 && connection.open && !this.stopped) await new Promise((resolve) => setTimeout(resolve, 30));
        const data = await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer();
        this.send(connection, { type: 'file-chunk', videoId: video.id, index: offset / CHUNK_BYTES, data });
      }
      this.send(connection, { type: 'file-end', videoId: video.id, digest: await digest(file) });
    } catch {
      this.error = 'Se interrumpió una copia del video. Puedes reintentar desde Servidor.';
      this.notify();
    } finally { this.sending.delete(connection); }
  }

  private async receiveFile(connection: DataConnection, sender: HostMember, packet: HostEnvelope) {
    const video = this.state?.video;
    if (packet.type === 'file-ready') {
      if (packet.videoId === video?.id) this.ready.set(sender.id, packet.videoId);
      this.notify();
    } else if (packet.type === 'file-request') {
      if (video?.id === packet.videoId) await this.sendFile(connection, video);
    } else if (packet.type === 'file-start') {
      if (video?.id !== packet.video.id || video.source !== 'file' || this.files.has(video.id)) return;
      if (this.incoming.size > 0 || packet.video.size !== video.size) return;
      this.incoming.set(connection, { video, chunks: [], received: 0 });
    } else if (packet.type === 'file-chunk') {
      const transfer = this.incoming.get(connection);
      if (!transfer || packet.videoId !== transfer.video.id || packet.index !== transfer.chunks.length) return;
      if (packet.data.byteLength > CHUNK_BYTES || transfer.received + packet.data.byteLength > transfer.video.size) {
        this.incoming.delete(connection);
        return;
      }
      transfer.chunks.push(packet.data);
      transfer.received += packet.data.byteLength;
      this.fileProgress = Math.floor(transfer.received / transfer.video.size * 100);
      this.notify();
    } else if (packet.type === 'file-end') {
      const transfer = this.incoming.get(connection);
      if (!transfer || transfer.video.id !== packet.videoId || transfer.received !== transfer.video.size) return;
      const file = new Blob(transfer.chunks, { type: transfer.video.mime });
      if (await digest(file) !== packet.digest) throw new Error('Video checksum mismatch');
      this.incoming.delete(connection);
      if (this.state?.video?.id !== transfer.video.id || this.stopped) return;
      this.files.set(transfer.video.id, file);
      this.refreshFile();
      this.notify();
    }
  }

  stop() {
    this.stopped = true;
    this.connected = false;
    if (this.timer) clearInterval(this.timer);
    this.directory?.destroy();
    this.peer?.destroy();
    this.connections.clear();
    this.pendingConnections.clear();
    this.authorized.clear();
    this.hellos.clear();
    this.files.clear();
    this.pendingChat.clear();
    this.incoming.clear();
    if (this.fileUrl) URL.revokeObjectURL(this.fileUrl);
    this.listeners.clear();
  }
}

