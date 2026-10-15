import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import type { Permission } from '@tuition/shared';
import { useAuth } from './auth';

export function RequireStaff({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading)
    return (
      <p className="mu" style={{ padding: 20 }}>
        טוען...
      </p>
    );
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (me.stage === 'pending_2fa') return <Navigate to="/login/2fa" replace />;
  if (me.stage === 'setup_2fa') return <Navigate to="/login/setup-2fa" replace />;
  return <>{children}</>;
}

/** Client-side only, for convenience: the server enforces every permission on its own. */
export function RequirePerm({ perm, children }: { perm?: Permission; children: ReactNode }) {
  const { has } = useAuth();
  if (perm && !has(perm)) {
    return (
      <div className="card placeholder">
        <h2>אין הרשאה</h2>
        <p className="mu">אין לך הרשאה לפתוח מסך זה. לבקשת הרשאה פנו למנהל המערכת.</p>
      </div>
    );
  }
  return <>{children}</>;
}
