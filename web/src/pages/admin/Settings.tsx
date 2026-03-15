import { useEffect, useMemo, useState } from 'react';
import { AdminDashboardLayout } from '../../components/admin/AdminDashboardLayout';
import { AdminNoAccessCard } from '../../components/admin/AdminNoAccessCard';
import { apiFetchAdmin } from '../../api/config';
import { Icon } from '../../components/Icon';
import { buildAdminPermissionKey, useAdminPermissions } from '../../utils/adminPermissions';
import { useStickyActionsDivider } from '../../utils/stickyActionsDivider';
import { useTranslation } from 'react-i18next';

type Translate = (key: string, options?: Record<string, unknown>) => string;

type SettingType = 'boolean' | 'integer' | 'float' | 'string' | 'text';

interface SettingDefinition {
    key: string;
    type: SettingType;
    description: string;
}

interface SettingRecord {
    key: string;
    value: unknown;
}

interface SettingsResponse {
    settings: SettingRecord[];
}

interface EditFormState {
    valueText: string;
    valueBool: boolean;
}

const SETTINGS_CATALOG: SettingDefinition[] = [
    {
        key: 'ONLY_MAPPED_MODELS',
        type: 'boolean',
        description: 'Only use mapped model list.',
    },
    {
        key: 'SITE_NAME',
        type: 'string',
        description: 'Site name displayed in UI.',
    },
    {
        key: 'WEB_AUTHN_ORIGIN',
        type: 'string',
        description: 'WebAuthn origin for passkey verification.',
    },
    {
        key: 'WEB_AUTHN_RPID',
        type: 'string',
        description: 'WebAuthn RP ID (domain only) for passkey verification.',
    },
    {
        key: 'WEB_AUTHN_ORIGINS',
        type: 'string',
        description: 'WebAuthn origins for passkey verification.',
    },
    {
        key: 'QUOTA_POLL_INTERVAL_SECONDS',
        type: 'integer',
        description: 'Quota polling interval in seconds.',
    },
    {
        key: 'QUOTA_POLL_MAX_CONCURRENCY',
        type: 'integer',
        description: 'Max concurrent quota polling requests (cap 5).',
    },
    {
        key: 'RATE_LIMIT',
        type: 'integer',
        description: 'Global rate limit per second.',
    },
    {
        key: 'RATE_LIMIT_REDIS_ENABLED',
        type: 'boolean',
        description: 'Enable Redis rate limiter.',
    },
    {
        key: 'RATE_LIMIT_REDIS_ADDR',
        type: 'string',
        description: 'Redis address for rate limiter.',
    },
    {
        key: 'RATE_LIMIT_REDIS_PASSWORD',
        type: 'string',
        description: 'Redis password for rate limiter.',
    },
    {
        key: 'RATE_LIMIT_REDIS_DB',
        type: 'integer',
        description: 'Redis database index for rate limiter.',
    },
    {
        key: 'RATE_LIMIT_REDIS_PREFIX',
        type: 'string',
        description: 'Redis key prefix for rate limiter.',
    },
    {
        key: 'AUTO_ASSIGN_PROXY',
        type: 'boolean',
        description: 'Auto assign proxy for new auth and API keys.',
    },
];

const TYPE_LABELS: Record<SettingType, string> = {
    boolean: 'Boolean',
    integer: 'Integer',
    float: 'Float',
    string: 'String',
    text: 'Multiline String',
};

const SETTING_EXAMPLES: Record<string, string> = {
    SITE_NAME: 'CLIProxyAPI',
    WEB_AUTHN_ORIGIN: 'https://domain or https://domain:port',
    WEB_AUTHN_RPID: 'domain (no scheme/port)',
    WEB_AUTHN_ORIGINS: 'https://domain or https://domain:port',
    QUOTA_POLL_INTERVAL_SECONDS: '180',
    QUOTA_POLL_MAX_CONCURRENCY: '5',
    RATE_LIMIT: '100',
    RATE_LIMIT_REDIS_ENABLED: 'true',
    RATE_LIMIT_REDIS_ADDR: 'localhost:6379',
    RATE_LIMIT_REDIS_PASSWORD: 'password',
    RATE_LIMIT_REDIS_DB: '0',
    RATE_LIMIT_REDIS_PREFIX: 'cpab:rl',
};

const POSITIVE_INTEGER_KEYS = new Set<string>([
    'QUOTA_POLL_INTERVAL_SECONDS',
    'QUOTA_POLL_MAX_CONCURRENCY',
]);
const NON_NEGATIVE_INTEGER_KEYS = new Set<string>([
    'RATE_LIMIT',
    'RATE_LIMIT_REDIS_DB',
]);

const inputClassName =
    'w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent';
const listInputClassName = inputClassName.replace('w-full', 'flex-1');

function normalizeOriginList(raw: unknown): string[] {
    if (Array.isArray(raw)) {
        return raw.map((item) => String(item).trim()).filter(Boolean);
    }
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return [];
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed.map((item) => String(item).trim()).filter(Boolean);
            }
        } catch {
            // Fallback to newline split.
        }
        return trimmed
            .split(/\r?\n/)
            .map((item) => item.trim())
            .filter(Boolean);
    }
    return [];
}

function normalizeValue(def: SettingDefinition, raw: unknown): unknown {
    if (raw === null || raw === undefined) {
        if (def.type === 'boolean') return false;
        if (def.type === 'integer') return 0;
        if (def.type === 'float') return 0;
        return '';
    }
    if (def.type === 'boolean') {
        if (typeof raw === 'boolean') return raw;
        if (typeof raw === 'string') return raw.toLowerCase() === 'true';
        return Boolean(raw);
    }
    if (def.type === 'integer') {
        if (typeof raw === 'number') return Math.trunc(raw);
        const parsed = parseInt(String(raw), 10);
        return Number.isNaN(parsed) ? 0 : parsed;
    }
    if (def.type === 'float') {
        if (typeof raw === 'number') return raw;
        const parsed = parseFloat(String(raw));
        return Number.isNaN(parsed) ? 0 : parsed;
    }
    if (typeof raw === 'string') return raw;
    return JSON.stringify(raw);
}

function formatValue(def: SettingDefinition, raw: unknown, t: Translate): string {
    if (def.key === 'WEB_AUTHN_ORIGINS') {
        return normalizeOriginList(raw).join(', ');
    }
    const normalized = normalizeValue(def, raw);
    if (def.type === 'boolean') {
        return normalized ? t('Enabled') : t('Disabled');
    }
    if (def.type === 'integer' || def.type === 'float') {
        return String(normalized);
    }
    return String(normalized || '');
}

function buildPayload(def: SettingDefinition, state: EditFormState): unknown {
    if (def.type === 'boolean') {
        return state.valueBool;
    }
    if (def.type === 'integer') {
        const parsed = parseInt(state.valueText.trim(), 10);
        return Number.isNaN(parsed) ? 0 : parsed;
    }
    if (def.type === 'float') {
        const parsed = parseFloat(state.valueText.trim());
        return Number.isNaN(parsed) ? 0 : parsed;
    }
    return state.valueText;
}

function buildOriginListPayload(entries: string[]): string[] {
    return entries.map((entry) => entry.trim()).filter(Boolean);
}

function EditSettingModal({
    setting,
    value,
    onClose,
    onSave,
    submitting,
}: {
    setting: SettingDefinition;
    value: unknown;
    onClose: () => void;
    onSave: (payload: unknown) => void;
    submitting: boolean;
}) {
    const { t } = useTranslation();
    const normalizedValue = normalizeValue(setting, value);
    const isOriginList = setting.key === 'WEB_AUTHN_ORIGINS';
    const requiresPositiveInteger =
        setting.type === 'integer' && POSITIVE_INTEGER_KEYS.has(setting.key);
    const requiresNonNegativeInteger =
        setting.type === 'integer' && NON_NEGATIVE_INTEGER_KEYS.has(setting.key);
    const exampleKey = SETTING_EXAMPLES[setting.key];
    const example = exampleKey ? t(exampleKey) : '';
    const [formState, setFormState] = useState<EditFormState>({
        valueText: String(
            setting.type === 'boolean' ? '' : (normalizedValue ?? '')
        ),
        valueBool: Boolean(normalizedValue),
    });
    const [formError, setFormError] = useState('');
    const [originList, setOriginList] = useState<string[]>(() => {
        if (!isOriginList) return [];
        const initial = normalizeOriginList(value);
        return initial.length > 0 ? initial : [''];
    });

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        if (requiresPositiveInteger) {
            const parsed = parseInt(formState.valueText.trim(), 10);
            if (Number.isNaN(parsed) || parsed <= 0) {
                setFormError(t('Value must be a positive integer.'));
                return;
            }
        } else if (requiresNonNegativeInteger) {
            const parsed = parseInt(formState.valueText.trim(), 10);
            if (Number.isNaN(parsed) || parsed < 0) {
                setFormError(t('Value must be a non-negative integer.'));
                return;
            }
        }
        setFormError('');
        const payload = isOriginList
            ? buildOriginListPayload(originList)
            : buildPayload(setting, formState);
        onSave(payload);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
            <div className="relative bg-white dark:bg-surface-dark rounded-xl shadow-xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden border border-gray-200 dark:border-border-dark">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-border-dark flex items-center justify-between shrink-0">
                    <div>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                            {t('Edit Setting')}
                        </h3>
                        <p className="text-sm text-slate-500 dark:text-text-secondary">
                            {t('Update the value only.')}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-background-dark transition-colors"
                    >
                        <Icon name="close" size={18} />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1.5">
                            {t('Key')}
                        </label>
                        <input
                            type="text"
                            value={setting.key}
                            disabled
                            className="w-full px-4 py-2.5 text-sm bg-gray-100 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-500 dark:text-text-secondary cursor-not-allowed"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1.5">
                            {t('Value')}
                        </label>
                        {isOriginList ? (
                            <div className="space-y-2">
                                {originList.map((origin, index) => (
                                    <div key={`${index}`} className="flex items-center gap-2">
                                        <input
                                            type="text"
                                            value={origin}
                                            onChange={(e) => {
                                                const next = [...originList];
                                                next[index] = e.target.value;
                                                setOriginList(next);
                                                setFormError('');
                                            }}
                                            placeholder={example}
                                            className={listInputClassName}
                                        />
                                        <div className="flex items-center gap-1">
                                            {index === originList.length - 1 && (
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setOriginList((prev) => [...prev, ''])
                                                    }
                                                    className="inline-flex items-center justify-center h-10 w-10 rounded-lg border border-gray-200 dark:border-border-dark text-gray-600 hover:bg-gray-100 dark:hover:bg-background-dark"
                                                    title={t('Add row')}
                                                >
                                                    <Icon name="add" size={18} />
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setOriginList((prev) =>
                                                        prev.length > 1
                                                            ? prev.filter((_, itemIndex) => itemIndex !== index)
                                                            : ['']
                                                    )
                                                }
                                                disabled={originList.length === 1}
                                                className="inline-flex items-center justify-center h-10 w-10 rounded-lg border border-gray-200 dark:border-border-dark text-gray-600 hover:bg-gray-100 dark:hover:bg-background-dark disabled:opacity-50 disabled:cursor-not-allowed"
                                                title={t('Remove row')}
                                            >
                                                <Icon name="delete" size={18} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : setting.type === 'boolean' ? (
                            <button
                                type="button"
                                onClick={() => {
                                    setFormState((prev) => ({
                                        ...prev,
                                        valueBool: !prev.valueBool,
                                    }));
                                    setFormError('');
                                }}
                                className={`w-full flex items-center justify-between px-4 py-2.5 text-sm rounded-lg border transition-colors ${
                                    formState.valueBool
                                        ? 'bg-green-50 border-green-200 text-green-700 dark:bg-green-900/30 dark:border-green-800 dark:text-green-200'
                                        : 'bg-gray-50 border-gray-200 text-slate-700 dark:bg-background-dark dark:border-border-dark dark:text-text-secondary'
                                }`}
                            >
                                <span>{formState.valueBool ? t('Enabled') : t('Disabled')}</span>
                                <span
                                    className={`inline-flex items-center w-10 h-6 rounded-full transition-colors ${
                                        formState.valueBool ? 'bg-green-500' : 'bg-gray-300'
                                    }`}
                                >
                                    <span
                                        className={`h-4 w-4 bg-white rounded-full shadow transform transition-transform ${
                                            formState.valueBool ? 'translate-x-4' : 'translate-x-1'
                                        }`}
                                    />
                                </span>
                            </button>
                        ) : setting.type === 'text' ? (
                            <textarea
                                rows={5}
                                value={formState.valueText}
                                onChange={(e) => {
                                    setFormState((prev) => ({ ...prev, valueText: e.target.value }));
                                    setFormError('');
                                }}
                                placeholder={example}
                                className={inputClassName}
                            />
                        ) : (
                            <input
                                type={setting.type === 'string' ? 'text' : 'number'}
                                step={setting.type === 'float' ? '0.01' : '1'}
                                value={formState.valueText}
                                onChange={(e) => {
                                    setFormState((prev) => ({ ...prev, valueText: e.target.value }));
                                    setFormError('');
                                }}
                                placeholder={example}
                                className={inputClassName}
                            />
                        )}
                        {formError ? (
                            <p className="mt-2 text-xs text-red-500">
                                {formError}
                            </p>
                        ) : null}
                    </div>
                </form>
                <div className="px-6 py-4 border-t border-gray-200 dark:border-border-dark flex justify-end gap-3 shrink-0">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 dark:border-border-dark text-slate-700 dark:text-text-secondary hover:bg-slate-50 dark:hover:bg-background-dark transition-colors"
                    >
                        {t('Cancel')}
                    </button>
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={submitting}
                        className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {submitting ? t('Saving...') : t('Save')}
                    </button>
                </div>
            </div>
        </div>
    );
}

export function AdminSettings() {
    const { t } = useTranslation();
    const { hasPermission } = useAdminPermissions();
    const [settingsMap, setSettingsMap] = useState<Record<string, unknown>>({});
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState<SettingDefinition | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const settingsList = useMemo(() => SETTINGS_CATALOG, []);
    const canListSettings = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/settings'));
    const canCreateSettings = hasPermission(buildAdminPermissionKey('POST', '/v0/admin/settings'));
    const canUpdateSettings = hasPermission(buildAdminPermissionKey('PUT', '/v0/admin/settings/:key'));
    const canEditSettings = canCreateSettings || canUpdateSettings;
    const columnCount = canEditSettings ? 5 : 4;
    const { tableScrollRef, handleTableScroll, showActionsDivider } = useStickyActionsDivider(
        settingsList.length,
        loading
    );

    useEffect(() => {
        if (!canListSettings) {
            setLoading(false);
            return;
        }
        let mounted = true;
        apiFetchAdmin<SettingsResponse>('/v0/admin/settings')
            .then((res) => {
                if (!mounted) return;
                const nextMap: Record<string, unknown> = {};
                for (const item of res.settings || []) {
                    nextMap[item.key] = item.value;
                }
                setSettingsMap(nextMap);
            })
            .catch(console.error)
            .finally(() => {
                if (mounted) setLoading(false);
            });
        return () => {
            mounted = false;
        };
    }, [canListSettings]);

    const handleSave = async (payload: unknown) => {
        if (!editing) return;
        if (!canEditSettings) return;
        setSubmitting(true);
        try {
            if (canUpdateSettings) {
                try {
                    await apiFetchAdmin(`/v0/admin/settings/${editing.key}`, {
                        method: 'PUT',
                        body: JSON.stringify({ value: payload }),
                    });
                    setSettingsMap((prev) => ({ ...prev, [editing.key]: payload }));
                    setEditing(null);
                    return;
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    if (!message.toLowerCase().includes('not found') && !message.includes('404')) {
                        throw err;
                    }
                }
            }

            if (canCreateSettings) {
                await apiFetchAdmin('/v0/admin/settings', {
                    method: 'POST',
                    body: JSON.stringify({ key: editing.key, value: payload }),
                });
                setSettingsMap((prev) => ({ ...prev, [editing.key]: payload }));
                setEditing(null);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setSubmitting(false);
        }
    };

    if (!canListSettings) {
        return (
            <AdminDashboardLayout title={t('Settings')} subtitle={t('Manage system settings.')}>
                <AdminNoAccessCard />
            </AdminDashboardLayout>
        );
    }

    return (
        <AdminDashboardLayout title={t('Settings')} subtitle={t('Manage fixed system settings.')}>
            <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-sm overflow-hidden">
                <div ref={tableScrollRef} className="overflow-x-auto" onScroll={handleTableScroll}>
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 dark:bg-surface-dark text-gray-500 dark:text-gray-400 uppercase text-xs font-semibold border-b border-gray-200 dark:border-border-dark">
                            <tr>
                                <th className="px-6 py-4">
                                    {t('Key')}
                                </th>
                                <th className="px-6 py-4">
                                    {t('Value')}
                                </th>
                                <th className="px-6 py-4">
                                    {t('Type')}
                                </th>
                                <th className="px-6 py-4">
                                    {t('Description')}
                                </th>
                                {canEditSettings && (
                                    <th
                                        className={`px-6 py-4 text-center sticky right-0 z-20 bg-gray-50 dark:bg-surface-dark relative after:content-[''] after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-gray-200 dark:after:bg-border-dark after:pointer-events-none ${
                                            showActionsDivider ? 'after:opacity-100' : 'after:opacity-0'
                                        }`}
                                    >
                                        {t('Actions')}
                                    </th>
                                )}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-border-dark">
                            {loading ? (
                                <tr>
                                    <td
                                        colSpan={columnCount}
                                        className="px-6 py-10 text-center text-slate-500 dark:text-text-secondary"
                                    >
                                        {t('Loading settings...')}
                                    </td>
                                </tr>
                            ) : settingsList.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={columnCount}
                                        className="px-6 py-10 text-center text-slate-500 dark:text-text-secondary"
                                    >
                                        {t('No settings configured.')}
                                    </td>
                                </tr>
                            ) : (
                                settingsList.map((setting) => (
                                    <tr
                                        key={setting.key}
                                        className="hover:bg-slate-50 dark:hover:bg-background-dark group"
                                    >
                                        <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-white">
                                            {setting.key}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-slate-700 dark:text-text-secondary">
                                            {formatValue(setting, settingsMap[setting.key], t)}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-slate-600 dark:text-text-secondary">
                                            {t(TYPE_LABELS[setting.type])}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-slate-600 dark:text-text-secondary">
                                            {t(setting.description)}
                                        </td>
                                        {canEditSettings && (
                                            <td
                                                className={`px-6 py-4 text-center sticky right-0 z-10 bg-white dark:bg-surface-dark group-hover:bg-slate-50 dark:group-hover:bg-background-dark relative after:content-[''] after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-gray-200 dark:after:bg-border-dark after:pointer-events-none ${
                                                    showActionsDivider ? 'after:opacity-100' : 'after:opacity-0'
                                                }`}
                                            >
                                                <button
                                                    onClick={() => setEditing(setting)}
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 dark:border-border-dark text-slate-700 dark:text-text-secondary hover:bg-slate-100 dark:hover:bg-background-dark transition-colors"
                                                >
                                                    <Icon name="edit" size={16} />
                                                    {t('Edit')}
                                                </button>
                                            </td>
                                        )}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {editing && canEditSettings && (
                <EditSettingModal
                    setting={editing}
                    value={settingsMap[editing.key]}
                    onClose={() => setEditing(null)}
                    onSave={handleSave}
                    submitting={submitting}
                />
            )}
        </AdminDashboardLayout>
    );
}
