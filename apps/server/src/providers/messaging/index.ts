import { randomBytes } from 'node:crypto';

/** SMS and WhatsApp gateways. Only mocks until real providers are chosen (plan stage 9). */
export interface TextChannel {
  readonly name: string;
  send(to: string, body: string): Promise<{ ok: true; ref: string } | { ok: false; error: string }>;
}

export class MockTextChannel implements TextChannel {
  /** Recent sends, kept in memory only so tests can read them (test routes). Never persisted. */
  readonly sent: { to: string; body: string }[] = [];
  constructor(readonly name: 'sms' | 'whatsapp') {}
  async send(to: string, body: string) {
    if (!/^0\d{8,9}$/.test(to)) return { ok: false as const, error: 'מספר טלפון לא תקין' };
    this.sent.unshift({ to, body });
    this.sent.length = Math.min(this.sent.length, 50);
    return { ok: true as const, ref: `mock_${this.name}_${randomBytes(6).toString('hex')}` };
  }
}

export interface TextChannels {
  sms: TextChannel;
  whatsapp: TextChannel;
}

export const createTextChannels = (): TextChannels => ({
  sms: new MockTextChannel('sms'),
  whatsapp: new MockTextChannel('whatsapp'),
});
