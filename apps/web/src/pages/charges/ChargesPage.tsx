import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CHARGE_TYPES, CHARGE_TYPE_KEYS, type ChargeRow } from '@tuition/shared';
import { get, post } from '../../api/client';
import { useCatalog } from '../../api/hooks';
import { FormError } from '../../components/Field';
import { Money } from '../../components/Money';
import { useDialogs } from '../../components/Dialogs';
import { useToast } from '../../components/Toast';
import {
  AddCatalogModal,
  BulkChargeModal,
  CancelChargeModal,
  ChargeModal,
  DiscountModal,
} from './ChargeModals';

const fmt = (d: string) => d.split('-').reverse().join('/');

export function ChargesPage() {
  const { open } = useDialogs();
  const toast = useToast();
  const qc = useQueryClient();
  const [type, setType] = useState('');
  const charges = useQuery({
    queryKey: ['charges', type],
    queryFn: () => get<{ charges: ChargeRow[] }>(`/api/charges${type ? `?type=${type}` : ''}`),
  });
  const catalog = useCatalog();
  return (
    <>
      <h2>חיובים והנחות</h2>
      <div className="row">
        <button className="b" type="button" onClick={() => open(<BulkChargeModal />)}>
          חיוב קבוצתי
        </button>
        <button className="b s" type="button" onClick={() => open(<ChargeModal />)}>
          חיוב לתלמיד
        </button>
        <button className="b s" type="button" onClick={() => open(<DiscountModal />)}>
          הנחה / מלגה
        </button>
      </div>
      <div className="card">
        <div className="row">
          <b>חיובים אחרונים</b>
          <select aria-label="סוג חיוב" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">כל הסוגים</option>
            {CHARGE_TYPE_KEYS.map((k) => (
              <option key={k} value={k}>
                {CHARGE_TYPES[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>תאריך</th>
                <th>תלמיד</th>
                <th>תיאור</th>
                <th>סוג</th>
                <th>סכום</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {charges.data?.charges.map((c) => (
                <tr key={c.id}>
                  <td>{fmt(c.date)}</td>
                  <td>{c.studentName}</td>
                  <td>
                    {c.description}
                    {c.cancelled && (
                      <span className="pill gr" style={{ marginInlineStart: 6 }}>
                        בוטל
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`pill ${c.amountAgorot < 0 ? 'g' : 'bl'}`}>{CHARGE_TYPES[c.type]}</span>
                  </td>
                  <td>
                    <Money a={c.amountAgorot} />
                  </td>
                  <td>
                    {!c.cancelled && !c.isReversal && c.type !== 'sib' && (
                      <button
                        className="b s sm"
                        type="button"
                        onClick={() => open(<CancelChargeModal id={c.id} description={c.description} />)}
                      >
                        ביטול
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {charges.data && !charges.data.charges.length && (
                <tr>
                  <td colSpan={6}>אין חיובים</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <FormError message={(charges.error as Error | null)?.message} />
      </div>
      <div className="card">
        <div className="row">
          <b>קטלוג חיובים</b>
          <button className="b s sm" type="button" onClick={() => open(<AddCatalogModal />)}>
            פריט חדש
          </button>
        </div>
        <div className="tw">
          <table style={{ minWidth: 0 }}>
            <thead>
              <tr>
                <th>פריט</th>
                <th>סכום ברירת מחדל</th>
                <th>סוג</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {catalog.data?.items.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>
                    <Money a={c.defaultAgorot} />
                  </td>
                  <td>{CHARGE_TYPES[c.type as keyof typeof CHARGE_TYPES]}</td>
                  <td>
                    <button
                      className="b s sm"
                      type="button"
                      onClick={async () => {
                        await post(`/api/catalog/${c.id}/remove`);
                        await qc.invalidateQueries({ queryKey: ['catalog'] });
                        toast(`הפריט "${c.name}" הוסר מהקטלוג`);
                      }}
                    >
                      מחיקה
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
