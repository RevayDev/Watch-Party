import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { RoomService } from '../src/services/room.service.js';
import { backupRoomsFile, restoreRoomsFile } from './helpers.js';

/**
 * Panel Admin REST (fase 1+2 del plan docs/admin-panel-spotify.md).
 * TDD: estos tests definen el contrato antes de la implementación.
 *
 * Auth: `x-admin-token` o `Authorization: Bearer`. Sin ADMIN_TOKEN en el
 * servidor → 503. Token erróneo/ausente → 401. El panel NUNCA expone
 * `leaderSecret` ni `socketId`.
 */

const ADMIN_TOKEN = 'test-admin-token-123';

let server: Server | null = null;
let base = '';
let app: Express | null = null;

/** Emits capturados del `io` falso (la app real lo pone en server.ts). */
const emitted: Array<{ room: string; event: string; payload: unknown }> = [];
const leftRooms: string[] = [];

function fakeIo() {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        emitted.push({ room, event, payload });
      },
    }),
    in: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        emitted.push({ room, event, payload });
      },
      socketsLeave: (_r: string) => {
        leftRooms.push(room);
      },
    }),
  };
}

async function startApp(): Promise<string> {
  if (base) return base;
  backupRoomsFile();
  app = createApp();
  app.set('io', fakeIo());
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server!.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return base;
}

async function stopApp(): Promise<void> {
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server!.close((err) => (err ? reject(err) : resolve()))
    );
    server = null;
    base = '';
    app = null;
  }
  await restoreRoomsFile();
}

function adminHeaders(token: string = ADMIN_TOKEN): Record<string, string> {
  return { 'Content-Type': 'application/json', 'x-admin-token': token };
}

async function api(path: string, init?: RequestInit) {
  const url = await startApp();
  return fetch(`${url}${path}`, init);
}

/** Crea una sala con líder + invitados (vía servicio, store en memoria). */
async function makeRoom(leaderName: string, guests: string[] = []) {
  const { room } = await RoomService.createRoom({ leaderName, isTemporary: true });
  for (const g of guests) {
    await RoomService.joinRoom(room.roomId, g, 'Web Browser', `uid-${room.roomId}-${g}`);
  }
  return room.roomId;
}

let savedAdminToken: string | undefined;

beforeAll(async () => {
  savedAdminToken = process.env.ADMIN_TOKEN;
  process.env.ADMIN_TOKEN = ADMIN_TOKEN;
  await startApp();
});

afterAll(async () => {
  if (savedAdminToken === undefined) delete process.env.ADMIN_TOKEN;
  else process.env.ADMIN_TOKEN = savedAdminToken;
  await stopApp();
});

beforeEach(() => {
  emitted.length = 0;
  leftRooms.length = 0;
  process.env.ADMIN_TOKEN = ADMIN_TOKEN;
});

afterEach(async () => {
  // Limpieza: borra las salas creadas por el test (vía servicio).
  const rooms = await RoomService.listRooms();
  for (const r of rooms) {
    await RoomService.deleteRoom(r.roomId, true).catch(() => false);
  }
});

describe('admin auth (requireAdmin)', () => {
  it('401 sin token', async () => {
    const res = await api('/api/admin/rooms');
    expect(res.status).toBe(401);
    expect(((await res.json()) as any).error).toMatch(/token/i);
  });

  it('401 con token erróneo', async () => {
    const res = await api('/api/admin/rooms', { headers: adminHeaders('equivocado') });
    expect(res.status).toBe(401);
  });

  it('acepta Authorization: Bearer', async () => {
    const res = await api('/api/admin/rooms', {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(res.status).toBe(200);
  });

  it('503 si el servidor no tiene ADMIN_TOKEN configurado', async () => {
    delete process.env.ADMIN_TOKEN;
    const res = await api('/api/admin/rooms', { headers: adminHeaders() });
    expect(res.status).toBe(503);
  });
});

describe('admin lectura (fase 1: solo-lectura)', () => {
  it('lista salas sin secretos', async () => {
    const roomId = await makeRoom('Lider1', ['Beto']);
    const res = await api('/api/admin/rooms', { headers: adminHeaders() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.rooms)).toBe(true);
    const found = body.rooms.find((r: any) => r.roomId === roomId);
    expect(found).toBeDefined();
    expect(found.participantCount).toBe(2);
    // Sin secretos en ningún rincón de la respuesta.
    expect(JSON.stringify(body)).not.toMatch(/leaderSecret/i);
    expect(JSON.stringify(body)).not.toMatch(/socketId/i);
    expect(found.participants.map((p: any) => p.name).sort()).toEqual(['Beto', 'Lider1']);
  });

  it('detalle de sala con video, ajustes y listas', async () => {
    const roomId = await makeRoom('Lider2', ['Ana']);
    const res = await api(`/api/admin/rooms/${roomId}`, { headers: adminHeaders() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.roomId).toBe(roomId);
    expect(body.video ?? null).toBeNull();
    expect(body.settings).toBeDefined();
    expect(Array.isArray(body.participants)).toBe(true);
    expect(Array.isArray(body.joinRequests)).toBe(true);
    expect(Array.isArray(body.kickedUsers)).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/leaderSecret/i);
  });

  it('404 en sala inexistente', async () => {
    const res = await api('/api/admin/rooms/ZZZZZZ', { headers: adminHeaders() });
    expect(res.status).toBe(404);
  });
});

describe('admin acciones de sala (fase 2)', () => {
  it('PATCH settings válido actualiza y emite room-settings-updated', async () => {
    const roomId = await makeRoom('Lider3');
    const res = await api(`/api/admin/rooms/${roomId}/settings`, {
      method: 'PATCH',
      headers: adminHeaders(),
      body: JSON.stringify({ settings: { reactionsEnabled: false } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.settings.reactionsEnabled).toBe(false);
    expect(emitted.some((e) => e.event === 'room-settings-updated' && e.room === roomId)).toBe(true);
  });

  it('PATCH settings inválido → 400 sin aplicar nada', async () => {
    const roomId = await makeRoom('Lider4');
    const res = await api(`/api/admin/rooms/${roomId}/settings`, {
      method: 'PATCH',
      headers: adminHeaders(),
      body: JSON.stringify({ settings: { reactionsEnabled: 'si' } }),
    });
    expect(res.status).toBe(400);
    const room = await RoomService.getRoomById(roomId);
    expect(room?.settings?.reactionsEnabled).not.toBe('si' as never);
  });

  it('DELETE cierra, limpia y emite room-closed', async () => {
    const roomId = await makeRoom('Lider5', ['Beto']);
    const res = await api(`/api/admin/rooms/${roomId}`, {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    expect(emitted.some((e) => e.event === 'room-closed' && e.room === roomId)).toBe(true);
    expect(leftRooms).toContain(roomId);
    expect(await RoomService.getRoomById(roomId)).toBeNull();
  });

  it('DELETE inexistente → 404', async () => {
    const res = await api('/api/admin/rooms/ZZZZZZ', {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    expect(res.status).toBe(404);
  });
});

describe('admin acciones de usuario (fase 2)', () => {
  it('kick expulsa y emite user-kicked', async () => {
    const roomId = await makeRoom('Lider6', ['Troll']);
    const res = await api(`/api/admin/rooms/${roomId}/kick`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ targetUserName: 'Troll' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.participants.map((p: any) => p.name)).not.toContain('Troll');
    expect(body.kickedUsers.map((k: any) => k.name)).toContain('Troll');
    expect(emitted.some((e) => e.event === 'user-kicked' && e.room === roomId)).toBe(true);
  });

  it('kick con ban=true marca banned', async () => {
    const roomId = await makeRoom('Lider7', ['Spammer']);
    const res = await api(`/api/admin/rooms/${roomId}/kick`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ targetUserName: 'Spammer', ban: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.kickedUsers.find((k: any) => k.name === 'Spammer')?.banned).toBe(true);
  });

  it('kick sin objetivo → 400', async () => {
    const roomId = await makeRoom('Lider8');
    const res = await api(`/api/admin/rooms/${roomId}/kick`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('unban limpia la lista y emite kicked-users-updated', async () => {
    const roomId = await makeRoom('Lider9', ['Perdonado']);
    await api(`/api/admin/rooms/${roomId}/kick`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ targetUserName: 'Perdonado', ban: true }),
    });
    emitted.length = 0;
    const res = await api(`/api/admin/rooms/${roomId}/unban`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ targetUserName: 'Perdonado' }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).kickedUsers).toEqual([]);
    expect(emitted.some((e) => e.event === 'kicked-users-updated')).toBe(true);
  });

  it('role cambia a coleader y emite participant-role-updated', async () => {
    const roomId = await makeRoom('Lider10', ['Ayudante']);
    const res = await api(`/api/admin/rooms/${roomId}/role`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ targetUserName: 'Ayudante', role: 'coleader' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.participants.find((p: any) => p.name === 'Ayudante')?.role).toBe('coleader');
    expect(emitted.some((e) => e.event === 'participant-role-updated')).toBe(true);
  });

  it('role inválido → 400', async () => {
    const roomId = await makeRoom('Lider11', ['Alguien']);
    const res = await api(`/api/admin/rooms/${roomId}/role`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ targetUserName: 'Alguien', role: 'rey' }),
    });
    expect(res.status).toBe(400);
  });

  it('transfer-leader cambia el líder y emite leader-changed', async () => {
    const roomId = await makeRoom('Lider12', ['Sucesor']);
    const res = await api(`/api/admin/rooms/${roomId}/transfer-leader`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ targetUserName: 'Sucesor' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.newLeaderName).toBe('Sucesor');
    expect(emitted.some((e) => e.event === 'leader-changed')).toBe(true);
  });

  it('rename cambia el nombre y emite participant-renamed', async () => {
    const roomId = await makeRoom('Lider13', ['Anonimo']);
    const res = await api(`/api/admin/rooms/${roomId}/rename`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ oldName: 'Anonimo', newName: 'ConNombre' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.participants.map((p: any) => p.name)).toContain('ConNombre');
    expect(body.participants.map((p: any) => p.name)).not.toContain('Anonimo');
    expect(emitted.some((e) => e.event === 'participant-renamed')).toBe(true);
  });

  it('rename con nombre en uso → 409', async () => {
    const roomId = await makeRoom('Lider14', ['Ana', 'Beto']);
    const res = await api(`/api/admin/rooms/${roomId}/rename`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ oldName: 'Ana', newName: 'beto' }),
    });
    expect(res.status).toBe(409);
  });

  it('rename sin newName → 400', async () => {
    const roomId = await makeRoom('Lider15', ['Solo']);
    const res = await api(`/api/admin/rooms/${roomId}/rename`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ oldName: 'Solo' }),
    });
    expect(res.status).toBe(400);
  });

  it('mute a un usuario emite force-mute-user', async () => {
    const roomId = await makeRoom('Lider16', ['Ruidoso']);
    const res = await api(`/api/admin/rooms/${roomId}/mute`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ kind: 'mic', targetUserName: 'Ruidoso' }),
    });
    expect(res.status).toBe(200);
    expect(
      emitted.some((e) => e.event === 'force-mute-user' && e.room === roomId)
    ).toBe(true);
  });

  it('mute sin objetivo emite force-mute-all', async () => {
    const roomId = await makeRoom('Lider17');
    const res = await api(`/api/admin/rooms/${roomId}/mute`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ kind: 'mic' }),
    });
    expect(res.status).toBe(200);
    expect(emitted.some((e) => e.event === 'force-mute-all')).toBe(true);
  });

  it('mute de cámara emite force-disable-camera(s)', async () => {
    const roomId = await makeRoom('Lider18', ['Cam']);
    const one = await api(`/api/admin/rooms/${roomId}/mute`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ kind: 'camera', targetUserName: 'Cam' }),
    });
    expect(one.status).toBe(200);
    expect(emitted.some((e) => e.event === 'force-disable-camera')).toBe(true);
    const all = await api(`/api/admin/rooms/${roomId}/mute`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ kind: 'camera' }),
    });
    expect(all.status).toBe(200);
    expect(emitted.some((e) => e.event === 'force-disable-all-cameras')).toBe(true);
  });

  it('mute con kind inválido → 400', async () => {
    const roomId = await makeRoom('Lider19');
    const res = await api(`/api/admin/rooms/${roomId}/mute`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ kind: 'volumen' }),
    });
    expect(res.status).toBe(400);
  });
});
