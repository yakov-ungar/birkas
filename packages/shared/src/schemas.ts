import { z } from 'zod';
import { ALL_PERMISSIONS, ROLE_NAMES, type Permission } from './permissions';

const email = z.string().trim().toLowerCase().email().max(200);
const permissionList = z
  .array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]]))
  .max(ALL_PERMISSIONS.length);

export const loginSchema = z.object({ email, password: z.string().min(1).max(200) }).strict();
export const totpCodeSchema = z.object({ code: z.string().trim().min(6).max(20) }).strict();

export const userCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    email,
    role: z.enum(ROLE_NAMES as [string, ...string[]]),
  })
  .strict();

export const userUpdateSchema = z
  .object({
    role: z.string().max(40).optional(),
    permissions: permissionList.optional(),
    active: z.boolean().optional(),
  })
  .strict();

/** Password length is validated again on the server against the configured minimum. */
export const inviteAcceptSchema = z
  .object({ token: z.string().min(20).max(200), password: z.string().min(8).max(128) })
  .strict();
export const inviteTokenSchema = z.object({ token: z.string().min(20).max(200) }).strict();

export type LoginInput = z.infer<typeof loginSchema>;
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
