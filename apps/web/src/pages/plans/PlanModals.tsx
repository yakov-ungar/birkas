import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CONSENT_METHODS,
  PLAN_CHARGE_STATUS,
  PLAN_METHODS,
  formatMoney,
  type ConsentMethod,
  type PlanDetail,
  type PlanMethod,
} from '@tuition/shared';
import { get, post } from '../../api/client';
import { useInvalidateMoney, useStudents } from '../../api/hooks';
import { Field, FormError, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { Money, MoneyField } from '../../components/Money';
import { useDialogs } from '../../components/Dialogs';
import { useToast } from '../../components/Toast';
import { FormModal } from '../families/StudentActions';
import { ReceiptModal } from '../receipts/ReceiptModal';

const fmt = (d: string) => d.split('-').reverse().join('/');
const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });

interface StudentCardOpt {
  id: string;
  label: string;
  isDefault: boolean;
  expired: boolean;
}

interface Preview {
  label: string;
  studentName: string;
  schedule: { seq: number; dueDate: string; amountAgorot: number }[];
  total: number;
  openEnded: boolean;
  consentText: string;
}

export function NewPlanModal({ studentId, after }: { studentId?: string; after?: ReactNode }) {
  const { open, close } = useDialogs();
  const students = useStudents('filter=act');
  const [sid, setSid] = useState(studentId ?? '');
  const [type, setType] = useState<'installments' | 'recurring'>('installments');
  const [amount, setAmount] = useState<number | null>(null);
  const [count, setCount] = useState('6');
  const [start, setStart] = useState(todayIso());
  const [method, setMethod] = useState<PlanMethod>('card');
  const [cardId, setCardId] = useState('');
  const [so, setSo] = useState({ bank: '', branch: '', account: '' });
  const cards = useQuery({
    enabled: !!sid && method === 'card',
    queryKey: ['plan-cards', sid],
    queryFn: () => get<{ cards: StudentCardOpt[] }>(`/api/plans/student-cards/${sid}`),
  });
  useEffect(() => {
    const list = cards.data?.cards.filter((c) => !c.expired) ?? [];
    setCardId((list.find((c) => c.isDefault) ?? list[0])?.id ?? '');
  }, [cards.data]);
  const done = () => (after ? open(after) : close());
  const plan = () => ({
    studentId: sid,
    type,
    amountAgorot: amount,
    count: Number(count),
    startDate: start,
    method,
    ...(method === 'card' ? { cardId } : {}),
    ...(method === 'standing_order' ? { standingOrder: so } : {}),
  });
  return (
    <FormModal
      title="תוכנית חיוב חדשה"
      submitLabel="המשך"
      onCancel={done}
      onSubmit={async () => {
        if (method === 'card' && !cardId)
          throw new Error('לתלמיד אין כרטיס שמור. הוסף כרטיס בכרטיס התלמיד או במסך כרטיסים שמורים');
        const p = plan();
        const pv = await post<Preview>('/api/plans/preview', p);
        open(<ConfirmPlan plan={p} preview={pv} after={after} />);
      }}
    >
      {(fe) => (
        <>
          <SelectField
            label="תלמיד"
            value={sid}
            onChange={(e) => setSid(e.target.value)}
            error={fe.studentId}
          >
            <option value="">בחירת תלמיד</option>
            {students.data?.students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullName} (יתרה {formatMoney(s.balanceAgorot)})
              </option>
            ))}
          </SelectField>
          <SelectField
            label="סוג"
            value={type}
            onChange={(e) => setType(e.target.value as 'installments' | 'recurring')}
          >
            <option value="installments">פריסה לתשלומים (סכום כולל)</option>
            <option value="recurring">חיוב חוזר חודשי</option>
          </SelectField>
          <MoneyField
            label={type === 'installments' ? 'סכום כולל (₪)' : 'סכום חודשי (₪)'}
            value={amount}
            onChange={setAmount}
            error={fe.amountAgorot}
          />
          <Field
            label={
              type === 'installments' ? 'מספר תשלומים (2 עד 36)' : 'מספר חודשים (0 = עד הודעה חדשה, עד 60)'
            }
            inputMode="numeric"
            dir="ltr"
            value={count}
            onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))}
            error={fe.count}
          />
          <Field
            label="תאריך חיוב ראשון"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            error={fe.startDate}
          />
          <SelectField
            label="אמצעי חיוב"
            value={method}
            onChange={(e) => setMethod(e.target.value as PlanMethod)}
          >
            {(Object.keys(PLAN_METHODS) as PlanMethod[]).map((m) => (
              <option key={m} value={m}>
                {PLAN_METHODS[m]}
              </option>
            ))}
          </SelectField>
          {method === 'card' && sid && (
            <SelectField
              label="כרטיס"
              value={cardId}
              onChange={(e) => setCardId(e.target.value)}
              error={fe.cardId}
            >
              {!cards.data?.cards.length && <option value="">אין כרטיסים שמורים לתלמיד</option>}
              {cards.data?.cards.map((c) => (
                <option key={c.id} value={c.id} disabled={c.expired}>
                  {c.label}
                  {c.expired ? ' · פג תוקף' : ''}
                </option>
              ))}
            </SelectField>
          )}
          {method === 'standing_order' && (
            <>
              <Field
                label="בנק"
                value={so.bank}
                onChange={(e) => setSo({ ...so, bank: e.target.value })}
                error={fe['standingOrder.bank']}
              />
              <Field
                label="סניף"
                inputMode="numeric"
                dir="ltr"
                value={so.branch}
                onChange={(e) => setSo({ ...so, branch: e.target.value })}
                error={fe['standingOrder.branch']}
              />
              <Field
                label="מספר חשבון"
                inputMode="numeric"
                dir="ltr"
                value={so.account}
                onChange={(e) => setSo({ ...so, account: e.target.value })}
                error={fe['standingOrder.account']}
              />
            </>
          )}
        </>
      )}
    </FormModal>
  );
}

function ConfirmPlan({
  plan,
  preview,
  after,
}: {
  plan: Record<string, unknown>;
  preview: Preview;
  after?: ReactNode;
}) {
  const { open, close } = useDialogs();
  const invalidate = useInvalidateMoney();
  const [key] = useState(() => crypto.randomUUID());
  const [consented, setConsented] = useState(false);
  const [consentMethod, setConsentMethod] = useState<ConsentMethod>('phone');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const needsConsent = plan.method !== 'transfer';
  return (
    <Modal
      title="אישור תוכנית חיוב"
      onClose={() => (after ? open(after) : close())}
      footer={
        <>
          <button
            className="b"
            type="button"
            disabled={busy || (needsConsent && !consented)}
            onClick={async () => {
              setBusy(true);
              try {
                const d = await post<PlanDetail>('/api/plans', {
                  plan,
                  idempotencyKey: key,
                  ...(needsConsent ? { consent: { method: consentMethod, confirmed: true } } : {}),
                });
                await invalidate();
                open(<PlanModal id={d.id} notice="התוכנית נוצרה. החיובים יבוצעו אוטומטית במועדם." />);
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            אישור ויצירה
          </button>
          <button
            className="b s"
            type="button"
            onClick={() => open(<NewPlanModal studentId={String(plan.studentId)} after={after} />)}
          >
            חזרה
          </button>
        </>
      }
    >
      <p>
        <b>{preview.studentName}</b> · {preview.label}
        <br />
        אמצעי: {PLAN_METHODS[plan.method as PlanMethod]}
      </p>
      <table style={{ minWidth: 0 }}>
        <thead>
          <tr>
            <th>#</th>
            <th>תאריך</th>
            <th>סכום</th>
          </tr>
        </thead>
        <tbody>
          {preview.schedule.map((c) => (
            <tr key={c.seq}>
              <td>{c.seq}</td>
              <td>{fmt(c.dueDate)}</td>
              <td>
                <Money a={c.amountAgorot} />
              </td>
            </tr>
          ))}
          {preview.total > preview.schedule.length && (
            <tr>
              <td colSpan={3}>
                {preview.openEnded
                  ? 'וממשיך כל חודש עד הודעה חדשה'
                  : `ועוד ${preview.total - preview.schedule.length} חיובים...`}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {needsConsent && (
        <fieldset style={{ border: '1px solid var(--line)', borderRadius: 8, marginTop: 12 }}>
          <legend>הסכמת המשלם</legend>
          <p style={{ margin: '4px 0' }}>{preview.consentText}</p>
          <SelectField
            label="ההסכמה התקבלה"
            value={consentMethod}
            onChange={(e) => setConsentMethod(e.target.value as ConsentMethod)}
          >
            {(['phone', 'written', 'meeting'] as ConsentMethod[]).map((m) => (
              <option key={m} value={m}>
                {CONSENT_METHODS[m]}
              </option>
            ))}
          </SelectField>
          <label className="chk">
            <input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} /> אני
            מאשר/ת שההורה הסכים לחיוב כמפורט
          </label>
        </fieldset>
      )}
      <FormError message={err} />
    </Modal>
  );
}

export function PlanModal({ id, notice }: { id: string; notice?: string }) {
  const { open, close } = useDialogs();
  const toast = useToast();
  const invalidate = useInvalidateMoney();
  const q = useQuery({ queryKey: ['plan', id], queryFn: () => get<PlanDetail>(`/api/plans/${id}`) });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const p = q.data;
  const act = async (label: string, url: string, body: unknown = {}) => {
    setBusy(label);
    setErr(null);
    try {
      const r = await post<{ result?: string; reason?: string | null }>(url, body);
      await invalidate();
      if (r.result) toast(r.result === 'paid' ? 'החיוב הצליח' : `החיוב נכשל: ${r.reason ?? ''}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const live = p && p.status !== 'cancelled' && p.status !== 'completed';
  return (
    <Modal
      title={p ? `${p.studentName} · ${p.label}` : 'טוען...'}
      onClose={close}
      footer={
        p && (
          <>
            {live && (
              <button
                className="b"
                type="button"
                disabled={!!busy}
                onClick={() =>
                  void act('toggle', `/api/plans/${id}/${p.status === 'active' ? 'pause' : 'resume'}`)
                }
              >
                {p.status === 'active' ? 'השהיה' : 'חידוש'}
              </button>
            )}
            {live && p.method === 'card' && (
              <button className="b s" type="button" onClick={() => open(<SwapCardModal plan={p} />)}>
                החלפת כרטיס
              </button>
            )}
            {live && (
              <button
                className="b s"
                type="button"
                disabled={!!busy}
                onClick={() => open(<CancelPlanModal id={id} />)}
              >
                ביטול החיובים הנותרים
              </button>
            )}
            <button className="b s" type="button" onClick={close}>
              סגור
            </button>
          </>
        )
      }
    >
      {notice && <p className="al info">{notice}</p>}
      <FormError message={(q.error as Error | null)?.message ?? err} />
      {p && (
        <>
          <p>
            <span className={`pill ${p.display[1]}`}>{p.display[0]}</span> · {p.methodLabel}
            {p.standingOrder &&
              ` · ${p.standingOrder.bank} סניף ${p.standingOrder.branch} חשבון ****${p.standingOrder.accountLast4}`}{' '}
            ·{' '}
            {p.type === 'installments' ? (
              <>
                סכום כולל <Money a={p.amountAgorot} />
              </>
            ) : (
              <>
                <Money a={p.amountAgorot} /> לחודש
              </>
            )}
          </p>
          <div className="tw" style={{ maxHeight: 300, overflow: 'auto' }}>
            <table style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>תאריך</th>
                  <th>סכום</th>
                  <th>סטטוס</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {p.charges.map((c) => (
                  <tr key={c.id}>
                    <td>{c.seq}</td>
                    <td>{fmt(c.dueDate)}</td>
                    <td>
                      <Money a={c.amountAgorot} />
                    </td>
                    <td>
                      <span className={`pill ${PLAN_CHARGE_STATUS[c.status][1]}`}>
                        {PLAN_CHARGE_STATUS[c.status][0]}
                      </span>
                      {c.lastError && c.status === 'failed' && <span className="bad"> {c.lastError}</span>}
                    </td>
                    <td>
                      {c.status === 'failed' && p.status === 'active' && (
                        <button
                          className="b s sm"
                          type="button"
                          disabled={!!busy}
                          onClick={() => void act('retry', `/api/plans/${id}/charges/${c.id}/retry`)}
                        >
                          {busy === 'retry' ? 'מנסה...' : 'נסה שוב'}
                        </button>
                      )}
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
              </tbody>
            </table>
          </div>
          {p.type === 'recurring' && p.count === 0 && (
            <p className="mu">חיוב ללא הגבלה: מוצגים החיובים הקרובים, ונוספים חדשים אוטומטית.</p>
          )}
          {p.consent && (
            <p className="mu">
              הסכמת המשלם התקבלה {p.consent.method} ב-{new Date(p.consent.at).toLocaleDateString('he-IL')}:{' '}
              {p.consent.text}
            </p>
          )}
        </>
      )}
    </Modal>
  );
}

function SwapCardModal({ plan }: { plan: PlanDetail }) {
  const { open } = useDialogs();
  const invalidate = useInvalidateMoney();
  const cards = useQuery({
    queryKey: ['plan-cards', plan.studentId],
    queryFn: () => get<{ cards: StudentCardOpt[] }>(`/api/plans/student-cards/${plan.studentId}`),
  });
  const [cardId, setCardId] = useState(plan.cardId ?? '');
  return (
    <FormModal
      title="החלפת כרטיס בתוכנית"
      submitLabel="החלפה"
      onCancel={() => open(<PlanModal id={plan.id} />)}
      onSubmit={async () => {
        await post(`/api/plans/${plan.id}/swap-card`, { cardId });
        await invalidate();
        open(<PlanModal id={plan.id} />);
      }}
    >
      {() => (
        <SelectField label="כרטיס" value={cardId} onChange={(e) => setCardId(e.target.value)}>
          {cards.data?.cards.map((c) => (
            <option key={c.id} value={c.id} disabled={c.expired}>
              {c.label}
              {c.expired ? ' · פג תוקף' : ''}
            </option>
          ))}
        </SelectField>
      )}
    </FormModal>
  );
}

function CancelPlanModal({ id }: { id: string }) {
  const { open } = useDialogs();
  const invalidate = useInvalidateMoney();
  return (
    <FormModal
      title="ביטול החיובים הנותרים"
      submitLabel="ביטול החיובים"
      onCancel={() => open(<PlanModal id={id} />)}
      onSubmit={async () => {
        await post(`/api/plans/${id}/cancel`);
        await invalidate();
        open(<PlanModal id={id} />);
      }}
    >
      {() => (
        <p style={{ gridColumn: '1/-1' }}>לבטל את כל החיובים שטרם בוצעו? חיובים ששולמו נשארים כפי שהם.</p>
      )}
    </FormModal>
  );
}
