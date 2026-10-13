import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError, type ZodSchema } from 'zod';

/** Error with a Hebrew, user-facing message. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, fields?: Record<string, string>) =>
  new AppError(400, 'bad_request', msg, fields);
export const unauthorized = (msg = 'נדרשת התחברות') => new AppError(401, 'unauthorized', msg);
export const forbidden = (msg = 'אין לך הרשאה לפעולה זו') => new AppError(403, 'forbidden', msg);
export const notFound = (msg = 'הפריט לא נמצא') => new AppError(404, 'not_found', msg);
export const conflict = (msg: string) => new AppError(409, 'conflict', msg);

export function parse<T>(schema: ZodSchema<T>, data: unknown): T {
  const r = schema.safeParse(data ?? {});
  if (r.success) return r.data;
  throw zodToAppError(r.error);
}

function zodToAppError(e: ZodError): AppError {
  const fields: Record<string, string> = {};
  for (const i of e.issues) {
    const k = i.path.join('.') || '_';
    if (!fields[k]) fields[k] = i.message;
  }
  return badRequest('יש לתקן את השדות המסומנים', fields);
}

export function errorHandler(err: FastifyError | AppError, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof AppError) {
    return reply
      .status(err.statusCode)
      .send({ error: { code: err.code, message: err.message, fields: err.fields } });
  }
  const status = (err as FastifyError).statusCode ?? 500;
  if (status === 429) {
    return reply
      .status(429)
      .send({ error: { code: 'rate_limited', message: 'יותר מדי ניסיונות. נסו שוב בעוד כמה דקות' } });
  }
  if (status >= 400 && status < 500) {
    return reply.status(status).send({ error: { code: 'bad_request', message: 'הבקשה אינה תקינה' } });
  }
  req.log.error({ err }, 'unhandled error');
  return reply
    .status(500)
    .send({ error: { code: 'internal', message: 'אירעה שגיאה במערכת. נסו שוב מאוחר יותר' } });
}
