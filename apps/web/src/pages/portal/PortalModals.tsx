import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  INSTALLMENT_MONTHS,
  type CardMode,
  type NedarimStart,
  type NedarimStatus,
  PREFERRED_METHODS,
  formatMoney,
  type PaymentResult,
  type PortalMe,
} from '@tuition/shared';
import { HttpError, get, post } from '../../api/client';
import { Field, FormError, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { MoneyField } from '../../components/Money';
import { useDialogs } from '../../components/Dialogs';
import { FormModal } from '../families/StudentActions';
import { CardFields, type CardFieldsHandle } from '../payments/CardFields';
import { NedarimFrame, type NedarimFrameHandle } from '../payments/NedarimFrame';

const useRefresh = () => {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['portal-me'] });
};

export function Done({ title, children }: { title: string; children: React.ReactNode }) {
  const { close } = useDialogs();
  return (
    <Modal
      title={title}
      onClose={close}
      footer={
        <button className="b" type="button" onClick={close}>
          סגירה
        </button>
      }
    >
      {children}
    </Modal>
  );
}

/** Demo portalPay: amount (default the balance), then a saved card or the provider's hosted fields. */
export function PortalPay({ me }: { me: PortalMe }) {
  const { close, open } = useDialogs();
  const refresh = useRefresh();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState<number | null>(me.balanceAgorot);
  const usable = me.cards.filter((c) => !c.expired);
  const [choice, setChoice] = useState(usable[0]?.id ?? 'new');
  const [save, setSave] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cardRef = useRef<CardFieldsHandle>(null);
  const nedarimRef = useRef<NedarimFrameHandle>(null);
  const mode = useQuery({
    queryKey: ['portal-card-mode'],
    queryFn: () => get<CardMode>('/api/portal/card-mode'),
  });
  const nedarim = mode.data?.mode === 'nedarim' ? mode.data.iframeUrl : null;

  const submit = async () => {
    setErr(null);
    if (!amount || amount <= 0) return setErr('סכום לא תקין');
    setBusy(true);
    try {
      let r: PaymentResult;
      if (nedarim) r = await nedarimRef.current!.pay();
      else {
        const card =
          choice === 'new'
            ? { newCard: { ...(await cardRef.current!.tokenize()), save } }
            : { cardId: choice };
        r = await post<PaymentResult>('/api/portal/pay', { amountAgorot: amount, idempotencyKey, ...card });
      }
      await refresh();
      open(
        <Done title="התשלום התקבל">
          <p>
            {formatMoney(amount)} · אשראי
            {r.approvalCode && (
              <>
                <br />
                מספר אישור: <span className="ltr">{r.approvalCode}</span>
              </>
            )}
            <br />
            קבלה מס&apos; <b>{r.receipt?.number}</b> הופקה
          </p>
          {r.allocations.length > 1 && (
            <p className="mu">
              חולק בין:{' '}
              {r.allocations.map((p) => `${p.studentName} ${formatMoney(p.amountAgorot)}`).join(' · ')}
            </p>
          )}
          {r.receipt && (
            <button
              className="b s"
              type="button"
              onClick={() => window.open(`/api/portal/receipts/${r.receipt!.id}/pdf`, '_blank', 'noopener')}
            >
              צפייה בקבלה
            </button>
          )}
        </Done>,
      );
    } catch (e) {
      setErr((e as Error).message);
      if (e instanceof HttpError && e.status === 401) close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`תשלום - ${me.familyName}`}
      onClose={close}
      footer={
        <>
          <button className="b" type="button" disabled={busy} onClick={() => void submit()}>
            {busy ? 'מעבד...' : 'חיוב'}
          </button>
          <button className="b s" type="button" onClick={close}>
            ביטול
          </button>
        </>
      }
    >
      <MoneyField label="סכום לתשלום (₪)" value={amount} onChange={setAmount} />
      {mode.isLoading && <p className="mu">טוען...</p>}
      {nedarim && (
        <NedarimFrame
          ref={nedarimRef}
          iframeUrl={nedarim}
          start={() =>
            post<NedarimStart>('/api/portal/pay/nedarim', { amountAgorot: amount, idempotencyKey })
          }
          status={(id) => get<NedarimStatus>(`/api/portal/pay/nedarim/${id}`)}
        />
      )}
      {mode.data?.mode === 'hosted' && (
        <>
          <SelectField label="כרטיס" value={choice} onChange={(e) => setChoice(e.target.value)}>
            {usable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.brand} ****{c.last4} ({c.exp})
              </option>
            ))}
            <option value="new">כרטיס חדש</option>
          </SelectField>
          {choice === 'new' && (
            <>
              <CardFields ref={cardRef} src={me.hostedFieldsUrl} />
              <label className="row" style={{ margin: '8px 0 0' }}>
                <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> לשמור את
                הכרטיס לתשלומים הבאים
              </label>
            </>
          )}
        </>
      )}
      {!nedarim && me.testMode && <p className="mu">מצב בדיקה: לא מתבצע חיוב אמיתי.</p>}
      <FormError message={err} />
    </Modal>
  );
}

/** Demo portalPlan: months, preferred method, note. */
export function InstallmentsRequest() {
  const { close, open } = useDialogs();
  const refresh = useRefresh();
  const [months, setMonths] = useState(6);
  const [method, setMethod] = useState<keyof typeof PREFERRED_METHODS>('card');
  const [note, setNote] = useState('');
  return (
    <FormModal
      title="בקשת פריסה"
      submitLabel="שליחה"
      onCancel={close}
      onSubmit={async () => {
        await post('/api/portal/requests', { type: 'installments', months, method, note });
        await refresh();
        open(
          <Done title="הבקשה נשלחה">
            <p>בית הספר יחזור אליך לאחר בדיקה.</p>
          </Done>,
        );
      }}
    >
      {() => (
        <>
          <SelectField label="מספר חודשים" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            {INSTALLMENT_MONTHS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="אמצעי חיוב מועדף"
            value={method}
            onChange={(e) => setMethod(e.target.value as keyof typeof PREFERRED_METHODS)}
          >
            {(Object.keys(PREFERRED_METHODS) as (keyof typeof PREFERRED_METHODS)[]).map((k) => (
              <option key={k} value={k}>
                {PREFERRED_METHODS[k]}
              </option>
            ))}
          </SelectField>
          <div className="field">
            <label htmlFor="rq-note">הערה לבית הספר</label>
            <textarea id="rq-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </>
      )}
    </FormModal>
  );
}

/** Demo portalDisc, with the child (or all the children) chosen by the parent (C12). */
export function DiscountRequest({ me }: { me: PortalMe }) {
  const { close, open } = useDialogs();
  const refresh = useRefresh();
  const [pct, setPct] = useState('10');
  const [studentId, setStudentId] = useState(me.students.length > 1 ? '' : (me.students[0]?.id ?? ''));
  const [note, setNote] = useState('');
  return (
    <FormModal
      title="בקשת הנחה"
      submitLabel="שליחה"
      onCancel={close}
      onSubmit={async () => {
        const p = Number(pct);
        if (!(p > 0 && p <= 100)) throw new Error('אחוז בין 1 ל-100');
        await post('/api/portal/requests', { type: 'discount', pct: p, studentId: studentId || null, note });
        await refresh();
        open(
          <Done title="הבקשה נשלחה">
            <p>הבקשה הועברה לאישור הנהלה.</p>
          </Done>,
        );
      }}
    >
      {(fe) => (
        <>
          <Field
            label="אחוז הנחה מבוקש"
            inputMode="decimal"
            dir="ltr"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            error={fe.pct}
          />
          {me.students.length > 1 && (
            <SelectField label="עבור" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
              <option value="">כל הילדים</option>
              {me.students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
            </SelectField>
          )}
          <div className="field">
            <label htmlFor="rq-dnote">פירוט הבקשה</label>
            <textarea id="rq-dnote" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </>
      )}
    </FormModal>
  );
}

/** Demo portalInfo. */
export function ContactRequest() {
  const { close, open } = useDialogs();
  const refresh = useRefresh();
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  return (
    <FormModal
      title="עדכון פרטי קשר"
      submitLabel="שליחה"
      onCancel={close}
      onSubmit={async () => {
        await post('/api/portal/requests', { type: 'contact', phone, email });
        await refresh();
        open(
          <Done title="הבקשה נשלחה">
            <p>הפרטים יתעדכנו לאחר אישור המזכירות.</p>
          </Done>,
        );
      }}
    >
      {(fe) => (
        <>
          <Field
            label="טלפון"
            type="tel"
            dir="ltr"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            error={fe.phone}
          />
          <Field
            label="אימייל"
            type="email"
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={fe.email}
          />
        </>
      )}
    </FormModal>
  );
}

/** Adds a card without paying (decision C11: the school may ask for one for an installments plan). */
export function AddCard({ me }: { me: PortalMe }) {
  const { close, open } = useDialogs();
  const refresh = useRefresh();
  const [studentId, setStudentId] = useState(me.students[0]?.id ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cardRef = useRef<CardFieldsHandle>(null);
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { save: _s, ...card } = { ...(await cardRef.current!.tokenize()), save: false };
      await post('/api/portal/cards', { studentId, card });
      await refresh();
      open(
        <Done title="הכרטיס נשמר">
          <p>הכרטיס נשמר. בית הספר יוכל לחייב בו לפי ההסדר שאושר.</p>
        </Done>,
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="הוספת כרטיס אשראי"
      onClose={close}
      footer={
        <>
          <button className="b" type="button" disabled={busy} onClick={() => void submit()}>
            שמירה
          </button>
          <button className="b s" type="button" onClick={close}>
            ביטול
          </button>
        </>
      }
    >
      {me.students.length > 1 && (
        <SelectField label="עבור" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
          {me.students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.fullName}
            </option>
          ))}
        </SelectField>
      )}
      <CardFields ref={cardRef} src={me.hostedFieldsUrl} />
      <FormError message={err} />
    </Modal>
  );
}
