import { useAuth } from '../../app/auth';
import { useFamily } from '../../api/hooks';
import { FormError } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { Money } from '../../components/Money';
import { useDialogs } from '../../components/Dialogs';
import { rowButton } from '../../components/format';
import { StudentModal } from './StudentModal';
import { StatementModal } from './StatementModal';
import { AddStudentModal, EditFamilyModal } from './StudentActions';
import { PaymentFlow } from '../payments/PaymentFlow';

export function FamilyModal({ id }: { id: string }) {
  const { close, open } = useDialogs();
  const { has } = useAuth();
  const q = useFamily(id);
  const f = q.data;
  return (
    <Modal
      title={f?.family.name ?? 'טוען...'}
      onClose={close}
      footer={
        f && (
          <>
            {has('pay') && (
              <button
                className="b"
                type="button"
                onClick={() =>
                  open(<PaymentFlow target={f.students.length > 1 ? `f:${id}` : `s:${f.students[0]?.id}`} />)
                }
                disabled={!f.students.length}
              >
                תשלום למשפחה
              </button>
            )}
            {has('stu_edit') && (
              <>
                <button className="b s" type="button" onClick={() => open(<AddStudentModal familyId={id} />)}>
                  הוספת תלמיד
                </button>
                <button
                  className="b s"
                  type="button"
                  onClick={() => open(<EditFamilyModal family={f.family} />)}
                >
                  עריכת פרטים
                </button>
              </>
            )}
            <button
              className="b s"
              type="button"
              onClick={() => open(<StatementModal familyId={id} after={<FamilyModal id={id} />} />)}
            >
              דף חשבון
            </button>
            <button className="b s" type="button" onClick={close}>
              סגור
            </button>
          </>
        )
      }
    >
      <FormError message={(q.error as Error | null)?.message} />
      {f && (
        <>
          <p>
            {f.family.parentName} · <span className="ltr">{f.family.phone}</span>
            {f.family.email && (
              <>
                {' '}
                · <span className="ltr">{f.family.email}</span>
              </>
            )}
            {f.family.address && (
              <>
                <br />
                {f.family.address}
              </>
            )}
          </p>
          <div className="tw">
            <table style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <th>תלמיד</th>
                  <th>כיתה</th>
                  <th>יתרה</th>
                </tr>
              </thead>
              <tbody>
                {f.students.map((s) => (
                  <tr key={s.id} {...rowButton(() => open(<StudentModal id={s.id} />))}>
                    <td>{s.fullName}</td>
                    <td>{s.grade}</td>
                    <td>
                      <Money a={s.balanceAgorot} />
                    </td>
                  </tr>
                ))}
                <tr>
                  <th colSpan={2}>סה״כ משפחה</th>
                  <th>
                    <Money a={f.balanceAgorot} />
                  </th>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mu">מעקב גבייה והבטחות תשלום ייבנו בשלב 5.</p>
        </>
      )}
    </Modal>
  );
}
