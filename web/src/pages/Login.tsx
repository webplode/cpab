import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { API_BASE_URL, TOKEN_KEY_FRONT, USER_KEY_FRONT } from '../api/config';
import { credentialToJSON, parseRequestOptions } from '../utils/webauthn';
import { useTranslation } from 'react-i18next';

function Logo() {
    return (
        <svg
            className="w-full h-full"
            fill="none"
            viewBox="0 0 48 48"
            xmlns="http://www.w3.org/2000/svg"
        >
            <path
                clipRule="evenodd"
                d="M24 4H42V17.3333V30.6667H24V44H6V30.6667V17.3333H24V4Z"
                fill="currentColor"
                fillRule="evenodd"
            />
        </svg>
    );
}

interface LoginFormData {
    username: string;
    password: string;
}

interface ApiError {
    error: string;
}

interface LoginResponse {
    user_id: number;
    username: string;
    name: string;
    email: string;
    token: string;
}

interface LoginPrepareResponse {
    mfa_enabled: boolean;
    totp_enabled: boolean;
    passkey_enabled: boolean;
}

export function Login() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [step, setStep] = useState<'username' | 'password' | 'mfa'>('username');
    const [totpCode, setTotpCode] = useState('');
    const [mfaMethods, setMfaMethods] = useState<LoginPrepareResponse>({
        mfa_enabled: false,
        totp_enabled: false,
        passkey_enabled: false,
    });
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [formData, setFormData] = useState<LoginFormData>({
        username: '',
        password: '',
    });

    useEffect(() => {
        if (location.state?.registered) {
            setSuccessMessage(t('Account created successfully. Please sign in.'));
            window.history.replaceState({}, document.title);
        }
    }, [location.state, t]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
        setError(null);
        if (name === 'username') {
            setStep('username');
            setMfaMethods({ mfa_enabled: false, totp_enabled: false, passkey_enabled: false });
            setTotpCode('');
        }
    };

    const validateForm = (): string | null => {
        if (!formData.username.trim()) {
            return t('Username is required');
        }
        if (step === 'password' && !formData.password.trim()) {
            return t('Password is required');
        }
        if (step === 'mfa' && mfaMethods.totp_enabled && !totpCode.trim()) {
            return t('TOTP code is required');
        }
        return null;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const validationError = validateForm();
        if (validationError) {
            setError(validationError);
            return;
        }

        setLoading(true);
        setError(null);
        setSuccessMessage(null);

        try {
            if (step === 'username') {
                const response = await fetch(`${API_BASE_URL}/v0/front/login/prepare`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        username: formData.username.trim(),
                    }),
                });
                if (!response.ok) {
                    const data: ApiError = await response.json();
                    throw new Error(data.error || t('Login failed'));
                }
                const data: LoginPrepareResponse = await response.json();
                setMfaMethods(data);
                if (data.mfa_enabled) {
                    setStep('mfa');
                } else {
                    setStep('password');
                }
                return;
            }

            if (step === 'password') {
                const response = await fetch(`${API_BASE_URL}/v0/front/login`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        username: formData.username.trim(),
                        password: formData.password,
                    }),
                });

                if (!response.ok) {
                    const data: ApiError = await response.json();
                    throw new Error(data.error || t('Login failed'));
                }

                const data: LoginResponse = await response.json();
                handleLoginSuccess(data);
                return;
            }

            if (step === 'mfa' && mfaMethods.totp_enabled) {
                const response = await fetch(`${API_BASE_URL}/v0/front/login/totp`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        username: formData.username.trim(),
                        code: totpCode.trim(),
                    }),
                });

                if (!response.ok) {
                    const data: ApiError = await response.json();
                    throw new Error(data.error || t('Login failed'));
                }

                const data: LoginResponse = await response.json();
                handleLoginSuccess(data);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : t('Login failed'));
        } finally {
            setLoading(false);
        }
    };

    const handleLoginSuccess = (data: LoginResponse) => {
        localStorage.setItem(TOKEN_KEY_FRONT, data.token);
        localStorage.setItem(
            USER_KEY_FRONT,
            JSON.stringify({
                id: data.user_id,
                username: data.username,
                name: data.name,
                email: data.email,
            })
        );

        navigate('/dashboard');
    };

    const handlePasskeyLogin = async () => {
        if (!window.PublicKeyCredential) {
            setError(t('Passkey is not supported in this browser'));
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(`${API_BASE_URL}/v0/front/login/passkey/options`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    username: formData.username.trim(),
                }),
            });
            if (!response.ok) {
                const data: ApiError = await response.json();
                throw new Error(data.error || t('Login failed'));
            }
            const options = await response.json();
            const publicKey = parseRequestOptions(options);
            const credential = (await navigator.credentials.get({
                publicKey,
            })) as PublicKeyCredential | null;
            if (!credential) {
                throw new Error(t('Passkey login was cancelled'));
            }
            const verifyResponse = await fetch(
                `${API_BASE_URL}/v0/front/login/passkey/verify?username=${encodeURIComponent(
                    formData.username.trim()
                )}`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(credentialToJSON(credential)),
                }
            );
            if (!verifyResponse.ok) {
                const data: ApiError = await verifyResponse.json();
                throw new Error(data.error || t('Login failed'));
            }
            const data: LoginResponse = await verifyResponse.json();
            handleLoginSuccess(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('Login failed'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-background-light dark:bg-background-dark text-slate-900 dark:text-white font-display min-h-screen flex flex-col antialiased overflow-x-hidden selection:bg-primary/30 selection:text-white">
            <div className="relative flex flex-1 flex-col items-center justify-center p-4 sm:p-6 lg:p-8">
                {/* Background Decor */}
                <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
                    <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-primary/5 blur-[120px]" />
                    <div className="absolute top-[40%] -right-[10%] w-[40%] h-[40%] rounded-full bg-[#232f48]/20 blur-[100px]" />
                </div>

                {/* Login Card Wrapper */}
                <div className="relative w-full max-w-5xl bg-[#111722] border border-[#232f48] rounded-2xl shadow-2xl flex flex-col md:flex-row overflow-hidden z-10 min-h-[600px]">
                    {/* Left Side: Form Area */}
                    <div className="flex-1 flex flex-col p-8 md:p-12 lg:p-16 justify-center">
                        {/* Branding Header */}
                        <div className="flex items-center gap-3 mb-10">
                            <div className="size-8 text-primary">
                                <Logo />
                            </div>
                            <h2 className="text-white text-xl font-bold leading-tight tracking-[-0.015em]">
                                CLIProxyAPI
                            </h2>
                        </div>

                        {/* Text Content */}
                        <div className="mb-8">
                            <h1 className="text-white text-3xl font-bold leading-tight tracking-[-0.015em] mb-3">
                                {t('Welcome Back')}
                            </h1>
                            <p className="text-[#92a4c9] text-base font-normal leading-normal">
                                {t('Sign in to access your API relay dashboard.')}
                            </p>
                        </div>

                        {/* Success Message */}
                        {successMessage && (
                            <div className="mb-5 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm">
                                {successMessage}
                            </div>
                        )}

                        {/* Error Message */}
                        {error && (
                            <div className="mb-5 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                                {error}
                            </div>
                        )}

                        {/* Login Form */}
                        <form
                            className="flex flex-col gap-5 w-full max-w-md"
                            onSubmit={handleSubmit}
                        >
                            {/* Username Field */}
                            <label className="flex flex-col gap-2">
                                <span className="text-white text-sm font-medium leading-normal">
                                    {t('Username')}
                                </span>
                                <div className="flex w-full items-stretch rounded-lg group focus-within:ring-2 focus-within:ring-primary/50 transition-all">
                                    <input
                                        className="form-input flex-1 w-full rounded-l-lg border border-r-0 border-[#324467] bg-[#192233] text-white placeholder:text-[#92a4c9] px-4 h-12 text-base focus:outline-none focus:border-primary focus:ring-0 transition-colors"
                                        placeholder={t('Enter your username')}
                                        type="text"
                                        name="username"
                                        value={formData.username}
                                        onChange={handleInputChange}
                                        disabled={loading}
                                    />
                                    <div className="flex items-center justify-center px-4 bg-[#192233] border border-l-0 border-[#324467] rounded-r-lg text-[#92a4c9] group-focus-within:border-primary group-focus-within:text-white transition-colors">
                                        <Icon name="person" />
                                    </div>
                                </div>
                            </label>

                            {step === 'password' ? (
                                <label className="flex flex-col gap-2">
                                    <div className="flex justify-between items-center">
                                        <span className="text-white text-sm font-medium leading-normal">
                                            {t('Password')}
                                        </span>
                                        <Link
                                            to="/reset-password"
                                            className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                                        >
                                            {t('Forgot Password?')}
                                        </Link>
                                    </div>
                                    <div className="flex w-full items-stretch rounded-lg group focus-within:ring-2 focus-within:ring-primary/50 transition-all">
                                        <input
                                            className="form-input flex-1 w-full rounded-l-lg border border-r-0 border-[#324467] bg-[#192233] text-white placeholder:text-[#92a4c9] px-4 h-12 text-base focus:outline-none focus:border-primary focus:ring-0 transition-colors"
                                            placeholder={t('Enter your password')}
                                            type={showPassword ? 'text' : 'password'}
                                            name="password"
                                            value={formData.password}
                                            onChange={handleInputChange}
                                            disabled={loading}
                                        />
                                        <div
                                            className="flex items-center justify-center px-4 bg-[#192233] border border-l-0 border-[#324467] rounded-r-lg text-[#92a4c9] group-focus-within:border-primary group-focus-within:text-white transition-colors cursor-pointer hover:bg-[#232f48]"
                                            onClick={() => setShowPassword(!showPassword)}
                                        >
                                            <Icon
                                                name={
                                                    showPassword
                                                        ? 'visibility_off'
                                                        : 'visibility'
                                                }
                                            />
                                        </div>
                                    </div>
                                </label>
                            ) : null}

                            {step === 'mfa' && mfaMethods.totp_enabled ? (
                                <label className="flex flex-col gap-2">
                                    <span className="text-white text-sm font-medium leading-normal">
                                        {t('TOTP Code')}
                                    </span>
                                    <div className="flex w-full items-stretch rounded-lg group focus-within:ring-2 focus-within:ring-primary/50 transition-all">
                                        <input
                                            className="form-input flex-1 w-full rounded-lg border border-[#324467] bg-[#192233] text-white placeholder:text-[#92a4c9] px-4 h-12 text-base focus:outline-none focus:border-primary focus:ring-0 transition-colors"
                                            placeholder={t('Enter 6-digit code')}
                                            type="text"
                                            value={totpCode}
                                            onChange={(event) => setTotpCode(event.target.value)}
                                            disabled={loading}
                                        />
                                    </div>
                                </label>
                            ) : null}

                            {step === 'mfa' && mfaMethods.passkey_enabled ? (
                                <button
                                    type="button"
                                    disabled={loading}
                                    onClick={handlePasskeyLogin}
                                    className="flex w-full items-center justify-center overflow-hidden rounded-lg h-12 px-6 border border-primary/40 text-primary text-base font-bold leading-normal tracking-[0.015em] transition-all hover:bg-primary/10"
                                >
                                    {t('Use Passkey')}
                                </button>
                            ) : null}

                            {step !== 'mfa' || mfaMethods.totp_enabled ? (
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="mt-2 flex w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg h-12 px-6 bg-primary hover:bg-blue-600 text-white text-base font-bold leading-normal tracking-[0.015em] transition-all shadow-[0_0_15px_rgba(19,91,236,0.3)] hover:shadow-[0_0_20px_rgba(19,91,236,0.5)] disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {loading ? (
                                        <span className="flex items-center gap-2">
                                            <Icon name="progress_activity" className="animate-spin" />
                                            {t('Working...')}
                                        </span>
                                    ) : (
                                        <span className="truncate">
                                            {step === 'username'
                                                ? t('Continue')
                                                : step === 'password'
                                                    ? t('Sign In')
                                                    : t('Verify TOTP')}
                                        </span>
                                    )}
                                </button>
                            ) : null}
                            {step !== 'username' ? (
                                <button
                                    type="button"
                                    disabled={loading}
                                    onClick={() => {
                                        setStep('username');
                                        setFormData((prev) => ({ ...prev, password: '' }));
                                        setTotpCode('');
                                    }}
                                    className="text-sm text-primary hover:text-primary/80 transition-colors"
                                >
                                    {t('Use a different username')}
                                </button>
                            ) : null}
                        </form>

                        {/* Footer Links */}
                        <div className="mt-8 flex items-center justify-between text-sm text-[#92a4c9]">
                            <div className="flex gap-1">
                                <span>{t("Don't have an account?")}</span>
                                <Link
                                    to="/register"
                                    className="text-white font-medium hover:text-primary transition-colors"
                                >
                                    {t('Sign Up')}
                                </Link>
                            </div>
                        </div>
                        <div className="mt-auto pt-8 flex items-center gap-4 text-xs text-[#64748b]">
                            <LanguageSwitcher variant="dark" size="sm" menuDirection="up" menuAlign="left" />
                            <a
                                className="hover:text-[#92a4c9] transition-colors"
                                href="#"
                            >
                                {t('Privacy Policy')}
                            </a>
                            <a
                                className="hover:text-[#92a4c9] transition-colors"
                                href="#"
                            >
                                {t('Terms of Service')}
                            </a>
                        </div>
                    </div>

                    {/* Right Side: Visual/Context Panel */}
                    <div className="hidden md:flex md:w-1/2 relative flex-col justify-end overflow-hidden bg-[#0f1520]">
                        {/* Background Image with Overlay */}
                        <div
                            className="absolute inset-0 bg-cover bg-center z-0"
                            style={{
                                backgroundImage:
                                    "url('https://lh3.googleusercontent.com/aida-public/AB6AXuASHkOXDo6LZ_iWhAKtRmpFLt2f0gUcUmChHP41VF4jlbYI7u3VAAO8p9km2HBcIoGc_kpIJe5NJMxhjqOXv3-5wGCTYF8VOB19bcNghnih07-A1ZTJfmVQOM_8HyEEelUZBwQNJeneLvt9jfAjmyQksBAAyvfx__qBHwhgJ_sGdWYq4sl4ZlOzhP3JzXt6-0TD4jNdv5stegLf6dxFOGu6stGC-l3esJfytOPKeyFhLSzvNGj4I4V7WOPz_Wsg5FN7-0tpf1GDnWly')",
                            }}
                        />
                        {/* Gradient Overlay */}
                        <div className="absolute inset-0 bg-linear-to-t from-[#111722] via-[#111722]/80 to-primary/10 z-10" />

                        {/* Content */}
                        <div className="relative z-20 p-8 md:p-12 lg:p-16 flex flex-col gap-6">
                            <div className="size-12 rounded-lg bg-primary/20 flex items-center justify-center backdrop-blur-xs border border-primary/30 text-primary">
                                <Icon name="dns" size={28} />
                            </div>
                            <div className="space-y-2">
                                <h3 className="text-white text-2xl font-bold leading-tight">
                                    {t('Enterprise API Relay')}
                                </h3>
                                <p className="text-[#92a4c9] text-base font-medium leading-relaxed max-w-sm">
                                    {t(
                                        'Secure, high-performance gateway for your large model infrastructure. Monitor throughput and manage keys in real-time.'
                                    )}
                                </p>
                            </div>

                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
