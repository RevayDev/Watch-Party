/**
 * Salas premium: heredan el acceso del creador y aplican su capacidad.
 * - Con acceso activo → plan 'premium', persistente permitida, cupo 10.
 * - Sin acceso → plan 'free', temporal forzado, cupo 5.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { RoomService, DemoCapacityError, getRoomPlan, maxUsersForRoom } from '../src/services/room.service.js';
import {
  setDemoModeOverride,
  resetDemoModeCache,
  DEMO_MAX_USERS_PER_ROOM,
} from '../src/config/demo-mode.js';
import { getPremiumPlan } from '../src/config/plans.js';
import { entitlementStore, resetPaymentsMemoryStores } from '../src/payments/payment.store.js';
import { backupRoomsFile, restoreRoomsFile } from './helpers.js';

const created: string[] = [];

async function drain(): Promise<void> {
  while (created.length > 0) {
    const id = created.pop()!;
    await RoomService.deleteRoom(id, true).catch(() => false);
  }
}

async function grantPremium(userId: string): Promise<void> {
  await entitlementStore.create({
    userId,
    planId: 'PREMIUM_ROOM',
    grantedAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    active: true,
  });
}

beforeAll(() => {
  backupRoomsFile();
});

beforeEach(() => {
  setDemoModeOverride(true);
  resetPaymentsMemoryStores();
});

afterEach(async () => {
  await drain();
  resetPaymentsMemoryStores();
});

afterAll(async () => {
  setDemoModeOverride(undefined);
  resetDemoModeCache();
  resetPaymentsMemoryStores();
  await restoreRoomsFile();
});

describe('plan de sala por acceso del creador', () => {
  it('con acceso premium → plan premium y persistente permitida', async () => {
    await grantPremium('u-prem');
    const { room } = await RoomService.createRoom({ hostName: 'Anfitrion', userId: 'u-prem' });
    created.push(room.roomId);
    expect(room.plan).toBe('premium');
    expect(getRoomPlan(room)).toBe('premium');
    expect(room.isTemporary).toBe(false);
  });

  it('sin acceso → plan free con temporal forzado', async () => {
    const { room } = await RoomService.createRoom({ hostName: 'Anfitrion', userId: 'u-free' });
    created.push(room.roomId);
    expect(getRoomPlan(room)).toBe('free');
    expect(room.isTemporary).toBe(true);
  });

  it('maxUsersForRoom: premium usa el plan central, free usa la demo', async () => {
    expect(maxUsersForRoom({ plan: 'premium' })).toBe(getPremiumPlan().maxUsers);
    expect(maxUsersForRoom({ plan: 'free' })).toBe(DEMO_MAX_USERS_PER_ROOM);
    expect(maxUsersForRoom({})).toBe(DEMO_MAX_USERS_PER_ROOM);
  });
});

describe('capacidad por plan', () => {
  it('sala premium admite 10 y rechaza el 11º', async () => {
    await grantPremium('u-prem');
    const { room } = await RoomService.createRoom({ hostName: 'Anfitrion', userId: 'u-prem' });
    created.push(room.roomId);
    for (let i = 0; i < 9; i++) {
      await RoomService.joinRoom(room.roomId, `Invitado${i}`, 'Web', `u-inv-${i}`);
    }
    expect((await RoomService.getRoomById(room.roomId))?.participants.length).toBe(10);
    await expect(RoomService.joinRoom(room.roomId, 'Extra', 'Web', 'u-extra')).rejects.toBeInstanceOf(
      DemoCapacityError
    );
  });

  it('sala free sigue en 5 aunque otro usuario tenga premium', async () => {
    await grantPremium('u-otro');
    const { room } = await RoomService.createRoom({ hostName: 'Anfitrion', userId: 'u-free' });
    created.push(room.roomId);
    expect(getRoomPlan(room)).toBe('free');
    for (let i = 0; i < 4; i++) {
      await RoomService.joinRoom(room.roomId, `Invitado${i}`, 'Web', `u-f-${i}`);
    }
    await expect(RoomService.joinRoom(room.roomId, 'Extra', 'Web', 'u-extra')).rejects.toBeInstanceOf(
      DemoCapacityError
    );
  });
});

describe('persistencia por plan', () => {
  it('settings persistente permitido en premium, forzado temporal en free', async () => {
    await grantPremium('u-prem');
    const premium = await RoomService.createRoom({ hostName: 'Anfitrion', userId: 'u-prem' });
    created.push(premium.room.roomId);
    const free = await RoomService.createRoom({ hostName: 'Anfitrion2', userId: 'u-free' });
    created.push(free.room.roomId);

    const updatedPremium = await RoomService.updateSettings(premium.room.roomId, { isTemporary: false });
    expect(updatedPremium?.isTemporary).toBe(false);

    const updatedFree = await RoomService.updateSettings(free.room.roomId, { isTemporary: false });
    expect(updatedFree?.isTemporary).toBe(true);
  });
});
