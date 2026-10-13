import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { HttpError, post } from '../../api/client';
import { useAuth } from '../../app/auth';
import { Field, FormError } from '../../components/Field';
import { AuthCard } from './AuthCard';
import { stagePath } from './LoginPage';

export function TwoFactorPage() {
  const { me, refresh, logout, loading } = useAuth();
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return null;
  if (!me) return <Navigate to="/login" replace />;
  if (me.stage !== 'pending_2fa') return <Navigate to={stagePath(me.stage)} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await post('/api/auth/2fa/verify', { code });
      await refresh();
      nav('/', { replace: true });
    } catch (e2) {
      setErr(e2 instanceof HttpError ? e2.message : 'האימות נכשל');
      if (e2 instanceof HttpError && e2.status === 423) await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title="אימות דו-שלבי">
      <form onSubmit={submit} noValidate>
        {useRecovery ? (
          <Field
            label="קוד שחזור"
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            dir="ltr"
            placeholder="XXXXX-XXXXX"
          />
        ) : (
          <Field
            label="קוד בן 6 ספרות מאפליקציית האימות"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            dir="ltr"
          />
        )}
        <button className="b" type="submit" disabled={busy || code.length < 6}>
          אימות
        </button>
        <FormError message={err} />
        <div className="row">
          <button
            type="button"
            className="link"
            onClick={() => {
              setUseRecovery(!useRecovery);
              setCode('');
            }}
          >
            {useRecovery ? 'שימוש בקוד מהאפליקציה' : 'אין גישה לטלפון? שימוש בקוד שחזור'}
          </button>
          <button type="button" className="link spacer" onClick={() => void logout()}>
            חזרה למסך הכניסה
          </button>
        </div>
      </form>
    </AuthCard>
  );
}
