import type {
  AdminMetrics,
  AdminSummary,
  AuditFilters,
  AuditRecord,
  GiftCodeRecord,
  PaymentFilters,
  PaymentRecord,
  SanitizedRoom,
} from './types';

const BACKEND_BASE = import.meta.env.VITE_API_URL || '';
const ADMIN_BASE = BACKEND_BASE ? `${BACKEND_BASE.replace(/\/$/, '')}/api/admin` : '/api/admin';

/** Error con `status` HTTP para distinguir 503 (sin ADMIN_TOKEN) de 401. */
export class AdminApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function authHeaders(token: string): Record<string, string> {
  return { 'x-admin-token': token };
}

async function request<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${ADMIN_BASE}${path}`, {
      ...init,
      headers: { ...(init?.headers ?? {}), ...authHeaders(token) },
    });
  } catch {
    const where = BACKEND_BASE || 'mismo origen (proxy local)';
    throw new Error(
      `No se pudo contactar con el servidor (${where}). Verifica que el backend esté corriendo.`
    );
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message =
      typeof body.error === 'string'
        ? body.error
        : `Error ${response.status} en la administración`;
    throw new AdminApiError(response.status, message);
  }
  return response.json() as Promise<T>;
}

function query(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && String(v).trim() !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** GET /api/admin/summary — conteos (salas, pagos, códigos, accesos). */
export function fetchSummary(token: string): Promise<AdminSummary> {
  return request<AdminSummary>(token, '/summary');
}

/**
 * GET /api/admin/rooms — SIN roomId responde `{liveRooms, rooms: [], note}`
 * a propósito (privacidad); CON roomId devuelve `{room}` sanitizado.
 */
export function fetchRooms(
  token: string,
  roomId?: string
): Promise<{ liveRooms: number; rooms: unknown[]; note: string } | { room: SanitizedRoom }> {
  const id = roomId?.trim().toUpperCase();
  return request(token, `/rooms${id ? query({ roomId: id }) : ''}`);
}

/** GET /api/admin/rooms/:roomId — detalle sanitizado de una sala. */
export function fetchRoomDetail(token: string, roomId: string): Promise<{ room: SanitizedRoom }> {
  return request(token, `/rooms/${encodeURIComponent(roomId.trim().toUpperCase())}`);
}

/** GET /api/admin/payments — pagos con filtros ?status&provider&search&limit. */
export function fetchPayments(token: string, filters: PaymentFilters): Promise<{ payments: PaymentRecord[] }> {
  return request(token, `/payments${query({ ...filters })}`);
}

/** POST /api/admin/payments/:paymentId/refund — reembolso local auditado. */
export function refundPayment(token: string, paymentId: string): Promise<{ payment: PaymentRecord }> {
  return request(token, `/payments/${encodeURIComponent(paymentId)}/refund`, { method: 'POST' });
}

/** GET /api/admin/gift-codes — lista de códigos. */
export function fetchGiftCodes(token: string): Promise<{ codes: GiftCodeRecord[] }> {
  return request(token, '/gift-codes');
}

/** POST /api/admin/gift-codes — crea un código. */
export function createGiftCode(
  token: string,
  input: { type: string; durationDays?: number; maxUses?: number; expiresInDays?: number }
): Promise<{ code: GiftCodeRecord }> {
  return request(token, '/gift-codes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

/** PATCH /api/admin/gift-codes/:code/disable — desactiva un código. */
export function disableGiftCode(token: string, code: string): Promise<{ code: GiftCodeRecord }> {
  return request(token, `/gift-codes/${encodeURIComponent(code)}/disable`, { method: 'PATCH' });
}

/** DELETE /api/admin/gift-codes/:code — borra un código sin usos. */
export function deleteGiftCode(token: string, code: string): Promise<{ deleted: boolean; code: string }> {
  return request(token, `/gift-codes/${encodeURIComponent(code)}`, { method: 'DELETE' });
}

/** GET /api/admin/audit — auditoría ?action&actor&since&limit. */
export function fetchAudit(token: string, filters: AuditFilters): Promise<{ entries: AuditRecord[] }> {
  return request(token, `/audit${query({ ...filters })}`);
}

/** GET /api/admin/metrics — métricas del sistema + tráfico + conteos. */
export function fetchMetrics(token: string): Promise<AdminMetrics> {
  return request(token, '/metrics');
}

/** Mensaje claro según el fallo: 503 = falta ADMIN_TOKEN en el servidor. */
export function adminErrorMessage(err: unknown): string {
  if (err instanceof AdminApiError) {
    if (err.status === 503) return 'Administración no configurada: falta ADMIN_TOKEN en el servidor. Contacta al responsable del despliegue.';
    if (err.status === 401) return 'Token incorrecto o ausente. Revisa el ADMIN_TOKEN e inténtalo de nuevo.';
    return err.message;
  }
  return 'No se pudo contactar con el servidor.';
}
