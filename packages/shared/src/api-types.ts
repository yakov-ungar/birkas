import type { Permission } from './permissions';

export type SessionStage = 'pending_2fa' | 'setup_2fa' | 'full';

export interface MeResponse {
  stage: SessionStage;
  csrfToken: string;
  user: { id: string; name: string; email: string; role: string; permissions: Permission[] };
  school: { name: string; yearName: string };
  idleTimeoutMin: number;
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  permissions: Permission[];
  active: boolean;
  status: 'active' | 'disabled' | 'invited' | 'locked';
  has2fa: boolean;
  lastLoginAt: string | null;
}

export interface AuditRow {
  id: string;
  at: string;
  actor: string;
  action: string;
  entity: string;
  entityId: string | null;
  summary: string;
}

export interface LoginEventRow {
  id: string;
  at: string;
  user: string;
  event: string;
  device: string;
}

export interface ApiError {
  error: { code: string; message: string; fields?: Record<string, string> };
}
