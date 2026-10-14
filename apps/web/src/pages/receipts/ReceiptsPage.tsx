import { useQuery } from '@tanstack/react-query';
import type { ReceiptRow } from '@tuition/shared';
import { get } from '../../api/client';
import { useAuth } from '../../app/auth';
import { useDialogs } from '../../components/Dialogs';
import { Money } from '../../components/Money';
import { FormError } from '../../components/Field';
import { PaymentFlow } from '../payments/PaymentFlow';
import { ReceiptModal } from './ReceiptModal';

const fmt = (d: string) => d.split('-').reverse().join('/');

export function TypePill({ r }: { r: ReceiptRow }) {
  if (r.docType === 'credit_note') return <span className="pill o">זיכוי</span>;
  if (r.docType === 'refund') return <span className="pill o">החזר</span>;
  if (r.cancelled) return <span className="pill r">מבוטלת</span>;
  return <span className="pill g">קבלה</span>;
}

export function ReceiptsPage() {
  const { has } = useAuth();
  const { open } = useDialogs();
  const q = useQuery({
    queryKey: ['receipts'],
    queryFn: () => get<{ receipts: ReceiptRow[] }>('/api/receipts'),
  });
  return (
    <>
      <h2>קבלות וזיכויים</h2>
      {has('pay') && (
        <div className="row">
          <button className="b" type="button" onClick={() => open(<PaymentFlow />)}>
            קבלת תשלום והפקת קבלה
          </button>
        </div>
      )}
      <div className="card tw">
        <table>
          <thead>
            <tr>
              <th>מס׳</th>
              <th>תאריך</th>
              <th>על שם</th>
              <th>סכום</th>
              <th>סוג</th>
              <th>נשלחה</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {q.data?.receipts.map((r) => (
              <tr key={r.id}>
                <td>{r.number}</td>
                <td>{fmt(r.date)}</td>
                <td>{r.payerName}</td>
                <td>
                  <Money a={r.docType === 'receipt' ? r.amountAgorot : -r.amountAgorot} />
                </td>
                <td>
                  <TypePill r={r} />
                </td>
                <td>{r.sentAt ? 'כן' : 'לא'}</td>
                <td>
                  <button className="b s sm" type="button" onClick={() => open(<ReceiptModal id={r.id} />)}>
                    צפייה והדפסה
                  </button>
                </td>
              </tr>
            ))}
            {q.data && !q.data.receipts.length && (
              <tr>
                <td colSpan={7}>אין קבלות</td>
              </tr>
            )}
          </tbody>
        </table>
        <FormError message={(q.error as Error | null)?.message} />
      </div>
    </>
  );
}
