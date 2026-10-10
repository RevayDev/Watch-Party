import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryRoomRepository } from '../src/adapters/memory-room.repository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// backend/tests/helpers.ts -> backend/data/rooms.json
const roomsFile = path.join(__dirname, '..', 'data', 'rooms.json');

let backup: string | null = null;
let existed = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Guarda una copia de data/rooms.json (store en memoria del backend).
 * Los tests usan RoomService en modo memoria y su persistencia con debounce
 * (300ms) escribe en ese fichero: sin backup, una ejecución podría dejar
 * salas de prueba en el disco local del desarrollador.
 */
export function backupRoomsFile(): void {
  try {
    existed = fs.existsSync(roomsFile);
    backup = existed ? fs.readFileSync(roomsFile, 'utf-8') : null;
  } catch {
    backup = null;
    existed = false;
  }
}

/**
 * Espera a que el debounce de persistencia (300ms) se vacíe y restaura el
 * fichero original para no dejar rastro en el entorno local.
 */
export async function restoreRoomsFile(): Promise<void> {
  await sleep(450);
  try {
    if (!existed) {
      if (fs.existsSync(roomsFile)) fs.unlinkSync(roomsFile);
    } else if (backup !== null) {
      fs.writeFileSync(roomsFile, backup, 'utf-8');
    }
  } catch {
    // mejor esfuerzo: nunca debe romper el resultado de los tests
  }
}

/**
 * Vacía el store en memoria del backend (lo que se cargó de data/rooms.json
 * o se creó en tests anteriores). Sin esto, salas reales dejadas en el
 * fichero por el desarrollador contaminan los conteos (`countLiveRooms`).
 * NO borra el fichero de disco: solo el estado en memoria.
 */
export function clearMemoryRoomStore(): void {
  memoryRoomRepository.__clearForTests();
}
