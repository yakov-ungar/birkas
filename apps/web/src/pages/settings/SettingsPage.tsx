import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AllSettings, LoginEventRow, SecuritySettings } from '@tuition/shared';
import { HttpError, get, patch } from '../../api/client';
import { useAuth } from '../../app/auth';
import { Field, FormError } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { Tabs } from '../../components/Tabs';
import { useToast } from '../../components/Toast';
import { fmtDateTime } from '../../components/format';
import { GeneralModal, Integrations, SchoolYear } from './SettingsTabs';
import { TutoringSettings } from '../tutoring/Tutoring';

const shekel = (agorot: number) => `₪${(agorot / 100).toLocaleString('he-IL')}`;

export function SettingsPage() {
  const [tab, setTab] = useState('gen');
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => get<{ settings: AllSettings }>('/api/settings'),
  });
  const s = settings.data?.settings;
  return (
    <>
      <h2>הגדרות וחיבורים</h2>
      <Tabs
        label="הגדרות"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'gen', label: 'כללי', content: s ? <General s={s} /> : <p className="mu">טוען...</p> },
          { id: 'int', label: 'חיבורים', content: <Integrations /> },
          { id: 'sec', label: 'אבטחה', content: s ? <Security s={s} /> : <p className="mu">טוען...</p> },
          { id: 'yr', label: 'שנת לימודים', content: <SchoolYear /> },
          { id: 'tut', label: 'שיעורים פרטיים', content: <TutoringSettings /> },
        ]}
      />
    </>
  );
}

function General({ s }: { s: AllSettings }) {
  const [editing, setEditing] = useState(false);
  const rows: [string, string][] = [
    ['שם בית הספר', s.schoolName],
    ['שנת לימודים פעילה', s.activeYearName],
    ['הנחת אחים', `ילד שני ${s.siblingPct[1]}% · ילד שלישי ואילך ${s.siblingPct[2]}%`],
    ['עמלת שיק חוזר', shekel(s.checkReturnFeeAgorot)],
    ['הרצת חיובים אוטומטית', s.autoRunTime],
    ['גיבוי אוטומטי', s.backupFrequency === 'daily' ? 'יומי' : 'שבועי'],
    ['ערוצי הודעות', s.textMessaging ? 'מייל, SMS ווואטסאפ' : 'מייל בלבד'],
  ];
  return (
    <div className="card">
      <table>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th scope="row">{k}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="b" type="button" onClick={() => setEditing(true)}>
          עריכת הגדרות
        </button>
      </div>
      {editing && <GeneralModal s={s} onClose={() => setEditing(false)} />}
    </div>
  );
}

function Security({ s }: { s: AllSettings }) {
  const [editing, setEditing] = useState(false);
  const events = useQuery({
    queryKey: ['login-events'],
    queryFn: () => get<{ events: LoginEventRow[] }>('/api/settings/login-events'),
  });
  const rows: [string, string][] = [
    ['אימות דו-שלבי חובה', s.require2fa ? 'פעיל' : 'כבוי'],
    ['ניתוק אוטומטי אחרי חוסר פעילות', `${s.idleTimeoutMin} דקות`],
    ['אורך סיסמה מינימלי', `${s.minPasswordLength} תווים`],
    ['נעילה אחרי ניסיונות כושלים', `${s.maxFailedLogins} ניסיונות`],
  ];
  return (
    <>
      <div className="card">
        <table>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <th scope="row">{k}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="b" type="button" onClick={() => setEditing(true)}>
            עריכת הגדרות אבטחה
          </button>
        </div>
      </div>
      <div className="card tw">
        <b>אירועי התחברות אחרונים</b>
        <table>
          <thead>
            <tr>
              <th>שעה</th>
              <th>משתמש</th>
              <th>אירוע</th>
              <th>מכשיר</th>
            </tr>
          </thead>
          <tbody>
            {events.data?.events.map((e) => (
              <tr key={e.id}>
                <td>{fmtDateTime(e.at)}</td>
                <td>{e.user}</td>
                <td>{e.event}</td>
                <td>{e.device}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <SecurityModal s={s} onClose={() => setEditing(false)} />}
    </>
  );
}

function SecurityModal({ s, onClose }: { s: SecuritySettings; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { refresh } = useAuth();
  const [v, setV] = useState({
    require2fa: s.require2fa,
    idleTimeoutMin: String(s.idleTimeoutMin),
    minPasswordLength: String(s.minPasswordLength),
    maxFailedLogins: String(s.maxFailedLogins),
  });
  const m = useMutation({
    mutationFn: () =>
      patch('/api/settings/security', {
        require2fa: v.require2fa,
        idleTimeoutMin: Number(v.idleTimeoutMin),
        minPasswordLength: Number(v.minPasswordLength),
        maxFailedLogins: Number(v.maxFailedLogins),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings'] });
      void qc.invalidateQueries({ queryKey: ['audit'] });
      void refresh();
      toast('ההגדרות נשמרו');
      onClose();
    },
  });
  const fe = m.error instanceof HttpError ? m.error.fields : undefined;
  return (
    <Modal
      title="הגדרות אבטחה"
      onClose={onClose}
      footer={
        <>
          <button className="b" type="submit" form="sec-form" disabled={m.isPending}>
            שמירה
          </button>
          <button className="b s" type="button" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <form
        id="sec-form"
        className="cc"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <label className="chk" style={{ gridColumn: '1 / -1' }}>
          <input
            type="checkbox"
            checked={v.require2fa}
            onChange={(e) => setV({ ...v, require2fa: e.target.checked })}
          />{' '}
          אימות דו-שלבי חובה לכל המשתמשים
        </label>
        <Field
          label="ניתוק אחרי חוסר פעילות (דקות, 5 עד 480)"
          type="number"
          min={5}
          max={480}
          value={v.idleTimeoutMin}
          onChange={(e) => setV({ ...v, idleTimeoutMin: e.target.value })}
          error={fe?.idleTimeoutMin}
        />
        <Field
          label="אורך סיסמה מינימלי (8 עד 64)"
          type="number"
          min={8}
          max={64}
          value={v.minPasswordLength}
          onChange={(e) => setV({ ...v, minPasswordLength: e.target.value })}
          error={fe?.minPasswordLength}
        />
        <Field
          label="נעילה אחרי ניסיונות כושלים (3 עד 20)"
          type="number"
          min={3}
          max={20}
          value={v.maxFailedLogins}
          onChange={(e) => setV({ ...v, maxFailedLogins: e.target.value })}
          error={fe?.maxFailedLogins}
        />
      </form>
      <FormError message={m.error?.message} />
    </Modal>
  );
}
