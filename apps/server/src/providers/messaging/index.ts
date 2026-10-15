import { randomBytes } from 'node:crypto';
import type { Db } from '../../lib/db';
import type { Encryptor } from '../../lib/crypto';
import { YemotVoice, forSpeech } from './yemot';

/** SMS and WhatsApp stay mocks (the school uses email and voice calls instead, stage 9). */
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

/**
 * Voice calls go through ימות המשיח only when the "voice" connection is set up in production mode
 * (settings → connections). Otherwise nothing is dialled, and callers fall back to email.
 */
export class VoiceChannel implements TextChannel {
  readonly name = 'voice';
  constructor(
    private readonly db: Db,
    private readonly enc: Encryptor,
    private readonly http: typeof fetch,
  ) {}

  async provider(): Promise<YemotVoice | null> {
    const i = await this.db.integration.findUnique({ where: { key: 'voice' } });
    if (!i?.connected || i.mode !== 'live' || !i.configEnc) return null;
    const c = JSON.parse(this.enc.decrypt(i.configEnc)) as {
      username: string;
      secret: string;
      callerId?: string;
    };
    return new YemotVoice({ username: c.username, password: c.secret, callerId: c.callerId }, this.http);
  }

  async send(to: string, body: string) {
    const p = await this.provider();
    if (!p) return { ok: false as const, error: 'שירות השיחות הקוליות אינו מחובר' };
    return p.send(to, forSpeech(body));
  }
}

export interface TextChannels {
  sms: TextChannel;
  whatsapp: TextChannel;
  voice: VoiceChannel;
}

export const createTextChannels = (db: Db, enc: Encryptor, http: typeof fetch): TextChannels => ({
  sms: new MockTextChannel('sms'),
  whatsapp: new MockTextChannel('whatsapp'),
  voice: new VoiceChannel(db, enc, http),
});
