import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, CUSTOM_ROLE, ROLES, normalizePermissions, roleFor } from './permissions';

describe('permissions', () => {
  it('has the 14 permissions from the demo', () => {
    expect(ALL_PERMISSIONS).toHaveLength(14);
  });

  it('defines the 5 default roles from the demo', () => {
    expect(Object.keys(ROLES)).toEqual(['מנהל מערכת', 'גבייה', 'קופאית', 'הנהלת חשבונות', 'צפייה בלבד']);
    expect(ROLES['מנהל מערכת']).toEqual(ALL_PERMISSIONS);
  });

  it('detects a role only on an exact match, regardless of order', () => {
    expect(roleFor(['rec', 'checks', 'pay', 'stu_view'])).toBe('קופאית');
    expect(roleFor(['stu_view', 'pay'])).toBe(CUSTOM_ROLE);
    expect(roleFor([...ALL_PERMISSIONS])).toBe('מנהל מערכת');
  });

  it('normalizes unknown and duplicate permissions away', () => {
    expect(normalizePermissions(['pay', 'pay', 'hack', 'stu_view'])).toEqual(['stu_view', 'pay']);
  });
});
