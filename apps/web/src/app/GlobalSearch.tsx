import { useState, type FormEvent } from 'react';
import { get } from '../api/client';
import { useDialogs } from '../components/Dialogs';
import { Modal } from '../components/Modal';
import { Money } from '../components/Money';
import { StudentModal } from '../pages/families/StudentModal';
import { FamilyModal } from '../pages/families/FamilyModal';
import { ReceiptModal } from '../pages/receipts/ReceiptModal';

interface Results {
  students: { id: string; fullName: string; familyName: string; balanceAgorot: number }[];
  families: { id: string; name: string; parentName: string; phone: string }[];
  receipts: { id: string; number: number; docType: string; amountAgorot: number; payerName: string }[];
}

/** The demo's header search: student, parent, phone or receipt number. */
export function GlobalSearch() {
  const { open, close } = useDialogs();
  const [q, setQ] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (term.length < 2) return;
    const r = await get<Results>(`/api/search?q=${encodeURIComponent(term)}`);
    const empty = !r.students.length && !r.families.length && !r.receipts.length;
    open(
      <Modal
        title={`תוצאות חיפוש: ${term}`}
        onClose={close}
        footer={
          <button className="b s" type="button" onClick={close}>
            סגור
          </button>
        }
      >
        {r.students.length > 0 && <h4>תלמידים</h4>}
        {r.students.map((s) => (
          <div className="chk" key={s.id}>
            <button className="b s sm" type="button" onClick={() => open(<StudentModal id={s.id} />)}>
              {s.fullName}
            </button>{' '}
            {s.familyName} · יתרה <Money a={s.balanceAgorot} />
          </div>
        ))}
        {r.families.length > 0 && <h4>משפחות</h4>}
        {r.families.map((f) => (
          <div className="chk" key={f.id}>
            <button className="b s sm" type="button" onClick={() => open(<FamilyModal id={f.id} />)}>
              {f.name}
            </button>{' '}
            {f.parentName} · <span className="ltr">{f.phone}</span>
          </div>
        ))}
        {r.receipts.length > 0 && <h4>קבלות</h4>}
        {r.receipts.map((x) => (
          <div className="chk" key={x.id}>
            <button className="b s sm" type="button" onClick={() => open(<ReceiptModal id={x.id} />)}>
              קבלה {x.number}
            </button>{' '}
            {x.payerName} · <Money a={x.amountAgorot} />
          </div>
        ))}
        {empty && <p className="mu">לא נמצאו תוצאות</p>}
      </Modal>,
    );
  };
  return (
    <form className="row" style={{ margin: 0, gap: 6 }} onSubmit={(e) => void submit(e)} role="search">
      <input
        type="search"
        placeholder="חיפוש תלמיד, הורה, טלפון או קבלה"
        aria-label="חיפוש כללי"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ width: 260, maxWidth: '100%' }}
      />
      <button className="b s" type="submit">
        חיפוש
      </button>
    </form>
  );
}
