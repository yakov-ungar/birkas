import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import type { AlertItem } from '@tuition/shared';
import { get } from '../api/client';
import { useDialogs } from '../components/Dialogs';
import { Modal } from '../components/Modal';

export const useAlerts = () =>
  useQuery({
    queryKey: ['alerts'],
    queryFn: () => get<{ alerts: AlertItem[] }>('/api/alerts'),
    refetchInterval: 60_000,
  });

export function AlertList({ alerts, onOpen }: { alerts: AlertItem[]; onOpen: (path: string) => void }) {
  if (!alerts.length) return <div className="mu">אין התראות</div>;
  return (
    <>
      {alerts.map((a, i) => (
        <div
          key={i}
          className={`al ${a.level === 'bad' ? 'bad' : a.level === 'info' ? 'info' : ''}`}
          style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}
        >
          <span>
            <span className="sr-only">
              {a.level === 'bad' ? 'חמור: ' : a.level === 'warn' ? 'אזהרה: ' : 'מידע: '}
            </span>
            {a.text}
          </span>
          <button className="b s sm" type="button" onClick={() => onOpen(a.path)}>
            פתח
          </button>
        </div>
      ))}
    </>
  );
}

export function AlertsButton() {
  const { open, close } = useDialogs();
  const nav = useNavigate();
  const q = useAlerts();
  const alerts = q.data?.alerts ?? [];
  const go = (path: string) => {
    close();
    nav(path);
  };
  return (
    <button
      className="b s"
      type="button"
      aria-label={`התראות (${alerts.length})`}
      onClick={() =>
        open(
          <Modal
            title="התראות"
            onClose={close}
            footer={
              <button className="b s" type="button" onClick={close}>
                סגור
              </button>
            }
          >
            <AlertList alerts={alerts} onOpen={go} />
          </Modal>,
        )
      }
    >
      התראות <span className="bn">{alerts.length}</span>
    </button>
  );
}
