import type { IRoom } from '../types/room.types.js';

/**
 * Puerto de persistencia de salas (hexagonal).
 * El servicio de aplicación programa contra esta interfaz; los adaptadores
 * Mongo / Memoria / Prisma la implementan. Opera sobre IRoom plano.
 */
export interface RoomRepository {
  /** ¿Existe una sala con este roomId (normalizado)? */
  exists(roomId: string): Promise<boolean>;
  /** Persiste una sala nueva. */
  create(room: IRoom): Promise<IRoom>;
  /** Busca por roomId público (normaliza mayúsculas/trim). Null si no existe. */
  findById(roomId: string): Promise<IRoom | null>;
  /** Inserta o actualiza una sala ya mutada en memoria. Retorna la sala guardada. */
  save(room: IRoom): Promise<IRoom>;
  /** Elimina por roomId. true si existía. */
  delete(roomId: string): Promise<boolean>;
  /** Salas crudas candidatas a cierre por temporizador (el filtrado fino es de dominio). */
  findTimerCandidates(): Promise<IRoom[]>;
  /** Nº de salas vivas en este store (cuota de la demo; solo conteo, sin datos). */
  count(): Promise<number>;
}
