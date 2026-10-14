/**
 * Payment provider boundary. The browser enters card details only in the provider's
 * hosted fields; this server receives a token and card metadata, never a card number or CVV.
 */
export interface TokenizationResult {
  token: string;
  last4: string;
  brand: string;
  expMonth: number;
  expYear: number;
  holderName: string;
}

export interface CardToken {
  token: string;
  last4: string;
  brand: string;
  expMonth: number;
  expYear: number;
  holderName: string;
}

export type ChargeResult =
  | { status: 'approved'; providerTxnId: string; approvalCode: string }
  | { status: 'declined' | 'error'; errorMessageHe: string };

export type RefundResult =
  | { status: 'approved'; providerTxnId: string }
  | { status: 'declined' | 'error'; errorMessageHe: string };

export interface PaymentProvider {
  readonly name: string;
  /** Where the browser loads the hosted card fields from. */
  hostedFieldsUrl(): string;
  /** Verifies the hosted fields' result with the provider and returns what may be stored. */
  finalizeTokenization(result: TokenizationResult): Promise<CardToken>;
  chargeToken(input: {
    token: string;
    amountAgorot: number;
    idempotencyKey: string;
    description: string;
  }): Promise<ChargeResult>;
  refund(input: {
    providerTxnId: string;
    amountAgorot: number;
    idempotencyKey: string;
  }): Promise<RefundResult>;
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): unknown | null;
  testConnection(): Promise<{ ok: boolean; latencyMs: number; messageHe: string }>;
}

export class ProviderError extends Error {}
