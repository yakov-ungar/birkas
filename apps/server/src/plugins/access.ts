import type { Permission, SessionStage } from '@tuition/shared';

/**
 * Every /api route must declare its access rule in `config.access`.
 * buildApp() refuses to start if one is missing, and a test enumerates all routes
 * to prove that permission-protected ones return 403 without the permission.
 */
export type Access =
  | { type: 'public' }
  | { type: 'test' }
  /** A parent signed in to the portal; the family comes from the parent session only. */
  | { type: 'parent' }
  /** permission: one key, or several meaning "any of". */
  | { type: 'session'; stages: SessionStage[]; permission?: Permission | Permission[] };

export const PUBLIC: Access = { type: 'public' };
export const TEST_ONLY: Access = { type: 'test' };
export const PARENT: Access = { type: 'parent' };
/** Fully signed-in staff (password + 2FA where required), optionally with a permission. */
export const staff = (permission?: Permission | Permission[]): Access => ({
  type: 'session',
  stages: ['full'],
  permission,
});

export const permsOf = (a: Access): Permission[] =>
  a.type === 'session' && a.permission ? [a.permission].flat() : [];
/** Signed in with password but 2FA not completed yet. */
export const preAuth = (...stages: SessionStage[]): Access => ({ type: 'session', stages });

declare module 'fastify' {
  interface FastifyContextConfig {
    access?: Access;
  }
}
