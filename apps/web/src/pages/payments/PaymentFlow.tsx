import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PAYMENT_METHODS, formatMoney, type PaymentResult, type SavedCardRow } from '@tuition/shared';
import { HttpError, get, post } from '../../api/client';
import { useFamilies, useInvalidateMoney, useStudents } from '../../api/hooks';
import { useAuth } from '../../app/auth';
import { Field, FormError, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { Money, MoneyField } from '../../components/Money';
import { useDialogs } from '../../components/Dialogs';
import { CardFields, type CardFieldsHandle } from './CardFields';
import { ReceiptModal } from '../receipts/ReceiptModal';

type Method = 'card' | 'transfer' | 'cash' | 'check';
const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });

interface AllocRow {
  studentId: string;
  fullName: string;
  balanceAgorot: number;
  amountAgorot: number;
}

/** "f:<familyId>" pays for the whole family (split automatically, editable); "s:<studentId>" for one student. */
export function PaymentFlow({
  target: initialTarget,
  method: initialMethod,
}: {
  target?: string;
  method?: Method;
}) {
  const { close, open } = useDialogs();
  const { me, has } = useAuth();
  const invalidate = useInvalidateMoney();
  const students = useStudents('filter=all');
  const families = useFamilies();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [step, setStep] = useState<'form' | 'details'>('form');
  const [target, setTarget] = useState(initialTarget ?? '');
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<Method>(initialMethod ?? 'card');
  const [err, setErr] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [alloc, setAlloc] = useState<AllocRow[] | null>(null);
  const [cardChoice, setCardChoice] = useState<string>('');
  const [saveCard, setSaveCard] = useState(false);
  const cardRef = useRef<CardFieldsHandle>(null);

  const options = useMemo(() => {
    const out: { v: string; t: string }[] = [];
    for (const f of families.data?.families ?? []) {
      const kids = (students.data?.students ?? []).filter((s) => s.familyId === f.id);
      if (!kids.length) continue;
      if (kids.length > 1)
        out.push({ v: `f:${f.id}`, t: `כל ${f.name} (יתרה ${formatMoney(f.balanceAgorot)})` });
      for (const s of kids)
        out.push({ v: `s:${s.id}`, t: `${s.fullName} (יתרה ${formatMoney(s.balanceAgorot)})` });
    }
    return out;
  }, [families.data, students.data]);

  useEffect(() => {
    if (!target && options[0]) setTarget(options[0].v);
  }, [options, target]);

  const isFamily = target.startsWith('f:');
  const targetId = target.slice(2);
  const familyId = isFamily ? targetId : students.data?.students.find((s) => s.id === targetId)?.familyId;
  const who = options.find((o) => o.v === target)?.t.replace(/ \(יתרה.*$/, '') ?? '';

  const cards = useQuery({
    enabled: step === 'details' && method === 'card' && !!familyId,
    queryKey: ['payment-cards', familyId],
    queryFn: () =>
      get<{ cards: SavedCardRow[]; hostedFieldsUrl: string }>(`/api/families/${familyId}/payment-cards`),
  });
  useEffect(() => {
    if (cards.data && !cardChoice) {
      const usable = cards.data.cards.filter((c) => !c.expired);
      setCardChoice((usable.find((c) => c.isDefault) ?? usable[0])?.id ?? 'new');
    }
  }, [cards.data, cardChoice]);

  const toDetails = async () => {
    setErr(null);
    if (!target) return setErr('יש לבחור עבור מי התשלום');
    if (!amount || amount <= 0) return setErr('יש להזין סכום חיובי');
    if (isFamily) {
      try {
        const r = await get<{ students: AllocRow[] }>(
          `/api/payments/allocation?familyId=${targetId}&amountAgorot=${amount}`,
        );
        setAlloc(r.students);
      } catch (e) {
        return setErr((e as Error).message);
      }
    } else setAlloc(null);
    setFields(
      method === 'cash'
        ? { receivedBy: me?.user.name ?? '' }
        : method === 'transfer' || method === 'check'
          ? { date: todayIso(), dueDate: todayIso() }
          : {},
    );
    setStep('details');
  };

  const allocSum = alloc?.reduce((s, a) => s + a.amountAgorot, 0) ?? 0;

  const submit = async () => {
    setErr(null);
    if (alloc && allocSum !== amount) return setErr('סכום החלוקה חייב להיות שווה לסכום התשלום');
    setBusy(true);
    try {
      let details: Record<string, unknown>;
      if (method === 'cash') details = { method, receivedBy: fields.receivedBy ?? '' };
      else if (method === 'transfer')
        details = {
          method,
          bank: fields.bank ?? '',
          reference: fields.reference ?? '',
          date: fields.date ?? todayIso(),
        };
      else if (method === 'check')
        details = {
          method,
          number: fields.number ?? '',
          bank: fields.bank ?? '',
          dueDate: fields.dueDate ?? todayIso(),
        };
      else if (cardChoice && cardChoice !== 'new') details = { method, cardId: cardChoice };
      else {
        const t = await cardRef.current!.tokenize();
        details = { method, newCard: { ...t, save: saveCard } };
      }
      const body = {
        idempotencyKey,
        ...(isFamily
          ? {
              familyId: targetId,
              allocations: alloc!.map((a) => ({ studentId: a.studentId, amountAgorot: a.amountAgorot })),
            }
          : { studentId: targetId }),
        amountAgorot: amount,
        details,
      };
      const res = await post<PaymentResult>('/api/payments', body);
      await invalidate();
      open(<PaymentDone result={res} amount={amount!} method={method} who={who} />);
    } catch (e) {
      setErr(e instanceof HttpError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (step === 'form') {
    return (
      <Modal
        title="קבלת תשלום"
        onClose={close}
        footer={
          <>
            <button className="b" type="button" onClick={() => void toDetails()}>
              המשך
            </button>
            <button className="b s" type="button" onClick={close}>
              ביטול
            </button>
          </>
        }
      >
        <div className="cc">
          <SelectField label="עבור" value={target} onChange={(e) => setTarget(e.target.value)}>
            {options.map((o) => (
              <option key={o.v} value={o.v}>
                {o.t}
              </option>
            ))}
          </SelectField>
          <MoneyField label="סכום (₪)" value={amount} onChange={setAmount} autoFocus />
          <SelectField
            label="אמצעי תשלום"
            value={method}
            onChange={(e) => setMethod(e.target.value as Method)}
          >
            {(['card', 'transfer', 'cash', 'check'] as Method[]).map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHODS[m]}
              </option>
            ))}
          </SelectField>
        </div>
        <FormError message={err ?? (students.error as Error | null)?.message} />
      </Modal>
    );
  }

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields({ ...fields, [k]: e.target.value });
  const title = `${method === 'card' ? 'אשראי' : method === 'transfer' ? 'פרטי העברה' : method === 'cash' ? 'מזומן' : 'רישום שיק'} - ${who} - ${formatMoney(amount!)}`;

  return (
    <Modal
      title={title}
      onClose={close}
      footer={
        <>
          <button className="b" type="button" onClick={() => void submit()} disabled={busy}>
            {busy
              ? method === 'card'
                ? 'מאשר עסקה...'
                : 'רושם...'
              : method === 'card'
                ? 'חיוב'
                : method === 'check'
                  ? 'רישום שיק'
                  : 'אישור ורישום'}
          </button>
          <button className="b s" type="button" onClick={() => setStep('form')} disabled={busy}>
            חזרה
          </button>
        </>
      }
    >
      {method === 'cash' && (
        <div className="cc">
          <Field label="התקבל על ידי" value={fields.receivedBy ?? ''} onChange={set('receivedBy')} />
        </div>
      )}
      {method === 'transfer' && (
        <div className="cc">
          <Field label="בנק מעביר" value={fields.bank ?? ''} onChange={set('bank')} />
          <Field label="אסמכתא" value={fields.reference ?? ''} onChange={set('reference')} dir="ltr" />
          <Field label="תאריך" type="date" value={fields.date ?? ''} onChange={set('date')} />
        </div>
      )}
      {method === 'check' && (
        <>
          <div className="cc">
            <Field label="מספר שיק" value={fields.number ?? ''} onChange={set('number')} dir="ltr" />
            <Field label="בנק וסניף" value={fields.bank ?? ''} onChange={set('bank')} />
            <Field label="תאריך פירעון" type="date" value={fields.dueDate ?? ''} onChange={set('dueDate')} />
          </div>
          <p className="mu">השיק יופיע ביתרה לאחר ההפקדה בתאריך הפירעון.</p>
        </>
      )}
      {method === 'card' && (
        <>
          {cards.isLoading && <p className="mu">טוען כרטיסים...</p>}
          {cards.data && (
            <>
              {cards.data.cards.length > 0 && (
                <SelectField label="כרטיס" value={cardChoice} onChange={(e) => setCardChoice(e.target.value)}>
                  {cards.data.cards.map((c) => (
                    <option key={c.id} value={c.id} disabled={c.expired}>
                      {c.brand} ****{c.last4} ({c.exp}) · {c.studentName}
                      {c.expired ? ' · פג תוקף' : ''}
                    </option>
                  ))}
                  <option value="new">כרטיס חדש</option>
                </SelectField>
              )}
              {cardChoice === 'new' && (
                <>
                  <CardFields ref={cardRef} src={cards.data.hostedFieldsUrl} />
                  {has('cards') && (
                    <label className="chk">
                      <input
                        type="checkbox"
                        checked={saveCard}
                        onChange={(e) => setSaveCard(e.target.checked)}
                      />{' '}
                      לשמור את הכרטיס (נשמר טוקן בלבד)
                    </label>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
      {alloc && method !== 'check' && (
        <div className="tw" style={{ marginTop: 10 }}>
          <b>חלוקה בין התלמידים</b>
          <p className="mu">חולק אוטומטית: קודם החוב הגדול. אפשר לשנות ידנית.</p>
          <table style={{ minWidth: 0 }}>
            <thead>
              <tr>
                <th>תלמיד</th>
                <th>יתרה</th>
                <th>סכום</th>
              </tr>
            </thead>
            <tbody>
              {alloc.map((a, i) => (
                <tr key={a.studentId}>
                  <td>{a.fullName}</td>
                  <td>
                    <Money a={a.balanceAgorot} />
                  </td>
                  <td>
                    <MoneyField
                      label={`סכום ל${a.fullName}`}
                      hideLabel
                      value={a.amountAgorot}
                      onChange={(v) =>
                        setAlloc(alloc.map((x, j) => (j === i ? { ...x, amountAgorot: v ?? 0 } : x)))
                      }
                    />
                  </td>
                </tr>
              ))}
              <tr>
                <th colSpan={2}>סה״כ</th>
                <th className={allocSum === amount ? 'ok' : 'bad'}>
                  <Money a={allocSum} /> מתוך <Money a={amount!} />
                </th>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <FormError message={err} />
    </Modal>
  );
}

function PaymentDone({
  result,
  amount,
  method,
  who,
}: {
  result: PaymentResult;
  amount: number;
  method: Method;
  who: string;
}) {
  const { close, open } = useDialogs();
  if (!result.receipt) {
    return (
      <Modal
        title="השיק נרשם"
        onClose={close}
        footer={
          <button className="b s" type="button" onClick={close}>
            סגור
          </button>
        }
      >
        <p>
          שיק על סך <Money a={amount} /> נרשם עבור {who}. הוא יופיע ביתרה לאחר ההפקדה.
        </p>
      </Modal>
    );
  }
  const r = result.receipt;
  return (
    <Modal
      title="התשלום התקבל"
      onClose={close}
      footer={
        <>
          <button className="b" type="button" onClick={() => open(<ReceiptModal id={r.id} />)}>
            צפייה והדפסה
          </button>
          <button className="b s" type="button" onClick={close}>
            סגור
          </button>
        </>
      }
    >
      <p>
        <Money a={amount} /> · {PAYMENT_METHODS[method]}
        {result.approvalCode && (
          <>
            <br />
            מספר אישור: <span className="ltr">{result.approvalCode}</span>
          </>
        )}
        <br />
        קבלה מס׳ <b>{r.number}</b> הופקה{r.sentAt ? ' ונשלחה להורה' : ''}
      </p>
      {result.allocations.length > 1 && (
        <p className="mu">
          חולק בין:{' '}
          {result.allocations.map((p) => (
            <span key={p.studentId}>
              {p.studentName} <Money a={p.amountAgorot} />
              {' · '}
            </span>
          ))}
        </p>
      )}
    </Modal>
  );
}
