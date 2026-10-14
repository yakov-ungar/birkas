import type { LedgerRow } from '@tuition/shared';
import { Money } from '../../components/Money';

const fmt = (d: string) => d.split('-').reverse().join('/');

export function LedgerTable({ rows, showStudent }: { rows: LedgerRow[]; showStudent?: boolean }) {
  return (
    <div className="tw" style={{ maxHeight: 300, overflow: 'auto' }}>
      <table style={{ minWidth: 0 }}>
        <thead>
          <tr>
            <th>תאריך</th>
            {showStudent && <th>תלמיד</th>}
            <th>תיאור</th>
            <th>חיוב</th>
            <th>זיכוי / תשלום</th>
            <th>יתרה</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{fmt(r.date)}</td>
              {showStudent && <td>{r.studentName}</td>}
              <td>
                {r.description}
                {r.cancelled && (
                  <span className="pill gr" style={{ marginInlineStart: 6 }}>
                    בוטל
                  </span>
                )}
              </td>
              <td>{r.debitAgorot ? <Money a={r.debitAgorot} /> : ''}</td>
              <td>{r.creditAgorot ? <Money a={r.creditAgorot} /> : ''}</td>
              <td>
                <Money a={r.balanceAgorot} />
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={showStudent ? 6 : 5}>אין תנועות</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
