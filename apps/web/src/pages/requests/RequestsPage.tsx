import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DISCOUNT_REASONS,
  PLAN_METHODS,
  REQUEST_STATUS,
  REQUEST_TYPES,
  formatMoney,
  percentOf,
  type ApprovalForm,
  type PlanMethod,
  type RequestRow,
} from '@tuition/shared';
import { get, post } from '../../api/client';
import { useInvalidateMoney } from '../../api/hooks';
import { Field, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { Money } from '../../components/Money';
import { useDialogs } from '../../components/Dialogs';
import { useToast } from '../../components/Toast';
import { fmtDate } from '../../components/format';
import { FormModal } from '../families/StudentActions';

const pill = { pending: 'o', approved: 'g', rejected: 'r' } as const;
type Reason = (typeof DISCOUNT_REASONS)[number];

export function RequestsPage() {
  const { open } = useDialogs();
  const list = useQuery({
    queryKey: ['requests'],
    queryFn: () => get<{ requests: RequestRow[] }>('/api/requests'),
  });
  return (
    <>
      <h2>בקשות הורים</h2>
      <p className="mu">בקשות שהורים שולחים מהפורטל: פריסת חוב, בקשת הנחה ועדכון פרטי קשר.</p>
      <div className="card tw">
        <table>
          <thead>
            <tr>
              <th>תאריך</th>
              <th>משפחה</th>
              <th>תלמיד</th>
              <th>סוג</th>
              <th>פרטים</th>
              <th>סטטוס</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.data?.requests.map((r) => (
              <tr key={r.id}>
                <td>{fmtDate(r.createdAt)}</td>
                <td>{r.familyName}</td>
                <td>{r.studentsLabel}</td>
                <td>{REQUEST_TYPES[r.type]}</td>
                <td>
                  {r.detailsText}
                  {r.note && <div className="mu">{r.note}</div>}
                  {r.rejectReason && <div className="mu">סיבת דחייה: {r.rejectReason}</div>}
                  {r.resultSummary && <div className="mu">{r.resultSummary}</div>}
                </td>
                <td>
                  <span className={`pill ${pill[r.status]}`}>{REQUEST_STATUS[r.status]}</span>
                  {r.decidedByName && <div className="mu">{r.decidedByName}</div>}
                </td>
                <td>
                  {r.status === 'pending' && (
                    <>
                      <button className="b sm" type="button" onClick={() => open(<ApproveModal id={r.id} />)}>
                        אישור
                      </button>{' '}
                      <button className="b s sm" type="button" onClick={() => open(<RejectModal r={r} />)}>
                        דחייה
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {list.data && !list.data.requests.length && (
              <tr>
                <td colSpan={7}>אין בקשות</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function RejectModal({ r }: { r: RequestRow }) {
  const { close } = useDialogs();
  const toast = useToast();
  const invalidate = useInvalidateMoney();
  const [reason, setReason] = useState('');
  return (
    <FormModal
      title="דחיית בקשה"
      submitLabel="דחייה"
      onCancel={close}
      onSubmit={async () => {
        await post(`/api/requests/${r.id}/reject`, { reason });
        await invalidate();
        toast(`נדחתה בקשת ${REQUEST_TYPES[r.type]} של ${r.familyName}`);
        close();
      }}
    >
      {(fe) => (
        <Field
          label="סיבה (תישלח להורה)"
          value={reason}
          maxLength={300}
          onChange={(e) => setReason(e.target.value)}
          error={fe.reason}
        />
      )}
    </FormModal>
  );
}

function ApproveModal({ id }: { id: string }) {
  const { close } = useDialogs();
  const form = useQuery({
    queryKey: ['request-approval', id],
    queryFn: () => get<ApprovalForm>(`/api/requests/${id}/approval`),
  });
  if (form.error)
    return (
      <Modal title="אישור בקשה" onClose={close}>
        <p className="bad">{(form.error as Error).message}</p>
      </Modal>
    );
  if (!form.data)
    return (
      <Modal title="אישור בקשה" onClose={close}>
        <p className="mu">טוען...</p>
      </Modal>
    );
  const f = form.data;
  if (f.installments) return <InstallmentsApproval f={f} />;
  if (f.discount) return <DiscountApproval f={f} />;
  return <ContactApproval f={f} />;
}

function useApprove(id: string, okText: string) {
  const { close } = useDialogs();
  const toast = useToast();
  const invalidate = useInvalidateMoney();
  return async (body: unknown) => {
    await post(`/api/requests/${id}/approve`, body);
    await invalidate();
    toast(okText);
    close();
  };
}

/** Demo reqApprove for installments: a plan on each child's balance, first payment in 30 days (C11). */
function InstallmentsApproval({ f }: { f: ApprovalForm }) {
  const inst = f.installments!;
  const { close } = useDialogs();
  const toast = useToast();
  const approve = useApprove(f.request.id, `אושרה בקשת פריסה של ${f.request.familyName}`);
  const [startDate, setStartDate] = useState(inst.startDate);
  const [count, setCount] = useState(inst.count);
  const [rows, setRows] = useState(
    inst.students.map((s) => ({
      ...s,
      include: true,
      chosen: s.method as PlanMethod,
      cardId: s.cards.find((c) => c.isDefault)?.id ?? s.cards[0]?.id ?? '',
      bank: '',
      branch: '',
      account: '',
    })),
  );
  const set = (i: number, patch: Partial<(typeof rows)[number]>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const wantsCard = f.request.details.type === 'installments' && f.request.details.method === 'card';
  const noCard = wantsCard && rows.some((r) => !r.cards.length);
  return (
    <FormModal
      title={`אישור בקשת פריסה - ${f.request.familyName}`}
      submitLabel="יצירת תוכניות ואישור"
      onCancel={close}
      onSubmit={async () => {
        const plans = rows
          .filter((r) => r.include)
          .map((r) => ({
            studentId: r.studentId,
            count,
            startDate,
            method: r.chosen,
            ...(r.chosen === 'card' ? { cardId: r.cardId } : {}),
            ...(r.chosen === 'standing_order'
              ? { standingOrder: { bank: r.bank, branch: r.branch, account: r.account } }
              : {}),
          }));
        await approve({ plans });
      }}
    >
      {() => (
        <>
          <p className="mu">
            ההורה ביקש {f.request.detailsText}. ההורה אישר בפורטל, והאישור נשמר עם התוכנית.
          </p>
          {f.request.note && <p>הערת ההורה: {f.request.note}</p>}
          {!inst.students.length && <p className="bad">אין כרגע יתרה לפריסה באף אחד מהילדים</p>}
          <div className="row">
            <Field
              label="תשלום ראשון"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <SelectField
              label="מספר תשלומים"
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            >
              {Array.from({ length: 35 }, (_, i) => i + 2).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </SelectField>
          </div>
          {rows.map((r, i) => (
            <div className="card" key={r.studentId} style={{ padding: 10, marginBottom: 8 }}>
              <label className="row" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={r.include}
                  onChange={(e) => set(i, { include: e.target.checked })}
                />
                <b>{r.fullName}</b> · יתרה לפריסה <Money a={r.balanceAgorot} />
              </label>
              {r.include && (
                <div className="row">
                  <SelectField
                    label="אמצעי"
                    value={r.chosen}
                    onChange={(e) => set(i, { chosen: e.target.value as PlanMethod })}
                  >
                    {(Object.keys(PLAN_METHODS) as PlanMethod[]).map((m) => (
                      <option key={m} value={m} disabled={m === 'card' && !r.cards.length}>
                        {PLAN_METHODS[m]}
                        {m === 'card' && !r.cards.length ? ' (אין כרטיס שמור)' : ''}
                      </option>
                    ))}
                  </SelectField>
                  {r.chosen === 'card' && (
                    <SelectField
                      label="כרטיס"
                      value={r.cardId}
                      onChange={(e) => set(i, { cardId: e.target.value })}
                    >
                      {r.cards.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </SelectField>
                  )}
                  {r.chosen === 'standing_order' && (
                    <>
                      <Field label="בנק" value={r.bank} onChange={(e) => set(i, { bank: e.target.value })} />
                      <Field
                        label="סניף"
                        dir="ltr"
                        value={r.branch}
                        onChange={(e) => set(i, { branch: e.target.value })}
                      />
                      <Field
                        label="חשבון"
                        dir="ltr"
                        value={r.account}
                        onChange={(e) => set(i, { account: e.target.value })}
                      />
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
          {noCard && (
            <div className="row">
              <span className="mu">ההורה ביקש חיוב בכרטיס ואין כרטיס שמור.</span>
              <button
                className="b s sm"
                type="button"
                onClick={async () => {
                  try {
                    await post(`/api/requests/${f.request.id}/card-link`);
                    toast('נשלח להורה קישור להוספת כרטיס בפורטל');
                  } catch (e) {
                    toast((e as Error).message);
                  }
                }}
              >
                שליחת קישור להוספת כרטיס
              </button>
            </div>
          )}
        </>
      )}
    </FormModal>
  );
}

/** Demo reqApprove for a discount: the discount form prefilled, one row per child (C12). */
function DiscountApproval({ f }: { f: ApprovalForm }) {
  const { close } = useDialogs();
  const approve = useApprove(f.request.id, `אושרה בקשת הנחה של ${f.request.familyName}`);
  const [rows, setRows] = useState(
    f.discount!.students.map((s) => ({ ...s, include: s.tuitionAgorot > 0, value: String(s.pct) })),
  );
  const [reason, setReason] = useState<Reason>('צורך משפחתי');
  const [note, setNote] = useState(f.request.note);
  const set = (i: number, patch: Partial<(typeof rows)[number]>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <FormModal
      title={`אישור בקשת הנחה - ${f.request.familyName}`}
      submitLabel="הוספת ההנחה ואישור"
      onCancel={close}
      onSubmit={async () => {
        await approve({
          discounts: rows
            .filter((r) => r.include)
            .map((r) => ({ studentId: r.studentId, kind: 'pct', value: Number(r.value), reason, note })),
        });
      }}
    >
      {() => (
        <>
          <p className="mu">ההורה ביקש {f.request.detailsText}.</p>
          {rows.map((r, i) => {
            const pct = Number(r.value);
            const preview = pct > 0 && pct <= 100 ? percentOf(r.tuitionAgorot, pct) : 0;
            return (
              <div className="row" key={r.studentId}>
                <label className="row" style={{ margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={r.include}
                    disabled={r.tuitionAgorot <= 0}
                    onChange={(e) => set(i, { include: e.target.checked })}
                  />
                  {r.fullName} · שכר לימוד <Money a={r.tuitionAgorot} />
                </label>
                <Field
                  label="אחוז"
                  dir="ltr"
                  inputMode="decimal"
                  value={r.value}
                  onChange={(e) => set(i, { value: e.target.value })}
                />
                <span className="mu">הנחה: {formatMoney(preview)}</span>
              </div>
            );
          })}
          <SelectField label="סיבה" value={reason} onChange={(e) => setReason(e.target.value as Reason)}>
            {DISCOUNT_REASONS.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </SelectField>
          <Field label="הערה פנימית" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
        </>
      )}
    </FormModal>
  );
}

/** Demo reqApprove for contact details: updated at once. */
function ContactApproval({ f }: { f: ApprovalForm }) {
  const { close } = useDialogs();
  const approve = useApprove(f.request.id, 'הפרטים עודכנו');
  const c = f.contact!;
  return (
    <FormModal
      title={`עדכון פרטי קשר - ${f.request.familyName}`}
      submitLabel="עדכון ואישור"
      onCancel={close}
      onSubmit={() => approve({})}
    >
      {() => (
        <table>
          <thead>
            <tr>
              <th></th>
              <th>כיום</th>
              <th>מבוקש</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>טלפון</td>
              <td className="ltr">{c.current.phone}</td>
              <td className="ltr">{c.requested.phone}</td>
            </tr>
            <tr>
              <td>אימייל</td>
              <td className="ltr">{c.current.email || '-'}</td>
              <td className="ltr">{c.requested.email || 'ללא שינוי'}</td>
            </tr>
          </tbody>
        </table>
      )}
    </FormModal>
  );
}
