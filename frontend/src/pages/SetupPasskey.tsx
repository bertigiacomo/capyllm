import React, { useEffect, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { AlertTriangle } from 'lucide-react';
import { getSetupOptions, verifySetup, type UserSession } from '../api';
import { CapyLogo } from '../components/CapyLogo';
import { useI18n } from '../i18n';

interface SetupPasskeyProps {
  onSuccess: (user: UserSession) => void;
}

export const SetupPasskey: React.FC<SetupPasskeyProps> = ({ onSuccess }) => {
  const { t } = useI18n();
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [options, setOptions] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const tParam = urlParams.get('token');
    if (!tParam) {
      setError(t('auth.missing_token'));
      return;
    }
    setToken(tParam);

    setLoading(true);
    getSetupOptions(tParam)
      .then((data) => {
        setOptions(data.options);
        setEmail(data.email);
      })
      .catch((err) => {
        setError(err.message || t('auth.invalid_invite'));
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const handleRegister = async () => {
    if (!token || !options) return;
    setVerifying(true);
    setError(null);

    try {
      const regResp = await startRegistration({ optionsJSON: options });
      const result = await verifySetup(token, regResp);

      if (result.success && result.user) {
        // Clean URL parameter
        window.history.replaceState({}, document.title, '/');
        onSuccess(result.user);
      } else {
        setError(t('auth.register_failed'));
      }
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setError(t('auth.setup_cancelled'));
      } else {
        setError(err.message || t('auth.setup_failed'));
      }
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-canvas text-ink">
      <div className="ds-card w-full max-w-sm flex flex-col gap-6">
        <div className="flex flex-col gap-1 text-center items-center">
          <CapyLogo size={80} className="mb-2" />
          <div className="text-xl font-bold tracking-tight">CapyLLM</div>
          <p className="ds-small text-muted">
            {t('setup.subtitle')}
          </p>
        </div>

        {error && (
          <div className="ds-alert ds-alert--err flex items-center gap-2">
            <AlertTriangle size={16} className="text-err shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="py-8 text-center text-muted ds-small">
            {t('common.loading')}
          </div>
        ) : email && options ? (
          <div className="flex flex-col gap-4">
            <div className="p-3 bg-sunken rounded-sm border border-hairline flex flex-col gap-1">
              <span className="ds-label">Account</span>
              <span className="text-sm font-medium">{email}</span>
            </div>

            <button
              type="button"
              className="ds-btn ds-btn--primary w-full"
              onClick={handleRegister}
              disabled={verifying}
            >
              {verifying ? t('setup.btn_loading') : t('setup.btn_register')}
            </button>
            <p className="ds-small text-muted text-center">
              {t('login.hint')}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
};
