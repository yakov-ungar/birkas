import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CHECK_STATUS,
  PAYMENT_METHODS,
  formatMoney,
  type CashState,
  type CheckRow,
  type PaymentMethod,
} from '@tuition/shared';
import { HttpError, get, post } from '../../api/client';
import { useInvalidateMoney, useStudents } from '../../api/hooks';
import { Field, FormError, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { Money, MoneyField } from '../../components/Money';
import { Tabs } from '../../components/Tabs';
import { useDialogs } from '../../components/Dialogs';
import { useToast } from '../../components/Toast';
import { fmtDate, fmtTime } from '../../components/format';
import { FormModal } from '../families/StudentActions';
import { ReceiptModal } from '../receipts/ReceiptModal';

const fmt = (d: string) => d.split('-').reverse().join('/');
const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
export const useCash = (enabled = true) =>
  useQuery({ queryKey: ['cash'], queryFn: () => get<CashState>('/api/cash'), enabled });

export function ChecksPage() {
  const [tab, setTab] = useState('chk');
  return (
    <>
      <h2>שיקים וקופה</h2>
      <Tabs
        label="שיקים וקופה"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'chk', label: 'שיקים דחויים', content: <ChecksTab /> },
          { id: 'cash', label: 'קופה מזומן', content: <CashTab /> },
        ]}
      />
    </>
  );
}

function ChecksTab() {
  const { open, close } = useDialogs();
  const toast = useToast();
  const invalidate = useInvalidateMoney();
  const q = useQuery({ queryKey: ['checks'], queryFn: () => get<{ checks: CheckRow[] }>('/api/checks') });
  const act = async (url: string, ok: string) => {
    try {
      await post(url);
      await invalidate();
      toast(ok);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <>
      <div className="row">
        <button className="b" type="button" onClick={() => open(<NewCheckModal />)}>
          רישום שיק
        </button>
        <button
          className="b s"
          type="button"
          onClick={async () => {
            try {
              const r = await post<{ count: number; totalAgorot: number }>('/api/checks/deposit-due');
              await invalidate();
              toast(
                r.count
                  ? `${r.count} שיקים הופקדו בסך ${formatMoney(r.totalAgorot)}. הופקו קבלות.`
                  : 'אין שיקים שהגיע מועדם',
              );
            } catch (e) {
              toast((e as Error).message);
            }
          }}
        >
          הפקד שיקים שהגיע מועדם
        </button>
      </div>
      <div className="card tw">
        <table>
          <thead>
            <tr>
              <th>פירעון</th>
              <th>תלמיד</th>
              <th>מס׳ שיק</th>
              <th>בנק</th>
              <th>סכום</th>
              <th>סטטוס</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {q.data?.checks.map((c) => (
              <tr key={c.id}>
                <td>
                  {fmt(c.dueDate)} {c.dueReached && <span className="pill o">הגיע מועד</span>}
                </td>
                <td>{c.studentName}</td>
                <td className="ltr">{c.number}</td>
                <td>{c.bank}</td>
                <td>
                  <Money a={c.amountAgorot} />
                </td>
                <td>
                  <span className={`pill ${CHECK_STATUS[c.status][1]}`}>{CHECK_STATUS[c.status][0]}</span>
                </td>
                <td>
                  {c.status === 'pending' && (
                    <>
                      <button
                        className="b sm"
                        type="button"
                        onClick={() => void act(`/api/checks/${c.id}/deposit`, 'השיק הופקד וקבלה הופקה')}
                      >
                        הפקדה
                      </button>{' '}
                      <button
                        className="b s sm"
                        type="button"
                        onClick={() => void act(`/api/checks/${c.id}/cancel`, 'רישום השיק בוטל')}
                      >
                        ביטול
                      </button>
                    </>
                  )}
                  {c.status === 'deposited' && (
                    <button
                      className="b s sm"
                      type="button"
                      onClick={() =>
                        open(
                          <Modal
                            title={`שיק ${c.number} חזר`}
                            onClose={close}
                            footer={
                              <>
                                <button
                                  className="b"
                                  type="button"
                                  onClick={async () => {
                                    close();
                                    await act(`/api/checks/${c.id}/return`, 'השיק סומן כחוזר');
                                  }}
                                >
                                  סמן כחוזר
                                </button>
                                <button className="b s" type="button" onClick={close}>
                                  ביטול
                                </button>
                              </>
                            }
                          >
                            <p>התשלום יבוטל באישור זיכוי, ותחויב עמלת שיק חוזר לפי ההגדרות.</p>
                          </Modal>,
                        )
                      }
                    >
                      סמן כחוזר
                    </button>
                  )}{' '}
                  {c.receiptId && (
                    <button
                      className="b s sm"
                      type="button"
                      onClick={() => open(<ReceiptModal id={c.receiptId!} />)}
                    >
                      קבלה
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {q.data && !q.data.checks.length && (
              <tr>
                <td colSpan={7}>אין שיקים</td>
              </tr>
            )}
          </tbody>
        </table>
        <FormError message={(q.error as Error | null)?.message} />
      </div>
      <p className="mu">שיק מופיע ביתרה רק לאחר הפקדה. שיק שחזר מבטל את התשלום ומחייב עמלה לפי ההגדרות.</p>
    </>
  );
}

function NewCheckModal() {
  const { close } = useDialogs();
  const toast = useToast();
  const invalidate = useInvalidateMoney();
  const students = useStudents('filter=all');
  const [key] = useState(() => crypto.randomUUID());
  const [v, setV] = useState({ studentId: '', number: '', bank: '', dueDate: todayIso() });
  const [amount, setAmount] = useState<number | null>(null);
  return (
    <FormModal
      title="רישום שיק"
      submitLabel="רישום"
      onCancel={close}
      onSubmit={async () => {
        await post('/api/checks', { idempotencyKey: key, ...v, amountAgorot: amount });
        await invalidate();
        close();
        toast(`השיק יופיע ביתרה לאחר ההפקדה בתאריך ${fmt(v.dueDate)}`);
      }}
    >
      {(fe) => (
        <>
          <SelectField
            label="תלמיד"
            value={v.studentId}
            onChange={(e) => setV({ ...v, studentId: e.target.value })}
            error={fe.studentId}
          >
            <option value="">בחירת תלמיד</option>
            {students.data?.students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullName}
              </option>
            ))}
          </SelectField>
          <Field
            label="מספר שיק"
            dir="ltr"
            value={v.number}
            onChange={(e) => setV({ ...v, number: e.target.value })}
            error={fe.number}
          />
          <Field
            label="בנק וסניף"
            value={v.bank}
            onChange={(e) => setV({ ...v, bank: e.target.value })}
            error={fe.bank}
          />
          <MoneyField label="סכום (₪)" value={amount} onChange={setAmount} error={fe.amountAgorot} />
          <Field
            label="תאריך פירעון"
            type="date"
            value={v.dueDate}
            onChange={(e) => setV({ ...v, dueDate: e.target.value })}
            error={fe.dueDate}
          />
        </>
      )}
    </FormModal>
  );
}

function CashTab() {
  const { open } = useDialogs();
  const q = useCash();
  const st = q.data?.open;
  return (
    <>
      <div className="card">
        {st ? (
          <>
            <div className="grid">
              <div className="kpi">
                <b>
                  <Money a={st.expectedAgorot} />
                </b>
                <span>צפוי בקופה</span>
              </div>
              <div className="kpi">
                <b>
                  <Money a={st.cashInAgorot} />
                </b>
                <span>מזומן שנאסף ולא נסגר</span>
              </div>
              <div className="kpi">
                <b>
                  <Money a={st.openingFloatAgorot} />
                </b>
                <span>יתרת פתיחה</span>
              </div>
              <div className="kpi">
                <b>{st.transactions}</b>
                <span>תנועות מזומן פתוחות</span>
              </div>
            </div>
            <p className="mu">
              נפתחה ב-{fmtDate(st.openedAt)} {fmtTime(st.openedAt)} על ידי {st.openedBy}
            </p>
            {st.byMethod.length > 0 && (
              <table style={{ minWidth: 0, marginBottom: 12 }}>
                <caption className="sr-only">סיכום לפי אמצעי תשלום</caption>
                <thead>
                  <tr>
                    <th>אמצעי תשלום (מאז פתיחת הקופה)</th>
                    <th>תנועות</th>
                    <th>סכום</th>
                  </tr>
                </thead>
                <tbody>
                  {st.byMethod.map((m) => (
                    <tr key={m.method}>
                      <td>{PAYMENT_METHODS[m.method as PaymentMethod] ?? m.label}</td>
                      <td>{m.count}</td>
                      <td>
                        <Money a={m.amountAgorot} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <button
              className="b"
              type="button"
              onClick={() => open(<CloseCashModal expected={st.expectedAgorot} />)}
            >
              סגירת קופה
            </button>
          </>
        ) : (
          <>
            <p>הקופה סגורה. כדי לקבל או להחזיר מזומן יש לפתוח קופה.</p>
            <button className="b" type="button" onClick={() => open(<OpenCashModal />)}>
              פתיחת קופה
            </button>
          </>
        )}
        <FormError message={(q.error as Error | null)?.message} />
      </div>
      <div className="card tw">
        <b>היסטוריית סגירות</b>
        <table>
          <thead>
            <tr>
              <th>תאריך</th>
              <th>שעה</th>
              <th>על ידי</th>
              <th>צפוי</th>
              <th>נספר</th>
              <th>הפרש</th>
              <th>הערות</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.history.map((h) => (
              <tr key={h.id}>
                <td>{fmtDate(h.closedAt)}</td>
                <td>{fmtTime(h.closedAt)}</td>
                <td>{h.closedBy}</td>
                <td>
                  <Money a={h.expectedAgorot} />
                </td>
                <td>
                  <Money a={h.countedAgorot} />
                </td>
                <td className={h.diffAgorot ? 'bad' : 'ok'}>
                  <Money a={h.diffAgorot} />
                </td>
                <td>{h.notes}</td>
              </tr>
            ))}
            {q.data && !q.data.history.length && (
              <tr>
                <td colSpan={7}>אין סגירות</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function OpenCashModal() {
  const { close } = useDialogs();
  const invalidate = useInvalidateMoney();
  const toast = useToast();
  const [amount, setAmount] = useState<number | null>(0);
  return (
    <FormModal
      title="פתיחת קופה"
      submitLabel="פתיחה"
      onCancel={close}
      onSubmit={async () => {
        await post('/api/cash/open', { openingFloatAgorot: amount ?? 0 });
        await invalidate();
        close();
        toast('הקופה נפתחה');
      }}
    >
      {(fe) => (
        <MoneyField
          label="יתרת פתיחה (מזומן בקופה, ₪)"
          value={amount}
          onChange={setAmount}
          error={fe.openingFloatAgorot}
        />
      )}
    </FormModal>
  );
}

export function CloseCashModal({ expected }: { expected: number }) {
  const { close, open } = useDialogs();
  const invalidate = useInvalidateMoney();
  const [counted, setCounted] = useState<number | null>(expected);
  const [notes, setNotes] = useState('');
  const submit = async (acceptDifference: boolean) => {
    const r = await post<{ expectedAgorot: number; countedAgorot: number; diffAgorot: number }>(
      '/api/cash/close',
      { countedAgorot: counted ?? 0, notes: notes || undefined, acceptDifference },
    );
    await invalidate();
    open(
      <Modal
        title="הקופה נסגרה"
        onClose={close}
        footer={
          <button className="b s" type="button" onClick={close}>
            סגור
          </button>
        }
      >
        <p>
          צפוי <Money a={r.expectedAgorot} /> · נספר <Money a={r.countedAgorot} /> · הפרש{' '}
          <b className={r.diffAgorot ? 'bad' : 'ok'}>
            <Money a={r.diffAgorot} />
          </b>
        </p>
      </Modal>,
    );
  };
  return (
    <FormModal
      title="סגירת קופה"
      submitLabel="סגירה"
      onCancel={close}
      onSubmit={async () => {
        try {
          await submit(false);
        } catch (e) {
          if (!(e instanceof HttpError && e.code === 'cash_difference')) throw e;
          open(
            <Modal
              title="יש הפרש בקופה"
              onClose={close}
              footer={
                <>
                  <button className="b" type="button" onClick={() => void submit(true)}>
                    סגירה
                  </button>
                  <button className="b s" type="button" onClick={close}>
                    ביטול
                  </button>
                </>
              }
            >
              <p>{e.message}</p>
            </Modal>,
          );
        }
      }}
    >
      {(fe) => (
        <>
          <MoneyField
            label={`סכום שנספר בפועל (צפוי: ${formatMoney(expected)})`}
            value={counted}
            onChange={setCounted}
            error={fe.countedAgorot}
          />
          <Field label="הערות" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </>
      )}
    </FormModal>
  );
}
