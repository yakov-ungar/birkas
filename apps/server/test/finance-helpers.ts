import { randomUUID } from 'node:crypto';
import type { Agent } from './helpers';

export const key = () => randomUUID();

export async function addStudent(a: Agent, body: Record<string, unknown>) {
  const r = await a.req('POST', '/api/students', { grade: "א'", tuitionAgorot: 960000, ...body });
  if (r.statusCode !== 200) throw new Error(`addStudent ${r.statusCode} ${r.body}`);
  return r.json() as { studentId: string; familyId: string; siblingDiscountAgorot: number };
}

export async function newFamily(
  a: Agent,
  name = 'יוסף כהן',
  parent = 'דוד כהן',
  phone = '050-1111111',
  email = '',
) {
  return addStudent(a, { fullName: name, newFamily: { parentName: parent, phone, email } });
}

export async function card(a: Agent, studentId: string) {
  const r = await a.req('GET', `/api/students/${studentId}`);
  if (r.statusCode !== 200) throw new Error(`card ${r.statusCode} ${r.body}`);
  return r.json();
}

export async function pay(a: Agent, body: Record<string, unknown>) {
  return a.req('POST', '/api/payments', { idempotencyKey: key(), ...body });
}

export const cash = { method: 'cash', receivedBy: 'קופאית' };

/** Cash needs an open drawer (decision B9). */
export async function openCash(a: Agent, floatAgorot = 0) {
  const r = await a.req('POST', '/api/cash/open', { openingFloatAgorot: floatAgorot });
  if (r.statusCode !== 200) throw new Error(`openCash ${r.statusCode} ${r.body}`);
}

export const mockCard = (last4 = '1111', save = false, exp: [number, number] = [12, 2030]) => ({
  token: `mock_tok_${last4}_${'a'.repeat(16)}`,
  last4,
  brand: 'ויזה',
  expMonth: exp[0],
  expYear: exp[1],
  holderName: 'דוד כהן',
  save,
});
