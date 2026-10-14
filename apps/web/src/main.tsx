import '@fontsource/heebo/400.css';
import '@fontsource/heebo/600.css';
import '@fontsource/heebo/700.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './app/auth';
import { Layout } from './app/Layout';
import { RequirePerm, RequireStaff } from './app/guards';
import { NAV } from './app/nav';
import { ToastProvider } from './components/Toast';
import { LoginPage } from './pages/auth/LoginPage';
import { TwoFactorPage } from './pages/auth/TwoFactorPage';
import { SetupTwoFactorPage } from './pages/auth/SetupTwoFactorPage';
import { InvitePage } from './pages/auth/InvitePage';
import { UsersPage } from './pages/users/UsersPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { Placeholder } from './pages/Placeholder';
import { FamiliesPage } from './pages/families/FamiliesPage';
import { ChargesPage } from './pages/charges/ChargesPage';
import { ReceiptsPage } from './pages/receipts/ReceiptsPage';
import { DialogProvider } from './components/Dialogs';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { PlansPage } from './pages/plans/PlansPage';
import { CardsPage } from './pages/cards/CardsPage';
import { HttpError } from './api/client';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof HttpError && e.status >= 400 && e.status < 500) && n < 2,
      refetchOnWindowFocus: false,
    },
  },
});

const BUILT: Record<string, JSX.Element> = {
  '/users': <UsersPage />,
  '/settings': <SettingsPage />,
  '/families': <FamiliesPage />,
  '/charges': <ChargesPage />,
  '/receipts': <ReceiptsPage />,
  '/': <DashboardPage />,
  '/plans': <PlansPage />,
  '/cards': <CardsPage />,
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/login/2fa" element={<TwoFactorPage />} />
              <Route path="/login/setup-2fa" element={<SetupTwoFactorPage />} />
              <Route path="/invite" element={<InvitePage />} />
              <Route
                element={
                  <RequireStaff>
                    <DialogProvider>
                      <Layout />
                    </DialogProvider>
                  </RequireStaff>
                }
              >
                {NAV.map((n) => (
                  <Route
                    key={n.path}
                    path={n.path}
                    element={
                      <RequirePerm perm={n.perm}>
                        {BUILT[n.path] ?? <Placeholder title={n.label} stage={n.stage} />}
                      </RequirePerm>
                    }
                  />
                ))}
                <Route
                  path="*"
                  element={
                    <div className="card placeholder">
                      <h2>הדף לא נמצא</h2>
                    </div>
                  }
                />
              </Route>
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
