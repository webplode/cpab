import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DashboardLayout } from '../components/DashboardLayout';
import { Icon } from '../components/Icon';
import { apiFetch } from '../api/config';
import { credentialToJSON, parseCreationOptions } from '../utils/webauthn';
import { useTranslation } from 'react-i18next';

interface ProfileResponse {
    id: number;
    username: string;
    email: string;
    active: boolean;
    disabled: boolean;
    created_at: string;
    updated_at: string;
}

interface MfaStatusResponse {
    totp_enabled: boolean;
    passkey_enabled: boolean;
}

interface TotpPrepareResponse {
    secret: string;
    otpauth_url: string;
    qr_image: string;
}

interface ToastState {
    show: boolean;
    message: string;
}

const inputClassName =
    'w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent';

function formatDate(value: string | undefined, locale: string): string {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '-';
    }
    return date.toLocaleString(locale);
}

function getStatusBadge(enabled: boolean, t: (key: string) => string) {
    return (
        <span
            className={[
                'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border',
                enabled
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800'
                    : 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-surface-dark dark:text-text-secondary dark:border-border-dark',
            ].join(' ')}
        >
            <Icon name={enabled ? 'check_circle' : 'radio_button_unchecked'} size={14} />
            {enabled ? t('Enabled') : t('Not enabled')}
        </span>
    );
}

export function Settings() {
    const { t, i18n } = useTranslation();
    const locale = i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US';
    const [profile, setProfile] = useState<ProfileResponse | null>(null);
    const [profileLoading, setProfileLoading] = useState(true);
    const [profileError, setProfileError] = useState('');

    const [passwordForm, setPasswordForm] = useState({
        current: '',
        next: '',
        confirm: '',
    });
    const [passwordLoading, setPasswordLoading] = useState(false);
    const [passwordError, setPasswordError] = useState('');

    const [mfaStatus, setMfaStatus] = useState<MfaStatusResponse>({
        totp_enabled: false,
        passkey_enabled: false,
    });
    const [mfaError, setMfaError] = useState('');
    const [isMfaModalOpen, setIsMfaModalOpen] = useState(false);
    const [totpSecret, setTotpSecret] = useState('');
    const [totpUrl, setTotpUrl] = useState('');
    const [totpQrImage, setTotpQrImage] = useState('');
    const [totpCode, setTotpCode] = useState('');
    const [totpLoading, setTotpLoading] = useState(false);
    const [passkeyLoading, setPasskeyLoading] = useState(false);
    const mfaLoading = totpLoading || passkeyLoading;

    const [toast, setToast] = useState<ToastState>({ show: false, message: '' });
    const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showToast = useCallback((message: string) => {
        if (toastRef.current) {
            clearTimeout(toastRef.current);
        }
        setToast({ show: true, message });
        toastRef.current = setTimeout(() => {
            setToast({ show: false, message: '' });
        }, 3000);
    }, []);

    useEffect(() => {
        return () => {
            if (toastRef.current) {
                clearTimeout(toastRef.current);
            }
        };
    }, []);

    const handleCopyText = async (value: string) => {
        const trimmed = value.trim();
        if (!trimmed) {
            return;
        }
        try {
            await navigator.clipboard.writeText(trimmed);
            showToast(t('Copied'));
        } catch (err) {
            console.error('Failed to copy text:', err);
            setMfaError(t('Failed to copy'));
        }
    };

    const loadProfile = useCallback(async () => {
        setProfileLoading(true);
        setProfileError('');
        try {
            const res = await apiFetch<ProfileResponse>('/v0/front/profile');
            setProfile(res);
        } catch (err) {
            setProfileError(err instanceof Error ? err.message : t('Failed to load profile.'));
        } finally {
            setProfileLoading(false);
        }
    }, [t]);

    const loadMfaStatus = useCallback(async () => {
        try {
            const res = await apiFetch<MfaStatusResponse>('/v0/front/mfa/status');
            setMfaStatus(res);
        } catch (err) {
            setMfaError(err instanceof Error ? err.message : t('Failed to load MFA status.'));
        }
    }, [t]);

    useEffect(() => {
        loadProfile();
        loadMfaStatus();
    }, [loadProfile, loadMfaStatus]);

    const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setPasswordForm((prev) => ({ ...prev, [name]: value }));
        setPasswordError('');
    };

    const handlePasswordSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const current = passwordForm.current.trim();
        const next = passwordForm.next.trim();
        const confirm = passwordForm.confirm.trim();
        if (!current || !next) {
            setPasswordError(t('Current and new password are required.'));
            return;
        }
        if (next !== confirm) {
            setPasswordError(t('New password confirmation does not match.'));
            return;
        }

        setPasswordLoading(true);
        setPasswordError('');
        try {
            await apiFetch('/v0/front/profile/password', {
                method: 'PUT',
                body: JSON.stringify({ old_password: current, new_password: next }),
            });
            setPasswordForm({ current: '', next: '', confirm: '' });
            showToast(t('Password updated.'));
        } catch (err) {
            setPasswordError(err instanceof Error ? err.message : t('Failed to update password.'));
        } finally {
            setPasswordLoading(false);
        }
    };

    const handleStartTotp = async () => {
        setTotpLoading(true);
        setMfaError('');
        try {
            const res = await apiFetch<TotpPrepareResponse>('/v0/front/mfa/totp/prepare', {
                method: 'POST',
            });
            setTotpSecret(res.secret || '');
            setTotpUrl(res.otpauth_url || '');
            setTotpQrImage(res.qr_image || '');
            setTotpCode('');
        } catch (err) {
            setMfaError(err instanceof Error ? err.message : t('Failed to start TOTP setup.'));
        } finally {
            setTotpLoading(false);
        }
    };

    const handleOpenMfaModal = () => {
        setIsMfaModalOpen(true);
        setMfaError('');
        setTotpSecret('');
        setTotpUrl('');
        setTotpQrImage('');
        setTotpCode('');
        loadMfaStatus();
        handleStartTotp();
    };

    const handleCloseMfaModal = () => {
        if (mfaLoading) {
            return;
        }
        setIsMfaModalOpen(false);
        setMfaError('');
        setTotpSecret('');
        setTotpUrl('');
        setTotpQrImage('');
        setTotpCode('');
    };

    const handleConfirmTotp = async () => {
        const code = totpCode.trim();
        if (!code) {
            setMfaError(t('TOTP code is required.'));
            return;
        }
        setTotpLoading(true);
        setMfaError('');
        try {
            await apiFetch('/v0/front/mfa/totp/confirm', {
                method: 'POST',
                body: JSON.stringify({ code }),
            });
            setTotpSecret('');
            setTotpUrl('');
            setTotpQrImage('');
            setTotpCode('');
            await loadMfaStatus();
            setIsMfaModalOpen(false);
            showToast(t('TOTP enabled.'));
        } catch (err) {
            setMfaError(err instanceof Error ? err.message : t('Failed to enable TOTP.'));
        } finally {
            setTotpLoading(false);
        }
    };

    const handleDisableTotp = async () => {
        setTotpLoading(true);
        setMfaError('');
        try {
            await apiFetch('/v0/front/mfa/totp/disable', { method: 'POST' });
            setTotpSecret('');
            setTotpUrl('');
            setTotpQrImage('');
            setTotpCode('');
            await loadMfaStatus();
            showToast(t('TOTP disabled.'));
        } catch (err) {
            setMfaError(err instanceof Error ? err.message : t('Failed to disable TOTP.'));
        } finally {
            setTotpLoading(false);
        }
    };

    const handleEnablePasskey = async () => {
        if (!window.PublicKeyCredential) {
            setMfaError(t('Passkey is not supported in this browser.'));
            return;
        }
        setPasskeyLoading(true);
        setMfaError('');
        try {
            const options = await apiFetch('/v0/front/mfa/passkey/options', { method: 'POST' });
            const publicKey = parseCreationOptions(options);
            const credential = (await navigator.credentials.create({
                publicKey,
            })) as PublicKeyCredential | null;
            if (!credential) {
                throw new Error(t('Passkey registration was cancelled.'));
            }
            await apiFetch('/v0/front/mfa/passkey/verify', {
                method: 'POST',
                body: JSON.stringify(credentialToJSON(credential)),
            });
            await loadMfaStatus();
            showToast(t('Passkey enabled.'));
        } catch (err) {
            setMfaError(err instanceof Error ? err.message : t('Failed to enable passkey.'));
        } finally {
            setPasskeyLoading(false);
        }
    };

    const handleDisablePasskey = async () => {
        setPasskeyLoading(true);
        setMfaError('');
        try {
            await apiFetch('/v0/front/mfa/passkey/disable', { method: 'POST' });
            await loadMfaStatus();
            showToast(t('Passkey disabled.'));
        } catch (err) {
            setMfaError(err instanceof Error ? err.message : t('Failed to disable passkey.'));
        } finally {
            setPasskeyLoading(false);
        }
    };

    return (
        <DashboardLayout title={t('Settings')} subtitle={t('Manage your account security and authentication.')}>
            <div className="space-y-6">
                <section className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-sm p-6">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                                {t('Account')}
                            </h3>
                            <p className="text-sm text-slate-500 dark:text-text-secondary mt-1">
                                {t('Your account profile details.')}
                            </p>
                        </div>
                        <Icon name="account_circle" className="text-primary" size={28} />
                    </div>
                    {profileLoading ? (
                        <div className="mt-4 text-sm text-slate-500 dark:text-text-secondary">
                            {t('Loading profile...')}
                        </div>
                    ) : profileError ? (
                        <div className="mt-4 text-sm text-red-600 dark:text-red-400">
                            {profileError}
                        </div>
                    ) : (
                        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="rounded-lg border border-gray-200 dark:border-border-dark bg-gray-50 dark:bg-background-dark p-4">
                                <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-text-secondary">
                                    {t('Username')}
                                </p>
                                <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">
                                    {profile?.username || '-'}
                                </p>
                            </div>
                            <div className="rounded-lg border border-gray-200 dark:border-border-dark bg-gray-50 dark:bg-background-dark p-4">
                                <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-text-secondary">
                                    {t('Email')}
                                </p>
                                <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">
                                    {profile?.email || '-'}
                                </p>
                            </div>
                            <div className="rounded-lg border border-gray-200 dark:border-border-dark bg-gray-50 dark:bg-background-dark p-4">
                                <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-text-secondary">
                                    {t('Created')}
                                </p>
                                <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">
                                    {formatDate(profile?.created_at, locale)}
                                </p>
                            </div>
                        </div>
                    )}
                </section>

                <section className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-sm p-6">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                                {t('Password')}
                            </h3>
                            <p className="text-sm text-slate-500 dark:text-text-secondary mt-1">
                                {t('Update your account password.')}
                            </p>
                        </div>
                        <Icon name="lock" className="text-primary" size={26} />
                    </div>
                    <form className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4" onSubmit={handlePasswordSubmit}>
                        <label className="flex flex-col gap-2 text-sm text-slate-600 dark:text-text-secondary">
                            {t('Current Password')}
                            <input
                                className={inputClassName}
                                type="password"
                                name="current"
                                value={passwordForm.current}
                                onChange={handlePasswordChange}
                                disabled={passwordLoading}
                            />
                        </label>
                        <label className="flex flex-col gap-2 text-sm text-slate-600 dark:text-text-secondary">
                            {t('New Password')}
                            <input
                                className={inputClassName}
                                type="password"
                                name="next"
                                value={passwordForm.next}
                                onChange={handlePasswordChange}
                                disabled={passwordLoading}
                            />
                        </label>
                        <label className="flex flex-col gap-2 text-sm text-slate-600 dark:text-text-secondary">
                            {t('Confirm New')}
                            <input
                                className={inputClassName}
                                type="password"
                                name="confirm"
                                value={passwordForm.confirm}
                                onChange={handlePasswordChange}
                                disabled={passwordLoading}
                            />
                        </label>
                        <div className="md:col-span-3 flex items-center justify-between gap-4">
                            {passwordError && (
                                <span className="text-sm text-red-600 dark:text-red-400">
                                    {passwordError}
                                </span>
                            )}
                            <button
                                type="submit"
                                disabled={passwordLoading}
                                className="ml-auto inline-flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-blue-600 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Icon name="save" size={18} />
                                {passwordLoading ? t('Saving...') : t('Update Password')}
                            </button>
                        </div>
                    </form>
                </section>

                <section className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-sm p-6">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                                {t('Multi-Factor Authentication')}
                            </h3>
                            <p className="text-sm text-slate-500 dark:text-text-secondary mt-1">
                                {t('Strengthen your login security with TOTP or passkeys.')}
                            </p>
                        </div>
                        <Icon name="verified_user" className="text-primary" size={26} />
                    </div>

                    <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className="rounded-lg border border-gray-200 dark:border-border-dark bg-gray-50 dark:bg-background-dark p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                                        {t('TOTP Authenticator')}
                                    </h4>
                                    <p className="text-xs text-slate-500 dark:text-text-secondary">
                                        {t('Time-based one-time codes from an authenticator app.')}
                                    </p>
                                </div>
                                {getStatusBadge(mfaStatus.totp_enabled, t)}
                            </div>

                            <div className="mt-4 flex items-center gap-3">
                                <button
                                    type="button"
                                    onClick={mfaStatus.totp_enabled ? handleDisableTotp : handleOpenMfaModal}
                                    disabled={mfaLoading}
                                    className={[
                                        'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                                        mfaStatus.totp_enabled
                                            ? 'bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-background-dark dark:text-text-secondary dark:hover:bg-surface-dark'
                                            : 'bg-primary text-white hover:bg-blue-600',
                                    ].join(' ')}
                                >
                                    <Icon name={mfaStatus.totp_enabled ? 'lock_open' : 'qr_code'} size={16} />
                                    {mfaLoading
                                        ? t('Working...')
                                        : mfaStatus.totp_enabled
                                            ? t('Disable TOTP')
                                            : t('Set Up TOTP')}
                                </button>
                            </div>
                        </div>

                        <div className="rounded-lg border border-gray-200 dark:border-border-dark bg-gray-50 dark:bg-background-dark p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                                        {t('Passkey')}
                                    </h4>
                                    <p className="text-xs text-slate-500 dark:text-text-secondary">
                                        {t('Use device biometrics or security keys for sign-in.')}
                                    </p>
                                </div>
                                {getStatusBadge(mfaStatus.passkey_enabled, t)}
                            </div>
                            <div className="mt-4 flex items-center gap-3">
                                <button
                                    type="button"
                                    onClick={mfaStatus.passkey_enabled ? handleDisablePasskey : handleEnablePasskey}
                                    disabled={passkeyLoading}
                                    className={[
                                        'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                                        mfaStatus.passkey_enabled
                                            ? 'bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-background-dark dark:text-text-secondary dark:hover:bg-surface-dark'
                                            : 'bg-primary text-white hover:bg-blue-600',
                                    ].join(' ')}
                                >
                                    <Icon name={mfaStatus.passkey_enabled ? 'lock_open' : 'fingerprint'} size={16} />
                                    {passkeyLoading
                                        ? t('Working...')
                                        : mfaStatus.passkey_enabled
                                            ? t('Disable Passkey')
                                            : t('Enable Passkey')}
                                </button>
                                {!mfaStatus.passkey_enabled && (
                                    <span className="text-xs text-slate-500 dark:text-text-secondary">
                                        {t('Requires a compatible browser and device.')}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    {!isMfaModalOpen && mfaError && (
                        <div className="mt-4 text-sm text-red-600 dark:text-red-400">
                            {mfaError}
                        </div>
                    )}
                </section>
            </div>

            {isMfaModalOpen
                ? createPortal(
                      <div
                          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
                          onClick={handleCloseMfaModal}
                      >
                          <div
                              className="bg-white dark:bg-surface-dark rounded-xl shadow-xl w-full max-w-md mx-4 border border-gray-200 dark:border-border-dark max-h-[90vh] flex flex-col overflow-hidden"
                              onClick={(event) => event.stopPropagation()}
                          >
                              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-border-dark shrink-0">
                                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                                      {t('Multi-Factor Authentication')}
                                  </h2>
                                  <button
                                      onClick={handleCloseMfaModal}
                                      className="inline-flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
                                      type="button"
                                  >
                                      <Icon name="close" />
                                  </button>
                              </div>
                              <div className="p-6 space-y-4 flex-1 overflow-y-auto">
                                  <div className="space-y-3">
                                      <div className="text-xs text-slate-500 dark:text-text-secondary">
                                          {t('Add this secret to your authenticator app and enter the code below.')}
                                      </div>
                                      {totpQrImage ? (
                                          <div className="flex items-center justify-center rounded-lg border border-gray-200 dark:border-border-dark bg-white dark:bg-background-dark p-4">
                                              <img
                                                  src={totpQrImage}
                                                  alt={t('TOTP QR')}
                                                  className="h-40 w-40"
                                              />
                                          </div>
                                      ) : null}
                                      <div className="flex items-start gap-2">
                                          <div className="flex-1 rounded-lg border border-gray-200 dark:border-border-dark bg-gray-50 dark:bg-background-dark px-3 py-2 text-xs font-mono text-slate-700 dark:text-slate-200 break-all">
                                              {totpSecret || '—'}
                                          </div>
                                          <button
                                              type="button"
                                              onClick={() => handleCopyText(totpSecret)}
                                              disabled={!totpSecret}
                                                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-gray-200 dark:border-border-dark bg-white dark:bg-background-dark text-slate-700 dark:text-text-secondary hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                              >
                                                  <Icon name="content_copy" size={16} />
                                                  {t('Copy')}
                                              </button>
                                          </div>
                                      <div className="flex items-start gap-2">
                                          <div className="flex-1 rounded-lg border border-gray-200 dark:border-border-dark bg-gray-50 dark:bg-background-dark px-3 py-2 text-xs font-mono text-slate-700 dark:text-slate-200 break-all">
                                              {totpUrl || '—'}
                                          </div>
                                          <button
                                              type="button"
                                              onClick={() => handleCopyText(totpUrl)}
                                              disabled={!totpUrl}
                                                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-gray-200 dark:border-border-dark bg-white dark:bg-background-dark text-slate-700 dark:text-text-secondary hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                              >
                                                  <Icon name="content_copy" size={16} />
                                                  {t('Copy')}
                                              </button>
                                          </div>
                                          <input
                                              type="text"
                                              value={totpCode}
                                              onChange={(event) => setTotpCode(event.target.value)}
                                              placeholder={t('Enter 6-digit code')}
                                              className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-border-dark rounded-lg bg-white dark:bg-background-dark text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                                              disabled={mfaLoading}
                                          />
                                          <button
                                              className="w-full py-2.5 rounded-lg font-medium transition-colors bg-primary hover:bg-blue-600 text-white disabled:opacity-60"
                                              onClick={handleConfirmTotp}
                                              type="button"
                                              disabled={mfaLoading}
                                          >
                                              {mfaLoading ? t('Verifying...') : t('Verify')}
                                          </button>
                                  </div>

                                  {mfaError ? <p className="text-sm text-red-500">{mfaError}</p> : null}
                              </div>
                          </div>
                      </div>,
                      document.body
                  )
                : null}

            {toast.show && (
                <div className="fixed top-4 right-4 z-[9999] animate-slide-in-right">
                    <div className="flex items-center gap-3 px-4 py-3 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 rounded-lg shadow-lg">
                        <Icon name="check_circle" size={20} className="text-emerald-500" />
                        <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                            {toast.message}
                        </span>
                        <button
                            onClick={() => setToast({ show: false, message: '' })}
                            className="inline-flex h-7 w-7 items-center justify-center text-emerald-500 hover:text-emerald-700 dark:hover:text-emerald-300 rounded transition-colors"
                        >
                            <Icon name="close" size={16} />
                        </button>
                    </div>
                </div>
            )}
        </DashboardLayout>
    );
}
