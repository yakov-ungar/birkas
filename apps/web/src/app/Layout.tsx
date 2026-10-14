import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from './auth';
import { NAV } from './nav';
import { hebrewDate, weekday, fmtDate } from '../components/format';
import { GlobalSearch } from './GlobalSearch';
import { AlertsButton } from './Alerts';

export function Layout() {
  const { me, has, logout } = useAuth();
  if (!me) return null;
  // Server date, so the header follows the test clock on test servers.
  const now = new Date(`${me.today}T12:00:00Z`);
  return (
    <>
      <a className="skip" href="#main">
        דילוג לתוכן
      </a>
      <header className="hdr">
        <div className="hl">
          <strong>
            {me.school.name} · {me.school.yearName}
          </strong>
          <span className="mu">
            {weekday(now)} · {hebrewDate(now)} · {fmtDate(now)}
          </span>
        </div>
        {has('stu_view') && <GlobalSearch />}
        <AlertsButton />
        <span className="mu">
          מחובר כ{me.user.name} ({me.user.role})
        </span>
        <button className="b s" type="button" onClick={() => void logout()}>
          התנתקות
        </button>
      </header>
      <div className="app">
        <nav className="side" aria-label="תפריט ראשי">
          {NAV.filter((n) => !n.perm || has(n.perm)).map((n) => (
            <NavLink
              key={n.path}
              to={n.path}
              end={n.path === '/'}
              className={({ isActive }) => (isActive ? 'on' : '')}
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <main id="main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </>
  );
}
