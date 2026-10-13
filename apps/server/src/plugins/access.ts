import type { Permission, SessionStage } from '@tuition/shared';

/**
 * Every /api route must declare its access rule in `config.access`.
 * buildApp() refuses to start if one is missing, and a test enumerates all routes
 * to prove that permission-protected ones return 403 without the permission.
 */
export type Access =
  | { type: 'public' }
  | { type: 'test' }
  | { type: 'session'; stages: SessionStage[]; permission?: Permission };

export const PUBLIC: Access = { type: 'public' };
export const TEST_ONLY: Access = { type: 'test' };
/** Fully signed-in staff (password + 2FA where required), optionally with a permission. */
export const staff = (permission?: Permission): Access => ({ type: 'session', stages: ['full'], permission });
/** Signed in with password but 2FA not completed yet. */
export const preAuth = (...stages: SessionStage[]): Access => ({ type: 'session', stages });

declare module 'fastify' {
  interface FastifyContextConfig {
    access?: Access;
  }
}
