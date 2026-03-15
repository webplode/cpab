import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AdminDashboardLayout } from '../../components/admin/AdminDashboardLayout';
import { AdminNoAccessCard } from '../../components/admin/AdminNoAccessCard';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Icon } from '../../components/Icon';
import { apiFetchAdmin } from '../../api/config';
import { buildAdminPermissionKey, useAdminPermissions } from '../../utils/adminPermissions';
import { useStickyActionsDivider } from '../../utils/stickyActionsDivider';
import { useTranslation } from 'react-i18next';

type Translate = (key: string, options?: Record<string, unknown>) => string;

interface ModelAlias {
    name: string;
    alias: string;
}

interface APIKeyEntry {
    api_key: string;
    proxy_url?: string;
}

interface ProviderApiKey {
    id: number;
    provider: string;
    name: string;
    priority: number;
    api_key: string;
    prefix: string;
    base_url: string;
    proxy_url: string;
    headers?: Record<string, string>;
    models?: ModelAlias[];
    excluded_models?: string[];
    api_key_entries?: APIKeyEntry[];
    created_at: string;
    updated_at: string;
}

interface ListResponse {
    api_keys: ProviderApiKey[];
}

interface DropdownMenuProps {
    anchorId: string;
    options: { value: string; label: string }[];
    selected: string;
    menuWidth?: number;
    onSelect: (value: string) => void;
    onClose: () => void;
}

function DropdownMenu({ anchorId, options, selected, menuWidth, onSelect, onClose }: DropdownMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);
    const btn = document.getElementById(anchorId);
    const rect = btn ? btn.getBoundingClientRect() : null;
    const position = rect
        ? { top: rect.bottom + 4, left: rect.left, width: rect.width }
        : { top: 0, left: 0, width: 0 };

    return createPortal(
        <>
            <div className="fixed inset-0 z-40" onClick={onClose} />
            <div
                ref={menuRef}
                className="fixed z-50 bg-white dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto"
                style={{ top: position.top, left: position.left, width: position.width || menuWidth }}
            >
                {options.map((opt) => (
                    <button
                        key={opt.value}
                        type="button"
                        onClick={() => onSelect(opt.value)}
                        className={`w-full text-left px-4 py-2.5 text-sm truncate hover:bg-gray-100 dark:hover:bg-background-dark transition-colors ${
                            selected === opt.value
                                ? 'bg-gray-100 dark:bg-background-dark text-primary font-medium'
                                : 'text-slate-900 dark:text-white'
                        }`}
                        title={opt.label}
                    >
                        {opt.label}
                    </button>
                ))}
            </div>
        </>,
        document.body
    );
}

const PROVIDER_OPTIONS = [
    { labelKey: 'Gemini', value: 'gemini' },
    { labelKey: 'Codex', value: 'codex' },
    { labelKey: 'Claude Code', value: 'claude' },
    { labelKey: 'OpenAI Chat Completions', value: 'openai-compatibility' },
];

function buildProviderOptions(t: Translate): { label: string; value: string }[] {
    return PROVIDER_OPTIONS.map((opt) => ({ value: opt.value, label: t(opt.labelKey) }));
}

function getProviderLabel(provider: string, t: Translate): string {
    const normalized = provider.trim().toLowerCase();
    const match = PROVIDER_OPTIONS.find((opt) => opt.value === normalized);
    if (match) {
        return t(match.labelKey);
    }
    return provider || t('Unknown');
}

function getProviderStyle(provider: string): string {
    const colors: Record<string, string> = {
        gemini: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-100 dark:border-blue-800',
        codex: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 border-indigo-100 dark:border-indigo-800',
        claude: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-100 dark:border-amber-800',
        'openai-compatibility': 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-100 dark:border-emerald-800',
    };
    return colors[provider] || 'bg-gray-50 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400 border-gray-100 dark:border-gray-800';
}

function formatDate(dateStr: string, locale: string): string {
    return new Date(dateStr).toLocaleDateString(locale, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

function maskKey(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return '—';
    if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}•••`;
    return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

function formatKeySummary(item: ProviderApiKey, t: Translate): string {
    if (item.provider === 'openai-compatibility') {
        const count = item.api_key_entries?.length || 0;
        return count > 0 ? t('{{count}} keys', { count }) : '—';
    }
    return maskKey(item.api_key || '');
}

interface ApiKeyModalProps {
    mode: 'create' | 'edit';
    initial?: ProviderApiKey;
    providerMenuWidth?: number;
    onClose: () => void;
    onSuccess: () => void;
}

function ApiKeyModal({ mode, initial, providerMenuWidth, onClose, onSuccess }: ApiKeyModalProps) {
    const { t } = useTranslation();
    const [provider, setProvider] = useState(initial?.provider || '');
    const [name, setName] = useState(initial?.name || '');
    const [priority, setPriority] = useState<number>(initial?.priority ?? 0);
    const [apiKey, setApiKey] = useState(initial?.api_key || '');
    const [prefix, setPrefix] = useState(initial?.prefix || '');
    const [baseURL, setBaseURL] = useState(initial?.base_url || '');
    const [proxyURL, setProxyURL] = useState(initial?.proxy_url || '');
    const [headersList, setHeadersList] = useState<{ key: string; value: string }[]>(
        initial?.headers
            ? (() => {
                  const entries = Object.entries(initial.headers).map(([key, value]) => ({ key, value }));
                  return entries.length > 0 ? entries : [{ key: '', value: '' }];
              })()
            : [{ key: '', value: '' }]
    );
    const [modelsList, setModelsList] = useState<ModelAlias[]>(
        initial?.models && initial.models.length > 0 ? initial.models : [{ name: '', alias: '' }]
    );
    const [excludedModelsList, setExcludedModelsList] = useState<string[]>(
        initial?.excluded_models && initial.excluded_models.length > 0
            ? initial.excluded_models
            : ['']
    );
    const [apiKeyEntriesText, setApiKeyEntriesText] = useState(
        initial?.api_key_entries ? JSON.stringify(initial.api_key_entries, null, 2) : ''
    );
    const [menuOpen, setMenuOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    const options = buildProviderOptions(t);
    const selectedLabel = provider ? getProviderLabel(provider, t) : t('Select Type');

    const handleHeaderChange = (index: number, field: 'key' | 'value', value: string) => {
        setHeadersList((prev) =>
            prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
        );
    };

    const addHeaderRowBelow = (index: number) => {
        setHeadersList((prev) => {
            const next = [...prev];
            next.splice(index + 1, 0, { key: '', value: '' });
            return next;
        });
    };

    const removeHeaderRow = (index: number) => {
        setHeadersList((prev) => {
            if (prev.length === 1) return [{ key: '', value: '' }];
            return prev.filter((_, i) => i !== index);
        });
    };

    const handleModelChange = (index: number, field: 'name' | 'alias', value: string) => {
        setModelsList((prev) =>
            prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
        );
    };

    const addModelRowBelow = (index: number) => {
        setModelsList((prev) => {
            const next = [...prev];
            next.splice(index + 1, 0, { name: '', alias: '' });
            return next;
        });
    };

    const removeModelRow = (index: number) => {
        setModelsList((prev) => {
            if (prev.length === 1) {
                return [{ name: '', alias: '' }];
            }
            return prev.filter((_, i) => i !== index);
        });
    };

    const handleExcludedChange = (index: number, value: string) => {
        setExcludedModelsList((prev) => prev.map((item, i) => (i === index ? value : item)));
    };

    const addExcludedRowBelow = (index: number) => {
        setExcludedModelsList((prev) => {
            const next = [...prev];
            next.splice(index + 1, 0, '');
            return next;
        });
    };

    const removeExcludedRow = (index: number) => {
        setExcludedModelsList((prev) => {
            if (prev.length === 1) return [''];
            return prev.filter((_, i) => i !== index);
        });
    };

    const parseArray = (value: string, label: string): unknown[] | null => {
        const trimmed = value.trim();
        if (!trimmed) return [];
        try {
            const parsed = JSON.parse(trimmed);
            if (!Array.isArray(parsed)) {
                setError(t('{{label}} must be a JSON array.', { label }));
                return null;
            }
            return parsed as unknown[];
        } catch {
            setError(t('{{label}} must be valid JSON.', { label }));
            return null;
        }
    };

    const handleSubmit = async () => {
        setError('');
        if (!provider) {
            setError(t('Type is required.'));
            return;
        }
        if (provider === 'openai-compatibility') {
            if (!name.trim()) {
                setError(t('Provider name is required.'));
                return;
            }
            if (!baseURL.trim()) {
                setError(t('Base URL is required.'));
                return;
            }
        } else {
            if (!apiKey.trim()) {
                setError(t('API key is required.'));
                return;
            }
            if (provider === 'codex' && !baseURL.trim()) {
                setError(t('Base URL is required for Codex.'));
                return;
            }
        }

        const normalizedHeaders = headersList
            .map((item) => ({ key: item.key.trim(), value: item.value.trim() }))
            .filter((item) => item.key && item.value)
            .reduce<Record<string, string>>((acc, item) => {
                acc[item.key] = item.value;
                return acc;
            }, {});

        const excludedModels = excludedModelsList.map((m) => m.trim()).filter(Boolean);

        const apiKeyEntries = parseArray(apiKeyEntriesText, t('API Key Entries'));
        if (apiKeyEntries === null) return;
        if (provider === 'openai-compatibility' && apiKeyEntries.length === 0) {
            setError(t('API key entries is required.'));
            return;
        }

        const normalizedModels = modelsList
            .map((item) => ({ name: item.name.trim(), alias: item.alias.trim() }))
            .filter((item) => item.name || item.alias);

        const payload = {
            provider,
            name: name.trim(),
            priority,
            api_key: apiKey.trim(),
            prefix: prefix.trim(),
            base_url: baseURL.trim(),
            proxy_url: proxyURL.trim(),
            headers: Object.keys(normalizedHeaders).length ? normalizedHeaders : undefined,
            models: normalizedModels,
            excluded_models: excludedModels,
            api_key_entries: apiKeyEntries,
        };

        setSubmitting(true);
        try {
            const url = mode === 'create'
                ? '/v0/admin/provider-api-keys'
                : `/v0/admin/provider-api-keys/${initial?.id}`;
            const method = mode === 'create' ? 'POST' : 'PUT';
            await apiFetchAdmin(url, {
                method,
                body: JSON.stringify(payload),
            });
            onSuccess();
            onClose();
        } catch (err) {
            console.error('Failed to save api key:', err);
            setError(t('Failed to save API key.'));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white dark:bg-surface-dark rounded-xl shadow-xl w-full max-w-2xl mx-4 border border-gray-200 dark:border-border-dark max-h-[90vh] overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-border-dark shrink-0">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                        {mode === 'create' ? t('New API Key') : t('Edit API Key')}
                    </h2>
                    <button
                        onClick={onClose}
                        className="inline-flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
                    >
                        <Icon name="close" />
                    </button>
                </div>
                <div className="p-6 space-y-4 overflow-y-auto flex-1">
                    {error && (
                        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                            {error}
                        </div>
                    )}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Type')}
                        </label>
                        <div className="relative">
                            <button
                                type="button"
                                id="provider-modal-dropdown-btn"
                                onClick={() => setMenuOpen(!menuOpen)}
                                className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-border-dark bg-gray-50 dark:bg-background-dark px-4 py-2.5 text-sm text-slate-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            >
                                <span className={provider ? '' : 'text-gray-400'}>{selectedLabel}</span>
                                <Icon name="expand_more" size={18} />
                            </button>
                            {menuOpen && (
                                <DropdownMenu
                                    anchorId="provider-modal-dropdown-btn"
                                    options={options}
                                    selected={provider}
                                    menuWidth={providerMenuWidth}
                                    onSelect={(value) => {
                                        setProvider(value);
                                        setMenuOpen(false);
                                    }}
                                    onClose={() => setMenuOpen(false)}
                                />
                            )}
                        </div>
                    </div>

                    {provider === 'openai-compatibility' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                {t('Provider Name')}
                            </label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder={t('e.g. openrouter')}
                                className="w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                            />
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Priority')}
                        </label>
                        <input
                            type="number"
                            step="1"
                            value={priority}
                            onChange={(e) => setPriority(Number.parseInt(e.target.value || '0', 10) || 0)}
                            placeholder="0"
                            className="w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                        />
                    </div>

                    {provider !== 'openai-compatibility' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                {t('API Key')}
                            </label>
                            <input
                                type="text"
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                placeholder={t('Enter API key')}
                                className="w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                            />
                        </div>
                    )}

                    <div className="grid gap-4 md:grid-cols-2">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                {t('Base URL')}
                            </label>
                            <input
                                type="text"
                                value={baseURL}
                                onChange={(e) => setBaseURL(e.target.value)}
                                placeholder={t('https://...')}
                                className="w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                {t('Prefix')}
                            </label>
                            <input
                                type="text"
                                value={prefix}
                                onChange={(e) => setPrefix(e.target.value)}
                                placeholder={t('optional prefix')}
                                className="w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                            />
                        </div>
                    </div>

                    {provider !== 'openai-compatibility' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                {t('Proxy URL')}
                            </label>
                            <input
                                type="text"
                                value={proxyURL}
                                onChange={(e) => setProxyURL(e.target.value)}
                                placeholder={t('optional proxy url')}
                                className="w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                            />
                        </div>
                    )}

                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                {t('Headers')}
                            </label>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                                {t('Add key / value pairs')}
                            </span>
                        </div>
                        <div className="space-y-3">
                            {headersList.map((item, idx) => (
                                <div
                                    key={`header-row-${idx}`}
                                    className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center"
                                >
                                    <input
                                        type="text"
                                        value={item.key}
                                        onChange={(e) => handleHeaderChange(idx, 'key', e.target.value)}
                                        placeholder={t('Header key')}
                                        className="w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                                    />
                                    <input
                                        type="text"
                                        value={item.value}
                                        onChange={(e) => handleHeaderChange(idx, 'value', e.target.value)}
                                        placeholder={t('Header value')}
                                        className="w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => addHeaderRowBelow(idx)}
                                        className="px-3 py-2 bg-gray-100 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-sm text-slate-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                                        title={t('Add row')}
                                    >
                                        {t('Add')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => removeHeaderRow(idx)}
                                        className="px-3 py-2 bg-red-50 dark:bg-background-dark border border-red-200 dark:border-border-dark rounded-lg text-sm text-red-600 hover:bg-red-100 dark:hover:bg-gray-700 transition-colors"
                                        title={t('Remove row')}
                                    >
                                        {t('Delete')}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                {t('Models')}
                            </label>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                                {t('Add rows for name / alias')}
                            </span>
                        </div>
                        <div className="space-y-3">
                            {modelsList.map((item, idx) => (
                                <div
                                    key={`model-row-${idx}`}
                                    className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center"
                                >
                                    <input
                                        type="text"
                                        value={item.name}
                                        onChange={(e) => handleModelChange(idx, 'name', e.target.value)}
                                        placeholder={t('name')}
                                        className="w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                                    />
                                    <input
                                        type="text"
                                        value={item.alias}
                                        onChange={(e) => handleModelChange(idx, 'alias', e.target.value)}
                                        placeholder={t('alias')}
                                        className="w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => addModelRowBelow(idx)}
                                        className="px-3 py-2 bg-gray-100 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-sm text-slate-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                                        title={t('Add row')}
                                    >
                                        {t('Add')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => removeModelRow(idx)}
                                        className="px-3 py-2 bg-red-50 dark:bg-background-dark border border-red-200 dark:border-border-dark rounded-lg text-sm text-red-600 hover:bg-red-100 dark:hover:bg-gray-700 transition-colors"
                                        title={t('Remove row')}
                                    >
                                        {t('Delete')}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    {provider === 'openai-compatibility' ? (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                {t('API Key Entries (JSON)')}
                            </label>
                            <textarea
                                value={apiKeyEntriesText}
                                onChange={(e) => setApiKeyEntriesText(e.target.value)}
                                placeholder='[{"api_key":"sk-...","proxy_url":""}]'
                                rows={3}
                                className="w-full px-4 py-2.5 text-sm font-mono bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                            />
                        </div>
                    ) : (
                        <div>
                            <div className="flex items-center justify-between mb-1.5">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                    {t('Excluded Models')}
                                </label>
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                    {t('Add models to exclude')}
                                </span>
                            </div>
                            <div className="space-y-3">
                                {excludedModelsList.map((item, idx) => (
                                    <div
                                        key={`excluded-row-${idx}`}
                                        className="grid grid-cols-[1fr_auto_auto] gap-2 items-center"
                                    >
                                        <input
                                            type="text"
                                            value={item}
                                            onChange={(e) => handleExcludedChange(idx, e.target.value)}
                                            placeholder={t('model name')}
                                            className="w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => addExcludedRowBelow(idx)}
                                            className="px-3 py-2 bg-gray-100 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-sm text-slate-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                                            title={t('Add row')}
                                        >
                                            {t('Add')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => removeExcludedRow(idx)}
                                            className="px-3 py-2 bg-red-50 dark:bg-background-dark border border-red-200 dark:border-border-dark rounded-lg text-sm text-red-600 hover:bg-red-100 dark:hover:bg-gray-700 transition-colors"
                                            title={t('Remove row')}
                                        >
                                            {t('Delete')}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
                <div className="flex gap-3 px-6 py-4 border-t border-gray-200 dark:border-border-dark shrink-0">
                    <button
                        onClick={onClose}
                        className="flex-1 py-2.5 bg-gray-100 dark:bg-background-dark hover:bg-gray-200 dark:hover:bg-gray-700 text-slate-900 dark:text-white rounded-lg font-medium transition-colors border border-gray-200 dark:border-border-dark"
                    >
                        {t('Cancel')}
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={submitting}
                        className="flex-1 py-2.5 bg-primary hover:bg-blue-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {submitting ? t('Saving...') : t('Save')}
                    </button>
                </div>
            </div>
        </div>
    );
}

export function AdminApiKeys() {
    const { t, i18n } = useTranslation();
    const locale = i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US';
    const { hasPermission } = useAdminPermissions();
    const canListProviderKeys = hasPermission(
        buildAdminPermissionKey('GET', '/v0/admin/provider-api-keys')
    );
    const canCreateProviderKey = hasPermission(
        buildAdminPermissionKey('POST', '/v0/admin/provider-api-keys')
    );
    const canUpdateProviderKey = hasPermission(
        buildAdminPermissionKey('PUT', '/v0/admin/provider-api-keys/:id')
    );
    const canDeleteProviderKey = hasPermission(
        buildAdminPermissionKey('DELETE', '/v0/admin/provider-api-keys/:id')
    );

    const [keys, setKeys] = useState<ProviderApiKey[]>([]);
    const [loading, setLoading] = useState(true);
    const [keyword, setKeyword] = useState('');
    const [providerFilter, setProviderFilter] = useState('');
    const [filterMenuOpen, setFilterMenuOpen] = useState(false);
    const [providerBtnWidth, setProviderBtnWidth] = useState<number | undefined>(undefined);
    const [createOpen, setCreateOpen] = useState(false);
    const [editing, setEditing] = useState<ProviderApiKey | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<ProviderApiKey | null>(null);

    useEffect(() => {
        const allOptions = [t('All Types'), ...buildProviderOptions(t).map((opt) => opt.label)];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
            let maxWidth = 0;
            for (const opt of allOptions) {
                const width = ctx.measureText(opt).width;
                if (width > maxWidth) maxWidth = width;
            }
            setProviderBtnWidth(Math.ceil(maxWidth) + 76);
        }
    }, [i18n.language, t]);

    const fetchData = useCallback(async () => {
        if (!canListProviderKeys) {
            return;
        }
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (keyword.trim()) params.set('keyword', keyword.trim());
            if (providerFilter) params.set('provider', providerFilter);
            const query = params.toString();
            const url = query ? `/v0/admin/provider-api-keys?${query}` : '/v0/admin/provider-api-keys';
            const res = await apiFetchAdmin<ListResponse>(url);
            setKeys(res.api_keys || []);
        } catch (err) {
            console.error('Failed to fetch api keys:', err);
        } finally {
            setLoading(false);
        }
    }, [keyword, providerFilter, canListProviderKeys]);

    useEffect(() => {
        if (canListProviderKeys) {
            fetchData();
        }
    }, [fetchData, canListProviderKeys]);

    const { tableScrollRef, handleTableScroll, showActionsDivider } = useStickyActionsDivider(keys.length, loading);

    const handleDelete = async (item: ProviderApiKey) => {
        if (!canDeleteProviderKey) {
            return;
        }
        try {
            await apiFetchAdmin(`/v0/admin/provider-api-keys/${item.id}`, { method: 'DELETE' });
            setConfirmDelete(null);
            fetchData();
        } catch (err) {
            console.error('Failed to delete api key:', err);
        }
    };

    const providerOptionsWithAll = [
        { label: t('All Types'), value: '' },
        ...buildProviderOptions(t),
    ];

    if (!canListProviderKeys) {
        return (
            <AdminDashboardLayout
                title={t('API Keys')}
                subtitle={t('Manage upstream provider credentials for CLIProxyAPI.')}
            >
                <AdminNoAccessCard />
            </AdminDashboardLayout>
        );
    }

    return (
        <AdminDashboardLayout
            title={t('API Keys')}
            subtitle={t('Manage upstream provider credentials for CLIProxyAPI.')}
        >
            <div className="space-y-6">
                {canCreateProviderKey && (
                    <div className="flex justify-end">
                        <button
                            onClick={() => setCreateOpen(true)}
                            className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-blue-600 text-white rounded-lg text-sm font-medium shadow-sm transition-colors"
                        >
                            <Icon name="add" size={18} />
                            {t('Add API Key')}
                        </button>
                    </div>
                )}

                <div className="bg-white dark:bg-surface-dark p-3 rounded-xl border border-gray-200 dark:border-border-dark shadow-sm">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="flex flex-1 flex-col gap-3 md:flex-row md:items-center">
                            <div className="relative flex-1">
                                <input
                                    type="text"
                                    value={keyword}
                                    onChange={(e) => setKeyword(e.target.value)}
                                    placeholder={t('Search by name or API key')}
                                    className="w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                                />
                                <Icon
                                    name="search"
                                    size={18}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                                />
                            </div>
                            <div className="relative">
                                <button
                                    type="button"
                                    id="provider-filter-dropdown-btn"
                                    onClick={() => setFilterMenuOpen(!filterMenuOpen)}
                                    className="flex items-center justify-between gap-2 bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark text-slate-900 dark:text-white text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5 whitespace-nowrap"
                                    style={providerBtnWidth ? { width: providerBtnWidth } : undefined}
                                >
                                    <span>
                                        {providerFilter ? getProviderLabel(providerFilter, t) : t('All Types')}
                                    </span>
                                    <Icon name={filterMenuOpen ? 'expand_less' : 'expand_more'} size={18} />
                                </button>
                                {filterMenuOpen && (
                                    <DropdownMenu
                                        anchorId="provider-filter-dropdown-btn"
                                        options={providerOptionsWithAll}
                                        selected={providerFilter}
                                        menuWidth={providerBtnWidth}
                                        onSelect={(value) => {
                                            setProviderFilter(value);
                                            setFilterMenuOpen(false);
                                        }}
                                        onClose={() => setFilterMenuOpen(false)}
                                    />
                                )}
                            </div>
                        </div>
                        <button
                            onClick={fetchData}
                            className="h-10 w-10 inline-flex items-center justify-center text-gray-500 dark:text-text-secondary hover:bg-gray-100 dark:hover:bg-background-dark rounded-lg border border-gray-200 dark:border-border-dark transition-colors"
                            title={t('Refresh Data')}
                        >
                            <Icon name="refresh" />
                        </button>
                    </div>
                </div>

                <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-sm overflow-hidden">
                    <div ref={tableScrollRef} className="relative overflow-x-auto" onScroll={handleTableScroll}>
                        <table className="w-full text-sm text-left text-gray-500 dark:text-gray-400">
                            <thead className="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-surface-dark dark:text-gray-400 border-b border-gray-200 dark:border-border-dark">
                                <tr>
                                    <th className="px-6 py-4 font-semibold tracking-wider">{t('ID')}</th>
                                    <th className="px-6 py-4 font-semibold tracking-wider">{t('Type')}</th>
                                    <th className="px-6 py-4 font-semibold tracking-wider">{t('Name')}</th>
                                    <th className="px-6 py-4 font-semibold tracking-wider">{t('Priority')}</th>
                                    <th className="px-6 py-4 font-semibold tracking-wider">{t('API Key(s)')}</th>
                                    <th className="px-6 py-4 font-semibold tracking-wider">{t('Base URL')}</th>
                                    <th className="px-6 py-4 font-semibold tracking-wider">{t('Prefix')}</th>
                                    <th className="px-6 py-4 font-semibold tracking-wider">{t('Updated At')}</th>
                                    <th
                                        className={`px-6 py-4 font-semibold tracking-wider text-center sticky right-0 z-20 bg-gray-50 dark:bg-surface-dark relative after:content-[''] after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-gray-200 dark:after:bg-border-dark after:pointer-events-none ${
                                            showActionsDivider ? 'after:opacity-100' : 'after:opacity-0'
                                        }`}
                                    >
                                        {t('Actions')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-border-dark">
                                {loading ? (
                                    <tr>
                                        <td colSpan={9} className="px-6 py-12 text-center">
                                            {t('Loading...')}
                                        </td>
                                    </tr>
                                ) : keys.length === 0 ? (
                                    <tr>
                                        <td colSpan={9} className="px-6 py-12 text-center">
                                            {t('No API keys found')}
                                        </td>
                                    </tr>
                                ) : (
                                    keys.map((item) => (
                                        <tr
                                            key={item.id}
                                            className="hover:bg-gray-50 dark:hover:bg-background-dark group"
                                        >
                                            <td className="px-6 py-4 text-slate-900 dark:text-white font-medium">
                                                {item.id}
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${getProviderStyle(item.provider)}`}>
                                                    {getProviderLabel(item.provider, t)}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-slate-900 dark:text-white">
                                                {item.name || '—'}
                                            </td>
                                            <td className="px-6 py-4 font-mono text-slate-700 dark:text-gray-300">
                                                {item.priority}
                                            </td>
                                            <td className="px-6 py-4 text-slate-900 dark:text-white font-mono text-xs">
                                                {formatKeySummary(item, t)}
                                            </td>
                                            <td className="px-6 py-4 text-slate-700 dark:text-gray-300">
                                                {item.base_url || '—'}
                                            </td>
                                            <td className="px-6 py-4 text-slate-700 dark:text-gray-300">
                                                {item.prefix || '—'}
                                            </td>
                                            <td className="px-6 py-4 font-mono text-xs">
                                                {formatDate(item.updated_at, locale)}
                                            </td>
                                            <td
                                                className={`px-6 py-4 text-center sticky right-0 z-10 bg-white dark:bg-surface-dark group-hover:bg-gray-50 dark:group-hover:bg-background-dark relative after:content-[''] after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-gray-200 dark:after:bg-border-dark after:pointer-events-none ${
                                                    showActionsDivider ? 'after:opacity-100' : 'after:opacity-0'
                                                }`}
                                            >
                                                <div className="flex items-center justify-center gap-1">
                                                    {canUpdateProviderKey && (
                                                        <button
                                                            onClick={() => setEditing(item)}
                                                            className="p-2 text-gray-400 hover:text-primary hover:bg-gray-100 dark:hover:bg-background-dark rounded-lg transition-colors"
                                                            title={t('Edit')}
                                                        >
                                                            <Icon name="edit" size={18} />
                                                        </button>
                                                    )}
                                                    {canDeleteProviderKey && (
                                                        <button
                                                            onClick={() => setConfirmDelete(item)}
                                                            className="p-2 text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-background-dark rounded-lg transition-colors"
                                                            title={t('Delete')}
                                                        >
                                                            <Icon name="delete" size={18} />
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {createOpen && (
                <ApiKeyModal
                    mode="create"
                    providerMenuWidth={providerBtnWidth}
                    onClose={() => setCreateOpen(false)}
                    onSuccess={fetchData}
                />
            )}

            {editing && (
                <ApiKeyModal
                    mode="edit"
                    initial={editing}
                    providerMenuWidth={providerBtnWidth}
                    onClose={() => setEditing(null)}
                    onSuccess={fetchData}
                />
            )}

            {confirmDelete && (
                <ConfirmDialog
                    title={t('Delete API Key')}
                    message={t('Are you sure you want to delete {{provider}} entry?', {
                        provider: getProviderLabel(confirmDelete.provider, t),
                    })}
                    confirmText={t('Delete')}
                    danger
                    onConfirm={() => handleDelete(confirmDelete)}
                    onCancel={() => setConfirmDelete(null)}
                />
            )}
        </AdminDashboardLayout>
    );
}
