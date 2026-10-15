import type { TextChannel } from './index';

/**
 * ימות המשיח (Yemot HaMashiach) voice calls: the message is read aloud by text-to-speech
 * to the parent's phone. Used instead of SMS (stage 9).
 *
 * Built from the public description of the API: base https://www.call2all.co.il/ym/api/,
 * a token of "<system number>:<password>", SendTTS with `phones` and `ttsMessage`, and a JSON
 * answer whose `responseStatus` is "OK" on success. The documentation site was not reachable
 * from the build machine, so the first call with real credentials is the check (docs/STAGE-9.md).
 */
export interface YemotConfig {
  /** The Yemot system (line) number. */
  username: string;
  password: string;
  /** Number shown to the called parent, if the system allows choosing one. */
  callerId?: string;
  baseUrl?: string;
}

type Result = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };

export const YEMOT_BASE_URL = 'https://www.call2all.co.il/ym/api';

export class YemotVoice implements TextChannel {
  readonly name = 'voice';
  constructor(
    private readonly cfg: YemotConfig,
    private readonly http: typeof fetch = fetch,
  ) {}

  /** POST with a form body, so the token never appears in a URL or a proxy log. */
  private async request(method: string, params: Record<string, string>): Promise<Result> {
    const body = new URLSearchParams({ token: `${this.cfg.username}:${this.cfg.password}`, ...params });
    let res: Response;
    try {
      res = await this.http(`${this.cfg.baseUrl ?? YEMOT_BASE_URL}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return { ok: false, error: 'אין חיבור לימות המשיח' };
    }
    let data: Record<string, unknown>;
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      return { ok: false, error: `תשובה לא צפויה מימות המשיח (HTTP ${res.status})` };
    }
    if (res.ok && data.responseStatus === 'OK') return { ok: true, data };
    const msg = typeof data.message === 'string' ? data.message : String(data.responseStatus ?? res.status);
    return { ok: false, error: `ימות המשיח: ${msg.split(this.cfg.password).join('***').slice(0, 200)}` };
  }

  async send(to: string, body: string) {
    if (!/^0\d{8,9}$/.test(to)) return { ok: false as const, error: 'מספר טלפון לא תקין' };
    const r = await this.request('SendTTS', {
      phones: to,
      ttsMessage: body,
      ...(this.cfg.callerId ? { callerId: this.cfg.callerId } : {}),
    });
    if (!r.ok) return { ok: false as const, error: r.error };
    const ref = r.data.campaignId ?? r.data.callId ?? r.data.id ?? 'yemot';
    return { ok: true as const, ref: `yemot_${String(ref).slice(0, 60)}` };
  }

  /** Checks the credentials without placing a call. */
  async check(): Promise<{ ok: boolean; messageHe: string }> {
    const r = await this.request('GetSession', {});
    return r.ok
      ? { ok: true, messageHe: 'ימות המשיח אישרה את פרטי המערכת' }
      : { ok: false, messageHe: r.error };
  }
}

/**
 * Turns a written message into one that reads well aloud: links are not read (the parent gets
 * them by email or in the portal), and shekel amounts are spoken.
 */
export function forSpeech(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, 'בפורטל ההורים')
    .replace(/₪\s?([\d,]+(?:\.\d+)?)/g, (_m, n: string) => `${n.replace(/,/g, '')} שקלים`)
    .replace(/\s+/g, ' ')
    .trim();
}

/** A one-time code read digit by digit, twice. */
export const codeForSpeech = (code: string) => {
  const digits = code.split('').join(', ');
  return `${digits}. אני חוזר: ${digits}`;
};
