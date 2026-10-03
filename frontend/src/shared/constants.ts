/**
 * Constantes compartidas NO-socket (solo mover strings, sin lógica).
 * Los nombres de eventos socket NO se centralizan (ver PREGUNTAS): se
 * mantienen como literales en los emit/on para no oscurecer el grep.
 */

export const STORAGE_KEYS = {
  HOST_SESSION: 'watchparty_host_session',
  USER_ID: 'watchparty_user_id',
} as const;

/** NOTA (bloque 5): eventos socket intencionalmente NO centralizados. */
