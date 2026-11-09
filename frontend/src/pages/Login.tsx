import React, { useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import { AlertTriangle } from 'lucide-react';
import { getLoginOptions, verifyLogin, type UserSession } from '../api';
import { CapyLogo } from '../components/CapyLogo';
import { useI18n } from '../i18n';

interface LoginProps {
  onSuccess: (user: UserSession) => void;
}

export const Login: React.FC<LoginProps> = ({ onSuccess }) => {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePasskeyLogin = async () => {
    setLoading(true);
    setError(null);

    try {
      const { options } = await getLoginOptions();
      const authResp = await startAuthentication({ optionsJSON: options });
      const result = await verifyLogin(authResp);

      if (result.success && result.user) {
        onSuccess(result.user);
      } else {
        setError(t('auth.verify_failed'));
      }
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setError(t('auth.cancelled'));
      } else {
        setError(err.message || t('auth.failed'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-canvas text-ink">
      <div className="ds-card w-full max-w-sm flex flex-col gap-6">
        <div className="flex flex-col gap-1 text-center items-center">
          <CapyLogo size={80} className="mb-2" />
          <div className="text-xl font-bold tracking-tight">CapyLLM</div>
          <p className="ds-small text-muted">
            {t('login.subtitle')}
          </p>
        </div>

        {error && (
          <div className="ds-alert ds-alert--err flex items-center gap-2">
            <AlertTriangle size={16} className="text-err shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <button
            type="button"
            className="ds-btn ds-btn--primary w-full"
            onClick={handlePasskeyLogin}
            disabled={loading}
          >
            {loading ? t('login.btn_loading') : t('login.btn_passkey')}
          </button>
          <p className="ds-small text-muted text-center">
            {t('login.hint')}
          </p>
        </div>
      </div>
    </div>
  );
};

