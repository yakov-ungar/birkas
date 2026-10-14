import { useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SavedCardRow } from '@tuition/shared';
import { get, post } from '../../api/client';
import { useInvalidateMoney, useStudents } from '../../api/hooks';
import { FormError, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { useDialogs } from '../../components/Dialogs';
import { useToast } from '../../components/Toast';
import { CardFields, type CardFieldsHandle } from '../payments/CardFields';

const useCards = () =>
  useQuery({
    queryKey: ['cards'],
    queryFn: () => get<{ cards: SavedCardRow[]; hostedFieldsUrl: string }>('/api/cards'),
  });

export function useCardActions() {
  const toast = useToast();
  const invalidate = useInvalidateMoney();
  const run = async (url: string, ok: string) => {
    try {
      await post(url);
      await invalidate();
      toast(ok);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return {
    setDefault: (c: SavedCardRow) =>
      run(`/api/cards/${c.id}/default`, `כרטיס ****${c.last4} הוגדר כברירת מחדל`),
    remove: (c: SavedCardRow) => run(`/api/cards/${c.id}/remove`, `הכרטיס ****${c.last4} הוסר`),
  };
}

export function AddCardModal({ studentId, after }: { studentId?: string; after?: ReactNode }) {
  const { open, close } = useDialogs();
  const students = useStudents('filter=act');
  const cards = useCards();
  const invalidate = useInvalidateMoney();
  const ref = useRef<CardFieldsHandle>(null);
  const [sid, setSid] = useState(studentId ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const done = () => (after ? open(after) : close());
  return (
    <Modal
      title="הוספת כרטיס שמור"
      onClose={done}
      footer={
        <>
          <button
            className="b"
            type="button"
            disabled={busy || !sid}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                const t = await ref.current!.tokenize();
                await post('/api/cards', { studentId: sid, card: t });
                await invalidate();
                open(
                  <Modal
                    title="הכרטיס נשמר"
                    onClose={done}
                    footer={
                      <button className="b s" type="button" onClick={done}>
                        {after ? 'חזרה לכרטיס התלמיד' : 'סגור'}
                      </button>
                    }
                  >
                    <p>נשמר כטוקן בלבד. מספר הכרטיס המלא וה-CVV אינם נשמרים.</p>
                  </Modal>,
                );
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'יוצר טוקן מאובטח אצל חברת הסליקה...' : 'שמירה'}
          </button>
          <button className="b s" type="button" onClick={done}>
            ביטול
          </button>
        </>
      }
    >
      <SelectField label="תלמיד" value={sid} onChange={(e) => setSid(e.target.value)}>
        <option value="">בחירת תלמיד</option>
        {students.data?.students.map((s) => (
          <option key={s.id} value={s.id}>
            {s.fullName}
          </option>
        ))}
      </SelectField>
      {cards.data && <CardFields ref={ref} src={cards.data.hostedFieldsUrl} />}
      <FormError message={err} />
    </Modal>
  );
}

export function CardsPage() {
  const { open } = useDialogs();
  const cards = useCards();
  const actions = useCardActions();
  return (
    <>
      <h2>כרטיסים שמורים</h2>
      <div className="row">
        <button className="b" type="button" onClick={() => open(<AddCardModal />)}>
          הוספת כרטיס
        </button>
      </div>
      <div className="card tw">
        <table>
          <thead>
            <tr>
              <th>תלמיד</th>
              <th>כרטיס</th>
              <th>תוקף</th>
              <th>בעל הכרטיס</th>
              <th>תוכניות מקושרות</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {cards.data?.cards.map((c) => (
              <tr key={c.id}>
                <td>{c.studentName}</td>
                <td>
                  {c.brand} <span className="ltr">****{c.last4}</span>{' '}
                  {c.isDefault && <span className="pill g">ברירת מחדל</span>}
                </td>
                <td>
                  <span className="ltr">{c.exp}</span> {c.expired && <span className="pill r">פג תוקף</span>}
                </td>
                <td>{c.holderName}</td>
                <td>{c.linkedPlans}</td>
                <td>
                  {!c.isDefault && (
                    <button className="b s sm" type="button" onClick={() => void actions.setDefault(c)}>
                      ברירת מחדל
                    </button>
                  )}{' '}
                  <button
                    className="b s sm"
                    type="button"
                    onClick={() => void actions.remove(c)}
                    aria-label={`הסרת כרטיס ****${c.last4}`}
                  >
                    הסר
                  </button>
                </td>
              </tr>
            ))}
            {cards.data && !cards.data.cards.length && (
              <tr>
                <td colSpan={6}>אין כרטיסים שמורים</td>
              </tr>
            )}
          </tbody>
        </table>
        <FormError message={(cards.error as Error | null)?.message} />
      </div>
      <p className="mu">
        נשמר רק טוקן מחברת הסליקה, 4 ספרות אחרונות ותוקף. מספר הכרטיס המלא וה-CVV לא נשמרים במערכת.
      </p>
    </>
  );
}
