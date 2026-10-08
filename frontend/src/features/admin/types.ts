/**
 * Tipos del panel admin (contrato backend tras `requireAdmin`).
 * Fechas llegan serializadas como ISO strings vía `res.json()`.
 */

export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'cancelled' | 'refunded';

export interface PaymentRecord {
  id: string;
  provider: 'paypal' | 'card';
  providerOrderId: string;
  providerTransactionId?: string | null;
  planId: string;
  amount: number;
  currency: string;
  roomId?: string;
  userId?: string;
  status: PaymentStatus;
  failureReason?: string;
  stub: boolean;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type GiftCodeType = 'FREE_ROOM' | 'PREMIUM_ROOM';

export interface GiftCodeRecord {
  code: string;
  type: GiftCodeType;
  durationDays: number;
  maxUses: number;
  uses: number;
  expiresAt?: string;
  status: 'active' | 'disabled';
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditRecord {
  id: string;
  actor: string;
  action: string;
  detail?: string;
  createdAt: string;
}

/** Participante SANITIZADO (el backend jamás envía userIds/socketIds). */
export interface SanitizedParticipant {
  name: string;
  role: string;
  isHost: boolean;
  device?: string;
  joinedAt?: string;
}

/** Detalle de sala SANITIZADO (sin hostSecret ni joinRequests crudas). */
export interface SanitizedRoom {
  roomId: string;
  hostName: string;
  status: string;
  isTemporary: boolean;
  participantCount: number;
  participants: SanitizedParticipant[];
  pendingRequests: number;
  video: { title?: string; mimeType?: string; sourceType?: string } | null;
  settings?: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface AdminSummary {
  rooms: { live: number };
  payments: { total: number; byStatus: Record<string, number> };
  giftCodes: { total: number; active: number };
  entitlements: { active: number };
}

export interface SystemMetrics {
  uptimeSec: number;
  cpuLoad1m: number | null;
  totalMemMb: number | null;
  freeMemMb: number | null;
  heapUsedMb: number | null;
  heapTotalMb: number | null;
}

export interface RouteAggregate {
  route: string;
  count: number;
  errors: number;
  avgMs: number;
  p95Ms: number;
}

export interface AdminMetrics {
  timestamp: string;
  uptimeSeconds: number;
  rooms: { live: number };
  sockets: { online: number };
  payments: { total: number; byStatus: Record<string, number> };
  entitlements: { active: number };
  giftCodes: { total: number; active: number; redeemedUses: number };
  system: SystemMetrics;
  traffic: {
    http: { totalRequests: number; totalErrors: number; routes: RouteAggregate[] };
    perMinute: Array<{ minuteStart: string | null; requests: number; errors: number }>;
    ws: { connects: number; disconnects: number; peakConnections: number };
    rooms: { active: number };
    system: SystemMetrics;
  };
}

/** Filtros espejo del backend (`GET /api/admin/payments`). */
export interface PaymentFilters {
  status?: string;
  provider?: string;
  search?: string;
  limit?: number;
}

/** Filtros espejo del backend (`GET /api/admin/audit`). */
export interface AuditFilters {
  action?: string;
  actor?: string;
  since?: string;
  limit?: number;
}
