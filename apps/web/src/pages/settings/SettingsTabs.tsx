import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatMoney,
  type AllSettings,
  type IntegrationRow,
  type YearInfo,
  type YearPreview,
} from '@tuition/shared';
import { get, patch, post } from '../../api/client';
import { useInvalidateMoney } from '../../api/hooks';
import { useAuth } from '../../app/auth';
import { Field, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { MoneyField } from '../../components/Money';
import { useToast } from '../../components/Toast';
import { FormModal } from '../families/StudentActions';

const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });

/** Demo editCfg. Changing the sibling percentages recalculates every family. */
export function GeneralModal({ s, onClose }: { s: AllSettings; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const invalidate = useInvalidateMoney();
  const { refresh } = useAuth();
  const [v, setV] = useState({
    schoolName: s.schoolName,
    s2: String(s.siblingPct[1]),
    s3: String(s.siblingPct[2]),
    autoRunTime: s.autoRunTime,
    backupFrequency: s.backupFrequency,
    grades: s.grades.join(', '),
  });
  const [fee, setFee] = useState<number | null>(s.checkReturnFeeAgorot);
  const sibChanged = Number(v.s2) !== s.siblingPct[1] || Number(v.s3) !== s.siblingPct[2];
  return (
    <FormModal
      title="הגדרות כלליות"
      submitLabel="שמירה"
      onCancel={onClose}
      onSubmit={async () => {
        const pct = [Number(v.s2), Number(v.s3)];
        if (pct.some((p) => !Number.isInteger(p) || p < 0 || p > 100))
          throw new Error('אחוזי הנחה בין 0 ל-100');
        if (fee === null || fee < 0) throw new Error('עמלה לא תקינה');
        await patch('/api/settings/general', {
          schoolName: v.schoolName,
          siblingPct: [0, pct[0], pct[1]],
          checkReturnFeeAgorot: fee,
          autoRunTime: v.autoRunTime,
          backupFrequency: v.backupFrequency,
          grades: v.grades
            .split(',')
            .map((g) => g.trim())
            .filter(Boolean),
        });
        await qc.invalidateQueries({ queryKey: ['settings'] });
        await invalidate();
        await refresh();
        toast(sibChanged ? 'ההגדרות נשמרו וההנחות חושבו מחדש' : 'ההגדרות נשמרו');
        onClose();
      }}
    >
      {(fe) => (
        <>
          <Field
            label="שם בית הספר"
            value={v.schoolName}
            onChange={(e) => setV({ ...v, schoolName: e.target.value })}
            error={fe.schoolName}
          />
          <Field
            label="הנחת אחים - ילד שני (%)"
            type="number"
            min={0}
            max={100}
            value={v.s2}
            onChange={(e) => setV({ ...v, s2: e.target.value })}
          />
          <Field
            label="הנחת אחים - ילד שלישי ואילך (%)"
            type="number"
            min={0}
            max={100}
            value={v.s3}
            onChange={(e) => setV({ ...v, s3: e.target.value })}
          />
          <MoneyField label="עמלת שיק חוזר (₪)" value={fee} onChange={setFee} />
          <Field
            label="שעת הרצת חיובים אוטומטית"
            type="time"
            value={v.autoRunTime}
            onChange={(e) => setV({ ...v, autoRunTime: e.target.value })}
            error={fe.autoRunTime}
          />
          <SelectField
            label="תדירות גיבוי"
            value={v.backupFrequency}
            onChange={(e) => setV({ ...v, backupFrequency: e.target.value as 'daily' | 'weekly' })}
          >
            <option value="daily">יומי</option>
            <option value="weekly">שבועי</option>
          </SelectField>
          <Field
            label="כיתות לפי הסדר, מופרדות בפסיק (האחרונה מסיימת)"
            value={v.grades}
            onChange={(e) => setV({ ...v, grades: e.target.value })}
            error={fe.grades}
          />
          {sibChanged && (
            <p className="mu" style={{ gridColumn: '1 / -1' }}>
              שינוי אחוזי הנחת האחים יחשב מחדש את ההנחה לכל המשפחות בשנה הפעילה, בשורות ביטול ושורות חדשות.
            </p>
          )}
        </>
      )}
    </FormModal>
  );
}

// ---------- integrations ----------

export function Integrations() {
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<IntegrationRow | null>(null);
  const [disconnecting, setDisconnecting] = useState<IntegrationRow | null>(null);
  const [result, setResult] = useState<{ title: string; text: string } | null>(null);
  const list = useQuery({
    queryKey: ['integrations'],
    queryFn: () => get<{ integrations: IntegrationRow[] }>('/api/settings/integrations'),
  });
  const reload = () => qc.invalidateQueries({ queryKey: ['integrations'] });
  return (
    <>
      <div className="card tw">
        <table>
          <thead>
            <tr>
              <th>שירות</th>
              <th>סטטוס</th>
              <th>פרטים</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.data?.integrations.map((x) => (
              <tr key={x.key}>
                <td>{x.name}</td>
                <td>
                  <span className={`pill ${x.connected ? 'g' : 'gr'}`}>
                    {x.connected ? 'מחובר' : 'לא מחובר'}
                  </span>
                </td>
                <td>
                  {x.details}
                  <div className="mu">פועל כעת: {x.provider}</div>
                </td>
                <td>
                  <button
                    className="b s sm"
                    type="button"
                    onClick={async () => {
                      try {
                        const r = await post<{ ok: boolean; messageHe: string }>(
                          `/api/settings/integrations/${x.key}/test`,
                        );
                        setResult({ title: r.ok ? 'החיבור תקין' : 'אין חיבור', text: r.messageHe });
                      } catch (e) {
                        toast((e as Error).message);
                      }
                    }}
                  >
                    בדיקת חיבור
                  </button>{' '}
                  <button
                    className="b s sm"
                    type="button"
                    onClick={() => (x.connected ? setDisconnecting(x) : setEditing(x))}
                  >
                    {x.connected ? 'ניתוק' : 'הגדרה'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mu">
          כל השירותים פועלים כרגע עם ספקים מדומים, במצב בדיקה. פרטי החיבור נשמרים מוצפנים, ולא נעשה בהם שימוש
          עד שנבחר ספק אמיתי ותאשר את החיבור.
        </p>
      </div>
      {editing && (
        <IntegrationModal
          x={editing}
          onClose={() => setEditing(null)}
          onDone={async () => {
            await reload();
            setEditing(null);
            setResult({ title: 'החיבור הוגדר', text: 'פרטי החיבור נשמרו מוצפנים, במצב בדיקה.' });
          }}
        />
      )}
      {disconnecting && (
        <Modal
          title={`ניתוק ${disconnecting.name}`}
          onClose={() => setDisconnecting(null)}
          footer={
            <>
              <button
                className="b"
                type="button"
                onClick={async () => {
                  await post(`/api/settings/integrations/${disconnecting.key}/disconnect`);
                  await reload();
                  setDisconnecting(null);
                  toast(`נותק: ${disconnecting.name}`);
                }}
              >
                ניתוק
              </button>
              <button className="b s" type="button" onClick={() => setDisconnecting(null)}>
                ביטול
              </button>
            </>
          }
        >
          <p>לנתק את השירות? פרטי החיבור השמורים יימחקו.</p>
        </Modal>
      )}
      {result && (
        <Modal
          title={result.title}
          onClose={() => setResult(null)}
          footer={
            <button className="b" type="button" onClick={() => setResult(null)}>
              סגירה
            </button>
          }
        >
          <p>{result.text}</p>
        </Modal>
      )}
    </>
  );
}

function IntegrationModal({
  x,
  onClose,
  onDone,
}: {
  x: IntegrationRow;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  return (
    <FormModal
      title={`חיבור ${x.name}`}
      submitLabel="חיבור"
      onCancel={onClose}
      onSubmit={async () => {
        await post(`/api/settings/integrations/${x.key}`, { username, secret, mode: 'test' });
        await onDone();
      }}
    >
      {(fe) => (
        <>
          <Field
            label="מפתח / שם משתמש"
            dir="ltr"
            autoComplete="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            error={fe.username}
          />
          <Field
            label="סוד / סיסמה"
            type="password"
            dir="ltr"
            autoComplete="new-password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            error={fe.secret}
          />
          <SelectField label="מצב" value="test" onChange={() => {}}>
            <option value="test">בדיקה</option>
            <option value="live" disabled>
              ייצור (ייפתח אחרי בחירת ספק אמיתי)
            </option>
          </SelectField>
        </>
      )}
    </FormModal>
  );
}

// ---------- school year ----------

export function SchoolYear() {
  const info = useQuery({ queryKey: ['year'], queryFn: () => get<YearInfo>('/api/settings/year') });
  const [open, setOpen] = useState(false);
  const d = info.data;
  return (
    <div className="card">
      {d && (
        <p>
          שנה פעילה: <b>{d.activeYearName}</b> · תלמידים פעילים: {d.activeStudents} · בוגרים: {d.graduated}
        </p>
      )}
      <button className="b" type="button" onClick={() => setOpen(true)}>
        פתיחת שנת לימודים חדשה
      </button>
      <p className="mu">
        העלאת כיתות, סיום בוגרים ויצירת חיובי שכר לימוד חדשים. היתרות הקודמות נשמרות ועוברות אוטומטית.
      </p>
      {open && <YearModal onClose={() => setOpen(false)} />}
    </div>
  );
}

function YearModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateMoney();
  const qc = useQueryClient();
  const { refresh } = useAuth();
  const [yearName, setYearName] = useState('תשפ״ח');
  const [fee, setFee] = useState<number | null>(990000);
  const [date, setDate] = useState(todayIso());
  const [preview, setPreview] = useState<YearPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const input = () => ({ yearName, tuitionAgorot: fee ?? 0, chargeDate: date });

  if (preview)
    return (
      <Modal
        title="אישור פתיחת שנה"
        onClose={onClose}
        footer={
          <>
            <button
              className="b"
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await post<{ promoted: number; graduated: number }>(
                    '/api/settings/year/open',
                    input(),
                  );
                  await invalidate();
                  await qc.invalidateQueries({ queryKey: ['settings'] });
                  await refresh();
                  toast(`השנה נפתחה: עלו כיתה ${r.promoted} תלמידים, ${r.graduated} סיימו`);
                  onClose();
                } catch (e) {
                  toast((e as Error).message);
                  setBusy(false);
                }
              }}
            >
              אישור והפעלה
            </button>
            <button className="b s" type="button" onClick={onClose}>
              ביטול
            </button>
          </>
        }
      >
        <p>
          שנה: <b>{preview.yearName}</b>
          <br />
          תלמידים שיעלו כיתה: <b>{preview.promoted}</b>
          <br />
          בוגרים (כיתה {preview.graduatingGrade}) שיסומנו כסיימו: <b>{preview.graduating}</b>
          <br />
          חיובי שכר לימוד חדשים: <b>{preview.newCharges}</b> בסך <b>{formatMoney(preview.totalAgorot)}</b>{' '}
          (לפני הנחות אחים)
          <br />
          הנחות אחים צפויות: <b>{formatMoney(preview.siblingDiscountAgorot)}</b>
        </p>
        <p className="mu">יתרות קודמות נשארות ועוברות אוטומטית. בתצוגה הזו עוד לא שונה דבר.</p>
      </Modal>
    );

  return (
    <FormModal
      title="פתיחת שנת לימודים חדשה"
      submitLabel="המשך"
      onCancel={onClose}
      onSubmit={async () => {
        setPreview(await post<YearPreview>('/api/settings/year/preview', input()));
      }}
    >
      {(fe) => (
        <>
          <Field
            label="שם השנה"
            value={yearName}
            onChange={(e) => setYearName(e.target.value)}
            error={fe.yearName}
          />
          <MoneyField
            label="שכר לימוד שנתי לתלמיד (₪)"
            value={fee}
            onChange={setFee}
            error={fe.tuitionAgorot}
          />
          <Field
            label="תאריך חיוב"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            error={fe.chargeDate}
          />
        </>
      )}
    </FormModal>
  );
}
