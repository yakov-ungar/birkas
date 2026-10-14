import { STUDENT_STATUS } from '@tuition/shared';
import { useAuth } from '../../app/auth';
import { useStudent } from '../../api/hooks';
import { AGING_LABELS } from './labels';
import { FormError } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { Money } from '../../components/Money';
import { useDialogs } from '../../components/Dialogs';
import { LedgerTable } from './LedgerTable';
import { FamilyModal } from './FamilyModal';
import { StatementModal } from './StatementModal';
import { StatusModal, DeleteStudentModal, RefundModal } from './StudentActions';
import { PaymentFlow } from '../payments/PaymentFlow';
import { ChargeModal, DiscountModal } from '../charges/ChargeModals';
import { AddCardModal, useCardActions } from '../cards/CardsPage';
import { NewPlanModal, PlanModal } from '../plans/PlanModals';

export function StudentModal({ id }: { id: string }) {
  const { close, open } = useDialogs();
  const { has } = useAuth();
  const q = useStudent(id);
  const cardActions = useCardActions();
  const c = q.data;
  const back = <StudentModal id={id} />;
  return (
    <Modal
      title={
        c ? (
          <>
            {c.student.fullName}{' '}
            <span className={`pill ${c.student.status === 'active' ? 'g' : 'gr'}`}>
              {STUDENT_STATUS[c.student.status]}
            </span>
          </>
        ) : (
          'טוען...'
        )
      }
      onClose={close}
      footer={
        c && (
          <>
            {has('pay') && (
              <button className="b" type="button" onClick={() => open(<PaymentFlow target={`s:${id}`} />)}>
                קבלת תשלום
              </button>
            )}
            {has('charges') && (
              <>
                <button
                  className="b s"
                  type="button"
                  onClick={() => open(<ChargeModal studentId={id} after={back} />)}
                >
                  חיוב
                </button>
                <button
                  className="b s"
                  type="button"
                  onClick={() => open(<DiscountModal studentId={id} after={back} />)}
                >
                  הנחה / מלגה
                </button>
              </>
            )}
            {has('cards') && (
              <button
                className="b s"
                type="button"
                onClick={() => open(<AddCardModal studentId={id} after={back} />)}
              >
                הוספת כרטיס
              </button>
            )}
            {has('plans') && (
              <button
                className="b s"
                type="button"
                onClick={() => open(<NewPlanModal studentId={id} after={back} />)}
              >
                תוכנית חיוב
              </button>
            )}
            {has('pay') && c.balanceAgorot < 0 && (
              <button
                className="b s"
                type="button"
                onClick={() =>
                  open(<RefundModal studentId={id} credit={-c.balanceAgorot} name={c.student.fullName} />)
                }
              >
                החזר כספי
              </button>
            )}
            <button
              className="b s"
              type="button"
              onClick={() => open(<StatementModal familyId={c.family.id} after={back} />)}
            >
              דף חשבון
            </button>
            {has('stu_edit') && (
              <>
                <button
                  className="b s"
                  type="button"
                  onClick={() => open(<StatusModal student={c.student} />)}
                >
                  שינוי סטטוס
                </button>
                {!c.hasFinancialHistory && (
                  <button
                    className="b s"
                    type="button"
                    onClick={() => open(<DeleteStudentModal id={id} name={c.student.fullName} />)}
                  >
                    מחיקה
                  </button>
                )}
              </>
            )}
            <button className="b s" type="button" onClick={close}>
              סגור
            </button>
          </>
        )
      }
    >
      <FormError message={(q.error as Error | null)?.message} />
      {c && (
        <>
          <p>
            כיתה {c.student.grade} ·{' '}
            <button type="button" className="link" onClick={() => open(<FamilyModal id={c.family.id} />)}>
              {c.family.name}
            </button>{' '}
            · {c.family.parentName} · <span className="ltr">{c.family.phone}</span>
            {c.siblings.length > 0 && (
              <>
                <br />
                אחים:{' '}
                {c.siblings.map((s, i) => (
                  <span key={s.id}>
                    {i > 0 && ', '}
                    <button type="button" className="link" onClick={() => open(<StudentModal id={s.id} />)}>
                      {s.fullName}
                    </button>
                  </span>
                ))}
              </>
            )}
          </p>
          <div className="grid">
            <div className="kpi">
              <b>
                <Money a={c.netChargedAgorot} />
              </b>
              <span>חויב נטו</span>
            </div>
            <div className="kpi">
              <b>
                <Money a={c.paidAgorot} />
              </b>
              <span>שולם</span>
            </div>
            <div className="kpi">
              <b className={c.balanceAgorot > 0 ? 'bad' : 'ok'}>
                <Money a={c.balanceAgorot} />
              </b>
              <span>{c.balanceAgorot < 0 ? 'יתרת זכות' : 'יתרה'}</span>
            </div>
          </div>
          {c.balanceAgorot > 0 && (
            <p className="mu">
              גיל חוב:{' '}
              {c.aging
                .map((x, i) => (x > 0 ? `${AGING_LABELS[i]} ${(x / 100).toLocaleString('he-IL')} ₪` : ''))
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
          <b>ספר חשבון</b>
          <LedgerTable rows={c.ledger} />
          <h4>כרטיסי אשראי שמורים</h4>
          {c.cards === null ? (
            <div className="mu">אין הרשאה לצפייה בכרטיסים</div>
          ) : c.cards.length ? (
            c.cards.map((k) => (
              <div className="chk" key={k.id}>
                {k.brand} <span className="ltr">****{k.last4}</span> · תוקף{' '}
                <span className="ltr">{k.exp}</span>
                {k.expired && <span className="pill r">פג תוקף</span>}
                {k.isDefault && <span className="pill g">ברירת מחדל</span>}
                {!k.isDefault && (
                  <button className="b s sm" type="button" onClick={() => void cardActions.setDefault(k)}>
                    ברירת מחדל
                  </button>
                )}
                <button
                  className="b s sm"
                  type="button"
                  onClick={() => void cardActions.remove(k)}
                  aria-label={`הסרת כרטיס ****${k.last4}`}
                >
                  הסר
                </button>
              </div>
            ))
          ) : (
            <div className="mu">אין כרטיסים שמורים</div>
          )}
          <h4>תוכניות חיוב</h4>
          {c.plans === null ? (
            <div className="mu">אין הרשאה</div>
          ) : c.plans.length ? (
            c.plans.map((p) => (
              <div className="chk" key={p.id}>
                {p.label} · <Money a={p.amountAgorot} />{' '}
                <span className={`pill ${p.display[1]}`}>{p.display[0]}</span>
                <button className="b s sm" type="button" onClick={() => open(<PlanModal id={p.id} />)}>
                  פרטים
                </button>
              </div>
            ))
          ) : (
            <div className="mu">אין תוכניות</div>
          )}
        </>
      )}
    </Modal>
  );
}
