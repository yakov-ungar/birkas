import type { Permission } from '@tuition/shared';

export interface NavItem {
  path: string;
  label: string;
  perm?: Permission;
  /** Plan stage in which the screen is built (docs/PLAN.md). */
  stage: number;
}

/** Menu exactly as in the demo, in the same order and with the same permissions. */
export const NAV: NavItem[] = [
  { path: '/', label: 'לוח בקרה', stage: 3 },
  { path: '/families', label: 'תלמידים ומשפחות', perm: 'stu_view', stage: 2 },
  { path: '/charges', label: 'חיובים והנחות', perm: 'charges', stage: 2 },
  { path: '/plans', label: 'תוכניות חיוב', perm: 'plans', stage: 3 },
  { path: '/cards', label: 'כרטיסים שמורים', perm: 'cards', stage: 3 },
  { path: '/checks', label: 'שיקים וקופה', perm: 'checks', stage: 4 },
  { path: '/bank', label: 'בנק והוראות קבע', perm: 'bank', stage: 4 },
  { path: '/receipts', label: 'קבלות וזיכויים', perm: 'rec', stage: 2 },
  { path: '/collection', label: 'גבייה והודעות', perm: 'msg', stage: 5 },
  { path: '/requests', label: 'בקשות הורים', perm: 'req', stage: 6 },
  { path: '/portal-preview', label: 'פורטל הורים (תצוגה)', perm: 'req', stage: 6 },
  { path: '/reports', label: 'דוחות', perm: 'rep', stage: 7 },
  { path: '/users', label: 'משתמשים והרשאות', perm: 'users', stage: 1 },
  { path: '/settings', label: 'הגדרות וחיבורים', perm: 'settings', stage: 1 },
];
