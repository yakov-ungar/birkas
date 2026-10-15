import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { HttpError, post } from '../../api/client';
import { Field, FormError } from '../../components/Field';
import { AuthCard } from './AuthCard';

interface InviteInfo {
  name: string;
  email: string;
  minPasswordLength: number;
}

export function InvitePage() {
  // Token comes in the URL fragment, which browsers never send to the server.
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '');
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    history.replaceState(null, '', window.location.pathname);
    if (!token) {
      setErr('קישור ההזמנה חסר או שגוי');
      return;
    }
    post<InviteInfo>('/api/auth/invite/check', { token })
      .then(setInfo)
      .catch((e) => setErr(e instanceof HttpError ? e.message : 'קישור לא תקין'));
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) return setErr('הסיסמאות אינן זהות');
    setBusy(true);
    setErr(null);
    try {
      await post('/api/auth/invite/accept', { token, password: pw });
      setDone(true);
    } catch (e2) {
      setErr(e2 instanceof HttpError ? e2.message : 'השמירה נכשלה');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <AuthCard title="הסיסמה נשמרה">
        <p>כעת אפשר להתחבר. בכניסה הראשונה תתבקשו להגדיר אימות דו-שלבי.</p>
        <Link to="/login">למסך הכניסה</Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="הגדרת סיסמה">
      {info ? (
        <form onSubmit={submit} noValidate>
          <p>
            שלום {info.name}, <span className="ltr">{info.email}</span>
          </p>
          <Field
            label={`סיסמה (לפחות ${info.minPasswordLength} תווים)`}
            type="password"
            autoComplete="new-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            dir="ltr"
          />
          <Field
            label="אימות סיסמה"
            type="password"
            autoComplete="new-password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            dir="ltr"
          />
          <button className="b" type="submit" disabled={busy || !pw || !pw2}>
            שמירה
          </button>
          <FormError message={err} />
        </form>
      ) : (
        <FormError message={err ?? 'בודק את הקישור...'} />
      )}
    </AuthCard>
  );
}
