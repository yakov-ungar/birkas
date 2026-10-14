import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PortalLoginStart, PortalMe } from '@tuition/shared';
import { HttpError, get, post, setCsrf } from '../../api/client';
import { Field, FormError } from '../../components/Field';
import { DialogProvider, useDialogs } from '../../components/Dialogs';
import { ToastProvider } from '../../components/Toast';
import { PortalScreen, type PortalAction } from './PortalView';
import { AddCard, ContactRequest, DiscountRequest, InstallmentsRequest, PortalPay } from './PortalModals';

const linkToken = () => new URLSearchParams(window.location.search).get('t');

/**
 * The parent portal, mounted on its own (no staff AuthProvider): the parent cookie and CSRF
 * token never mix with a staff session in the same browser.
 */
export function PortalApp() {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <DialogProvider>
          <main className="portal-page">
            <Portal />
          </main>
        </DialogProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function Portal() {
  const qc = useQueryClient();
  const { open, close } = useDialogs();
  const [notice, setNotice] = useState<string | null>(null);
  const [triedDevice, setTriedDevice] = useState(false);
  const me = useQuery({
    queryKey: ['portal-me'],
    queryFn: async () => {
      const m = await get<PortalMe>('/api/portal/me');
      setCsrf(m.csrfToken);
      return m;
    },
  });
  const signedOut = me.error instanceof HttpError && me.error.status === 401;

  // A remembered device gets a new session without a code (decision C15).
  useEffect(() => {
    if (!signedOut || triedDevice) return;
    setTriedDevice(true);
    if ((me.error as HttpError).code === 'idle_timeout') setNotice((me.error as Error).message);
    post('/api/portal/login/device')
      .then(() => qc.invalidateQueries({ queryKey: ['portal-me'] }))
      .catch(() => {});
  }, [signedOut, triedDevice, me.error, qc]);

  if (me.isLoading)
    return (
      <p className="mu" style={{ padding: 20 }}>
        טוען...
      </p>
    );
  if (signedOut || !me.data)
    return (
      <Login
        notice={notice}
        onDone={async () => {
          setNotice(null);
          setTriedDevice(false);
          // The link served its purpose; keep it out of the address bar and history.
          if (linkToken()) window.history.replaceState(null, '', '/portal');
          await qc.invalidateQueries({ queryKey: ['portal-me'] });
        }}
      />
    );

  const m = me.data;
  const act = (a: PortalAction) => {
    if (a === 'pay') open(<PortalPay me={m} />);
    else if (a === 'installments') open(<InstallmentsRequest />);
    else if (a === 'discount') open(<DiscountRequest me={m} />);
    else if (a === 'contact') open(<ContactRequest />);
    else open(<AddCard me={m} />);
  };
  return (
    <PortalScreen
      v={m}
      onAction={act}
      onReceipt={(id) => window.open(`/api/portal/receipts/${id}/pdf`, '_blank', 'noopener')}
      onLogout={async () => {
        close();
        await post('/api/portal/logout').catch(() => {});
        setCsrf('');
        setTriedDevice(true);
        qc.setQueryData(['portal-me'], undefined);
        await qc.invalidateQueries({ queryKey: ['portal-me'] });
      }}
    />
  );
}

function Login({ notice, onDone }: { notice: string | null; onDone: () => Promise<void> }) {
  const link = linkToken();
  const [contact, setContact] = useState('');
  const [challenge, setChallenge] = useState<PortalLoginStart | null>(null);
  const [code, setCode] = useState('');
  const [trust, setTrust] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const start = (channel: 'sms' | 'email' = 'sms') =>
    run(async () => {
      setChallenge(
        await post<PortalLoginStart>(
          '/api/portal/login/start',
          link ? { link, channel } : { contact: contact.trim() },
        ),
      );
      setCode('');
    });

  return (
    <div className="phone">
      <div className="ph-h">
        פורטל הורים
        <br />
        <small>כניסה עם קוד חד-פעמי</small>
      </div>
      <div className="ph-b">
        {notice && <p className="bad">{notice}</p>}
        {!challenge ? (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void start();
            }}
          >
            {link ? (
              <>
                <p>נשלח קוד כניסה לטלפון הרשום אצלנו.</p>
                <div className="row">
                  <button className="b" type="submit" disabled={busy}>
                    שליחת קוד ב-SMS
                  </button>
                  <button className="b s" type="button" disabled={busy} onClick={() => void start('email')}>
                    שליחה למייל
                  </button>
                </div>
              </>
            ) : (
              <>
                <Field
                  label="טלפון או מייל הרשומים בבית הספר"
                  dir="ltr"
                  autoComplete="username"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                />
                <button className="b" type="submit" disabled={busy || contact.trim().length < 3}>
                  שליחת קוד
                </button>
              </>
            )}
          </form>
        ) : (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await post('/api/portal/login/verify', {
                  challengeId: challenge.challengeId,
                  code: code.trim(),
                  trustDevice: trust,
                });
                await onDone();
              });
            }}
          >
            <p>
              {challenge.sentTo
                ? `שלחנו קוד בן 6 ספרות אל ${challenge.sentTo}.`
                : 'אם הפרטים רשומים אצלנו, נשלח אליהם קוד בן 6 ספרות.'}{' '}
              הקוד בתוקף 10 דקות.
            </p>
            <Field
              label="קוד כניסה"
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
            <label className="row" style={{ margin: '4px 0 10px' }}>
              <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} /> לזכור את
              המכשיר הזה ל-30 יום
            </label>
            <div className="row">
              <button className="b" type="submit" disabled={busy || code.length !== 6}>
                כניסה
              </button>
              <button className="b s" type="button" disabled={busy} onClick={() => setChallenge(null)}>
                שליחה מחדש
              </button>
            </div>
          </form>
        )}
        <FormError message={err} />
      </div>
    </div>
  );
}
