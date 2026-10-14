import { randomBytes } from 'node:crypto';
import type { CardToken, ChargeResult, PaymentProvider, RefundResult, TokenizationResult } from './types';
import { ProviderError } from './types';

/** Deterministic PRNG so "random" failures are reproducible in tests. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Test cards (by last 4 digits) with fixed outcomes. */
export const MOCK_DECLINE_LAST4 = '0002';
export const MOCK_ERROR_LAST4 = '0051';

const TOKEN_RE = /^mock_tok_(\d{4})_[A-Za-z0-9_-]{8,}$/;

/**
 * Behaves like the demo: tokenization "at the acquirer", approvals with a 6-digit code,
 * declines for known test cards, and optional controlled random failures.
 * Idempotent per key, like a real acquirer.
 */
export class MockProvider implements PaymentProvider {
  readonly name = 'mock';
  private readonly results = new Map<string, ChargeResult | RefundResult>();
  private readonly rand: () => number;

  constructor(private readonly opts: { failureRate?: number; seed?: number } = {}) {
    this.rand = mulberry32(opts.seed ?? 42);
  }

  hostedFieldsUrl() {
    return '/mock-provider/fields.html';
  }

  async finalizeTokenization(r: TokenizationResult): Promise<CardToken> {
    const m = TOKEN_RE.exec(r.token);
    if (!m || m[1] !== r.last4) throw new ProviderError('טוקן לא תקין מחברת הסליקה');
    return {
      token: r.token,
      last4: r.last4,
      brand: r.brand,
      expMonth: r.expMonth,
      expYear: r.expYear,
      holderName: r.holderName,
    };
  }

  async chargeToken(input: {
    token: string;
    amountAgorot: number;
    idempotencyKey: string;
  }): Promise<ChargeResult> {
    const prev = this.results.get(input.idempotencyKey);
    if (prev) return prev as ChargeResult;
    const last4 = TOKEN_RE.exec(input.token)?.[1];
    let r: ChargeResult;
    if (!last4) r = { status: 'error', errorMessageHe: 'טוקן לא מוכר בחברת הסליקה' };
    else if (last4 === MOCK_DECLINE_LAST4) r = { status: 'declined', errorMessageHe: 'סירוב חברת האשראי' };
    else if (last4 === MOCK_ERROR_LAST4)
      r = { status: 'error', errorMessageHe: 'תקלת תקשורת עם חברת האשראי' };
    else if (this.opts.failureRate && this.rand() < this.opts.failureRate)
      r = { status: 'declined', errorMessageHe: 'סירוב חברת האשראי' };
    else
      r = {
        status: 'approved',
        providerTxnId: `mock_txn_${randomBytes(8).toString('hex')}`,
        approvalCode: String(100000 + Math.floor(this.rand() * 900000)),
      };
    this.results.set(input.idempotencyKey, r);
    return r;
  }

  async refund(input: {
    providerTxnId: string;
    amountAgorot: number;
    idempotencyKey: string;
  }): Promise<RefundResult> {
    const prev = this.results.get(input.idempotencyKey);
    if (prev) return prev as RefundResult;
    const r: RefundResult = input.providerTxnId.startsWith('mock_txn_')
      ? { status: 'approved', providerTxnId: `mock_ref_${randomBytes(8).toString('hex')}` }
      : { status: 'error', errorMessageHe: 'עסקה לא נמצאה בחברת הסליקה' };
    this.results.set(input.idempotencyKey, r);
    return r;
  }

  verifyWebhook() {
    return null;
  }

  async testConnection() {
    return { ok: true, latencyMs: 1, messageHe: 'מצב בדיקה (מדומה)' };
  }
}
