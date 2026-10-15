import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DOC_TYPES, PAYMENT_METHODS, type ReceiptView } from '@tuition/shared';
import { get, post } from '../../api/client';
import { useInvalidateMoney } from '../../api/hooks';
import { useAuth } from '../../app/auth';
import { Field, FormError } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { Money } from '../../components/Money';
import { useDialogs } from '../../components/Dialogs';
import { useToast } from '../../components/Toast';

const fmt = (d: string) => d.split('-').reverse().join('/');

export function ReceiptModal({ id }: { id: string }) {
  const { close, open } = useDialogs();
  const { has } = useAuth();
  const q = useQuery({ queryKey: ['receipt', id], queryFn: () => get<ReceiptView>(`/api/receipts/${id}`) });
  const r = q.data;
  const isCredit = r && r.docType !== 'receipt';
  return (
    <Modal
      title={
        r ? (
          <>
            {DOC_TYPES[r.docType]} מס׳ {r.number} {r.cancelled && <span className="pill r">מבוטלת</span>}
          </>
        ) : (
          'טוען...'
        )
      }
      onClose={close}
      footer={
        r && (
          <>
            <button
              className="b"
              type="button"
              onClick={() => window.open(`/api/receipts/${id}/pdf`, '_blank', 'noopener')}
            >
              הדפסה / PDF
            </button>
            {has('rec') && (
              <button className="b s" type="button" onClick={() => open(<EmailReceipt id={id} />)}>
                שליחה במייל
              </button>
            )}
            {has('pay') && r.docType === 'receipt' && !r.cancelled && r.method !== 'check' && (
              <button
                className="b s"
                type="button"
                onClick={() => open(<CancelReceipt id={id} number={r.number} />)}
              >
                ביטול קבלה
              </button>
            )}
            <button className="b s" type="button" onClick={close}>
              סגור
            </button>
          </>
        )
      }
    >
      {q.error && <FormError message={(q.error as Error).message} />}
      {r && (
        <>
          <p>
            <b>{r.schoolName}</b>
            <br />
            תאריך: {fmt(r.date)}
            <br />
            {isCredit ? 'הוחזר ל' : 'התקבל מאת'}: {r.payerName}
            <br />
            סכום:{' '}
            <b>
              <Money a={r.amountAgorot} />
            </b>
            <br />
            אמצעי: {PAYMENT_METHODS[r.method] ?? r.method}
            {r.reference ? ` · ${r.reference}` : ''}
          </p>
          <table style={{ minWidth: 0 }}>
            <thead>
              <tr>
                <th>עבור</th>
                <th>סכום</th>
              </tr>
            </thead>
            <tbody>
              {r.lines.map((l, i) => (
                <Fragment key={i}>
                  <tr>
                    <td>
                      <b>{l.studentName}</b>
                    </td>
                    <td>
                      <Money a={l.amountAgorot} />
                    </td>
                  </tr>
                  {l.items.map((it, j) => (
                    <tr key={`${i}-${j}`} className="mu">
                      <td style={{ paddingInlineStart: 24 }}>· {it.description}</td>
                      <td>
                        <Money a={it.amountAgorot} />
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
          {r.creditForNumber && <p className="mu">זיכוי לקבלה מס׳ {r.creditForNumber}</p>}
          {r.cancelledBy && <p className="mu">בוטלה באישור זיכוי מס׳ {r.cancelledBy}</p>}
          <p className="mu">
            {r.printCount === 0
              ? 'ההדפסה הראשונה תסומן "מקור", הבאות "העתק נאמן למקור".'
              : `הודפס/נשלח ${r.printCount} פעמים. הדפסה נוספת תסומן "העתק נאמן למקור".`}
          </p>
        </>
      )}
    </Modal>
  );
}

function EmailReceipt({ id }: { id: string }) {
  const { open } = useDialogs();
  const toast = useToast();
  const invalidate = useInvalidateMoney();
  const [email, setEmail] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const back = () => open(<ReceiptModal id={id} />);
  return (
    <Modal
      title="שליחת קבלה במייל"
      onClose={back}
      footer={
        <>
          <button
            className="b"
            type="button"
            onClick={async () => {
              try {
                await post(`/api/receipts/${id}/email`, { email });
                await invalidate();
                toast(`הקבלה נשלחה ל-${email}`);
                back();
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          >
            שליחה
          </button>
          <button className="b s" type="button" onClick={back}>
            ביטול
          </button>
        </>
      }
    >
      <Field
        label="כתובת מייל"
        type="email"
        dir="ltr"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <FormError message={err} />
    </Modal>
  );
}

function CancelReceipt({ id, number }: { id: string; number: number }) {
  const { open } = useDialogs();
  const invalidate = useInvalidateMoney();
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={`ביטול קבלה מס׳ ${number}`}
      onClose={() => open(<ReceiptModal id={id} />)}
      footer={
        <>
          <button
            className="b"
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await post<{ receipt: { id: string; number: number } }>(
                  `/api/receipts/${id}/cancel`,
                  { reason },
                );
                await invalidate();
                open(<ReceiptModal id={r.receipt.id} />);
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            ביטול קבלה
          </button>
          <button className="b s" type="button" onClick={() => open(<ReceiptModal id={id} />)}>
            חזרה
          </button>
        </>
      }
    >
      <p>
        יופק אישור זיכוי שמבטל את הקבלה, והיתרות יעודכנו. הקבלה המקורית נשמרת. תשלום באשראי יזוכה בחברת
        האשראי.
      </p>
      <Field label="סיבת הביטול" value={reason} onChange={(e) => setReason(e.target.value)} />
      <FormError message={err} />
    </Modal>
  );
}
