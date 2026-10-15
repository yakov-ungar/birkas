import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import type { SessionStage } from '@tuition/shared';
import { HttpError, post } from '../../api/client';
import { useAuth } from '../../app/auth';
import { Field, FormError } from '../../components/Field';
import { AuthCard } from './AuthCard';

export const stagePath = (s: SessionStage) =>
  s === 'pending_2fa' ? '/login/2fa' : s === 'setup_2fa' ? '/login/setup-2fa' : '/';

export function LoginPage() {
  const { me, refresh, notice } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me) return <Navigate to={stagePath(me.stage)} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await post<{ stage: SessionStage }>('/api/auth/login', { email, password });
      await refresh();
      nav(stagePath(r.stage), { replace: true });
    } catch (e2) {
      setErr(e2 instanceof HttpError ? e2.message : 'ההתחברות נכשלה');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title="כניסה למערכת הגבייה">
      {notice && <p className="al info">{notice}</p>}
      <form onSubmit={submit} noValidate>
        <Field
          label="אימייל"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          dir="ltr"
        />
        <Field
          label="סיסמה"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          dir="ltr"
        />
        <button className="b" type="submit" disabled={busy || !email || !password}>
          {busy ? 'מתחבר...' : 'כניסה'}
        </button>
        <FormError message={err} />
      </form>
    </AuthCard>
  );
}
