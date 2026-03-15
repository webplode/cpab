import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { AdminSidebar } from './AdminSidebar';
import { Header } from '../Header';
import { Icon } from '../Icon';
import { apiFetchAdmin, TOKEN_KEY_ADMIN, USER_KEY_ADMIN } from '../../api/config';
import { credentialToJSON, parseCreationOptions } from '../../utils/webauthn';
import { useTranslation } from 'react-i18next';

interface AdminDashboardLayoutProps {
    children: ReactNode;
    title?: string;
    subtitle?: string;
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

export function AdminDashboardLayout({ children, title, subtitle }: AdminDashboardLayoutProps) {
    const navigate = useNavigate();
    const { t } = useTranslation();
    const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [passwordError, setPasswordError] = useState('');
    const [passwordSaving, setPasswordSaving] = useState(false);
    const [isMfaModalOpen, setIsMfaModalOpen] = useState(false);
    const [mfaStep, setMfaStep] = useState<'choice' | 'totp'>('choice');
    const [mfaStatus, setMfaStatus] = useState<MfaStatusResponse>({
        totp_enabled: false,
        passkey_enabled: false,
    });
    const [mfaError, setMfaError] = useState('');
    const [mfaLoading, setMfaLoading] = useState(false);
    const [totpSecret, setTotpSecret] = useState('');
    const [totpUrl, setTotpUrl] = useState('');
    const [totpQrImage, setTotpQrImage] = useState('');
    const [totpCode, setTotpCode] = useState('');
    const [toast, setToast] = useState<{ show: boolean; message: string }>({
        show: false,
        message: '',
    });
    const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const adminInfo = useMemo(() => {
        const raw = localStorage.getItem(USER_KEY_ADMIN);
        if (!raw) {
            return { id: 0, username: '' };
        }
        try {
            const data = JSON.parse(raw) as { id?: unknown; username?: unknown };
            const idValue = typeof data.id === 'number' ? data.id : Number(data.id);
            return {
                id: Number.isFinite(idValue) ? idValue : 0,
                username: typeof data.username === 'string' ? data.username : '',
            };
        } catch {
            return { id: 0, username: '' };
        }
    }, []);

    const handleLogout = () => {
        localStorage.removeItem(TOKEN_KEY_ADMIN);
        localStorage.removeItem(USER_KEY_ADMIN);
        navigate('/admin/login');
    };

    const loadMfaStatus = async () => {
        try {
            const res = await apiFetchAdmin<MfaStatusResponse>('/v0/admin/mfa/status');
            setMfaStatus(res);
        } catch (err) {
            console.error('Failed to load MFA status:', err);
        }
    };

    const handleOpenMfa = () => {
        setIsMfaModalOpen(true);
        setMfaStep('choice');
        setMfaError('');
        setTotpSecret('');
        setTotpUrl('');
        setTotpQrImage('');
        setTotpCode('');
        loadMfaStatus();
    };

    const handleCloseMfa = () => {
        if (mfaLoading) {
            return;
        }
        setIsMfaModalOpen(false);
        setMfaError('');
    };

    const showToast = (message: string) => {
        setToast({ show: true, message });
        if (toastTimeoutRef.current) {
            clearTimeout(toastTimeoutRef.current);
        }
        toastTimeoutRef.current = setTimeout(() => {
            setToast({ show: false, message: '' });
        }, 3000);
    };

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

    useEffect(() => {
        return () => {
            if (toastTimeoutRef.current) {
                clearTimeout(toastTimeoutRef.current);
            }
        };
    }, []);

    const handleStartTotp = async () => {
        setMfaError('');
        setMfaLoading(true);
        try {
            const res = await apiFetchAdmin<TotpPrepareResponse>('/v0/admin/mfa/totp/prepare', {
                method: 'POST',
            });
            setTotpSecret(res.secret);
            setTotpUrl(res.otpauth_url);
            setTotpQrImage(res.qr_image);
            setMfaStep('totp');
        } catch (err) {
            setMfaError(err instanceof Error ? err.message : t('Failed to start TOTP setup'));
        } finally {
            setMfaLoading(false);
        }
    };

    const handleConfirmTotp = async () => {
        const code = totpCode.trim();
        if (!code) {
            setMfaError(t('Code is required'));
            return;
        }
        setMfaError('');
        setMfaLoading(true);
        try {
            await apiFetchAdmin('/v0/admin/mfa/totp/confirm', {
                method: 'POST',
                body: JSON.stringify({ code }),
            });
            setMfaStatus((prev) => ({ ...prev, totp_enabled: true }));
            setMfaStep('choice');
            setTotpSecret('');
            setTotpUrl('');
            setTotpQrImage('');
            setTotpCode('');
            showToast(t('TOTP enabled'));
        } catch (err) {
            setMfaError(err instanceof Error ? err.message : t('Failed to enable TOTP'));
        } finally {
            setMfaLoading(false);
        }
    };

    const handleStartPasskey = async () => {
        if (!window.PublicKeyCredential) {
            setMfaError(t('Passkey is not supported in this browser'));
            return;
        }
        setMfaError('');
        setMfaLoading(true);
        try {
            const options = await apiFetchAdmin('/v0/admin/mfa/passkey/options', { method: 'POST' });
            const publicKey = parseCreationOptions(options);
            const credential = (await navigator.credentials.create({
                publicKey,
            })) as PublicKeyCredential | null;
            if (!credential) {
                throw new Error(t('Passkey registration was cancelled'));
            }
            await apiFetchAdmin('/v0/admin/mfa/passkey/verify', {
                method: 'POST',
                body: JSON.stringify(credentialToJSON(credential)),
            });
            setMfaStatus((prev) => ({ ...prev, passkey_enabled: true }));
            showToast(t('Passkey enabled'));
        } catch (err) {
            setMfaError(err instanceof Error ? err.message : t('Failed to enable passkey'));
        } finally {
            setMfaLoading(false);
        }
    };

    const handleDisableTotp = async () => {
        setMfaError('');
        setMfaLoading(true);
        try {
            await apiFetchAdmin('/v0/admin/mfa/totp/disable', { method: 'POST' });
            setMfaStatus((prev) => ({ ...prev, totp_enabled: false }));
            setMfaStep('choice');
            setTotpSecret('');
            setTotpUrl('');
            setTotpQrImage('');
            setTotpCode('');
            showToast(t('TOTP disabled'));
        } catch (err) {
            setMfaError(err instanceof Error ? err.message : t('Failed to disable TOTP'));
        } finally {
            setMfaLoading(false);
        }
    };

    const handleDisablePasskey = async () => {
        setMfaError('');
        setMfaLoading(true);
        try {
            await apiFetchAdmin('/v0/admin/mfa/passkey/disable', { method: 'POST' });
            setMfaStatus((prev) => ({ ...prev, passkey_enabled: false }));
            showToast(t('Passkey disabled'));
        } catch (err) {
            setMfaError(err instanceof Error ? err.message : t('Failed to disable passkey'));
        } finally {
            setMfaLoading(false);
        }
    };

    const handleOpenChangePassword = () => {
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setPasswordError('');
        setIsPasswordModalOpen(true);
    };

    const handleCloseChangePassword = () => {
        if (passwordSaving) {
            return;
        }
        setIsPasswordModalOpen(false);
        setPasswordError('');
    };

    const handleSubmitPassword = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setPasswordError('');
        const trimmedCurrent = currentPassword.trim();
        const trimmedNew = newPassword.trim();
        const trimmedConfirm = confirmPassword.trim();
        if (!trimmedCurrent || !trimmedNew || !trimmedConfirm) {
            setPasswordError(t('All fields are required'));
            return;
        }
        if (trimmedNew !== trimmedConfirm) {
            setPasswordError(t('Passwords do not match'));
            return;
        }
        if (!adminInfo.id) {
            setPasswordError(t('Admin ID is missing'));
            return;
        }
        setPasswordSaving(true);
        try {
            await apiFetchAdmin(`/v0/admin/admins/${adminInfo.id}/password`, {
                method: 'PUT',
                body: JSON.stringify({
                    old_password: trimmedCurrent,
                    new_password: trimmedNew,
                }),
            });
            setIsPasswordModalOpen(false);
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
        } catch (err) {
            setPasswordError(err instanceof Error ? err.message : t('Update failed'));
        } finally {
            setPasswordSaving(false);
        }
    };

    return (
        <div className="flex h-screen w-full">
            <AdminSidebar
                onChangePassword={handleOpenChangePassword}
                onMFA={handleOpenMfa}
                onLogout={handleLogout}
            />
            <main className="flex-1 flex flex-col h-full overflow-y-auto bg-slate-50 dark:bg-background-dark">
                <Header
                    title={title}
                    subtitle={subtitle}
                    actions={
                        <div className="text-sm text-slate-600 dark:text-text-secondary flex items-center gap-2">
                            <span>{t('Current User:')}</span>
                            <span className="font-medium text-slate-900 dark:text-white">
                                {adminInfo.username || t('Admin')}
                            </span>
                        </div>
                    }
                />
                <div className="p-8 max-w-[1600px] w-full mx-auto flex flex-col gap-8">
                    {children}
                </div>
            </main>
            {isPasswordModalOpen
                ? createPortal(
                      <div
                          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
                          onClick={handleCloseChangePassword}
                      >
                          <div
                              className="bg-white dark:bg-surface-dark rounded-xl shadow-xl w-full max-w-sm mx-4 border border-gray-200 dark:border-border-dark max-h-[90vh] flex flex-col overflow-hidden"
                              onClick={(event) => event.stopPropagation()}
                          >
                              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-border-dark shrink-0">
                                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                                      {t('Change Password')}
                                  </h2>
                                  <button
                                      onClick={handleCloseChangePassword}
                                      className="inline-flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
                                      type="button"
                                  >
                                      <Icon name="close" />
                                  </button>
                              </div>
                              <form
                                  id="admin-change-password-form"
                                  className="p-6 space-y-4 flex-1 overflow-y-auto"
                                  onSubmit={handleSubmitPassword}
                              >
                                  <div>
                                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                          {t('Current Password')}
                                      </label>
                                      <input
                                          type="password"
                                          value={currentPassword}
                                          onChange={(event) => setCurrentPassword(event.target.value)}
                                          disabled={passwordSaving}
                                          placeholder="••••••••"
                                          className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-border-dark rounded-lg bg-white dark:bg-background-dark text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50"
                                      />
                                  </div>
                                  <div>
                                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                          {t('New Password')}
                                      </label>
                                      <input
                                          type="password"
                                          value={newPassword}
                                          onChange={(event) => setNewPassword(event.target.value)}
                                          disabled={passwordSaving}
                                          placeholder="••••••••"
                                          className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-border-dark rounded-lg bg-white dark:bg-background-dark text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50"
                                      />
                                  </div>
                                  <div>
                                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                          {t('Confirm New Password')}
                                      </label>
                                      <input
                                          type="password"
                                          value={confirmPassword}
                                          onChange={(event) => setConfirmPassword(event.target.value)}
                                          disabled={passwordSaving}
                                          placeholder="••••••••"
                                          className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-border-dark rounded-lg bg-white dark:bg-background-dark text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50"
                                      />
                                  </div>
                                  {passwordError ? (
                                      <p className="text-sm text-red-500">{passwordError}</p>
                                  ) : null}
                              </form>
                              <div className="flex gap-3 px-6 py-4 border-t border-gray-200 dark:border-border-dark shrink-0">
                                  <button
                                      onClick={handleCloseChangePassword}
                                      className="flex-1 py-2.5 bg-gray-100 dark:bg-background-dark hover:bg-gray-200 dark:hover:bg-gray-700 text-slate-900 dark:text-white rounded-lg font-medium transition-colors border border-gray-200 dark:border-border-dark"
                                      type="button"
                                      disabled={passwordSaving}
                                  >
                                      {t('Cancel')}
                                  </button>
                                  <button
                                      className="flex-1 py-2.5 rounded-lg font-medium transition-colors bg-primary hover:bg-blue-600 text-white disabled:opacity-60"
                                      type="submit"
                                      form="admin-change-password-form"
                                      disabled={passwordSaving}
                                  >
                                      {t('Update')}
                                  </button>
                              </div>
                          </div>
                      </div>,
                      document.body
                  )
                : null}
            {isMfaModalOpen
                ? createPortal(
                      <div
                          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
                          onClick={handleCloseMfa}
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
                                      onClick={handleCloseMfa}
                                      className="inline-flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
                                      type="button"
                                  >
                                      <Icon name="close" />
                                  </button>
                              </div>
                              <div className="p-6 space-y-4 flex-1 overflow-y-auto">
                                  <div className="text-sm text-slate-600 dark:text-text-secondary">
                                      <div className="flex items-center justify-between">
                                          <span>TOTP</span>
                                          <span className="font-medium text-slate-900 dark:text-white">
                                              {mfaStatus.totp_enabled ? t('Enabled') : t('Not enabled')}
                                          </span>
                                      </div>
                                      <div className="flex items-center justify-between mt-1">
                                          <span>{t('Passkey')}</span>
                                          <span className="font-medium text-slate-900 dark:text-white">
                                              {mfaStatus.passkey_enabled ? t('Enabled') : t('Not enabled')}
                                          </span>
                                      </div>
                                  </div>

                                  {mfaStep === 'choice' ? (
                                      <div className="space-y-3">
                                          {mfaStatus.totp_enabled ? (
                                              <button
                                                  className="w-full py-2.5 rounded-lg font-medium transition-colors border border-slate-200 dark:border-border-dark text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-surface-dark"
                                                  onClick={handleDisableTotp}
                                                  type="button"
                                                  disabled={mfaLoading}
                                              >
                                                  {t('Disable TOTP')}
                                              </button>
                                          ) : (
                                              <button
                                                  className="w-full py-2.5 rounded-lg font-medium transition-colors border border-slate-200 dark:border-border-dark text-slate-700 dark:text-white bg-slate-50 dark:bg-background-dark hover:bg-slate-100 dark:hover:bg-gray-700"
                                                  onClick={handleStartTotp}
                                                  type="button"
                                                  disabled={mfaLoading}
                                              >
                                                  {t('Set up TOTP')}
                                              </button>
                                          )}
                                          {mfaStatus.passkey_enabled ? (
                                              <button
                                                  className="w-full py-2.5 rounded-lg font-medium transition-colors border border-slate-200 dark:border-border-dark text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-surface-dark"
                                                  onClick={handleDisablePasskey}
                                                  type="button"
                                                  disabled={mfaLoading}
                                              >
                                                  {t('Disable Passkey')}
                                              </button>
                                          ) : (
                                              <button
                                                  className="w-full py-2.5 rounded-lg font-medium transition-colors border border-slate-200 dark:border-border-dark text-slate-700 dark:text-white bg-slate-50 dark:bg-background-dark hover:bg-slate-100 dark:hover:bg-gray-700"
                                                  onClick={handleStartPasskey}
                                                  type="button"
                                                  disabled={mfaLoading}
                                              >
                                                  {t('Set up Passkey')}
                                              </button>
                                          )}
                                      </div>
                                  ) : (
                                      <div className="space-y-3">
                                          <div className="text-xs text-slate-500 dark:text-text-secondary">
                                              {t('Add this secret to your authenticator app and enter the code below.')}
                                          </div>
                                          {totpQrImage ? (
                                              <div className="flex items-center justify-center rounded-lg border border-gray-200 dark:border-border-dark bg-white dark:bg-background-dark p-4">
                                                  <img
                                                      src={totpQrImage}
                                                      alt="TOTP QR"
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
                                          <div className="flex gap-3">
                                              <button
                                                  className="flex-1 py-2.5 bg-gray-100 dark:bg-background-dark hover:bg-gray-200 dark:hover:bg-gray-700 text-slate-900 dark:text-white rounded-lg font-medium transition-colors border border-gray-200 dark:border-border-dark"
                                                  onClick={() => setMfaStep('choice')}
                                                  type="button"
                                                  disabled={mfaLoading}
                                              >
                                                  {t('Back')}
                                              </button>
                                              <button
                                                  className="flex-1 py-2.5 rounded-lg font-medium transition-colors bg-primary hover:bg-blue-600 text-white disabled:opacity-60"
                                                  onClick={handleConfirmTotp}
                                                  type="button"
                                                  disabled={mfaLoading}
                                              >
                                                  {t('Verify')}
                                              </button>
                                          </div>
                                      </div>
                                  )}

                                  {mfaError ? (
                                      <p className="text-sm text-red-500">{mfaError}</p>
                                  ) : null}
                            </div>
                        </div>
                    </div>,
                    document.body
                )
                : null}
            {toast.show && (
                <div className="fixed top-4 right-4 z-[9999] animate-slide-in-right">
                    <div className="flex items-center gap-3 px-4 py-3 bg-emerald-50 dark:bg-emerald-900 border border-emerald-200 dark:border-emerald-800 rounded-lg shadow-lg">
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
        </div>
    );
}
