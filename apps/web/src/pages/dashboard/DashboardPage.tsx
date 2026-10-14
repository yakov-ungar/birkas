import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { Dashboard } from '@tuition/shared';
import { get } from '../../api/client';
import { useAuth } from '../../app/auth';
import { AlertList, useAlerts } from '../../app/Alerts';
import { BarChart } from '../../components/BarChart';
import { FormError } from '../../components/Field';
import { Money } from '../../components/Money';
import { useDialogs } from '../../components/Dialogs';
import { fmtTime, rowButton } from '../../components/format';
import { PaymentFlow } from '../payments/PaymentFlow';
import { BulkChargeModal } from '../charges/ChargeModals';
import { AddStudentModal } from '../families/StudentActions';
import { FamilyModal } from '../families/FamilyModal';
import { NewPlanModal } from '../plans/PlanModals';
import { AGING_LABELS } from '../families/labels';
import { CloseCashModal, OpenCashModal, useCash } from '../checks/ChecksPage';

/** Ordinal blue ramp for ordered debt-age buckets (validated: dataviz validate_palette --ordinal). */
const AGING_RAMP = ['#86b6ef', '#3987e5', '#1c5cab', '#0d366b'];

export function DashboardPage() {
  const { has } = useAuth();
  const { open } = useDialogs();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => get<Dashboard>('/api/dashboard') });
  const alerts = useAlerts();
  const cash = useCash(has('checks'));
  const d = q.data;
  return (
    <>
      <h2>לוח בקרה</h2>
      <div className="row">
        {has('pay') && (
          <button className="b" type="button" onClick={() => open(<PaymentFlow />)}>
            קבלת תשלום
          </button>
        )}
        {has('charges') && (
          <button className="b s" type="button" onClick={() => open(<BulkChargeModal />)}>
            חיוב קבוצתי
          </button>
        )}
        {has('plans') && (
          <button className="b s" type="button" onClick={() => open(<NewPlanModal />)}>
            תוכנית חיוב
          </button>
        )}
        {has('stu_edit') && (
          <button className="b s" type="button" onClick={() => open(<AddStudentModal />)}>
            תלמיד חדש
          </button>
        )}
        {has('checks') && cash.data && (
          <button
            className="b s"
            type="button"
            onClick={() =>
              open(
                cash.data!.open ? (
                  <CloseCashModal expected={cash.data!.open.expectedAgorot} />
                ) : (
                  <OpenCashModal />
                ),
              )
            }
          >
            {cash.data.open ? 'סגירת קופה' : 'פתיחת קופה'}
          </button>
        )}
      </div>
      <FormError message={(q.error as Error | null)?.message} />
      {d && (
        <>
          <div className="grid">
            {(
              [
                [<Money key="a" a={d.kpis.netChargedAgorot} />, 'חויב נטו'],
                [<Money key="b" a={d.kpis.collectedAgorot} />, 'נגבה'],
                [<Money key="c" a={d.kpis.openAgorot} />, 'יתרה פתוחה'],
                [`${d.kpis.collectionPct}%`, 'אחוז גבייה'],
                [<Money key="e" a={d.kpis.discountsAgorot} />, 'הנחות ומלגות'],
                [d.kpis.activeStudents, 'תלמידים פעילים'],
                [d.kpis.activePlans, 'תוכניות חיוב פעילות'],
                [d.kpis.failedCharges, 'חיובים שנכשלו'],
              ] as [React.ReactNode, string][]
            ).map(([v, l]) => (
              <div className="kpi" key={l}>
                <b>{v}</b>
                <span>{l}</span>
              </div>
            ))}
          </div>
          <div className="two">
            <div className="card">
              <BarChart
                title="גיל חובות"
                bars={AGING_LABELS.map((l, i) => ({ label: l, value: d.aging[i] ?? 0 }))}
                colors={AGING_RAMP}
              />
            </div>
            <div className="card">
              <BarChart
                title="גבייה בפועל בחצי השנה האחרונה"
                bars={d.monthly.map((m) => ({ label: m.label, value: m.amountAgorot }))}
              />
            </div>
          </div>
          <div className="two">
            <div className="card">
              <BarChart
                title="תחזית גבייה לחצי שנה קדימה"
                bars={d.forecast.map((m) => ({ label: m.label, value: m.amountAgorot }))}
                color="#6da7ec"
              />
              <p className="mu">לפי תוכניות חיוב ושיקים דחויים</p>
            </div>
            <div className="card">
              <b>התראות</b>
              <AlertList alerts={(alerts.data?.alerts ?? []).slice(0, 5)} onOpen={(p) => nav(p)} />
            </div>
          </div>
          <div className="two">
            <div className="card tw">
              <b>החייבים הגדולים</b>
              <table style={{ minWidth: 0 }}>
                <thead>
                  <tr>
                    <th>משפחה</th>
                    <th>יתרה</th>
                    <th>גיל חוב</th>
                  </tr>
                </thead>
                <tbody>
                  {d.topDebtors.map((f) => (
                    <tr
                      key={f.familyId}
                      {...(has('stu_view') ? rowButton(() => open(<FamilyModal id={f.familyId} />)) : {})}
                    >
                      <td>{f.name}</td>
                      <td>
                        <Money a={f.balanceAgorot} />
                      </td>
                      <td>{f.agingLabel}</td>
                    </tr>
                  ))}
                  {!d.topDebtors.length && (
                    <tr>
                      <td colSpan={3}>אין חייבים</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="card">
              <b>פעילות אחרונה</b>
              {d.activity.map((a, i) => (
                <div key={i} className="log-line">
                  <span className="mu">{fmtTime(a.at)}</span> · {a.actor}: {a.summary}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
