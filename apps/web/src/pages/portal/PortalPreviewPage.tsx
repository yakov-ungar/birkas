import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PortalView } from '@tuition/shared';
import { get } from '../../api/client';
import { SelectField } from '../../components/Field';
import { PortalScreen } from './PortalView';

/** Demo "פורטל הורים (תצוגה)". Read only (decision B8): staff take payments in the regular payment screen. */
export function PortalPreviewPage() {
  const fams = useQuery({
    queryKey: ['portal-preview-families'],
    queryFn: () =>
      get<{ families: { id: string; name: string; parentName: string }[] }>('/api/portal-preview/families'),
  });
  const [id, setId] = useState('');
  useEffect(() => {
    if (!id && fams.data?.families[0]) setId(fams.data.families[0].id);
  }, [fams.data, id]);
  const view = useQuery({
    enabled: !!id,
    queryKey: ['portal-preview', id],
    queryFn: () => get<PortalView>(`/api/portal-preview/${id}`),
  });
  return (
    <>
      <h2>פורטל הורים (תצוגה מקדימה)</h2>
      <div className="row">
        <SelectField label="הצג כהורה" value={id} onChange={(e) => setId(e.target.value)}>
          {fams.data?.families.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} - {f.parentName}
            </option>
          ))}
        </SelectField>
        <span className="mu">כך נראה הפורטל להורה. בתצוגה זו הכפתורים מושבתים ולא מתבצעות פעולות.</span>
      </div>
      {view.data && <PortalScreen v={view.data} onAction={() => {}} onReceipt={() => {}} />}
      {fams.data && !fams.data.families.length && <p className="mu">אין משפחות עם תלמידים</p>}
    </>
  );
}
