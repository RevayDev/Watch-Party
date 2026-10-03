import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { RoomService } from '../src/services/room.service.js';
import { backupRoomsFile, restoreRoomsFile } from './helpers.js';

/**
 * Cobertura del modo memoria (isMongoConnected = false en tests: nunca se
 * llama a connectDatabase, así que el comportamiento es determinista sin
 * necesidad de MongoDB).
 */
const created: string[] = [];

async function makeRoom(hostName = 'Host Uno'): Promise<string> {
  const { room } = await RoomService.createRoom({ hostName });
  created.push(room.roomId);
  return room.roomId;
}

beforeAll(() => {
  backupRoomsFile();
});

afterEach(async () => {
  while (created.length > 0) {
    const id = created.pop()!;
    await RoomService.deleteRoom(id, true).catch(() => false);
  }
});

afterAll(async () => {
  await restoreRoomsFile();
});

describe('RoomService.createRoom / getRoomById', () => {
  it('crea una sala con código de 6 caracteres y registra al host', async () => {
    const { room, hostSecret } = await RoomService.createRoom({ hostName: '  Ana  ' });
    created.push(room.roomId);
    expect(room.roomId).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
    expect(hostSecret).toMatch(/^[0-9a-f]{32}$/);
    expect(room.hostName).toBe('Ana');
    expect(room.participants).toHaveLength(1);
    expect(room.participants[0]).toMatchObject({ name: 'Ana', isHost: true, role: 'host' });
    expect(room.settings).toMatchObject({ muteOnEntry: false, allowMicReactivation: true });
  });

  it('getRoomById normaliza minúsculas y espacios', async () => {
    const roomId = await makeRoom('Beto');
    const found = await RoomService.getRoomById(`  ${roomId.toLowerCase()}  `);
    expect(found?.roomId).toBe(roomId);
    expect(await RoomService.getRoomById('ZZZZZZ')).toBeNull();
  });
});

describe('RoomService.joinRoom (identidad estable)', () => {
  it('agrega miembros y evita duplicados por re-join', async () => {
    const roomId = await makeRoom('Host');
    await RoomService.joinRoom(roomId, 'Invitado', 'Web', 'uid-1');
    await RoomService.joinRoom(roomId, 'Invitado', 'Web', 'uid-1');
    const room = await RoomService.getRoomById(roomId);
    expect(room?.participants.filter((p) => p.userId === 'uid-1')).toHaveLength(1);
  });

  it('reclama userId para participantes legacy con el mismo nombre', async () => {
    const roomId = await makeRoom('Host');
    await RoomService.joinRoom(roomId, 'Legacy', 'Web');
    await RoomService.joinRoom(roomId, 'Legacy', 'Web', 'uid-legacy');
    const room = await RoomService.getRoomById(roomId);
    const matches = room?.participants.filter((p) => p.name === 'Legacy');
    expect(matches).toHaveLength(1);
    expect(matches?.[0].userId).toBe('uid-legacy');
  });

  it('un rename previo evita duplicados al re-join con el mismo userId', async () => {
    const roomId = await makeRoom('Host');
    await RoomService.joinRoom(roomId, 'Original', 'Web', 'uid-x');
    await RoomService.renameParticipant(roomId, 'Renombrado', { userId: 'uid-x' });
    await RoomService.joinRoom(roomId, 'CualquierNombre', 'Web', 'uid-x');
    const room = await RoomService.getRoomById(roomId);
    expect(room?.participants.filter((p) => p.userId === 'uid-x')).toHaveLength(1);
    expect(room?.participants.find((p) => p.userId === 'uid-x')?.name).toBe('Renombrado');
  });

  it('devuelve null ante sala inexistente', async () => {
    expect(await RoomService.joinRoom('NOEXST', 'Alguien')).toBeNull();
  });
});

describe('RoomService: join requests (aprobación manual)', () => {
  it('addJoinRequest evita duplicados por nombre (case-insensitive)', async () => {
    const roomId = await makeRoom('Host');
    await RoomService.addJoinRequest(roomId, { socketId: 's1', name: 'Pedro' });
    await RoomService.addJoinRequest(roomId, { socketId: 's2', name: 'pedro' });
    const room = await RoomService.getRoomById(roomId);
    expect(room?.joinRequests).toHaveLength(1);
  });

  it('approveJoinRequest mueve la solicitud a participantes', async () => {
    const roomId = await makeRoom('Host');
    await RoomService.addJoinRequest(roomId, { socketId: 's1', userId: 'u-p', name: 'Pedro', device: 'Web' });
    const { room, request } = await RoomService.approveJoinRequest(roomId, { userId: 'u-p' });
    expect(request?.name).toBe('Pedro');
    expect(room?.joinRequests).toHaveLength(0);
    expect(room?.participants.some((p) => p.userId === 'u-p')).toBe(true);
  });

  it('approveJoinRequest con objetivo inexistente no altera nada', async () => {
    const roomId = await makeRoom('Host');
    const { room, request } = await RoomService.approveJoinRequest(roomId, { name: 'Nadie' });
    expect(request).toBeNull();
    expect(room?.participants).toHaveLength(1);
  });

  it('rejectJoinRequest elimina la solicitud y con ban=true la banea', async () => {
    const roomId = await makeRoom('Host');
    await RoomService.addJoinRequest(roomId, { socketId: 's1', userId: 'u-troll', name: 'Troll' });
    const updated = await RoomService.rejectJoinRequest(
      roomId,
      { userId: 'u-troll' },
      { ban: true, rejectedBy: 'Host' }
    );
    expect(updated?.joinRequests).toHaveLength(0);
    expect(updated?.kickedUsers?.some((k) => k.userId === 'u-troll' && k.banned)).toBe(true);
  });
});

describe('RoomService: kick / unban', () => {
  it('kick elimina al participante y registra el evento', async () => {
    const roomId = await makeRoom('Host');
    await RoomService.joinRoom(roomId, 'Pesado', 'Web', 'u-pesado');
    const updated = await RoomService.kickParticipant(roomId, { name: 'Pesado' }, 'Host', false);
    expect(updated?.participants.some((p) => p.name === 'Pesado')).toBe(false);
    expect(updated?.kickedUsers?.[0]).toMatchObject({ name: 'Pesado', kickedBy: 'Host', banned: false });
  });

  it('no se puede expulsar al host', async () => {
    const roomId = await makeRoom('Host');
    const updated = await RoomService.kickParticipant(roomId, { name: 'Host' }, 'Host', false);
    expect(updated?.participants.some((p) => p.isHost)).toBe(true);
    expect(updated?.kickedUsers).toHaveLength(0);
  });

  it('unban elimina el registro por userId', async () => {
    const roomId = await makeRoom('Host');
    await RoomService.joinRoom(roomId, 'Pesado', 'Web', 'u-pesado');
    await RoomService.kickParticipant(roomId, { name: 'Pesado', userId: 'u-pesado' }, 'Host', true);
    const updated = await RoomService.unbanParticipant(roomId, { userId: 'u-pesado' });
    expect(updated?.kickedUsers?.some((k) => k.userId === 'u-pesado')).toBe(false);
  });
});

describe('RoomService: roles, rename y settings', () => {
  it('promueve a cohost pero nunca degrada al host', async () => {
    const roomId = await makeRoom('Host');
    await RoomService.joinRoom(roomId, 'Ayudante', 'Web', 'u-ay');
    await RoomService.setParticipantRole(roomId, 'Ayudante', 'cohost');
    await RoomService.setParticipantRole(roomId, 'Host', 'member');
    const room = await RoomService.getRoomById(roomId);
    expect(room?.participants.find((p) => p.name === 'Ayudante')?.role).toBe('cohost');
    expect(room?.participants.find((p) => p.name === 'Host')?.role).toBe('host');
  });

  it('rename actualiza hostName cuando el renombrado es el host', async () => {
    const roomId = await makeRoom('ViejoHost');
    await RoomService.renameParticipant(roomId, 'NuevoHost', { oldName: 'ViejoHost' });
    const room = await RoomService.getRoomById(roomId);
    expect(room?.hostName).toBe('NuevoHost');
  });

  it('rename con nombre vacío devuelve null', async () => {
    const roomId = await makeRoom('Host');
    expect(await RoomService.renameParticipant(roomId, '   ', { oldName: 'Host' })).toBeNull();
  });

  it('updateSettings fusiona sin perder el resto', async () => {
    const roomId = await makeRoom('Host');
    await RoomService.updateSettings(roomId, { requireApproval: true, muteOnEntry: true });
    const room = await RoomService.getRoomById(roomId);
    expect(room?.settings).toMatchObject({
      requireApproval: true,
      muteOnEntry: true,
      allowMicReactivation: true,
    });
  });
});

describe('RoomService: transferencia de host y timer sweep', () => {
  it('al salir el host, el siguiente participante hereda el rol', async () => {
    const roomId = await makeRoom('HostOriginal');
    await RoomService.joinRoom(roomId, 'Segundo', 'Web', 'u-2');
    await RoomService.joinRoom(roomId, 'Tercero', 'Web', 'u-3');
    const { room, newHostName } = await RoomService.removeParticipantAndTransferHost(roomId, 'HostOriginal');
    expect(newHostName).toBe('Segundo');
    expect(room?.hostName).toBe('Segundo');
    expect(room?.participants.find((p) => p.name === 'Segundo')).toMatchObject({ isHost: true, role: 'host' });
  });

  it('al salir un miembro, el host no cambia', async () => {
    const roomId = await makeRoom('Host');
    await RoomService.joinRoom(roomId, 'Miembro', 'Web', 'u-m');
    const { room, newHostName } = await RoomService.removeParticipantAndTransferHost(roomId, 'Miembro', 'u-m');
    expect(newHostName).toBeNull();
    expect(room?.hostName).toBe('Host');
  });

  it('getRoomsPastTimer solo devuelve salas con timer vencido', async () => {
    const expiredId = await makeRoom('HostExp');
    const futureId = await makeRoom('HostFut');
    const noTimerId = await makeRoom('HostNo');
    // Hacer los roomId únicos visibles para aislar este test del resto de salas locales
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    await RoomService.updateSettings(expiredId, { timerEndsAt: past });
    await RoomService.updateSettings(futureId, { timerEndsAt: future });
    await RoomService.updateSettings(noTimerId, { timerEndsAt: 'no-es-una-fecha' });

    const expired = await RoomService.getRoomsPastTimer();
    const ids = expired.map((r) => r.roomId);
    expect(ids).toContain(expiredId);
    expect(ids).not.toContain(futureId);
    expect(ids).not.toContain(noTimerId);
  });
});

describe('RoomService.deleteRoom', () => {
  it('elimina la sala y luego getById devuelve null', async () => {
    const roomId = await makeRoom('Host');
    created.pop(); // la borramos aquí mismo; afterEach no debe repetir
    expect(await RoomService.deleteRoom(roomId, true)).toBe(true);
    expect(await RoomService.getRoomById(roomId)).toBeNull();
    expect(await RoomService.deleteRoom(roomId, true)).toBe(false);
  });
});
