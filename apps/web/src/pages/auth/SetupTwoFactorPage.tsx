import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { HttpError, post } from '../../api/client';
import { useAuth } from '../../app/auth';
import { Field, FormError } from '../../components/Field';
import { AuthCard } from './AuthCard';

interface Setup {
  qrDataUrl: string;
  secret: string;
}

export function SetupTwoFactorPage() {
  const { me, refresh, logout, loading } = useAuth();
  const nav = useNavigate();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const allowed = me?.stage === 'setup_2fa';

  useEffect(() => {
    if (!allowed || setup) return;
    post<Setup>('/api/auth/2fa/setup')
      .then(setSetup)
      .catch((e) => setErr(e instanceof HttpError ? e.message : 'שגיאה ביצירת הקוד'));
  }, [allowed, setup]);

  if (loading) return null;
  if (!me) return <Navigate to="/login" replace />;
  if (!allowed && !codes) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await post<{ recoveryCodes: string[] }>('/api/auth/2fa/enable', { code });
      setCodes(r.recoveryCodes);
    } catch (e2) {
      setErr(e2 instanceof HttpError ? e2.message : 'האימות נכשל');
    } finally {
      setBusy(false);
    }
  };

  if (codes) {
    return (
      <AuthCard title="האימות הדו-שלבי הוגדר">
        <p>
          אלה <b>קודי השחזור</b> שלך. כל קוד משמש פעם אחת, אם הטלפון אבד או לא זמין. שמרו אותם במקום בטוח. הם
          לא יוצגו שוב.
        </p>
        <div className="codes" aria-label="קודי שחזור">
          {codes.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button
            className="b s"
            type="button"
            onClick={() => void navigator.clipboard?.writeText(codes.join('\n'))}
          >
            העתקה
          </button>
          <button
            className="b"
            type="button"
            onClick={async () => {
              await refresh();
              nav('/', { replace: true });
            }}
          >
            שמרתי, המשך למערכת
          </button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="הגדרת אימות דו-שלבי">
      <p className="mu">
        בית הספר מחייב אימות דו-שלבי. סרקו את הקוד באפליקציית אימות (Google Authenticator, Microsoft
        Authenticator או דומה) והזינו את הקוד שמופיע בה.
      </p>
      {setup ? (
        <>
          <img
            className="qr"
            src={setup.qrDataUrl}
            width={220}
            height={220}
            alt="קוד QR להגדרת אפליקציית האימות"
          />
          <details>
            <summary>אי אפשר לסרוק? הזנה ידנית</summary>
            <p>
              מפתח: <code data-testid="totp-secret">{setup.secret}</code>
            </p>
          </details>
        </>
      ) : (
        <p className="mu">טוען...</p>
      )}
      <form onSubmit={submit} noValidate>
        <Field
          label="קוד בן 6 ספרות"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          dir="ltr"
        />
        <button className="b" type="submit" disabled={busy || code.length !== 6 || !setup}>
          אישור והפעלה
        </button>
        <FormError message={err} />
        <button type="button" className="link" onClick={() => void logout()}>
          חזרה למסך הכניסה
        </button>
      </form>
    </AuthCard>
  );
}
