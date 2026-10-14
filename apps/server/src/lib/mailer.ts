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
}

/** Every mail is recorded in Outbox. With MAIL_TRANSPORT=smtp it is also delivered. */
export function createMailer(db: Db, config: Config): Mailer {
  const transport =
    config.MAIL_TRANSPORT === 'smtp' && config.SMTP_URL ? nodemailer.createTransport(config.SMTP_URL) : null;
  return {
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
