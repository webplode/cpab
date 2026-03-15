import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../components/Icon';
import { API_BASE_URL } from '../api/config';
import { useTranslation } from 'react-i18next';

interface InitFormData {
    databaseType: string;
    databaseHost: string;
    databasePort: string;
    databaseUser: string;
    databasePassword: string;
    databaseName: string;
    databaseSSLMode: string;
    databasePath: string;
    siteName: string;
    adminUsername: string;
    adminPassword: string;
    confirmPassword: string;
}

interface ApiError {
    error: string;
}

interface InitPrefillResponse {
    locked: boolean;
    database_type?: string;
    database_host?: string;
    database_port?: number;
    database_user?: string;
    database_name?: string;
    database_ssl_mode?: string;
    database_path?: string;
    database_password_set?: boolean;
}

interface DropdownOption {
    value: string;
    label: string;
}

interface DropdownMenuProps {
    anchorId: string;
    options: DropdownOption[];
    value: string;
    menuWidth?: number;
    onSelect: (value: string) => void;
    onClose: () => void;
}

function DropdownMenu({ anchorId, options, value, menuWidth, onSelect, onClose }: DropdownMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState(() => {
        const btn = document.getElementById(anchorId);
        if (!btn) {
            return { top: 0, left: 0, width: menuWidth || 0 };
        }
        const rect = btn.getBoundingClientRect();
        return {
            top: rect.bottom + 4,
            left: rect.left,
            width: rect.width || menuWidth || 0,
        };
    });

    useEffect(() => {
        const update = () => {
            const btn = document.getElementById(anchorId);
            if (!btn) return;
            const rect = btn.getBoundingClientRect();
            setPosition({
                top: rect.bottom + 4,
                left: rect.left,
                width: rect.width || menuWidth || 0,
            });
        };

        update();
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => {
            window.removeEventListener('resize', update);
            window.removeEventListener('scroll', update, true);
        };
    }, [anchorId, menuWidth]);

    return createPortal(
        <>
            <div className="fixed inset-0 z-40" onClick={onClose} />
            <div
                ref={menuRef}
                className="fixed z-50 bg-surface-dark border border-border-dark rounded-lg shadow-lg overflow-hidden"
                style={{ top: position.top, left: position.left, width: position.width || menuWidth }}
            >
                {options.map((opt) => (
                    <button
                        key={opt.value}
                        type="button"
                        onClick={() => onSelect(opt.value)}
                        className={`w-full text-left px-4 py-2.5 text-sm hover:bg-background-dark transition-colors ${
                            value === opt.value ? 'bg-background-dark text-primary font-medium' : 'text-white'
                        }`}
                    >
                        {opt.label}
                    </button>
                ))}
            </div>
        </>,
        document.body
    );
}

const SSL_MODE_OPTIONS = [
    { value: 'disable', label: 'disable' },
    { value: 'require', label: 'require' },
    { value: 'verify-ca', label: 'verify-ca' },
    { value: 'verify-full', label: 'verify-full' },
];

export function Init() {
    const { t } = useTranslation();
    const [showPassword, setShowPassword] = useState(false);
    const [showDbPassword, setShowDbPassword] = useState(false);
    const [dbLocked, setDbLocked] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [dbTypeOpen, setDbTypeOpen] = useState(false);
    const [sslModeOpen, setSSLModeOpen] = useState(false);
    const [formData, setFormData] = useState<InitFormData>({
        databaseType: 'postgres',
        databaseHost: 'localhost',
        databasePort: '5432',
        databaseUser: '',
        databasePassword: '',
        databaseName: 'cpab',
        databaseSSLMode: 'disable',
        databasePath: 'cpab.db',
        siteName: 'CLIProxyAPI',
        adminUsername: 'admin',
        adminPassword: '',
        confirmPassword: '',
    });
    const dbTypeOptions = useMemo<DropdownOption[]>(
        () => [
            { value: 'postgres', label: t('PostgreSQL') },
            { value: 'sqlite', label: t('SQLite') },
        ],
        [t]
    );

    useEffect(() => {
        const loadPrefill = async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/v0/init/prefill`);
                if (!response.ok) {
                    return;
                }
                const data: InitPrefillResponse = await response.json();
                if (!data.locked) {
                    return;
                }

                setDbLocked(true);
                setDbTypeOpen(false);
                setSSLModeOpen(false);
                setFormData((prev) => ({
                    ...prev,
                    databaseType: data.database_type || prev.databaseType,
                    databaseHost: data.database_host || prev.databaseHost,
                    databasePort: data.database_port ? String(data.database_port) : prev.databasePort,
                    databaseUser: data.database_user || prev.databaseUser,
                    databasePassword: data.database_password_set ? '********' : '',
                    databaseName: data.database_name || prev.databaseName,
                    databaseSSLMode: data.database_ssl_mode || prev.databaseSSLMode,
                    databasePath: data.database_path || prev.databasePath,
                }));
            } catch {
                // Ignore prefill errors and fall back to editable defaults.
            }
        };

        void loadPrefill();
    }, []);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
        setError(null);
    };

    const handleDbTypeSelect = (value: string) => {
        setFormData((prev) => ({ ...prev, databaseType: value }));
        setDbTypeOpen(false);
        setError(null);
    };

    const handleSSLModeSelect = (value: string) => {
        setFormData((prev) => ({ ...prev, databaseSSLMode: value }));
        setSSLModeOpen(false);
        setError(null);
    };

    const measureMenuWidth = useCallback((options: string[]) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return undefined;
        }
        ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
        let maxWidth = 0;
        for (const opt of options) {
            const width = ctx.measureText(opt).width;
            if (width > maxWidth) maxWidth = width;
        }
        return Math.ceil(maxWidth) + 76;
    }, []);

    const dbTypeBtnWidth = useMemo(
        () => measureMenuWidth(dbTypeOptions.map((opt) => opt.label)),
        [dbTypeOptions, measureMenuWidth]
    );
    const sslModeBtnWidth = useMemo(
        () => measureMenuWidth(SSL_MODE_OPTIONS.map((opt) => opt.label)),
        [measureMenuWidth]
    );

    const validateForm = (): string | null => {
        if (!dbLocked) {
            if (formData.databaseType === 'postgres') {
                if (!formData.databaseHost.trim()) {
                    return t('Database host is required');
                }
                if (!formData.databasePort.trim() || isNaN(parseInt(formData.databasePort))) {
                    return t('Invalid database port');
                }
                if (!formData.databaseUser.trim()) {
                    return t('Database username is required');
                }
                if (!formData.databasePassword.trim()) {
                    return t('Database password is required');
                }
                if (!formData.databaseName.trim()) {
                    return t('Database name is required');
                }
            } else if (formData.databaseType === 'sqlite') {
                if (!formData.databasePath.trim()) {
                    return t('Database path is required');
                }
            }
        }
        if (!formData.siteName.trim()) {
            return t('Site name is required');
        }
        if (!formData.adminUsername.trim()) {
            return t('Admin username is required');
        }
        if (!formData.adminPassword.trim()) {
            return t('Admin password is required');
        }
        if (formData.adminPassword.length < 6) {
            return t('Admin password must be at least 6 characters');
        }
        if (formData.adminPassword !== formData.confirmPassword) {
            return t('Passwords do not match');
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
            const requestBody = dbLocked
                ? {
                      site_name: formData.siteName.trim(),
                      admin_username: formData.adminUsername.trim(),
                      admin_password: formData.adminPassword,
                  }
                : {
                      database_type: formData.databaseType,
                      database_host: formData.databaseHost.trim(),
                      database_port: parseInt(formData.databasePort),
                      database_user: formData.databaseUser.trim(),
                      database_password: formData.databasePassword,
                      database_name: formData.databaseName.trim(),
                      database_ssl_mode: formData.databaseSSLMode,
                      database_path: formData.databasePath.trim(),
                      site_name: formData.siteName.trim(),
                      admin_username: formData.adminUsername.trim(),
                      admin_password: formData.adminPassword,
                  };

            const response = await fetch(`${API_BASE_URL}/v0/init/setup`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                const data: ApiError = await response.json();
                throw new Error(data.error || t('Initialization failed'));
            }

            setSuccess(true);
            setTimeout(() => {
                window.location.href = '/admin/login';
            }, 2000);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('Initialization failed'));
        } finally {
            setLoading(false);
        }
    };

    if (success) {
        return (
            <div className="bg-background-light dark:bg-background-dark text-slate-900 dark:text-white font-display antialiased overflow-y-auto min-h-screen flex flex-col">
                <main className="flex-1 flex items-center justify-center p-4 sm:p-8 relative">
                    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
                        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-green-500/5 rounded-full blur-[120px]" />
                        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-green-500/5 rounded-full blur-[100px]" />
                    </div>

                    <div className="layout-content-container flex flex-col w-full max-w-[520px] z-10">
                        <div className="bg-surface-dark/50 backdrop-blur-xs border border-border-dark rounded-xl p-6 sm:p-10 shadow-2xl text-center">
                            <div className="mx-auto bg-green-500/10 p-4 rounded-full mb-4">
                                <Icon name="check_circle" size={48} className="text-green-500" />
                            </div>
                            <h1 className="text-white text-2xl sm:text-[28px] font-bold leading-tight tracking-[-0.015em] mb-2">
                                {t('Initialization Successful!')}
                            </h1>
                            <p className="text-slate-400 text-base font-normal leading-normal">
                                {t('System configuration completed. Redirecting to admin login...')}
                            </p>
                        </div>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className="bg-background-light dark:bg-background-dark text-slate-900 dark:text-white font-display antialiased overflow-y-auto min-h-screen flex flex-col">
            <main className="flex-1 flex items-center justify-center p-4 sm:p-8 relative">
                <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
                    <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[120px]" />
                    <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-blue-500/5 rounded-full blur-[100px]" />
                </div>

                <div className="layout-content-container flex flex-col w-full max-w-[600px] z-10">
                    <div className="bg-surface-dark/50 backdrop-blur-xs border border-border-dark rounded-xl p-6 sm:p-10 shadow-2xl">
                        <div className="flex flex-col gap-2 text-center mb-8">
                            <div className="mx-auto bg-primary/10 w-12 h-12 rounded-full mb-2 flex items-center justify-center">
                                <Icon name="settings" size={28} className="text-primary" />
                            </div>
                            <h1 className="text-white text-2xl sm:text-[28px] font-bold leading-tight tracking-[-0.015em]">
                                {t('System Initialization')}
                            </h1>
                            <p className="text-slate-400 text-base font-normal leading-normal">
                                {t('First-time setup requires database connection and admin account configuration.')}
                            </p>
                        </div>

                        {error && (
                            <div className="mb-5 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                                {error}
                            </div>
                        )}

                        <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
                            <div className="border-b border-border-dark pb-6">
                                <h2 className="text-white text-lg font-semibold mb-4 flex items-center gap-2">
                                    <Icon name="database" size={20} className="text-slate-400" />
                                    {t('Database Configuration')}
                                </h2>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="flex flex-col w-full">
                                        <p className="text-white text-sm font-medium leading-normal pb-2">
                                            {t('Database Type')}
                                        </p>
                                        <button
                                            id="db-type-dropdown-btn"
                                            type="button"
                                            onClick={() => {
                                                if (loading || dbLocked) return;
                                                setDbTypeOpen((open) => !open);
                                                setSSLModeOpen(false);
                                            }}
                                            disabled={loading || dbLocked}
                                            className="form-input flex items-center justify-between rounded-lg text-white focus:outline-0 focus:ring-2 focus:ring-primary/50 border border-[#324467] bg-surface-dark h-12 px-4 text-base font-normal leading-normal transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                            style={dbTypeBtnWidth ? { width: dbTypeBtnWidth } : undefined}
                                        >
                                            <span>{dbTypeOptions.find((opt) => opt.value === formData.databaseType)?.label}</span>
                                            <Icon name={dbTypeOpen ? 'expand_less' : 'expand_more'} size={20} className="text-slate-400" />
                                        </button>
                                        {dbTypeOpen && (
                                            <DropdownMenu
                                                anchorId="db-type-dropdown-btn"
                                                options={dbTypeOptions}
                                                value={formData.databaseType}
                                                menuWidth={dbTypeBtnWidth}
                                                onSelect={handleDbTypeSelect}
                                                onClose={() => setDbTypeOpen(false)}
                                            />
                                        )}
                                    </div>
                                </div>

                                {formData.databaseType === 'sqlite' ? (
                                    <div className="mt-4">
                                        <label className="flex flex-col w-full">
                                            <p className="text-white text-sm font-medium leading-normal pb-2">
                                                {t('Database Path')}
                                            </p>
                                            <input
                                                className="form-input flex w-full min-w-0 resize-none overflow-hidden rounded-lg text-white focus:outline-0 focus:ring-2 focus:ring-primary/50 border border-[#324467] bg-surface-dark h-12 placeholder:text-slate-500 px-4 text-base font-normal leading-normal transition-all"
                                                placeholder="cpab.db"
                                                type="text"
                                                name="databasePath"
                                                value={formData.databasePath}
                                                onChange={handleInputChange}
                                                disabled={loading || dbLocked}
                                            />
                                        </label>
                                    </div>
                                ) : (
                                    <>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                                            <label className="flex flex-col w-full">
                                                <p className="text-white text-sm font-medium leading-normal pb-2">
                                                    {t('Host')}
                                                </p>
                                                <input
                                                    className="form-input flex w-full min-w-0 resize-none overflow-hidden rounded-lg text-white focus:outline-0 focus:ring-2 focus:ring-primary/50 border border-[#324467] bg-surface-dark h-12 placeholder:text-slate-500 px-4 text-base font-normal leading-normal transition-all"
                                                    placeholder="localhost"
                                                    type="text"
                                                    name="databaseHost"
                                                    value={formData.databaseHost}
                                                    onChange={handleInputChange}
                                                    disabled={loading || dbLocked}
                                                />
                                            </label>

                                            <label className="flex flex-col w-full">
                                                <p className="text-white text-sm font-medium leading-normal pb-2">
                                                    {t('Port')}
                                                </p>
                                                <input
                                                    className="form-input flex w-full min-w-0 resize-none overflow-hidden rounded-lg text-white focus:outline-0 focus:ring-2 focus:ring-primary/50 border border-[#324467] bg-surface-dark h-12 placeholder:text-slate-500 px-4 text-base font-normal leading-normal transition-all"
                                                    placeholder="5432"
                                                    type="text"
                                                    name="databasePort"
                                                    value={formData.databasePort}
                                                    onChange={handleInputChange}
                                                    disabled={loading || dbLocked}
                                                />
                                            </label>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                                            <label className="flex flex-col w-full">
                                                <p className="text-white text-sm font-medium leading-normal pb-2">
                                                    {t('Username')}
                                                </p>
                                                <input
                                                    className="form-input flex w-full min-w-0 resize-none overflow-hidden rounded-lg text-white focus:outline-0 focus:ring-2 focus:ring-primary/50 border border-[#324467] bg-surface-dark h-12 placeholder:text-slate-500 px-4 text-base font-normal leading-normal transition-all"
                                                    placeholder="postgres"
                                                    type="text"
                                                    name="databaseUser"
                                                    value={formData.databaseUser}
                                                    onChange={handleInputChange}
                                                    disabled={loading || dbLocked}
                                                />
                                            </label>

                                            <label className="flex flex-col w-full">
                                                <p className="text-white text-sm font-medium leading-normal pb-2">
                                                    {t('Password')}
                                                </p>
                                                <div className="relative">
                                                    <input
                                                        className="form-input flex w-full min-w-0 resize-none overflow-hidden rounded-lg text-white focus:outline-0 focus:ring-2 focus:ring-primary/50 border border-[#324467] bg-surface-dark h-12 placeholder:text-slate-500 px-4 pr-11 text-base font-normal leading-normal transition-all"
                                                        placeholder="••••••••"
                                                        type={showDbPassword ? 'text' : 'password'}
                                                        name="databasePassword"
                                                        value={formData.databasePassword}
                                                        onChange={handleInputChange}
                                                        disabled={loading || dbLocked}
                                                    />
                                                    <button
                                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors cursor-pointer flex items-center justify-center"
                                                        type="button"
                                                        onClick={() => setShowDbPassword(!showDbPassword)}
                                                    >
                                                        <Icon name={showDbPassword ? 'visibility_off' : 'visibility'} />
                                                    </button>
                                                </div>
                                            </label>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                                            <label className="flex flex-col w-full">
                                                <p className="text-white text-sm font-medium leading-normal pb-2">
                                                    {t('Database Name')}
                                                </p>
                                                <input
                                                    className="form-input flex w-full min-w-0 resize-none overflow-hidden rounded-lg text-white focus:outline-0 focus:ring-2 focus:ring-primary/50 border border-[#324467] bg-surface-dark h-12 placeholder:text-slate-500 px-4 text-base font-normal leading-normal transition-all"
                                                    placeholder="cpab"
                                                    type="text"
                                                    name="databaseName"
                                                    value={formData.databaseName}
                                                    onChange={handleInputChange}
                                                    disabled={loading || dbLocked}
                                                />
                                            </label>

                                            <div className="flex flex-col w-full">
                                                <p className="text-white text-sm font-medium leading-normal pb-2">
                                                    {t('SSL Mode')}
                                                </p>
                                                <button
                                                    id="ssl-mode-dropdown-btn"
                                                    type="button"
                                                    onClick={() => {
                                                        if (loading || dbLocked) return;
                                                        setSSLModeOpen((open) => !open);
                                                        setDbTypeOpen(false);
                                                    }}
                                                    disabled={loading || dbLocked}
                                                    className="form-input flex items-center justify-between rounded-lg text-white focus:outline-0 focus:ring-2 focus:ring-primary/50 border border-[#324467] bg-surface-dark h-12 px-4 text-base font-normal leading-normal transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                                    style={sslModeBtnWidth ? { width: sslModeBtnWidth } : undefined}
                                                >
                                                    <span>{formData.databaseSSLMode}</span>
                                                    <Icon name={sslModeOpen ? 'expand_less' : 'expand_more'} size={20} className="text-slate-400" />
                                                </button>
                                                {sslModeOpen && (
                                                    <DropdownMenu
                                                        anchorId="ssl-mode-dropdown-btn"
                                                        options={SSL_MODE_OPTIONS}
                                                        value={formData.databaseSSLMode}
                                                        menuWidth={sslModeBtnWidth}
                                                        onSelect={handleSSLModeSelect}
                                                        onClose={() => setSSLModeOpen(false)}
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>

                            <div>
                                <h2 className="text-white text-lg font-semibold mb-4 flex items-center gap-2">
                                    <Icon name="domain" size={20} className="text-slate-400" />
                                    {t('Site Configuration')}
                                </h2>

                                <label className="flex flex-col w-full">
                                    <p className="text-white text-sm font-medium leading-normal pb-2">
                                        {t('Site Name')}
                                    </p>
                                    <input
                                        className="form-input flex w-full min-w-0 resize-none overflow-hidden rounded-lg text-white focus:outline-0 focus:ring-2 focus:ring-primary/50 border border-[#324467] bg-surface-dark h-12 placeholder:text-slate-500 px-4 text-base font-normal leading-normal transition-all"
                                        placeholder="CLIProxyAPI"
                                        type="text"
                                        name="siteName"
                                        value={formData.siteName}
                                        onChange={handleInputChange}
                                        disabled={loading}
                                    />
                                </label>
                            </div>

                            <div className="border-t border-border-dark pt-6">
                                <h2 className="text-white text-lg font-semibold mb-4 flex items-center gap-2">
                                    <Icon name="admin_panel_settings" size={20} className="text-slate-400" />
                                    {t('Admin Account')}
                                </h2>

                                <label className="flex flex-col w-full">
                                    <p className="text-white text-sm font-medium leading-normal pb-2">
                                        {t('Admin Username')}
                                    </p>
                                    <div className="relative">
                                        <input
                                            className="form-input flex w-full min-w-0 resize-none overflow-hidden rounded-lg text-white focus:outline-0 focus:ring-2 focus:ring-primary/50 border border-[#324467] bg-surface-dark h-12 placeholder:text-slate-500 px-4 pl-11 text-base font-normal leading-normal transition-all"
                                            placeholder="admin"
                                            type="text"
                                            name="adminUsername"
                                            value={formData.adminUsername}
                                            onChange={handleInputChange}
                                            disabled={loading}
                                        />
                                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 flex items-center justify-center">
                                            <Icon name="person" />
                                        </div>
                                    </div>
                                </label>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                                    <label className="flex flex-col w-full">
                                        <p className="text-white text-sm font-medium leading-normal pb-2">
                                            {t('Password')}
                                        </p>
                                        <div className="relative">
                                            <input
                                                className="form-input flex w-full min-w-0 resize-none overflow-hidden rounded-lg text-white focus:outline-0 focus:ring-2 focus:ring-primary/50 border border-[#324467] bg-surface-dark h-12 placeholder:text-slate-500 px-4 pr-11 text-base font-normal leading-normal transition-all"
                                                placeholder="••••••••"
                                                type={showPassword ? 'text' : 'password'}
                                                name="adminPassword"
                                                value={formData.adminPassword}
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

                                    <label className="flex flex-col w-full">
                                        <p className="text-white text-sm font-medium leading-normal pb-2">
                                            {t('Confirm Password')}
                                        </p>
                                        <input
                                            className="form-input flex w-full min-w-0 resize-none overflow-hidden rounded-lg text-white focus:outline-0 focus:ring-2 focus:ring-primary/50 border border-[#324467] bg-surface-dark h-12 placeholder:text-slate-500 px-4 text-base font-normal leading-normal transition-all"
                                            placeholder="••••••••"
                                            type={showPassword ? 'text' : 'password'}
                                            name="confirmPassword"
                                            value={formData.confirmPassword}
                                            onChange={handleInputChange}
                                            disabled={loading}
                                        />
                                    </label>
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                className="mt-2 flex w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg h-12 px-4 bg-primary text-white text-base font-bold leading-normal tracking-[0.015em] hover:bg-blue-600 transition-colors shadow-lg shadow-primary/25 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {loading ? (
                                    <span className="flex items-center gap-2">
                                        <Icon name="progress_activity" className="animate-spin" />
                                        {t('Initializing...')}
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-2">
                                        <Icon name="rocket_launch" />
                                        {t('Start Initialization')}
                                    </span>
                                )}
                            </button>
                        </form>
                    </div>
                </div>
            </main>
        </div>
    );
}
