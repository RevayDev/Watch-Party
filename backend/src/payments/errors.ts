/**
 * Error base de los servicios de pagos/gift-codes con código HTTP asociado.
 * Los routers lo traducen a `res.status(err.statusCode).json({ error, code })`.
 */
export class ServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** Duplicado a nivel de store (índice único): el llamador debe re-leer y tratar como idempotente. */
export class DuplicateKeyError extends ServiceError {
  constructor(message = 'Registro duplicado (índice único).') {
    super(409, 'DUPLICATE_KEY', message);
  }
}

export function toServiceError(err: unknown, fallbackCode = 'INTERNAL_ERROR'): ServiceError {
  if (err instanceof ServiceError) return err;
  const message = err instanceof Error ? err.message : 'Error interno.';
  return new ServiceError(500, fallbackCode, message);
}
