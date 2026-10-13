import { useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { AuditRow } from '@tuition/shared';
import { download, get } from '../../api/client';
import { useToast } from '../../components/Toast';
import { fmtDateTime } from '../../components/format';

type Page = { rows: (AuditRow & { seq: number })[]; nextBeforeSeq: number | null };

export function AuditLogCard() {
  const toast = useToast();
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 300);
    return () => clearTimeout(t);
  }, [input]);

  const log = useInfiniteQuery({
    queryKey: ['audit', q],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ limit: '40' });
      if (q) p.set('q', q);
      if (pageParam) p.set('beforeSeq', String(pageParam));
      return get<Page>(`/api/audit?${p}`);
    },
    getNextPageParam: (last) => last.nextBeforeSeq,
  });
  const rows = log.data?.pages.flatMap((p) => p.rows) ?? [];

  return (
    <div className="card">
      <div className="row">
        <b>יומן פעולות</b>
        <input
          placeholder="סינון לפי טקסט"
          aria-label="סינון יומן"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button
          className="b s sm"
          type="button"
          onClick={() =>
            download(`/api/audit/export${q ? `?q=${encodeURIComponent(q)}` : ''}`, 'audit-log.csv').catch(
              (e: Error) => toast(e.message),
            )
          }
        >
          ייצוא
        </button>
      </div>
      <div aria-live="polite">
        {rows.map((r) => (
          <div key={r.id} className="log-line">
            <span className="mu">{fmtDateTime(r.at)}</span> · {r.actor}: {r.summary}
          </div>
        ))}
        {!log.isLoading && !rows.length && <div className="mu">אין רישומים</div>}
      </div>
      {log.hasNextPage && (
        <button
          className="b s sm"
          type="button"
          style={{ marginTop: 8 }}
          onClick={() => void log.fetchNextPage()}
          disabled={log.isFetchingNextPage}
        >
          טען עוד
        </button>
      )}
    </div>
  );
}
