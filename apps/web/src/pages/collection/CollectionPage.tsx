import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CHANNELS,
  TEMPLATE_PLACEHOLDERS,
  type BatchRow,
  type DebtorRow,
  type RuleRow,
} from '@tuition/shared';
import { get } from '../../api/client';
import { FormError } from '../../components/Field';
import { Money } from '../../components/Money';
import { Tabs } from '../../components/Tabs';
import { useDialogs } from '../../components/Dialogs';
import { fmtDateTime } from '../../components/format';
import { FamilyModal } from '../families/FamilyModal';
import { StatementModal } from '../families/StatementModal';
import { GroupSendModal, NoteModal, PromiseText, RuleEditModal, RuleTestModal } from './CollectionModals';

const fmt = (d: string) => d.split('-').reverse().join('/');
const useRules = () =>
  useQuery({ queryKey: ['rules'], queryFn: () => get<{ rules: RuleRow[] }>('/api/messages/rules') });

export function CollectionPage() {
  const [tab, setTab] = useState('debt');
  return (
    <>
      <h2>גבייה והודעות</h2>
      <Tabs
        label="גבייה והודעות"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'debt', label: 'מעקב חייבים', content: <DebtorsTab /> },
          { id: 'rules', label: 'תזכורות אוטומטיות', content: <RulesTab /> },
          { id: 'hist', label: 'היסטוריית הודעות', content: <HistoryTab /> },
        ]}
      />
    </>
  );
}

function DebtorsTab() {
  const { open } = useDialogs();
  const rules = useRules();
  const [age, setAge] = useState('0');
  const [min, setMin] = useState('0');
  const minAgorot = Math.max(0, Math.round(Number(min || 0) * 100));
  const q = useQuery({
    queryKey: ['debtors', age, minAgorot],
    queryFn: () =>
      get<{ debtors: DebtorRow[] }>(`/api/collection/debtors?minAge=${age}&minBalance=${minAgorot}`),
  });
  return (
    <>
      <div className="row">
        <select aria-label="גיל חוב" value={age} onChange={(e) => setAge(e.target.value)}>
          <option value="0">כל החייבים</option>
          <option value="30">חוב מעל 30 יום</option>
          <option value="60">חוב מעל 60 יום</option>
          <option value="90">חוב מעל 90 יום</option>
        </select>
        <label className="chk">
          יתרה מעל (₪){' '}
          <input
            inputMode="numeric"
            dir="ltr"
            style={{ width: 100 }}
            value={min}
            onChange={(e) => setMin(e.target.value.replace(/[^\d.]/g, ''))}
          />
        </label>
        <button
          className="b"
          type="button"
          onClick={() => open(<GroupSendModal rules={rules.data?.rules ?? []} />)}
        >
          שליחת הודעה לקבוצה
        </button>
      </div>
      <div className="card tw">
        <table>
          <thead>
            <tr>
              <th>משפחה</th>
              <th>יתרה</th>
              <th>גיל חוב</th>
              <th>קשר אחרון</th>
              <th>הבטחת תשלום</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {q.data?.debtors.map((d) => (
              <tr key={d.familyId}>
                <td>
                  <button
                    type="button"
                    className="link"
                    onClick={() => open(<FamilyModal id={d.familyId} />)}
                  >
                    {d.name}
                  </button>
                </td>
                <td>
                  <Money a={d.balanceAgorot} />
                </td>
                <td>{d.agingLabel}</td>
                <td>
                  {d.lastContact ? (
                    `${fmt(d.lastContact)} (${d.daysSinceContact} ימים)`
                  ) : (
                    <span className="bad">לא נוצר קשר</span>
                  )}
                </td>
                <td>{d.promise ? <PromiseText p={d.promise} /> : '-'}</td>
                <td>
                  <button
                    className="b s sm"
                    type="button"
                    onClick={() => open(<NoteModal familyId={d.familyId} familyName={d.name} />)}
                  >
                    הערה
                  </button>{' '}
                  <button
                    className="b s sm"
                    type="button"
                    onClick={() => open(<StatementModal familyId={d.familyId} />)}
                  >
                    דף חשבון
                  </button>
                </td>
              </tr>
            ))}
            {q.data && !q.data.debtors.length && (
              <tr>
                <td colSpan={6}>אין חייבים לפי הסינון</td>
              </tr>
            )}
          </tbody>
        </table>
        <FormError message={(q.error as Error | null)?.message} />
      </div>
    </>
  );
}

function RulesTab() {
  const { open } = useDialogs();
  const rules = useRules();
  return (
    <>
      {rules.data?.rules.map((r) => (
        <div key={r.key} className="card" style={{ padding: 12 }}>
          <div className="row" style={{ margin: 0 }}>
            <b>{r.name}</b>
            <span className={`pill ${r.enabled ? 'g' : 'gr'}`}>{r.enabled ? 'פעילה' : 'כבויה'}</span>
            <span className="mu">ערוץ: {CHANNELS[r.channel]}</span>
            <span className="spacer" />
            <button
              className="b s sm"
              type="button"
              onClick={() => open(<RuleTestModal rule={r} />)}
              aria-label={`בדיקת ${r.name}`}
            >
              בדיקה
            </button>
            <button
              className="b s sm"
              type="button"
              onClick={() => open(<RuleEditModal rule={r} />)}
              aria-label={`עריכת ${r.name}`}
            >
              עריכה
            </button>
          </div>
          <div className="mu">{r.template}</div>
        </div>
      ))}
      <p className="mu">התבניות תומכות במשתנים: {TEMPLATE_PLACEHOLDERS.join(' ')}</p>
      <p className="mu">
        כלל "חוב מעל 30 יום" נשלח לכל משפחה לכל היותר פעם ב-14 יום. הודעות SMS ווואטסאפ אוטומטיות יוצאות רק
        בין 08:00 ל-21:00, ולא בשבת ובחג.
      </p>
    </>
  );
}

function HistoryTab() {
  const q = useQuery({
    queryKey: ['history'],
    queryFn: () => get<{ batches: BatchRow[] }>('/api/messages/history'),
  });
  return (
    <div className="card tw">
      <table>
        <thead>
          <tr>
            <th>שעה</th>
            <th>ערוץ</th>
            <th>נמענים</th>
            <th>תוכן</th>
            <th>מקור</th>
          </tr>
        </thead>
        <tbody>
          {q.data?.batches.map((b) => (
            <tr key={b.id}>
              <td>{fmtDateTime(b.at)}</td>
              <td>{CHANNELS[b.channel]}</td>
              <td>
                {b.recipients}
                {b.queued > 0 && <div className="mu">{b.queued} ממתינות לשעות השליחה</div>}
                {b.failed > 0 && <div className="bad">{b.failed} לא נשלחו</div>}
              </td>
              <td>{b.template}</td>
              <td>{b.source === 'auto' ? `אוטומטי${b.ruleName ? ` (${b.ruleName})` : ''}` : 'ידני'}</td>
            </tr>
          ))}
          {q.data && !q.data.batches.length && (
            <tr>
              <td colSpan={5}>עדיין לא נשלחו הודעות</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
