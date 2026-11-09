import React, { useEffect, useState } from 'react';
import { fetchMe, type UserSession } from './api';
import { I18nProvider } from './i18n';
import { Login } from './pages/Login';
import { SetupPasskey } from './pages/SetupPasskey';
import { Dashboard } from './pages/Dashboard';

export const AppContent: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<UserSession | null>(null);

  const isSetupRoute =
    window.location.pathname.startsWith('/auth/setup') ||
    Boolean(new URLSearchParams(window.location.search).get('token'));

  useEffect(() => {
    fetchMe()
      .then((data) => {
        if (data.authenticated && data.user) {
          setSession(data.user);
        }
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-hairline-strong border-t-accent rounded-full animate-spin" />
          <span className="ds-small text-muted">Connecting to CapyLLM...</span>
        </div>
      </div>
    );
  }

  if (isSetupRoute && !session) {
    return <SetupPasskey onSuccess={(user) => setSession(user)} />;
  }

  if (!session) {
    return <Login onSuccess={(user) => setSession(user)} />;
  }

  return <Dashboard user={session} onLogout={() => setSession(null)} />;
};

export const App: React.FC = () => {
  return (
    <I18nProvider>
      <AppContent />
    </I18nProvider>
  );
};
