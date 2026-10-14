import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DATED_REPORTS,
  REPORT_BUTTONS,
  type Cell,
  type ColumnKind,
  type Report,
  type ReportKey,
} from '@tuition/shared';
import { download, get } from '../../api/client';
import { Field, SelectField } from '../../components/Field';
import { Money } from '../../components/Money';
import { useToast } from '../../components/Toast';

const fmtDate = (d: string) => d.split('-').reverse().join('/');

function show(v: Cell, kind: ColumnKind) {
  if (v === null || v === '') return '-';
  if (kind === 'money') return <Money a={Number(v)} />;
  if (kind === 'date') return fmtDate(String(v));
  if (kind === 'pct') return `${v}%`;
  return String(v);
}

/** Demo "דוחות": the nine reports plus "transactions by period", each with a CSV export. */
export function ReportsPage() {
  const toast = useToast();
  const [key, setKey] = useState<ReportKey | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [year, setYear] = useState('');
  const dated = !!key && DATED_REPORTS.includes(key);
  const qs = new URLSearchParams({
    ...(dated && from ? { from } : {}),
    ...(dated && to ? { to } : {}),
    ...(key === 'grades' && year ? { year } : {}),
  }).toString();
  const rep = useQuery({
    enabled: !!key,
    queryKey: ['report', key, qs],
    queryFn: () => get<Report>(`/api/reports/${key}${qs ? `?${qs}` : ''}`),
  });
  const r = rep.data;
  return (
    <>
      <h2>דוחות</h2>
      <div className="row">
        {(Object.keys(REPORT_BUTTONS) as ReportKey[]).map((k) => (
          <button
            key={k}
            className={`b${k === key ? '' : ' s'}`}
            type="button"
            aria-pressed={k === key}
            onClick={() => setKey(k)}
          >
            {REPORT_BUTTONS[k]}
          </button>
        ))}
      </div>
      {key && (
        <div className="row">
          {dated && (
            <>
              <Field label="מתאריך" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              <Field label="עד תאריך" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </>
          )}
          {key === 'grades' && r?.years && (
            <SelectField
              label="שנת לימודים"
              value={year || r.filters.year || ''}
              onChange={(e) => setYear(e.target.value)}
            >
              {r.years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </SelectField>
          )}
        </div>
      )}
      {rep.error && <p className="bad">{(rep.error as Error).message}</p>}
      {r && (
        <div className="card">
          <div className="row">
            <b>{r.title}</b>
            <button
              className="b s"
              type="button"
              onClick={() =>
                download(`/api/reports/${r.key}/csv${qs ? `?${qs}` : ''}`, `${r.key}.csv`).catch((e: Error) =>
                  toast(e.message),
                )
              }
            >
              ייצוא לאקסל (CSV)
            </button>
          </div>
          <div className="tw">
            <table>
              <thead>
                <tr>
                  {r.columns.map((c) => (
                    <th key={c.label}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((v, j) => (
                      <td key={j}>{show(v, r.columns[j]!.kind)}</td>
                    ))}
                  </tr>
                ))}
                {!r.rows.length && (
                  <tr>
                    <td colSpan={r.columns.length}>אין נתונים</td>
                  </tr>
                )}
              </tbody>
              {r.totals && (
                <tfoot>
                  <tr>
                    {r.totals.map((v, j) => (
                      <th key={j} scope={j === 0 ? 'row' : undefined}>
                        {j === 0 ? v : v === null ? '' : show(v, r.columns[j]!.kind)}
                      </th>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </>
  );
}
