import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { API_BASE_URL } from '../api/config';
import { useTranslation } from 'react-i18next';

interface RegisterFormData {
    username: string;
    email: string;
    password: string;
    confirmPassword: string;
}

interface ApiError {
    error: string;
}

export function Register() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [showPassword, setShowPassword] = useState(false);
    const [agreedToTerms, setAgreedToTerms] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [formData, setFormData] = useState<RegisterFormData>({
        username: '',
        email: '',
        password: '',
        confirmPassword: '',
    });

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
        setError(null);
    };

    const validateForm = (): string | null => {
        if (!formData.username.trim()) {
            return t('Username is required');
        }
        if (!formData.email.trim()) {
            return t('Email is required');
        }
        if (!formData.password.trim()) {
            return t('Password is required');
        }
        if (formData.password.length < 6) {
            return t('Password must be at least 6 characters');
        }
        if (formData.password !== formData.confirmPassword) {
            return t('Passwords do not match');
        }
        if (!agreedToTerms) {
            return t('You must agree to the Terms of Service and Privacy Policy');
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

        try {
            const response = await fetch(`${API_BASE_URL}/v0/front/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    username: formData.username.trim(),
                    email: formData.email.trim(),
                    password: formData.password,
                }),
            });

            if (!response.ok) {
                const data: ApiError = await response.json();
                throw new Error(data.error || t('Registration failed'));
            }

            navigate('/login', { state: { registered: true } });
        } catch (err) {
            setError(err instanceof Error ? err.message : t('Registration failed'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-background-light dark:bg-background-dark text-slate-900 dark:text-white font-display antialiased overflow-y-auto min-h-screen flex flex-col">
            {/* Main Content */}
            <main className="flex-1 flex items-center justify-center p-4 sm:p-8 relative">
                {/* Abstract Background Pattern */}
                <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
                    <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[120px]" />
                    <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-blue-500/5 rounded-full blur-[100px]" />
                </div>

                <div className="layout-content-container flex flex-col w-full max-w-[520px] z-10">
                    {/* Card Container */}
                    <div className="bg-surface-dark/50 backdrop-blur-xs border border-border-dark rounded-xl p-6 sm:p-10 shadow-2xl">
                        {/* Form Header */}
                        <div className="flex flex-col gap-2 text-center mb-8">
                            <div className="mx-auto bg-primary/10 h-12 w-12 rounded-full mb-2 inline-flex items-center justify-center">
                                <Icon name="person_add" size={32} className="text-primary" />
                            </div>
                            <h1 className="text-white text-2xl sm:text-[28px] font-bold leading-tight tracking-[-0.015em]">
                                {t('Create your account')}
                            </h1>
                            <p className="text-slate-400 text-base font-normal leading-normal">
                                {t('Start relaying large model APIs with enterprise-grade reliability.')}
                            </p>
                        </div>

                        {/* Error Message */}
                        {error && (
                            <div className="mb-5 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                                {error}
                            </div>
                        )}

                        {/* Registration Form */}
                        <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
                            {/* Username Field */}
                            <label className="flex flex-col w-full">
                                <p className="text-white text-sm font-medium leading-normal pb-2">
                                    {t('Username')}
                                </p>
                                <div className="relative">
                                    <input
                                        className="form-input flex w-full min-w-0 resize-none overflow-hidden rounded-lg text-white focus:outline-0 focus:ring-2 focus:ring-primary/50 border border-[#324467] bg-surface-dark h-12 placeholder:text-slate-500 px-4 pl-11 text-base font-normal leading-normal transition-all"
                                        placeholder={t('johndoe')}
                                        type="text"
                                        name="username"
                                        value={formData.username}
                                        onChange={handleInputChange}
                                        disabled={loading}
                                    />
                                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 flex items-center justify-center">
                                        <Icon name="person" />
                                    </div>
                                </div>
                            </label>

                            {/* Email Field */}
                            <label className="flex flex-col w-full">
                                <p className="text-white text-sm font-medium leading-normal pb-2">
                                    {t('Email')}
                                </p>
                                <div className="relative">
                                    <input
                                        className="form-input flex w-full min-w-0 flex-1 resize-none overflow-hidden rounded-lg text-white focus:outline-0 focus:ring-2 focus:ring-primary/50 border border-[#324467] bg-surface-dark h-12 placeholder:text-slate-500 px-4 pl-11 text-base font-normal leading-normal transition-all"
                                        placeholder={t('name@company.com')}
                                        type="email"
                                        name="email"
                                        value={formData.email}
                                        onChange={handleInputChange}
                                        disabled={loading}
                                    />
                                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 flex items-center justify-center">
                                        <Icon name="mail" />
                                    </div>
                                </div>
                            </label>

                            {/* Password Field */}
                            <label className="flex flex-col w-full">
                                <p className="text-white text-sm font-medium leading-normal pb-2">
                                    {t('Password')}
                                </p>
                                <div className="relative">
                                    <input
                                        className="form-input flex w-full min-w-0 flex-1 resize-none overflow-hidden rounded-lg text-white focus:outline-0 focus:ring-2 focus:ring-primary/50 border border-[#324467] bg-surface-dark h-12 placeholder:text-slate-500 px-4 text-base font-normal leading-normal transition-all"
                                        placeholder="••••••••"
                                        type={showPassword ? 'text' : 'password'}
                                        name="password"
                                        value={formData.password}
                                        onChange={handleInputChange}
                                        disabled={loading}
                                    />
                                    <button
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors cursor-pointer flex items-center justify-center"
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                    >
                                        <Icon name={showPassword ? 'visibility_off' : 'visibility'} />
                                    </button>
                                </div>
                            </label>

                            {/* Confirm Password Field */}
                            <label className="flex flex-col w-full">
                                <p className="text-white text-sm font-medium leading-normal pb-2">
                                    {t('Confirm Password')}
                                </p>
                                <div className="relative">
                                    <input
                                        className="form-input flex w-full min-w-0 flex-1 resize-none overflow-hidden rounded-lg text-white focus:outline-0 focus:ring-2 focus:ring-primary/50 border border-[#324467] bg-surface-dark h-12 placeholder:text-slate-500 px-4 text-base font-normal leading-normal transition-all"
                                        placeholder="••••••••"
                                        type={showPassword ? 'text' : 'password'}
                                        name="confirmPassword"
                                        value={formData.confirmPassword}
                                        onChange={handleInputChange}
                                        disabled={loading}
                                    />
                                </div>
                            </label>

                            {/* Terms Checkbox */}
                            <label className="flex items-start gap-3 mt-1 cursor-pointer group">
                                <div className="relative flex items-center">
                                    <input
                                        className="peer h-5 w-5 cursor-pointer appearance-none rounded border border-[#324467] bg-surface-dark checked:bg-primary checked:border-primary transition-all focus:ring-0 focus:ring-offset-0"
                                        type="checkbox"
                                        checked={agreedToTerms}
                                        onChange={(e) => setAgreedToTerms(e.target.checked)}
                                        disabled={loading}
                                    />
                                    <span className="absolute inset-0 flex items-center justify-center text-white opacity-0 peer-checked:opacity-100 pointer-events-none">
                                        <Icon name="check" size={16} className="font-bold leading-none" />
                                    </span>
                                </div>
                                <span className="text-sm text-slate-400 leading-tight group-hover:text-slate-300 transition-colors">
                                    {t('I agree to the')}{' '}
                                    <a className="text-primary hover:text-blue-400 hover:underline" href="#">
                                        {t('Terms of Service')}
                                    </a>{' '}
                                    {t('and')}{' '}
                                    <a className="text-primary hover:text-blue-400 hover:underline" href="#">
                                        {t('Privacy Policy')}
                                    </a>
                                    {t('.')}
                                </span>
                            </label>

                            {/* Submit Button */}
                            <button
                                type="submit"
                                disabled={loading}
                                className="mt-2 flex w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg h-12 px-4 bg-primary text-white text-base font-bold leading-normal tracking-[0.015em] hover:bg-blue-600 transition-colors shadow-lg shadow-primary/25 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {loading ? (
                                    <span className="flex items-center gap-2">
                                        <Icon name="progress_activity" className="animate-spin" />
                                        {t('Creating Account...')}
                                    </span>
                                ) : (
                                    <span className="truncate">{t('Create Account')}</span>
                                )}
                            </button>
                        </form>

                        {/* Footer Link */}
                        <div className="mt-8 relative flex items-center justify-center px-12">
                            <div className="absolute left-0 top-1/2 -translate-y-1/2">
                                <LanguageSwitcher variant="dark" size="sm" menuDirection="up" menuAlign="left" />
                            </div>
                            <p className="text-slate-400 text-sm text-center">
                                {t('Already have an account?')}{' '}
                                <Link
                                    to="/login"
                                    className="text-primary font-bold hover:text-blue-400 hover:underline"
                                >
                                    {t('Log in')}
                                </Link>
                            </p>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
