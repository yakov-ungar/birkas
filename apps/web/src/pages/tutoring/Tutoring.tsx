import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { monthLabel, type TutorRow, type TutoringRow } from '@tuition/shared';
import { get, patch, post, api } from '../../api/client';
import { useInvalidateMoney } from '../../api/hooks';
import { useAuth } from '../../app/auth';
import { Field, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { Money, MoneyField } from '../../components/Money';
import { useDialogs } from '../../components/Dialogs';
import { useToast } from '../../components/Toast';
import { FormModal } from '../families/StudentActions';

const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
const fmt = (d: string) => d.split('-').reverse().join('/');

export const useTutors = () =>
  useQuery({
    queryKey: ['tutors'],
    queryFn: () => get<{ tutors: TutorRow[]; subjects: string[] }>('/api/tutors'),
  });

const useLessons = (studentId: string) =>
  useQuery({
    queryKey: ['tutoring', studentId],
    queryFn: () => get<{ lessons: TutoringRow[] }>(`/api/tutoring?studentId=${studentId}`),
  });

/** "שיעורים פרטיים" in the student card: lessons with an אברך, charged at the end of every month. */
export function StudentTutoring({ studentId, back }: { studentId: string; back: React.ReactNode }) {
  const { has } = useAuth();
  const { open } = useDialogs();
  const q = useLessons(studentId);
  const lessons = q.data?.lessons ?? [];
  return (
    <>
      <h4>שיעורים פרטיים</h4>
      {lessons.length ? (
        lessons.map((l) => (
          <div className="chk" key={l.id}>
            {l.subject} · {l.tutorName} · <Money a={l.priceAgorot} /> לחודש · מ-{fmt(l.startDate)}
            {l.endDate ? (
              <span className="pill gr">הסתיים {fmt(l.endDate)}</span>
            ) : (
              <span className="pill g">פעיל</span>
            )}
            {l.chargedMonths.length > 0 && (
              <span className="mu"> חויב: {l.chargedMonths.map(monthLabel).join(', ')}</span>
            )}
            {!l.endDate && has('charges') && (
              <button
                className="b s sm"
                type="button"
                onClick={() => open(<EndLessonModal lesson={l} after={back} />)}
              >
                סיום
              </button>
            )}
          </div>
        ))
      ) : (
        <div className="mu">אין שיעורים פרטיים</div>
      )}
      {has('charges') && (
        <button
          className="b s sm"
          type="button"
          style={{ marginTop: 6 }}
          onClick={() => open(<AddLessonModal studentId={studentId} after={back} />)}
        >
          הוספת שיעור פרטי
        </button>
      )}
    </>
  );
}

export function AddLessonModal({ studentId, after }: { studentId: string; after: React.ReactNode }) {
  const { open } = useDialogs();
  const toast = useToast();
  const qc = useQueryClient();
  const t = useTutors();
  const active = (t.data?.tutors ?? []).filter((x) => x.active);
  const [tutorId, setTutorId] = useState('');
  const [subject, setSubject] = useState('');
  const [price, setPrice] = useState<number | null>(null);
  const [startDate, setStartDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const done = () => open(after);
  return (
    <FormModal
      title="הוספת שיעור פרטי"
      submitLabel="הוספה"
      onCancel={done}
      onSubmit={async () => {
        await post('/api/tutoring', {
          studentId,
          tutorId: tutorId || active[0]?.id,
          subject: subject || t.data?.subjects[0],
          priceAgorot: price ?? 0,
          startDate,
          ...(note.trim() ? { note: note.trim() } : {}),
        });
        await qc.invalidateQueries({ queryKey: ['tutoring'] });
        await qc.invalidateQueries({ queryKey: ['tutors'] });
        toast('השיעור נוסף. החיוב יתבצע בסוף כל חודש');
        done();
      }}
    >
      {(fe) =>
        t.data && !active.length ? (
          <p className="bad" style={{ gridColumn: '1 / -1' }}>
            אין אברכים פעילים. מוסיפים אברכים בהגדרות ← שיעורים פרטיים.
          </p>
        ) : (
          <>
            <SelectField label="אברך" value={tutorId} onChange={(e) => setTutorId(e.target.value)}>
              {active.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="מקצוע"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              error={fe.subject}
            >
              {(t.data?.subjects ?? []).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </SelectField>
            <MoneyField label="מחיר לחודש (₪)" value={price} onChange={setPrice} error={fe.priceAgorot} />
            <Field
              label="מתחיל בתאריך"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              error={fe.startDate}
            />
            <Field
              label="הערה (לא חובה)"
              value={note}
              maxLength={200}
              onChange={(e) => setNote(e.target.value)}
            />
            <p className="mu" style={{ gridColumn: '1 / -1' }}>
              החיוב בסוף כל חודש, במחיר החודשי המלא, ויופיע בקבלה כשורה נפרדת "שיעור פרטי".
            </p>
          </>
        )
      }
    </FormModal>
  );
}

function EndLessonModal({ lesson, after }: { lesson: TutoringRow; after: React.ReactNode }) {
  const { open } = useDialogs();
  const qc = useQueryClient();
  const invalidate = useInvalidateMoney();
  const [endDate, setEndDate] = useState(todayIso());
  return (
    <FormModal
      title={`סיום שיעור פרטי - ${lesson.subject}`}
      submitLabel="סיום השיעור"
      onCancel={() => open(after)}
      onSubmit={async () => {
        await post(`/api/tutoring/${lesson.id}/end`, { endDate });
        await qc.invalidateQueries({ queryKey: ['tutoring'] });
        await invalidate();
        open(after);
      }}
    >
      {(fe) => (
        <>
          <Field
            label="תאריך סיום"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            error={fe.endDate}
          />
          <p className="mu" style={{ gridColumn: '1 / -1' }}>
            החודש של תאריך הסיום עדיין יחויב במלואו. מהחודש הבא לא יהיו חיובים.
          </p>
        </>
      )}
    </FormModal>
  );
}

// ---------- settings tab ----------

/** Settings → שיעורים פרטיים: the subject list and the אברכים. */
export function TutoringSettings() {
  const toast = useToast();
  const qc = useQueryClient();
  const t = useTutors();
  const [editing, setEditing] = useState<TutorRow | 'new' | null>(null);
  const [subjects, setSubjects] = useState<string | null>(null);
  const reload = () => qc.invalidateQueries({ queryKey: ['tutors'] });
  const list = subjects ?? (t.data?.subjects ?? []).join(', ');
  return (
    <>
      <div className="card">
        <b>מקצועות</b>
        <div className="row">
          <Field
            label="רשימת המקצועות, מופרדים בפסיק"
            value={list}
            onChange={(e) => setSubjects(e.target.value)}
          />
          <button
            className="b"
            type="button"
            onClick={async () => {
              try {
                await api('PUT', '/api/settings/tutor-subjects', {
                  tutorSubjects: list
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                });
                setSubjects(null);
                await reload();
                toast('רשימת המקצועות נשמרה');
              } catch (e) {
                toast((e as Error).message);
              }
            }}
          >
            שמירת מקצועות
          </button>
        </div>
      </div>
      <div className="card tw">
        <div className="row">
          <b>אברכים</b>
          <button className="b s sm" type="button" onClick={() => setEditing('new')}>
            אברך חדש
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>שם</th>
              <th>טלפון</th>
              <th>תלמידים פעילים</th>
              <th>סטטוס</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {t.data?.tutors.map((x) => (
              <tr key={x.id}>
                <td>{x.name}</td>
                <td className="ltr">{x.phone || '-'}</td>
                <td>{x.activeStudents}</td>
                <td>
                  <span className={`pill ${x.active ? 'g' : 'gr'}`}>{x.active ? 'פעיל' : 'לא פעיל'}</span>
                </td>
                <td>
                  <button className="b s sm" type="button" onClick={() => setEditing(x)}>
                    עריכה
                  </button>
                </td>
              </tr>
            ))}
            {t.data && !t.data.tutors.length && (
              <tr>
                <td colSpan={5}>עוד לא הוגדרו אברכים</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && <TutorModal tutor={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function TutorModal({ tutor, onClose }: { tutor: TutorRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(tutor?.name ?? '');
  const [phone, setPhone] = useState(tutor?.phone ?? '');
  const [active, setActive] = useState(tutor?.active ?? true);
  return (
    <Modal
      title={tutor ? `עריכת אברך - ${tutor.name}` : 'אברך חדש'}
      onClose={onClose}
      footer={
        <>
          <button
            className="b"
            type="button"
            onClick={async () => {
              try {
                if (tutor) await patch(`/api/tutors/${tutor.id}`, { name, phone, active });
                else await post('/api/tutors', { name, phone });
                await qc.invalidateQueries({ queryKey: ['tutors'] });
                toast('נשמר');
                onClose();
              } catch (e) {
                toast((e as Error).message);
              }
            }}
          >
            שמירה
          </button>
          <button className="b s" type="button" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <Field label="שם האברך" value={name} onChange={(e) => setName(e.target.value)} />
      <Field label="טלפון (לא חובה)" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
      {tutor && (
        <label className="chk">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> פעיל
        </label>
      )}
    </Modal>
  );
}
