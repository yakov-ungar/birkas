import { useQuery } from '@tanstack/react-query';
import { formatMoney, type PlanRow, type RunSummary } from '@tuition/shared';
import { get, post } from '../../api/client';
import { useInvalidateMoney } from '../../api/hooks';
import { useAuth } from '../../app/auth';
import { FormError } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { Money } from '../../components/Money';
import { useDialogs } from '../../components/Dialogs';
import { useToast } from '../../components/Toast';
import { rowButton } from '../../components/format';
import { NewPlanModal, PlanModal } from './PlanModals';

const fmt = (d: string) => d.split('-').reverse().join('/');

export function PlansPage() {
  const { me, refresh } = useAuth();
  const { open, close } = useDialogs();
  const toast = useToast();
  const invalidate = useInvalidateMoney();
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => get<{ plans: PlanRow[] }>('/api/plans') });
  const due = useQuery({
    queryKey: ['due'],
    queryFn: () => get<{ today: string; due: number }>('/api/plans/due-count'),
  });

  const runNow = async () => {
    if (!due.data?.due) return toast('אין חיובים שהגיע מועדם');
    try {
      const r = await post<RunSummary>('/api/plans/run');
      await invalidate();
      open(
        <Modal
          title="סיכום חיובים"
          onClose={close}
          footer={
            <button className="b s" type="button" onClick={close}>
              סגור
            </button>
          }
        >
          <p>
            הצליחו: <b>{r.ok}</b>
            <br />
            נכשלו: <b className={r.failed ? 'bad' : ''}>{r.failed}</b>
            {r.expected > 0 && (
              <>
                <br />
                ממתינים להעברה או להוראת קבע: <b>{r.expected}</b>
              </>
            )}
          </p>
          {r.failures.length > 0 && (
            <>
              <ul>
                {r.failures.map((f, i) => (
                  <li key={i}>
                    {f.studentName} · {formatMoney(f.amountAgorot)} · {f.reason}
                  </li>
                ))}
              </ul>
              <p className="mu">חיובים שנכשלו מופיעים בתוכנית עם אפשרות לנסות שוב.</p>
            </>
          )}
        </Modal>,
      );
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <>
      <h2>תוכניות חיוב</h2>
      <div className="card">
        <div className="row">
          <button className="b" type="button" onClick={() => open(<NewPlanModal />)}>
            תוכנית חיוב חדשה
          </button>
          <button className="b s" type="button" onClick={() => void runNow()}>
            הרץ חיובים שהגיע מועדם
          </button>
          {me?.testMode && (
            <button
              className="b s"
              type="button"
              onClick={async () => {
                await post('/api/test/clock/advance-month');
                await Promise.all([invalidate(), refresh()]);
                toast('תאריך הבדיקה קודם לחודש הבא');
              }}
            >
              קדם חודש (בדיקה)
            </button>
          )}
          {due.data && (
            <span className="mu">
              {me?.testMode ? 'תאריך בדיקה' : 'היום'}: {fmt(due.data.today)} · חיובים שהגיע מועדם:{' '}
              {due.data.due}
            </span>
          )}
        </div>
        <p className="mu">
          פריסה לתשלומים מחלקת סכום כולל למספר חיובים. חיוב חוזר גובה סכום קבוע כל חודש. החיובים רצים אוטומטית
          בכל לילה בשעה שמוגדרת בהגדרות.
        </p>
      </div>
      <div className="card tw">
        <table>
          <thead>
            <tr>
              <th>תלמיד</th>
              <th>סוג</th>
              <th>סכום</th>
              <th>התקדמות</th>
              <th>אמצעי</th>
              <th>חיוב הבא</th>
              <th>סטטוס</th>
            </tr>
          </thead>
          <tbody>
            {plans.data?.plans.map((p) => (
              <tr
                key={p.id}
                {...rowButton(() => open(<PlanModal id={p.id} />))}
                aria-label={`תוכנית של ${p.studentName}`}
              >
                <td>{p.studentName}</td>
                <td>{p.label}</td>
                <td>
                  <Money a={p.amountAgorot} /> {p.type === 'installments' ? 'סה״כ' : 'לחודש'}
                </td>
                <td>
                  {p.paidCount}
                  {p.type === 'installments' || p.count ? ` מתוך ${p.totalCount}` : ''}
                </td>
                <td>{p.methodLabel}</td>
                <td>{p.next ? `${fmt(p.next.dueDate)} · ${formatMoney(p.next.amountAgorot)}` : '-'}</td>
                <td>
                  <span className={`pill ${p.display[1]}`}>{p.display[0]}</span>
                </td>
              </tr>
            ))}
            {plans.data && !plans.data.plans.length && (
              <tr>
                <td colSpan={7}>אין תוכניות חיוב</td>
              </tr>
            )}
          </tbody>
        </table>
        <FormError message={(plans.error as Error | null)?.message} />
      </div>
    </>
  );
}
