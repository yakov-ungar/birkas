import { useState } from 'react';
import type { ImportReport } from '@tuition/shared';
import { post } from '../../api/client';
import { useInvalidateMoney } from '../../api/hooks';
import { FormError } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { MoneyField } from '../../components/Money';
import { useDialogs } from '../../components/Dialogs';

const toBase64 = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] ?? '');
    r.onerror = () => rej(new Error('לא ניתן לקרוא את הקובץ'));
    r.readAsDataURL(f);
  });

function downloadRejected(rep: ImportReport) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv =
    '﻿' +
    [['שורה', 'סיבה', 'ערכים'], ...rep.rejected.map((r) => [r.row, r.reason, r.values])]
      .map((r) => r.map(esc).join(','))
      .join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'rejected-rows.csv';
  a.click();
}

export function ImportModal() {
  const { close } = useDialogs();
  const invalidate = useInvalidateMoney();
  const [file, setFile] = useState<File | null>(null);
  const [fee, setFee] = useState<number | null>(960000);
  const [rep, setRep] = useState<ImportReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (rep) {
    return (
      <Modal
        title="הייבוא הסתיים"
        onClose={close}
        footer={
          <>
            {rep.rejected.length > 0 && (
              <button className="b s" type="button" onClick={() => downloadRejected(rep)}>
                הורדת השורות שנדחו
              </button>
            )}
            <button className="b s" type="button" onClick={close}>
              סגור
            </button>
          </>
        }
      >
        <p>
          נקלטו {rep.imported} תלמידים ו-{rep.newFamilies} משפחות חדשות. {rep.rejected.length} שורות נדחו.
        </p>
        {rep.rejected.length > 0 && (
          <div className="tw" style={{ maxHeight: 260, overflow: 'auto' }}>
            <table style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <th>שורה</th>
                  <th>סיבה</th>
                </tr>
              </thead>
              <tbody>
                {rep.rejected.map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    );
  }

  return (
    <Modal
      title="ייבוא תלמידים מקובץ"
      onClose={close}
      footer={
        <>
          <button
            className="b"
            type="button"
            disabled={!file || busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                const r = await post<ImportReport>('/api/students/import', {
                  fileName: file!.name,
                  contentBase64: await toBase64(file!),
                  defaultTuitionAgorot: fee ?? 0,
                });
                await invalidate();
                setRep(r);
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'קורא את הקובץ...' : 'ייבוא'}
          </button>
          <button className="b s" type="button" onClick={close}>
            ביטול
          </button>
        </>
      }
    >
      <p className="mu">
        קובץ xlsx או csv עם שורת כותרות. עמודות חובה: <b>שם תלמיד, כיתה, שם הורה, טלפון</b>. רשות: אימייל,
        כתובת, שכר לימוד. תלמידים עם אותו טלפון נכנסים לאותה משפחה.
      </p>
      <label className="field">
        קובץ
        <input type="file" accept=".xlsx,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <MoneyField label="שכר לימוד לשורות בלי סכום (₪)" value={fee} onChange={setFee} />
      <FormError message={err} />
    </Modal>
  );
}
