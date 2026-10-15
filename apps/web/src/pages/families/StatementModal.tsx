import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LedgerRow } from '@tuition/shared';
import { get, post } from '../../api/client';
import { Field, FormError } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { Money } from '../../components/Money';
import { useDialogs } from '../../components/Dialogs';
import { useToast } from '../../components/Toast';
import { LedgerTable } from './LedgerTable';
import { useChannels } from '../../app/channels';

interface Statement {
  schoolName: string;
  asOf: string;
  family: { id: string; name: string; parentName: string; email: string };
  ledger: LedgerRow[];
  balanceAgorot: number;
}

export function StatementModal({ familyId, after }: { familyId: string; after?: ReactNode }) {
  const { close, open } = useDialogs();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['statement', familyId],
    queryFn: () => get<Statement>(`/api/families/${familyId}/statement`),
  });
  const [sending, setSending] = useState(false);
  const [email, setEmail] = useState('');
  const [channel, setChannel] = useState<'email' | 'sms' | 'whatsapp' | 'voice'>('email');
  const channels = useChannels();
  const textMessaging = channels.includes('sms');
  const [err, setErr] = useState<string | null>(null);
  const s = q.data;
  const done = () => (after ? open(after) : close());
  return (
    <Modal
      title={`דף חשבון - ${s?.family.name ?? ''}`}
      onClose={done}
      footer={
        <>
          <button
            className="b"
            type="button"
            onClick={() => window.open(`/api/families/${familyId}/statement/pdf`, '_blank', 'noopener')}
          >
            הדפסה / PDF
          </button>
          {!sending && (
            <button
              className="b s"
              type="button"
              onClick={() => {
                setEmail(s?.family.email ?? '');
                setSending(true);
              }}
            >
              שליחה להורה
            </button>
          )}
          <button className="b s" type="button" onClick={done}>
            סגור
          </button>
        </>
      }
    >
      <FormError message={(q.error as Error | null)?.message} />
      {s && (
        <>
          <p>
            <b>{s.schoolName}</b>
            <br />
            דף חשבון נכון ל-{s.asOf.split('-').reverse().join('/')}
            <br />
            עבור: {s.family.parentName} · {s.family.name}
          </p>
          <LedgerTable rows={s.ledger} showStudent />
          <p>
            <b>
              יתרה לתשלום:{' '}
              <span className={s.balanceAgorot > 0 ? 'bad' : 'ok'}>
                <Money a={s.balanceAgorot} />
              </span>
            </b>
          </p>
          {sending && (
            <div className="row">
              <div className="field">
                <label htmlFor="stmt-ch">ערוץ</label>
                <select
                  id="stmt-ch"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value as 'email' | 'sms' | 'whatsapp' | 'voice')}
                >
                  <option value="email">מייל (עם PDF)</option>
                  {textMessaging && <option value="whatsapp">וואטסאפ</option>}
                  {textMessaging && <option value="sms">SMS</option>}
                  {channels.includes('voice') && <option value="voice">שיחה קולית</option>}
                </select>
              </div>
              {channel === 'email' && (
                <Field
                  label="כתובת מייל"
                  type="email"
                  dir="ltr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
              <button
                className="b"
                type="button"
                onClick={async () => {
                  try {
                    await post(
                      `/api/families/${familyId}/statement/send`,
                      channel === 'email' ? { channel, email } : { channel },
                    );
                    toast(channel === 'email' ? `דף החשבון נשלח ל-${email}` : 'דף החשבון נשלח להורה');
                    setSending(false);
                  } catch (e) {
                    setErr((e as Error).message);
                  }
                }}
              >
                שליחה
              </button>
            </div>
          )}
          <FormError message={err} />
        </>
      )}
    </Modal>
  );
}
