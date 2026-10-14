import { REQUEST_STATUS, REQUEST_TYPES, type PortalView as View } from '@tuition/shared';
import { Money } from '../../components/Money';
import { fmtDate } from '../../components/format';

export type PortalAction = 'pay' | 'installments' | 'discount' | 'contact' | 'card';

const fmt = (d: string) => d.split('-').reverse().join('/');
const pill = { pending: 'o', approved: 'g', rejected: 'r' } as const;

/** The demo's phone-shaped portal (rPortal). In the staff preview every action is disabled (B8). */
export function PortalScreen({
  v,
  onAction,
  onReceipt,
  onLogout,
}: {
  v: View;
  onAction: (a: PortalAction) => void;
  onReceipt: (id: string) => void;
  onLogout?: () => void;
}) {
  const b = v.balanceAgorot;
  const off = v.readOnly;
  return (
    <div className="phone">
      <div className="ph-h">
        {v.schoolName}
        <br />
        <small>פורטל הורים</small>
      </div>
      <div className="ph-b">
        <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
          <p style={{ margin: 0 }}>שלום {v.parentName}</p>
          {onLogout && (
            <button className="b s sm" type="button" onClick={onLogout}>
              יציאה
            </button>
          )}
        </div>
        <div className="bigbal" aria-live="polite">
          <span>{b > 0 ? 'יתרה לתשלום' : b < 0 ? 'יתרת זכות' : 'אין יתרה לתשלום'}</span>
          <b className={b > 0 ? 'bad' : 'ok'}>
            <Money a={Math.abs(b)} />
          </b>
        </div>
        {v.students.map((s) => (
          <div className="pk" key={s.id}>
            <span>
              {s.fullName} · {s.grade}
            </span>
            <b>
              <Money a={s.balanceAgorot} />
            </b>
          </div>
        ))}
        <div className="pbtn">
          <button className="b" type="button" disabled={off || b <= 0} onClick={() => onAction('pay')}>
            שלם עכשיו
          </button>
          <button className="b s" type="button" disabled={off} onClick={() => onAction('installments')}>
            בקשת פריסה
          </button>
          <button className="b s" type="button" disabled={off} onClick={() => onAction('discount')}>
            בקשת הנחה
          </button>
          <button className="b s" type="button" disabled={off} onClick={() => onAction('contact')}>
            עדכון פרטי קשר
          </button>
        </div>

        <h4>תנועות אחרונות</h4>
        {v.recent.length ? (
          v.recent.map((r, i) => (
            <div className="pk" key={i}>
              <span>
                {fmt(r.date)} · {r.description}
              </span>
              <b>{r.debitAgorot ? <Money a={r.debitAgorot} /> : <Money a={-r.creditAgorot} />}</b>
            </div>
          ))
        ) : (
          <div className="mu">אין תנועות</div>
        )}

        <h4>קבלות</h4>
        {v.receipts.length ? (
          v.receipts.map((r) => (
            <div className="pk" key={r.id}>
              <span>
                קבלה {r.number} · {fmt(r.date)}
              </span>
              <button className="b s sm" type="button" disabled={off} onClick={() => onReceipt(r.id)}>
                צפייה
              </button>
            </div>
          ))
        ) : (
          <div className="mu">אין קבלות</div>
        )}

        <h4>כרטיסי אשראי</h4>
        {v.cards.map((c) => (
          <div className="pk" key={c.id}>
            <span>
              {c.brand} ****{c.last4} · {c.studentName}
            </span>
            <span className={c.expired ? 'bad' : 'mu'}>{c.expired ? 'פג תוקף' : c.exp}</span>
          </div>
        ))}
        {!v.cards.length && <div className="mu">אין כרטיס שמור</div>}
        <button
          className="b s sm"
          type="button"
          disabled={off}
          style={{ marginTop: 8 }}
          onClick={() => onAction('card')}
        >
          הוספת כרטיס
        </button>

        {v.requests.length > 0 && (
          <>
            <h4>הבקשות שלי</h4>
            {v.requests.map((r) => (
              <div className="pk" key={r.id}>
                <span>
                  {fmtDate(r.createdAt)} · {REQUEST_TYPES[r.type]} · {r.detailsText}
                  {r.rejectReason && <div className="mu">סיבת דחייה: {r.rejectReason}</div>}
                </span>
                <span className={`pill ${pill[r.status]}`}>{REQUEST_STATUS[r.status]}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
