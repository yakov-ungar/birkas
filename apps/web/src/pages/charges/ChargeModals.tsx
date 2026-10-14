import { useState, type ReactNode } from 'react';
import { CHARGE_TYPES, DISCOUNT_REASONS, MANUAL_CHARGE_TYPES, formatMoney } from '@tuition/shared';
import { post } from '../../api/client';
import { useCatalog, useInvalidateMoney, useStudents } from '../../api/hooks';
import { useGrades } from '../../api/grades';
import { Field, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { MoneyField } from '../../components/Money';
import { useDialogs } from '../../components/Dialogs';
import { useToast } from '../../components/Toast';
import { FormModal } from '../families/StudentActions';

const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });

function StudentSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const s = useStudents('filter=all');
  return (
    <SelectField label="תלמיד" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">בחירת תלמיד</option>
      {s.data?.students.map((x) => (
        <option key={x.id} value={x.id}>
          {x.fullName} ({x.grade})
        </option>
      ))}
    </SelectField>
  );
}

export function ChargeModal({ studentId, after }: { studentId?: string; after?: ReactNode }) {
  const { open, close } = useDialogs();
  const toast = useToast();
  const invalidate = useInvalidateMoney();
  const [sid, setSid] = useState(studentId ?? '');
  const [type, setType] = useState<string>(MANUAL_CHARGE_TYPES[0]!);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(todayIso());
  const done = () => (after ? open(after) : close());
  return (
    <FormModal
      title="חיוב לתלמיד"
      submitLabel="רישום"
      onCancel={done}
      onSubmit={async () => {
        await post('/api/charges', { studentId: sid, type, description, amountAgorot: amount, date });
        await invalidate();
        toast('החיוב נוסף לספר החשבון של התלמיד');
        done();
      }}
    >
      {(fe) => (
        <>
          <StudentSelect value={sid} onChange={setSid} />
          <SelectField label="סוג" value={type} onChange={(e) => setType(e.target.value)}>
            {MANUAL_CHARGE_TYPES.map((t) => (
              <option key={t} value={t}>
                {CHARGE_TYPES[t]}
              </option>
            ))}
          </SelectField>
          <Field
            label="תיאור"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            error={fe.description}
          />
          <MoneyField label="סכום (₪)" value={amount} onChange={setAmount} error={fe.amountAgorot} />
          <Field
            label="תאריך חיוב"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            error={fe.date}
          />
        </>
      )}
    </FormModal>
  );
}

export function DiscountModal({ studentId, after }: { studentId?: string; after?: ReactNode }) {
  const { open, close } = useDialogs();
  const toast = useToast();
  const invalidate = useInvalidateMoney();
  const [sid, setSid] = useState(studentId ?? '');
  const [kind, setKind] = useState<'pct' | 'amount'>('pct');
  const [pct, setPct] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState<string>(DISCOUNT_REASONS[0]);
  const [note, setNote] = useState('');
  const done = () => (after ? open(after) : close());
  return (
    <FormModal
      title="הנחה / מלגה"
      submitLabel="אישור"
      onCancel={done}
      onSubmit={async () => {
        const value = kind === 'pct' ? Number(pct) : amount;
        const r = await post<{ amountAgorot: number }>('/api/charges/discount', {
          studentId: sid,
          kind,
          value,
          reason,
          ...(note ? { note } : {}),
        });
        await invalidate();
        toast(`${formatMoney(r.amountAgorot)} הופחתו מהיתרה`);
        done();
      }}
    >
      {(fe) => (
        <>
          <StudentSelect value={sid} onChange={setSid} />
          <SelectField
            label="סוג הנחה"
            value={kind}
            onChange={(e) => setKind(e.target.value as 'pct' | 'amount')}
          >
            <option value="pct">אחוז משכר הלימוד</option>
            <option value="amount">סכום קבוע</option>
          </SelectField>
          {kind === 'pct' ? (
            <Field
              label="אחוז"
              inputMode="decimal"
              dir="ltr"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              error={fe.value}
            />
          ) : (
            <MoneyField label="סכום (₪)" value={amount} onChange={setAmount} error={fe.value} />
          )}
          <SelectField label="סיבה" value={reason} onChange={(e) => setReason(e.target.value)}>
            {DISCOUNT_REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </SelectField>
          <Field
            label="הערה פנימית (לא מופיעה בדף החשבון)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </>
      )}
    </FormModal>
  );
}

export function BulkChargeModal() {
  const { open, close } = useDialogs();
  const catalog = useCatalog();
  const grades = useGrades();
  const invalidate = useInvalidateMoney();
  const [item, setItem] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [grade, setGrade] = useState('');
  const [date, setDate] = useState(todayIso());
  const firstItem = catalog.data?.items[0]?.id ?? 'custom';
  const chosen = item || firstItem;
  return (
    <FormModal
      title="חיוב קבוצתי"
      submitLabel="המשך"
      onCancel={close}
      onSubmit={async () => {
        const body = {
          ...(chosen === 'custom'
            ? { description, amountAgorot: amount ?? undefined }
            : { catalogItemId: chosen, ...(amount ? { amountAgorot: amount } : {}) }),
          grade: grade || null,
          date,
        };
        const pv = await post<{
          description: string;
          amountAgorot: number;
          count: number;
          totalAgorot: number;
        }>('/api/charges/bulk/preview', body);
        open(
          <Modal
            title="אישור חיוב קבוצתי"
            onClose={close}
            footer={
              <>
                <button
                  className="b"
                  type="button"
                  onClick={async () => {
                    const r = await post<{ count: number }>('/api/charges/bulk', {
                      ...body,
                      expectedCount: pv.count,
                    });
                    await invalidate();
                    open(
                      <Modal
                        title="החיובים נוצרו"
                        onClose={close}
                        footer={
                          <button className="b s" type="button" onClick={close}>
                            סגור
                          </button>
                        }
                      >
                        <p>{r.count} חיובים נוספו.</p>
                      </Modal>,
                    );
                  }}
                >
                  אישור וחיוב
                </button>
                <button className="b s" type="button" onClick={close}>
                  ביטול
                </button>
              </>
            }
          >
            <p>
              {pv.description} · {formatMoney(pv.amountAgorot)} לכל תלמיד
              <br />
              ייווצרו <b>{pv.count}</b> חיובים בסך <b>{formatMoney(pv.totalAgorot)}</b>.
            </p>
          </Modal>,
        );
      }}
    >
      {(fe) => (
        <>
          <SelectField label="פריט מהקטלוג" value={chosen} onChange={(e) => setItem(e.target.value)}>
            {catalog.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({formatMoney(c.defaultAgorot)})
              </option>
            ))}
            <option value="custom">חיוב מותאם</option>
          </SelectField>
          {chosen === 'custom' && (
            <Field
              label="תיאור"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              error={fe.description}
            />
          )}
          <MoneyField
            label={chosen === 'custom' ? 'סכום (₪)' : 'סכום (ריק = לפי הקטלוג)'}
            value={amount}
            onChange={setAmount}
            error={fe.amountAgorot}
          />
          <SelectField label="למי" value={grade} onChange={(e) => setGrade(e.target.value)}>
            <option value="">כל התלמידים הפעילים</option>
            {grades.map((g) => (
              <option key={g} value={g}>
                כיתה {g}
              </option>
            ))}
          </SelectField>
          <Field label="תאריך חיוב" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </>
      )}
    </FormModal>
  );
}

export function CancelChargeModal({ id, description }: { id: string; description: string }) {
  const { close } = useDialogs();
  const toast = useToast();
  const invalidate = useInvalidateMoney();
  const [reason, setReason] = useState('');
  return (
    <FormModal
      title="ביטול חיוב"
      submitLabel="ביטול החיוב"
      onCancel={close}
      onSubmit={async () => {
        await post(`/api/charges/${id}/cancel`, { reason });
        await invalidate();
        toast('החיוב בוטל בתנועה הפוכה');
        close();
      }}
    >
      {(fe) => (
        <>
          <p style={{ gridColumn: '1/-1' }}>
            החיוב "{description}" יבוטל בתנועה הפוכה. החיוב המקורי נשמר ומסומן כמבוטל.
          </p>
          <Field label="סיבה" value={reason} onChange={(e) => setReason(e.target.value)} error={fe.reason} />
        </>
      )}
    </FormModal>
  );
}

export function AddCatalogModal() {
  const { close } = useDialogs();
  const invalidate = useInvalidateMoney();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [type, setType] = useState<string>(MANUAL_CHARGE_TYPES[0]!);
  return (
    <FormModal
      title="פריט חדש בקטלוג"
      submitLabel="הוספה"
      onCancel={close}
      onSubmit={async () => {
        await post('/api/catalog', { name, defaultAgorot: amount, type });
        await invalidate();
        close();
      }}
    >
      {(fe) => (
        <>
          <Field label="שם הפריט" value={name} onChange={(e) => setName(e.target.value)} error={fe.name} />
          <MoneyField
            label="סכום ברירת מחדל (₪)"
            value={amount}
            onChange={setAmount}
            error={fe.defaultAgorot}
          />
          <SelectField label="סוג" value={type} onChange={(e) => setType(e.target.value)}>
            {MANUAL_CHARGE_TYPES.map((t) => (
              <option key={t} value={t}>
                {CHARGE_TYPES[t]}
              </option>
            ))}
          </SelectField>
        </>
      )}
    </FormModal>
  );
}
