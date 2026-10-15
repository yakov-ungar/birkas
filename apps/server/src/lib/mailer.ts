import nodemailer from 'nodemailer';
import type { Config } from '../config';
import type { Db } from './db';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
  /** Connects to the configured SMTP server (only when MAIL_TRANSPORT=smtp) and checks the login. */
  verify(): Promise<{ ok: boolean; messageHe: string }>;
}

function smtpPassword(url?: string): string {
  try {
    return url ? decodeURIComponent(new URL(url).password) : '';
  } catch {
    return '';
  }
}

/** Every mail is recorded in Outbox. With MAIL_TRANSPORT=smtp it is also delivered. */
export function createMailer(db: Db, config: Config): Mailer {
  const transport =
    config.MAIL_TRANSPORT === 'smtp' && config.SMTP_URL ? nodemailer.createTransport(config.SMTP_URL) : null;
  return {
    async verify() {
      if (!transport)
        return {
          ok: true,
          messageHe: 'תיבת יוצא פנימית: המיילים נשמרים במערכת ולא נשלחים (MAIL_TRANSPORT=outbox)',
        };
      try {
        await transport.verify();
        return { ok: true, messageHe: 'שרת המייל אישר את החיבור' };
      } catch (e) {
        // Shown to the admin: make sure the SMTP password can never appear in it.
        let msg = String((e as Error).message);
        const pw = smtpPassword(config.SMTP_URL);
        if (pw) msg = msg.split(pw).join('***');
        return { ok: false, messageHe: `שרת המייל דחה את החיבור: ${msg.slice(0, 200)}` };
      }
    },
    async send(mail) {
      const { attachments, ...rest } = mail;
      const row = await db.outbox.create({
        data: {
          ...rest,
          html: mail.html ?? null,
          attachmentNames: attachments?.length ? JSON.stringify(attachments.map((a) => a.filename)) : null,
        },
      });
      if (!transport) return;
      try {
        await transport.sendMail({ from: config.MAIL_FROM, ...mail });
        await db.outbox.update({ where: { id: row.id }, data: { sentAt: new Date() } });
      } catch (e) {
        await db.outbox.update({
          where: { id: row.id },
          data: { error: String((e as Error).message).slice(0, 500) },
        });
        throw e;
      }
    },
  };
}
