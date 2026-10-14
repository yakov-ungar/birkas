import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  PLAN_CHARGE_STATUS,
  formatMoney,
  type BankTxnRow,
  type MasavExportRow,
  type PlanChargeStatus,
  type StandingOrderRow,
} from '@tuition/shared';
import { download, get, post } from '../../api/client';
import { useFamilies, useInvalidateMoney } from '../../api/hooks';
import { Field, FormError, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { Money } from '../../components/Money';
import { useDialogs } from '../../components/Dialogs';
import { useToast } from '../../components/Toast';
import { FormModal } from '../families/StudentActions';
import { ReceiptModal } from '../receipts/ReceiptModal';

const fmt = (d: string) => d.split('-').reverse().join('/');
const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
const LEVEL: Record<string, [string, string]> = { high: ['התאמה גבוהה', 'g'], medium: ['התאמה חלקית', 'o'] };
const ITEM: Record<string, [string, string]> = {
  submitted: ['נשלח', 'bl'],
  paid: ['שולם', 'g'],
  returned: ['הוחזר', 'r'],
};

const toBase64 = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] ?? '');
    r.onerror = () => rej(new Error('לא ניתן לקרוא את הקובץ'));
    r.readAsDataURL(f);
  });

export function BankPage() {
  const { open } = useDialogs();
  const toast = useToast();
  const invalidate = useInvalidateMoney();
  const txns = useQuery({
    queryKey: ['bank'],
    queryFn: () => get<{ transactions: BankTxnRow[] }>('/api/bank/transactions'),
  });
  const so = useQuery({
    queryKey: ['standing-orders'],
    queryFn: () => get<{ standingOrders: StandingOrderRow[] }>('/api/bank/standing-orders'),
  });
  const masav = useQuery({
    queryKey: ['masav'],
    queryFn: () => get<{ exports: MasavExportRow[] }>('/api/bank/masav'),
  });

  const run = async (url: string, ok: string, body: unknown = {}) => {
    try {
      await post(url, body);
      await invalidate();
      toast(ok);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <>
      <h2>בנק והוראות קבע</h2>
      <div className="row">
        <button className="b" type="button" onClick={() => open(<ImportBankModal />)}>
          ייבוא דף בנק
        </button>
        <button className="b s" type="button" onClick={() => open(<MasavModal />)}>
          הפקת קובץ מס״ב
        </button>
      </div>
      <div className="card tw">
        <b>תנועות בנק</b>
        <table>
          <thead>
            <tr>
              <th>תאריך</th>
              <th>תיאור</th>
              <th>סכום</th>
              <th>התאמה</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {txns.data?.transactions.map((t) => (
              <tr key={t.id}>
                <td>{fmt(t.date)}</td>
                <td>
                  {t.description}
                  {t.reference && <span className="mu"> · {t.reference}</span>}
                </td>
                <td>
                  <Money a={t.amountAgorot} />
                </td>
                <td>
                  {t.status === 'registered' ? (
                    <>
                      <span className="pill g">נרשם</span> {t.familyName}
                    </>
                  ) : t.status === 'ignored' ? (
                    <span className="pill gr">לא רלוונטי</span>
                  ) : t.suggestedFamily ? (
                    <>
                      {t.suggestedFamily.name}{' '}
                      <span className={`pill ${LEVEL[t.matchLevel]?.[1] ?? 'o'}`}>
                        {LEVEL[t.matchLevel]?.[0]}
                      </span>
                      {t.matchReason && <div className="mu">{t.matchReason}</div>}
                    </>
                  ) : (
                    <span className="pill o">לא זוהה</span>
                  )}
                </td>
                <td>
                  {t.status === 'pending' && (
                    <>
                      {t.suggestedFamily && (
                        <button
                          className="b sm"
                          type="button"
                          onClick={() =>
                            void run(`/api/bank/transactions/${t.id}/register`, 'התשלום נרשם וקבלה הופקה', {
                              familyId: t.suggestedFamily!.id,
                            })
                          }
                        >
                          אישור
                        </button>
                      )}{' '}
                      <button className="b s sm" type="button" onClick={() => open(<AssignModal txn={t} />)}>
                        שיוך
                      </button>{' '}
                      <button
                        className="b s sm"
                        type="button"
                        onClick={() =>
                          void run(`/api/bank/transactions/${t.id}/ignore`, 'התנועה סומנה כלא רלוונטית')
                        }
                      >
                        התעלם
                      </button>
                    </>
                  )}
                  {t.receiptId && (
                    <button
                      className="b s sm"
                      type="button"
                      onClick={() => open(<ReceiptModal id={t.receiptId!} />)}
                    >
                      קבלה
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {txns.data && !txns.data.transactions.length && (
              <tr>
                <td colSpan={5}>אין תנועות. ייבא דף בנק.</td>
              </tr>
            )}
          </tbody>
        </table>
        <FormError message={(txns.error as Error | null)?.message} />
      </div>

      <div className="card tw">
        <b>הוראות קבע פעילות</b>
        <table>
          <thead>
            <tr>
              <th>תלמיד</th>
              <th>סכום</th>
              <th>בנק / חשבון</th>
              <th>חיוב הבא</th>
            </tr>
          </thead>
          <tbody>
            {so.data?.standingOrders.map((s) => (
              <tr key={s.planId}>
                <td>{s.studentName}</td>
                <td>
                  <Money a={s.amountAgorot} />
                </td>
                <td>
                  בנק {s.bank} · סניף {s.branch} · <span className="ltr">****{s.accountLast4}</span>
                </td>
                <td>
                  {s.next ? (
                    <>
                      {fmt(s.next.dueDate)}{' '}
                      <span
                        className={`pill ${PLAN_CHARGE_STATUS[s.next.status as PlanChargeStatus]?.[1] ?? 'o'}`}
                      >
                        {PLAN_CHARGE_STATUS[s.next.status as PlanChargeStatus]?.[0] ?? s.next.status}
                      </span>
                    </>
                  ) : (
                    '-'
                  )}
                </td>
              </tr>
            ))}
            {so.data && !so.data.standingOrders.length && (
              <tr>
                <td colSpan={4}>אין הוראות קבע</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card tw">
        <b>קובצי מס״ב</b>
        <p className="mu">
          עד שיתקבל המפרט הרשמי מהבנק, הקובץ הוא קובץ הדגמה ומסומן "לא לשליחה". אחרי תאריך החיוב מאשרים את
          הביצוע, וכל הוראה שהבנק החזיר מסמנים כמוחזרת.
        </p>
        {masav.data?.exports.map((e) => (
          <div
            key={e.id}
            className="rule"
            style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, marginBottom: 10 }}
          >
            <div className="row" style={{ margin: 0 }}>
              <b>תאריך חיוב {fmt(e.chargeDate)}</b>
              <span>
                {e.count} הוראות · <Money a={e.totalAgorot} />
              </span>
              <span className={`pill ${e.status === 'settled' ? 'g' : 'bl'}`}>
                {e.status === 'settled' ? 'בוצע' : 'נשלח לבנק'}
              </span>
              <span className="spacer" />
              <button
                className="b s sm"
                type="button"
                onClick={() =>
                  download(`/api/bank/masav/${e.id}/file`, `masav-demo-${e.chargeDate}.txt`).catch(
                    (x: Error) => toast(x.message),
                  )
                }
              >
                הורדת הקובץ
              </button>
              {e.status === 'submitted' && (
                <button
                  className="b sm"
                  type="button"
                  onClick={() => void run(`/api/bank/masav/${e.id}/settle`, 'הביצוע אושר והתשלומים נרשמו')}
                >
                  אישור ביצוע
                </button>
              )}
            </div>
            <table style={{ minWidth: 0, marginTop: 8 }}>
              <tbody>
                {e.items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.studentName}</td>
                    <td>
                      <Money a={i.amountAgorot} />
                    </td>
                    <td>
                      <span className={`pill ${ITEM[i.status]![1]}`}>{ITEM[i.status]![0]}</span>
                      {i.returnReason && <span className="mu"> {i.returnReason}</span>}
                    </td>
                    <td>
                      {i.status !== 'returned' && (
                        <button
                          className="b s sm"
                          type="button"
                          onClick={() => open(<ReturnItemModal id={i.id} name={i.studentName} />)}
                        >
                          סמן כמוחזר
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {masav.data && !masav.data.exports.length && <p className="mu">עדיין לא הופקו קבצים</p>}
      </div>
    </>
  );
}

function ImportBankModal() {
  const { close, open } = useDialogs();
  const invalidate = useInvalidateMoney();
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="ייבוא דף בנק"
      onClose={close}
      footer={
        <>
          <button
            className="b"
            type="button"
            disabled={!file || busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                const r = await post<{
                  imported: number;
                  matched: number;
                  duplicates: number;
                  skipped: number;
                }>('/api/bank/import', { fileName: file!.name, contentBase64: await toBase64(file!) });
                await invalidate();
                open(
                  <Modal
                    title="הייבוא הסתיים"
                    onClose={close}
                    footer={
                      <button className="b s" type="button" onClick={close}>
                        סגור
                      </button>
                    }
                  >
                    <p>
                      נקלטו {r.imported} זיכויים, מתוכם {r.matched} זוהו.{' '}
                      {r.duplicates > 0 && `${r.duplicates} תנועות כבר יובאו בעבר ודולגו. `}
                      {r.skipped > 0 && `${r.skipped} שורות אחרות (חיובים, יתרות) לא נקלטו.`}
                    </p>
                    <p className="mu">אשר או שייך כל תנועה בטבלה.</p>
                  </Modal>,
                );
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'קורא דף בנק ומתאים תנועות...' : 'ייבוא'}
          </button>
          <button className="b s" type="button" onClick={close}>
            ביטול
          </button>
        </>
      }
    >
      <p className="mu">
        קובץ csv או xlsx מהבנק עם שורת כותרות: תאריך, תיאור (או פרטים), זכות (או סכום), ואסמכתא אם יש. נקלטים
        רק זיכויים. תנועה שכבר יובאה לא נקלטת שוב.
      </p>
      <div className="field">
        <label htmlFor="bank-file">קובץ</label>
        <input
          id="bank-file"
          type="file"
          accept=".csv,.xlsx"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>
      <FormError message={err} />
    </Modal>
  );
}

function AssignModal({ txn }: { txn: BankTxnRow }) {
  const { close } = useDialogs();
  const toast = useToast();
  const invalidate = useInvalidateMoney();
  const families = useFamilies();
  const [familyId, setFamilyId] = useState(txn.suggestedFamily?.id ?? '');
  return (
    <FormModal
      title="שיוך תנועה"
      submitLabel="שיוך ורישום"
      onCancel={close}
      onSubmit={async () => {
        await post(`/api/bank/transactions/${txn.id}/register`, { familyId });
        await invalidate();
        close();
        toast('התשלום נרשם וקבלה הופקה');
      }}
    >
      {() => (
        <>
          <p style={{ gridColumn: '1/-1' }}>
            {txn.description} · {formatMoney(txn.amountAgorot)}
          </p>
          <SelectField label="משפחה" value={familyId} onChange={(e) => setFamilyId(e.target.value)}>
            <option value="">בחירת משפחה</option>
            {families.data?.families.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} - {f.parentName} (יתרה {formatMoney(f.balanceAgorot)})
              </option>
            ))}
          </SelectField>
        </>
      )}
    </FormModal>
  );
}

function MasavModal() {
  const { close } = useDialogs();
  const toast = useToast();
  const invalidate = useInvalidateMoney();
  const [date, setDate] = useState(todayIso());
  return (
    <FormModal
      title="הפקת קובץ מס״ב"
      submitLabel="הפקה"
      onCancel={close}
      onSubmit={async () => {
        const r = await post<{ id: string; count: number; totalAgorot: number }>('/api/bank/masav', {
          chargeDate: date,
        });
        await invalidate();
        await download(`/api/bank/masav/${r.id}/file`, `masav-demo-${date}.txt`);
        close();
        toast(`הקובץ הופק: ${r.count} הוראות בסך ${formatMoney(r.totalAgorot)}`);
      }}
    >
      {(fe) => (
        <>
          <Field
            label="תאריך חיוב"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            error={fe.chargeDate}
          />
          <p className="mu" style={{ gridColumn: '1/-1' }}>
            ייכללו כל חיובי הוראות הקבע שמועדם עד התאריך הזה. הם יסומנו "נשלח לבנק". קובץ הדגמה בלבד, לא
            לשליחה.
          </p>
        </>
      )}
    </FormModal>
  );
}

function ReturnItemModal({ id, name }: { id: string; name: string }) {
  const { close } = useDialogs();
  const toast = useToast();
  const invalidate = useInvalidateMoney();
  const [reason, setReason] = useState('');
  return (
    <FormModal
      title={`הוראת קבע הוחזרה - ${name}`}
      submitLabel="סימון כמוחזר"
      onCancel={close}
      onSubmit={async () => {
        await post(`/api/bank/masav/items/${id}/return`, { reason });
        await invalidate();
        close();
        toast('ההוראה סומנה כמוחזרת והחיוב סומן כנכשל');
      }}
    >
      {(fe) => (
        <Field
          label="סיבת ההחזרה (מהבנק)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={fe.reason}
        />
      )}
    </FormModal>
  );
}
