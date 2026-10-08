import { Request, Response, NextFunction } from 'express';
import { RoomService } from '../services/room.service.js';
import { DEMO_MAX_ROOMS } from '../config/demo-mode.js';

/**
 * Telemetría pública de la demo: SOLO conteos, jamás códigos de sala ni
 * listas (privacidad: no existe endpoint de listado y este no lo crea).
 */
export class DemoController {
  public static async availability(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const roomsUsed = await RoomService.countLiveRooms();
      const roomsTotal = DEMO_MAX_ROOMS;
      res.json({
        roomsUsed,
        roomsTotal,
        roomsAvailable: Math.max(0, roomsTotal - roomsUsed),
      });
    } catch (error) {
      next(error);
    }
  }
}
