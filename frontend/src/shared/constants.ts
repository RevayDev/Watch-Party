/**
 * Constantes compartidas NO-socket (solo mover strings, sin lógica).
 * Los nombres de eventos socket NO se centralizan (ver PREGUNTAS): se
 * mantienen como literales en los emit/on para no oscurecer el grep.
 */

export const STORAGE_KEYS = {
  LEADER_SESSION: 'watchparty_host_session',
  USER_ID: 'watchparty_user_id',
  /** Barra inferior: etiquetas visibles (personal, local, '1'/'0'). */
  BAR_LABELS: 'watchparty_bar_labels',
  /** Barra inferior: distribución ('spread' | 'centered', personal, local). */
  BAR_LAYOUT: 'watchparty_bar_layout',
} as const;

/** NOTA (bloque 5): eventos socket intencionalmente NO centralizados. */
