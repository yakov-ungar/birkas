import { useState, type ReactNode } from 'react';
import { STUDENT_STATUS, formatMoney, type StudentStatus } from '@tuition/shared';
import { HttpError, patch, post } from '../../api/client';
import { useFamilies, useInvalidateMoney } from '../../api/hooks';
import { useGrades } from '../../api/grades';
import { Field, FormError, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { MoneyField } from '../../components/Money';
import { useDialogs } from '../../components/Dialogs';
import { useToast } from '../../components/Toast';
import { StudentModal } from './StudentModal';
import { FamilyModal } from './FamilyModal';

/** Modal with a form; submit runs `onSubmit` and shows server errors (with field messages) in Hebrew. */
export function FormModal({
  title,
  submitLabel,
  onSubmit,
  onCancel,
  children,
}: {
  title: string;
  submitLabel: string;
  onSubmit: () => Promise<void>;
  onCancel: () => void;
  children: (fieldErrors: Record<string, string>) => ReactNode;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setErr(null);
    setFe({});
    try {
      await onSubmit();
    } catch (e) {
      setErr((e as Error).message);
      if (e instanceof HttpError && e.fields) setFe(e.fields);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="b" type="submit" form="fm" disabled={busy}>
            {submitLabel}
          </button>
          <button className="b s" type="button" onClick={onCancel}>
            ביטול
          </button>
        </>
      }
    >
      <form
        id="fm"
        className="cc"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {children(fe)}
      </form>
      <FormError message={err} />
    </Modal>
  );
}

export function AddStudentModal({ familyId }: { familyId?: string }) {
  const { open, close } = useDialogs();
  const families = useFamilies();
  const grades = useGrades();
  const invalidate = useInvalidateMoney();
  const [fam, setFam] = useState(familyId ?? 'new');
  const [v, setV] = useState({ fullName: '', grade: grades[0] ?? '', parentName: '', phone: '', email: '' });
  const [fee, setFee] = useState<number | null>(960000);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV({ ...v, [k]: e.target.value });
  return (
    <FormModal
      title="תלמיד חדש"
      submitLabel="שמירה"
      onCancel={() => (familyId ? open(<FamilyModal id={familyId} />) : close())}
      onSubmit={async () => {
        if (fee === null) throw new Error('יש להזין שכר לימוד');
        const r = await post<{ studentId: string; siblingDiscountAgorot: number }>('/api/students', {
          fullName: v.fullName,
          grade: v.grade,
          tuitionAgorot: fee,
          ...(fam === 'new'
            ? { newFamily: { parentName: v.parentName, phone: v.phone, email: v.email } }
            : { familyId: fam }),
        });
        await invalidate();
        open(
          <Modal
            title="התלמיד נוסף"
            onClose={close}
            footer={
              <>
                <button className="b" type="button" onClick={() => open(<StudentModal id={r.studentId} />)}>
                  פתיחת כרטיס תלמיד
                </button>
                <button className="b s" type="button" onClick={close}>
                  סגור
                </button>
              </>
            }
          >
            <p>
              נוצר חיוב שכר לימוד של {formatMoney(fee)}.
              {r.siblingDiscountAgorot > 0 && (
                <>
                  <br />
                  הוחלה הנחת אחים של {formatMoney(r.siblingDiscountAgorot)}.
                </>
              )}
            </p>
          </Modal>,
        );
      }}
    >
      {(fe) => (
        <>
          <SelectField label="משפחה" value={fam} onChange={(e) => setFam(e.target.value)}>
            <option value="new">משפחה חדשה</option>
            {families.data?.families.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} - {f.parentName}
              </option>
            ))}
          </SelectField>
          <Field label="שם התלמיד המלא" value={v.fullName} onChange={set('fullName')} error={fe.fullName} />
          <SelectField label="כיתה" value={v.grade} onChange={set('grade')} error={fe.grade}>
            {grades.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </SelectField>
          <MoneyField label="שכר לימוד שנתי (₪)" value={fee} onChange={setFee} error={fe.tuitionAgorot} />
          {fam === 'new' && (
            <>
              <Field
                label="שם ההורה"
                value={v.parentName}
                onChange={set('parentName')}
                error={fe['newFamily.parentName']}
              />
              <Field
                label="טלפון"
                type="tel"
                dir="ltr"
                value={v.phone}
                onChange={set('phone')}
                error={fe['newFamily.phone']}
              />
              <Field
                label="אימייל"
                type="email"
                dir="ltr"
                value={v.email}
                onChange={set('email')}
                error={fe['newFamily.email']}
              />
            </>
          )}
        </>
      )}
    </FormModal>
  );
}

export function EditFamilyModal({
  family,
}: {
  family: { id: string; parentName: string; phone: string; email: string; address: string; note: string };
}) {
  const { open } = useDialogs();
  const invalidate = useInvalidateMoney();
  const [v, setV] = useState({
    parentName: family.parentName,
    phone: family.phone,
    email: family.email,
    address: family.address,
    note: family.note,
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setV({ ...v, [k]: e.target.value });
  const back = () => open(<FamilyModal id={family.id} />);
  return (
    <FormModal
      title="פרטי משפחה"
      submitLabel="שמירה"
      onCancel={back}
      onSubmit={async () => {
        await patch(`/api/families/${family.id}`, v);
        await invalidate();
        back();
      }}
    >
      {(fe) => (
        <>
          <Field label="שם ההורה" value={v.parentName} onChange={set('parentName')} error={fe.parentName} />
          <Field
            label="טלפון"
            type="tel"
            dir="ltr"
            value={v.phone}
            onChange={set('phone')}
            error={fe.phone}
          />
          <Field
            label="אימייל"
            type="email"
            dir="ltr"
            value={v.email}
            onChange={set('email')}
            error={fe.email}
          />
          <Field label="כתובת" value={v.address} onChange={set('address')} error={fe.address} />
        </>
      )}
    </FormModal>
  );
}

export function StatusModal({
  student,
}: {
  student: { id: string; fullName: string; status: StudentStatus };
}) {
  const { open, close } = useDialogs();
  const toast = useToast();
  const invalidate = useInvalidateMoney();
  const [status, setStatus] = useState<StudentStatus>(student.status);
  return (
    <FormModal
      title={`סטטוס תלמיד - ${student.fullName}`}
      submitLabel="שמירה"
      onCancel={() => open(<StudentModal id={student.id} />)}
      onSubmit={async () => {
        const r = await post<{ remainingBalanceAgorot: number }>(`/api/students/${student.id}/status`, {
          status,
        });
        await invalidate();
        close();
        toast(
          r.remainingBalanceAgorot > 0
            ? `התלמיד סומן. נותרה יתרת חוב של ${formatMoney(r.remainingBalanceAgorot)} לגבייה`
            : 'הסטטוס עודכן',
        );
      }}
    >
      {() => (
        <SelectField
          label="סטטוס"
          value={status}
          onChange={(e) => setStatus(e.target.value as StudentStatus)}
        >
          {(Object.keys(STUDENT_STATUS) as StudentStatus[]).map((k) => (
            <option key={k} value={k}>
              {STUDENT_STATUS[k]}
            </option>
          ))}
        </SelectField>
      )}
    </FormModal>
  );
}

export function DeleteStudentModal({ id, name }: { id: string; name: string }) {
  const { open, close } = useDialogs();
  const toast = useToast();
  const invalidate = useInvalidateMoney();
  return (
    <FormModal
      title={`מחיקת ${name}`}
      submitLabel="מחיקה"
      onCancel={() => open(<StudentModal id={id} />)}
      onSubmit={async () => {
        await post(`/api/students/${id}/delete`);
        await invalidate();
        close();
        toast('התלמיד נמחק');
      }}
    >
      {() => (
        <p style={{ gridColumn: '1/-1' }}>
          מחיקה אפשרית רק לתלמיד בלי תשלומים (למשל, נוסף בטעות). החיובים שלו יבוטלו בתנועה הפוכה, והרישום
          יישמר ביומן.
        </p>
      )}
    </FormModal>
  );
}

export function RefundModal({
  studentId,
  credit,
  name,
}: {
  studentId: string;
  credit: number;
  name: string;
}) {
  const { open } = useDialogs();
  const invalidate = useInvalidateMoney();
  const [key] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState<number | null>(credit);
  const [method, setMethod] = useState<'transfer' | 'cash'>('transfer');
  const [reason, setReason] = useState('');
  return (
    <FormModal
      title={`החזר כספי - ${name}`}
      submitLabel="אישור החזר"
      onCancel={() => open(<StudentModal id={studentId} />)}
      onSubmit={async () => {
        await post('/api/refunds', { idempotencyKey: key, studentId, amountAgorot: amount, method, reason });
        await invalidate();
        open(<StudentModal id={studentId} />);
      }}
    >
      {(fe) => (
        <>
          <MoneyField
            label={`סכום (עד ${formatMoney(credit)})`}
            value={amount}
            onChange={setAmount}
            error={fe.amountAgorot}
          />
          <SelectField
            label="אמצעי החזר"
            value={method}
            onChange={(e) => setMethod(e.target.value as 'transfer' | 'cash')}
          >
            <option value="transfer">העברה</option>
            <option value="cash">מזומן</option>
          </SelectField>
          <Field label="סיבה" value={reason} onChange={(e) => setReason(e.target.value)} error={fe.reason} />
          <p className="mu" style={{ gridColumn: '1/-1' }}>
            החזר לכרטיס אשראי נעשה בביטול הקבלה של אותה עסקה.
          </p>
        </>
      )}
    </FormModal>
  );
}
