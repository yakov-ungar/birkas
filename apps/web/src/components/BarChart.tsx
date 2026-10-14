import { useId, useState } from 'react';
import { formatMoney } from '@tuition/shared';

export interface Bar {
  label: string;
  value: number;
}

const short = (a: number) => {
  const n = a / 100;
  return n >= 1000 ? `₪${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : `₪${Math.round(n)}`;
};

/**
 * Single-series column chart (dataviz rules: one axis, columns <= 24px with a 4px rounded
 * cap, value label on the cap in text ink, hover/focus tooltip, and a table view).
 * `colors` is an ordinal ramp for ordered buckets; otherwise one color for every bar.
 */
export function BarChart({
  title,
  bars,
  color = '#2a78d6',
  colors,
}: {
  title: string;
  bars: Bar[];
  color?: string;
  colors?: string[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const id = useId();
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div>
      <div className="row" style={{ marginBottom: 4 }}>
        <b id={id}>{title}</b>
        <button
          type="button"
          className="link spacer"
          onClick={() => setAsTable(!asTable)}
          aria-pressed={asTable}
        >
          {asTable ? 'תצוגת גרף' : 'תצוגת טבלה'}
        </button>
      </div>
      {asTable ? (
        <table style={{ minWidth: 0 }} aria-labelledby={id}>
          <tbody>
            {bars.map((b) => (
              <tr key={b.label}>
                <th scope="row">{b.label}</th>
                <td className="ltr">{formatMoney(b.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="bars" role="list" aria-labelledby={id}>
          {bars.map((b, i) => {
            const h = b.value > 0 ? Math.max(3, (b.value / max) * 100) : 0;
            return (
              <div
                key={b.label}
                className="col"
                role="listitem"
                tabIndex={0}
                aria-label={`${b.label}: ${formatMoney(b.value)}`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              >
                {hover === i && (
                  <div className="tip" role="tooltip">
                    {b.label}
                    <br />
                    <b className="ltr">{formatMoney(b.value)}</b>
                  </div>
                )}
                <div className="plot">
                  <span className="v ltr">{b.value > 0 ? short(b.value) : ''}</span>
                  <div className="bar" style={{ height: `${h}%`, background: colors?.[i] ?? color }} />
                </div>
                <span className="x">{b.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
