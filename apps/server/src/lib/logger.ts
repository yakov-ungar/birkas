import type { FastifyServerOptions } from 'fastify';
import { REDACT_PATHS, maskPans } from './redact';

/**
 * Logs carry ids only: request lines drop the query string (search terms may hold names/phones)
 * and every serialized line is scrubbed for card-number lookalikes.
 */
export function loggerOptions(level: string): FastifyServerOptions['logger'] {
  return {
    level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    serializers: {
      req: (req: { method: string; url: string; id: string }) => ({
        id: req.id,
        method: req.method,
        url: maskPans(req.url.split('?')[0] ?? ''),
      }),
    },
    hooks: {
      logMethod(args, method) {
        method.apply(
          this,
          args.map((a) => (typeof a === 'string' ? maskPans(a) : a)) as Parameters<typeof method>,
        );
      },
    },
  };
}
