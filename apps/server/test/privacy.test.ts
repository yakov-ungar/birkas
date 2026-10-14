import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bodyContainsPan, containsPan, maskPans } from '../src/lib/redact';
import { toCsv } from '../src/lib/csv';
import { Agent, createUser, makeApp, type TestCtx } from './helpers';

describe('redaction helpers', () => {
  it('masks Luhn-valid card numbers in any common format and leaves other numbers alone', () => {
    expect(maskPans('card 4111 1111 1111 1111 ok')).toBe('card [REDACTED-PAN] ok');
    expect(maskPans('4111-1111-1111-1111')).toBe('[REDACTED-PAN]');
    expect(maskPans('5555555555554444')).toBe('[REDACTED-PAN]');
    expect(maskPans('phone 0501111111, id 123456782, ref 1234567890123')).toBe(
      'phone 0501111111, id 123456782, ref 1234567890123',
    );
    expect(containsPan('nothing here')).toBe(false);
  });

  it('the body guard ignores UUIDs and finds card numbers anywhere else', () => {
    expect(bodyContainsPan({ idempotencyKey: '12345678-1234-4123-8123-123456789012', a: [{ b: 'x' }] })).toBe(
      false,
    );
    expect(bodyContainsPan({ note: '12345678-1234-4123-8123-123456789012' })).toBe(false);
    expect(bodyContainsPan({ a: [{ b: 'כרטיס 4111-1111-1111-1111' }] })).toBe(true);
    expect(bodyContainsPan({ n: 4111111111111111 })).toBe(true);
  });

  it('CSV neutralizes formula injection', () => {
    expect(toCsv(['a'], [['=HYPERLINK("x")']])).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('logs', () => {
  let ctx: TestCtx;
  beforeEach(async () => {
    ctx = await makeApp();
  });
  afterEach(() => ctx.close());

  it('never contain passwords, session cookies, emails or query strings', async () => {
    const { user, password } = await createUser(ctx.deps, {
      email: 'private.person@school.test',
      password: 'Very-Secret-Pass-77',
    });
    const a = new Agent(ctx.app);
    await a.req('POST', '/api/auth/login', { email: user.email, password });
    await a.req('POST', '/api/auth/login', { email: user.email, password: 'Wrong-Pass-4111111111111111' });
    await a.req('GET', '/api/audit?q=' + encodeURIComponent('דוד כהן 050-1111111'));
    const all = ctx.logs.join('\n');
    expect(all.length).toBeGreaterThan(0);
    expect(all).not.toContain(password);
    expect(all).not.toContain('private.person');
    expect(all).not.toContain('4111111111111111');
    expect(all).not.toContain('050-1111111');
    const sid = [...a.cookies.values()][0]!;
    expect(all).not.toContain(sid);
  });
});
