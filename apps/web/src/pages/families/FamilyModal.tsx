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
import { NoteModal, PromiseText } from '../collection/CollectionModals';
import { NOTE_TYPES } from '@tuition/shared';
import { post } from '../../api/client';
import { useInvalidateMoney } from '../../api/hooks';

export function FamilyModal({ id }: { id: string }) {
  const { close, open } = useDialogs();
  const { has } = useAuth();
  const q = useFamily(id);
  const invalidate = useInvalidateMoney();
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
            {has('msg') && (
              <button
                className="b s"
                type="button"
                onClick={() => open(<NoteModal familyId={id} familyName={f.family.name} backToFamily />)}
              >
                הערת גבייה
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
          {f.promise && (
            <p
              className="al"
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
            >
              <span>
                הבטחת תשלום: <PromiseText p={f.promise} />
              </span>
              {has('msg') && (
                <button
                  className="b s sm"
                  type="button"
                  onClick={async () => {
                    await post(`/api/notes/${f.promise!.noteId}/fulfilled`);
                    await invalidate();
                  }}
                >
                  סמן כבוצע
                </button>
              )}
            </p>
          )}
          {f.notes && (
            <>
              <h4>מעקב גבייה</h4>
              {f.notes.map((n) => (
                <div className="chk" key={n.id}>
                  <span className="mu">
                    {n.date.split('-').reverse().join('/')} · {n.byName}
                  </span>{' '}
                  <b>{NOTE_TYPES[n.type]}</b> {n.note}
                  {n.promise && (
                    <>
                      {' '}
                      · הבטחה <PromiseText p={n.promise} />
                      {n.promise.status === 'kept' && ' (קוימה)'}
                    </>
                  )}
                </div>
              ))}
              {!f.notes.length && <div className="mu">אין רישומים</div>}
            </>
          )}
        </>
      )}
    </Modal>
  );
}
