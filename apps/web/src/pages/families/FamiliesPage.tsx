import { useEffect, useState } from 'react';
import { STUDENT_STATUS } from '@tuition/shared';
import { useAuth } from '../../app/auth';
import { useFamilies, useStudents } from '../../api/hooks';
import { useGrades } from '../../api/grades';
import { FormError } from '../../components/Field';
import { Money } from '../../components/Money';
import { Tabs } from '../../components/Tabs';
import { useDialogs } from '../../components/Dialogs';
import { rowButton } from '../../components/format';
import { StudentModal } from './StudentModal';
import { FamilyModal } from './FamilyModal';
import { AddStudentModal } from './StudentActions';
import { ImportModal } from './ImportModal';
import { PAY_STATUS } from './labels';
import { PromiseText } from '../collection/CollectionModals';

export function FamiliesPage() {
  const { has } = useAuth();
  const { open } = useDialogs();
  const [tab, setTab] = useState('stu');
  return (
    <>
      <h2>תלמידים ומשפחות</h2>
      {has('stu_edit') && (
        <div className="row">
          <button className="b" type="button" onClick={() => open(<AddStudentModal />)}>
            תלמיד חדש
          </button>
          <button className="b s" type="button" onClick={() => open(<ImportModal />)}>
            ייבוא מאקסל
          </button>
        </div>
      )}
      <Tabs
        label="תלמידים ומשפחות"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'stu', label: 'תלמידים', content: <StudentsTab /> },
          { id: 'fams', label: 'משפחות', content: <FamiliesTab /> },
        ]}
      />
    </>
  );
}

function StudentsTab() {
  const { open } = useDialogs();
  const grades = useGrades();
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [grade, setGrade] = useState('');
  const [filter, setFilter] = useState('act');
  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 250);
    return () => clearTimeout(t);
  }, [input]);
  const params = new URLSearchParams({ filter, ...(q ? { q } : {}), ...(grade ? { grade } : {}) }).toString();
  const list = useStudents(params);
  return (
    <>
      <div className="row">
        <input
          placeholder="חיפוש תלמיד, הורה או טלפון"
          aria-label="חיפוש"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <select aria-label="כיתה" value={grade} onChange={(e) => setGrade(e.target.value)}>
          <option value="">כל הכיתות</option>
          {grades.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
        <select aria-label="סינון" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="act">פעילים</option>
          <option value="debt">חייבים בלבד</option>
          <option value="all">כולם</option>
          <option value="out">עזבו / סיימו</option>
        </select>
      </div>
      <div className="card tw">
        <table>
          <thead>
            <tr>
              <th>תלמיד</th>
              <th>כיתה</th>
              <th>הורה</th>
              <th>חויב נטו</th>
              <th>שולם</th>
              <th>יתרה</th>
              <th>סטטוס</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.students.map((s) => (
              <tr
                key={s.id}
                {...rowButton(() => open(<StudentModal id={s.id} />))}
                aria-label={`כרטיס תלמיד ${s.fullName}`}
              >
                <td>{s.fullName}</td>
                <td>{s.grade}</td>
                <td>{s.parentName}</td>
                <td>
                  <Money a={s.netChargedAgorot} />
                </td>
                <td>
                  <Money a={s.paidAgorot} />
                </td>
                <td>
                  <Money a={s.balanceAgorot} />
                </td>
                <td>
                  {s.payStatus === 'inactive' ? (
                    <span className="pill gr">{STUDENT_STATUS[s.status]}</span>
                  ) : (
                    <span className={`pill ${PAY_STATUS[s.payStatus]![1]}`}>
                      {PAY_STATUS[s.payStatus]![0]}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {list.data && !list.data.students.length && (
              <tr>
                <td colSpan={7}>לא נמצאו תלמידים</td>
              </tr>
            )}
          </tbody>
        </table>
        <FormError message={(list.error as Error | null)?.message} />
      </div>
      <p className="mu">
        לחיצה על תלמיד פותחת כרטיס תלמיד: ספר חשבון, כרטיסי אשראי שמורים, תוכניות חיוב והערות.
      </p>
    </>
  );
}

function FamiliesTab() {
  const { open } = useDialogs();
  const list = useFamilies();
  return (
    <div className="card tw">
      <table>
        <thead>
          <tr>
            <th>משפחה</th>
            <th>הורה</th>
            <th>טלפון</th>
            <th>ילדים</th>
            <th>יתרה</th>
            <th>גיל חוב</th>
            <th>הבטחת תשלום</th>
            <th>קשר אחרון</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.families.map((f) => (
            <tr
              key={f.id}
              {...rowButton(() => open(<FamilyModal id={f.id} />))}
              aria-label={`כרטיס ${f.name}`}
            >
              <td>{f.name}</td>
              <td>{f.parentName}</td>
              <td className="ltr">{f.phone}</td>
              <td>{f.childCount}</td>
              <td>
                <Money a={f.balanceAgorot} />
              </td>
              <td>{f.agingLabel}</td>
              <td>{f.promise ? <PromiseText p={f.promise} /> : '-'}</td>
              <td>{f.lastContact ? f.lastContact.split('-').reverse().join('/') : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
