/** Permission keys and labels, exactly as defined in the approved demo (docs/reference/tuition-demo-v3.html). */
export const PERMISSIONS = {
  stu_view: 'צפייה בתלמידים ומשפחות',
  stu_edit: 'הוספה ועריכת תלמידים',
  pay: 'קבלת תשלומים וזיכויים',
  charges: 'חיובים והנחות',
  cards: 'כרטיסי אשראי שמורים',
  plans: 'תוכניות חיוב',
  checks: 'שיקים וקופה',
  bank: 'בנק והוראות קבע',
  rec: 'קבלות',
  msg: 'גבייה והודעות',
  req: 'בקשות הורים ופורטל',
  rep: 'דוחות',
  users: 'משתמשים והרשאות',
  settings: 'הגדרות וחיבורים',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const isPermission = (v: unknown): v is Permission =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(PERMISSIONS, v);

export const CUSTOM_ROLE = 'מותאם אישית';

export const ROLES: Record<string, readonly Permission[]> = {
  'מנהל מערכת': ALL_PERMISSIONS,
  גבייה: ['stu_view', 'stu_edit', 'pay', 'charges', 'cards', 'plans', 'checks', 'rec', 'msg', 'req'],
  קופאית: ['stu_view', 'pay', 'checks', 'rec'],
  'הנהלת חשבונות': ['stu_view', 'rec', 'rep', 'bank', 'checks'],
  'צפייה בלבד': ['stu_view'],
};

export const ROLE_NAMES = Object.keys(ROLES);

/** Normalizes a permission list: known keys only, no duplicates, canonical order. */
export function normalizePermissions(perms: readonly string[]): Permission[] {
  const set = new Set(perms);
  return ALL_PERMISSIONS.filter((p) => set.has(p));
}

/** A role name is shown only when the permissions match it exactly; otherwise the user is "custom". */
export function roleFor(perms: readonly string[], preferred?: string): string {
  const norm = normalizePermissions(perms);
  const matches = (role: string) => {
    const r = ROLES[role];
    return !!r && r.length === norm.length && r.every((p) => norm.includes(p));
  };
  if (preferred && matches(preferred)) return preferred;
  return ROLE_NAMES.find(matches) ?? CUSTOM_ROLE;
}
