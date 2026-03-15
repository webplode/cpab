import { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AdminDashboardLayout } from '../../components/admin/AdminDashboardLayout';
import { AdminNoAccessCard } from '../../components/admin/AdminNoAccessCard';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { MultiGroupDropdownMenu } from '../../components/admin/MultiGroupDropdownMenu';
import { Icon } from '../../components/Icon';
import { apiFetchAdmin } from '../../api/config';
import { buildAdminPermissionKey, useAdminPermissions } from '../../utils/adminPermissions';
import { useStickyActionsDivider } from '../../utils/stickyActionsDivider';
import { useTranslation } from 'react-i18next';

type Translate = (key: string, options?: Record<string, unknown>) => string;

interface ModelMapping {
    id: number;
    provider: string;
    model_name: string;
    new_model_name: string;
    fork: boolean;
    selector: number;
    rate_limit: number;
    user_group_id: number[];
    is_enabled: boolean;
    created_at: string;
    updated_at: string;
}

interface ListResponse {
    model_mappings: ModelMapping[];
}

interface UserGroup {
    id: number;
    name: string;
}

interface UserGroupsResponse {
    user_groups: UserGroup[];
}

interface ProviderApiKeyRef {
    id: number;
    provider: string;
    name: string;
}

interface ProviderApiKeysListResponse {
    api_keys: ProviderApiKeyRef[];
}

interface ModelPayloadRule {
    id: number;
    protocol: string;
    params: unknown;
    is_enabled: boolean;
    description?: string;
}

interface ModelPayloadRuleResponse {
    rules: ModelPayloadRule[];
}

type ParamRuleType = 'default' | 'override';
type ParamValueType = 'string' | 'number' | 'boolean' | 'json';

interface ParamEntry {
    path: string;
    value: string;
    ruleType: ParamRuleType;
    valueType: ParamValueType;
}

interface ModelPayloadRuleForm extends Omit<ModelPayloadRule, 'params'> {
    paramEntries: ParamEntry[];
    isNew?: boolean;
}

interface AdminCheckboxProps {
    checked: boolean;
    indeterminate?: boolean;
    disabled?: boolean;
    onChange: (nextChecked: boolean) => void;
    title?: string;
}

function AdminCheckbox({ checked, indeterminate = false, disabled = false, onChange, title }: AdminCheckboxProps) {
    const isActive = checked || indeterminate;

    return (
        <button
            type="button"
            role="checkbox"
            aria-checked={indeterminate ? 'mixed' : checked}
            disabled={disabled}
            title={title}
            onClick={() => {
                if (disabled) return;
                onChange(!checked);
            }}
            onKeyDown={(e) => {
                if (disabled) return;
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onChange(!checked);
                }
            }}
            className={[
                'w-5 h-5 rounded-md border flex items-center justify-center transition-colors',
                'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-surface-dark',
                disabled
                    ? 'cursor-not-allowed opacity-60 border-gray-200 dark:border-border-dark bg-gray-100 dark:bg-background-dark'
                    : isActive
                        ? 'bg-primary border-primary text-white hover:bg-blue-600'
                        : 'bg-white dark:bg-background-dark border-gray-300 dark:border-border-dark text-transparent hover:border-primary',
            ].join(' ')}
        >
            {indeterminate ? <Icon name="remove" size={16} /> : checked ? <Icon name="check" size={16} /> : null}
        </button>
    );
}

interface ProviderDropdownMenuProps {
    selected: string;
    options: ProviderFilterOption[];
    onSelect: (value: string) => void;
    onClose: () => void;
}

interface ProviderFilterOption {
    value: string;
    label: string;
    providerKey: string;
}

function ProviderDropdownMenu({ selected, options, onSelect, onClose }: ProviderDropdownMenuProps) {
    const [position, setPosition] = useState(() => {
        const btn = document.getElementById('provider-dropdown-btn');
        if (!btn) {
            return { top: 0, left: 0, width: 160 };
        }
        const rect = btn.getBoundingClientRect();
        return {
            top: rect.bottom + 4,
            left: rect.left,
            width: Math.max(rect.width, 160),
        };
    });

    useEffect(() => {
        const update = () => {
            const btn = document.getElementById('provider-dropdown-btn');
            if (!btn) return;
            const rect = btn.getBoundingClientRect();
            setPosition({
                top: rect.bottom + 4,
                left: rect.left,
                width: Math.max(rect.width, 160),
            });
        };

        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => {
            window.removeEventListener('resize', update);
            window.removeEventListener('scroll', update, true);
        };
    }, []);

    return createPortal(
        <>
            <div className="fixed inset-0 z-40" onClick={onClose} />
            <div
                className="fixed z-50 bg-white dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg shadow-lg overflow-hidden"
                style={{ top: position.top, left: position.left, width: position.width }}
            >
                {options.map((opt) => (
                    <button
                        key={opt.value}
                        type="button"
                        onClick={() => onSelect(opt.value)}
                        className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-100 dark:hover:bg-background-dark transition-colors ${
                            selected === opt.value
                                ? 'bg-gray-100 dark:bg-background-dark text-primary font-medium'
                                : 'text-slate-900 dark:text-white'
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

function getProviderStyle(provider: string): string {
    const colors: Record<string, string> = {
        openai: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-100 dark:border-green-800',
        anthropic: 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 border-orange-100 dark:border-orange-800',
        google: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-100 dark:border-blue-800',
        azure: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400 border-sky-100 dark:border-sky-800',
        bedrock: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-100 dark:border-amber-800',
        cohere: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 border-purple-100 dark:border-purple-800',
        mistral: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 border-indigo-100 dark:border-indigo-800',
    };
    return colors[provider.toLowerCase()] || 'bg-gray-50 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400 border-gray-100 dark:border-gray-800';
}

function getStatusStyle(enabled: boolean): string {
    if (enabled) {
        return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-100 dark:border-emerald-800';
    }
    return 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 border-red-100 dark:border-red-900/30';
}

const API_KEY_PROVIDER_LABELS = [
    { labelKey: 'Gemini', value: 'gemini' },
    { labelKey: 'Codex', value: 'codex' },
    { labelKey: 'Claude Code', value: 'claude' },
    { labelKey: 'OpenAI Chat Completions', value: 'openai-compatibility' },
];

function getAPIKeyProviderLabel(provider: string, t: Translate): string {
    const key = provider.trim().toLowerCase();
    const match = API_KEY_PROVIDER_LABELS.find((opt) => opt.value === key);
    return match ? t(match.labelKey) : provider;
}

function normalizeOpenAICompatProviderKey(name: string): string {
    const trimmed = name.trim();
    return trimmed ? trimmed.toLowerCase() : 'openai-compatibility';
}

const PROVIDER_OPTIONS = [
    { labelKey: 'Gemini CLI', value: 'gemini-cli' },
    { labelKey: 'Antigravity', value: 'antigravity' },
    { labelKey: 'Codex', value: 'codex' },
    { labelKey: 'Claude Code', value: 'claude' },
    { labelKey: 'iFlow', value: 'iflow' },
    { labelKey: 'Vertex', value: 'vertex' },
    { labelKey: 'Qwen', value: 'qwen' },
];

function buildProviderOptions(t: Translate): { label: string; value: string }[] {
    return PROVIDER_OPTIONS.map((opt) => ({ value: opt.value, label: t(opt.labelKey) }));
}

const MODEL_MAPPING_SELECTOR_OPTIONS = [
    { labelKey: 'Round Robin', value: 0 },
    { labelKey: 'Fill First', value: 1 },
    { labelKey: 'Stick', value: 2 },
];

function buildModelMappingSelectorOptions(t: Translate): { label: string; value: string }[] {
    return MODEL_MAPPING_SELECTOR_OPTIONS.map((opt) => ({
        value: String(opt.value),
        label: t(opt.labelKey),
    }));
}

function getModelMappingSelectorLabel(selector: number, t: Translate): string {
    const match = MODEL_MAPPING_SELECTOR_OPTIONS.find((opt) => opt.value === selector);
    return match ? t(match.labelKey) : String(selector);
}

interface CreateModalProps {
    onClose: () => void;
    onSuccess: () => void;
    canLoadModels: boolean;
    userGroups: UserGroup[];
}

function CreateModal({ onClose, onSuccess, canLoadModels, userGroups }: CreateModalProps) {
    const { t } = useTranslation();
    const providerOptions = buildProviderOptions(t);
    const selectorOptions = buildModelMappingSelectorOptions(t);
    const [provider, setProvider] = useState('');
    const [modelName, setModelName] = useState('');
    const [newModelName, setNewModelName] = useState('');
    const [fork, setFork] = useState(false);
    const [selector, setSelector] = useState(0);
    const [rateLimit, setRateLimit] = useState('0');
    const [isEnabled, setIsEnabled] = useState(true);
    const [providerDropdownOpen, setProviderDropdownOpen] = useState(false);
    const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
    const [selectorDropdownOpen, setSelectorDropdownOpen] = useState(false);
    const [models, setModels] = useState<string[]>([]);
    const [loadingModels, setLoadingModels] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [userGroupIds, setUserGroupIds] = useState<number[]>([]);
    const [userGroupMenuOpen, setUserGroupMenuOpen] = useState(false);
    const [userGroupSearch, setUserGroupSearch] = useState('');
    const [userGroupBtnWidth, setUserGroupBtnWidth] = useState<number | undefined>(undefined);

    const providerBtnRef = useRef<HTMLButtonElement>(null);
    const modelBtnRef = useRef<HTMLButtonElement>(null);
    const selectorBtnRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        const allOptions = [t('All Groups'), ...userGroups.map((g) => `${g.name} #${g.id}`)];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
            let maxWidth = 0;
            for (const opt of allOptions) {
                const width = ctx.measureText(opt).width;
                if (width > maxWidth) maxWidth = width;
            }
            setUserGroupBtnWidth(Math.ceil(maxWidth) + 76);
        }
    }, [userGroups, t]);

    useEffect(() => {
        if (!provider) {
            setModels([]);
            setModelName('');
            return;
        }
        if (!canLoadModels) {
            setModels([]);
            setModelName('');
            return;
        }
        setLoadingModels(true);
        apiFetchAdmin<{ models: string[] }>(
            `/v0/admin/model-mappings/available-models?provider=${encodeURIComponent(provider)}`
        )
            .then((res) => {
                setModels(res.models || []);
            })
            .catch(() => {
                setModels([]);
            })
            .finally(() => {
                setLoadingModels(false);
            });
    }, [provider, canLoadModels]);

    const handleSubmit = async () => {
        if (!provider || !modelName || !newModelName) return;
        const parsedRateLimit = Number.parseInt(rateLimit, 10);
        const rateLimitValue = Number.isNaN(parsedRateLimit) ? 0 : Math.max(0, parsedRateLimit);
        setSubmitting(true);
        try {
            await apiFetchAdmin('/v0/admin/model-mappings', {
                method: 'POST',
                body: JSON.stringify({
                    provider,
                    model_name: modelName,
                    new_model_name: newModelName,
                    fork,
                    selector,
                    rate_limit: rateLimitValue,
                    user_group_id: userGroupIds,
                    is_enabled: isEnabled,
                }),
            });
            onSuccess();
            onClose();
        } catch (err) {
            console.error('Failed to create model mapping:', err);
        } finally {
            setSubmitting(false);
        }
    };

    const selectedProviderLabel = providerOptions.find((p) => p.value === provider)?.label || t('Select Provider');
    const selectedSelectorLabel = getModelMappingSelectorLabel(selector, t);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white dark:bg-surface-dark rounded-xl shadow-xl w-full max-w-md mx-4 border border-gray-200 dark:border-border-dark max-h-[90vh] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-border-dark shrink-0">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                        {t('New Model Mapping')}
                    </h2>
                    <button
                        onClick={onClose}
                        className="inline-flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
                    >
                        <Icon name="close" />
                    </button>
                </div>
                <div className="p-6 space-y-4 flex-1 overflow-y-auto">
                    {/* Provider Dropdown */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Provider')}
                        </label>
                        <div className="relative">
                            <button
                                ref={providerBtnRef}
                                type="button"
                                onClick={() => setProviderDropdownOpen(!providerDropdownOpen)}
                                className="w-full flex items-center justify-between px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            >
                                <span className={provider ? '' : 'text-gray-400'}>{selectedProviderLabel}</span>
                                <Icon name="expand_more" size={18} />
                            </button>
                            {providerDropdownOpen && (
                                <DropdownPortal
                                    anchorRef={providerBtnRef}
                                    options={providerOptions}
                                    selected={provider}
                                    onSelect={(val) => {
                                        setProvider(val);
                                        setModelName('');
                                        setProviderDropdownOpen(false);
                                    }}
                                    onClose={() => setProviderDropdownOpen(false)}
                                />
                            )}
                        </div>
                    </div>

                    {/* Model Dropdown */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Model')}
                        </label>
                        <div className="relative">
                            <button
                                ref={modelBtnRef}
                                type="button"
                                disabled={!provider || loadingModels || !canLoadModels}
                                onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                                className="w-full flex items-center justify-between px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <span className={modelName ? '' : 'text-gray-400'}>
                                    {!canLoadModels
                                        ? t('No permission to load models')
                                        : loadingModels
                                            ? t('Loading...')
                                            : modelName || t('Select Model')}
                                </span>
                                <Icon
                                    name={loadingModels ? 'progress_activity' : 'expand_more'}
                                    size={18}
                                    className={loadingModels ? 'animate-spin' : ''}
                                />
                            </button>
                            {modelDropdownOpen && models.length > 0 && (
                                <DropdownPortal
                                    anchorRef={modelBtnRef}
                                    options={models.map((m) => ({ label: m, value: m }))}
                                    selected={modelName}
                                    onSelect={(val) => {
                                        setModelName(val);
                                        setModelDropdownOpen(false);
                                    }}
                                    onClose={() => setModelDropdownOpen(false)}
                                />
                            )}
                        </div>
                    </div>

                    {/* New Model Name Input */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Map To')}
                        </label>
                        <input
                            type="text"
                            value={newModelName}
                            onChange={(e) => setNewModelName(e.target.value)}
                            placeholder={t('Enter target model name')}
                            className="w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                        />
                    </div>

                    {/* Selector Dropdown */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Selector')}
                        </label>
                        <div className="relative">
                            <button
                                ref={selectorBtnRef}
                                type="button"
                                onClick={() => setSelectorDropdownOpen(!selectorDropdownOpen)}
                                className="w-full flex items-center justify-between px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            >
                                <span>{selectedSelectorLabel}</span>
                                <Icon name="expand_more" size={18} />
                            </button>
                            {selectorDropdownOpen && (
                                <DropdownPortal
                                    anchorRef={selectorBtnRef}
                                    options={selectorOptions}
                                    selected={String(selector)}
                                    onSelect={(val) => {
                                        const next = Number.parseInt(val, 10);
                                        setSelector(Number.isFinite(next) ? next : 0);
                                        setSelectorDropdownOpen(false);
                                    }}
                                    onClose={() => setSelectorDropdownOpen(false)}
                                />
                            )}
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Rate limit')}
                        </label>
                        <input
                            type="number"
                            step="1"
                            value={rateLimit}
                            onChange={(e) => setRateLimit(e.target.value)}
                            placeholder="0"
                            className="w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('User Group')}
                        </label>
                        <div className="relative">
                            <button
                                type="button"
                                id="model-mapping-user-groups-btn"
                                onClick={() => setUserGroupMenuOpen(!userGroupMenuOpen)}
                                className="flex items-center justify-between gap-2 w-full bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark text-slate-900 dark:text-white text-sm rounded-lg focus:ring-primary focus:border-primary px-4 py-2.5"
                                style={userGroupBtnWidth ? { minWidth: userGroupBtnWidth } : undefined}
                                title={
                                    userGroupIds.length === 0
                                        ? t('All Groups')
                                        : userGroupIds
                                              .map((id) => userGroups.find((g) => g.id === id)?.name || `#${id}`)
                                              .join(', ')
                                }
                            >
                                <span className="truncate">
                                    {userGroupIds.length === 0
                                        ? t('All Groups')
                                        : t('Selected {{count}}', { count: userGroupIds.length })}
                                </span>
                                <Icon name={userGroupMenuOpen ? 'expand_less' : 'expand_more'} size={18} />
                            </button>
                            {userGroupMenuOpen && (
                                <MultiGroupDropdownMenu
                                    anchorId="model-mapping-user-groups-btn"
                                    groups={userGroups}
                                    selectedIds={userGroupIds}
                                    search={userGroupSearch}
                                    emptyLabel={t('All Groups')}
                                    menuWidth={userGroupBtnWidth}
                                    onSearchChange={setUserGroupSearch}
                                    onToggle={(value) =>
                                        setUserGroupIds((prev) =>
                                            prev.includes(value) ? prev.filter((id) => id !== value) : [...prev, value]
                                        )
                                    }
                                    onClear={() => setUserGroupIds([])}
                                    onClose={() => setUserGroupMenuOpen(false)}
                                />
                            )}
                        </div>
                        <p className="mt-1 text-xs text-slate-500 dark:text-text-secondary">
                            {t('Empty means all user groups can use this model mapping.')}
                        </p>
                    </div>

                    {/* Fork Switch */}
                    <div className="flex items-center justify-between">
                        <div>
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                {t('Fork')}
                            </label>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                {t('Expose the alias without hiding the original model.')}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setFork(!fork)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                fork ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'
                            }`}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                    fork ? 'translate-x-6' : 'translate-x-1'
                                }`}
                            />
                        </button>
                    </div>

                    {/* Is Enabled Switch */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center justify-between w-full">
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('Enabled')}</span>
                            <button
                                type="button"
                                onClick={() => setIsEnabled(!isEnabled)}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                    isEnabled ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
                                }`}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                        isEnabled ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                                />
                            </button>
                        </div>
                    </div>
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
                        disabled={!provider || !modelName || !newModelName || submitting}
                        className="flex-1 py-2.5 bg-primary hover:bg-blue-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {submitting ? t('Creating...') : t('Create')}
                    </button>
                </div>
            </div>
        </div>
    );
}

interface EditModalProps {
    mapping: ModelMapping;
    onClose: () => void;
    onSuccess: (updated: ModelMapping) => void;
    canLoadModels: boolean;
    userGroups: UserGroup[];
}

function EditModal({ mapping, onClose, onSuccess, canLoadModels, userGroups }: EditModalProps) {
    const { t } = useTranslation();
    const providerOptions = buildProviderOptions(t);
    const selectorOptions = buildModelMappingSelectorOptions(t);
    const [provider, setProvider] = useState(mapping.provider);
    const [modelName, setModelName] = useState(mapping.model_name);
    const [newModelName, setNewModelName] = useState(mapping.new_model_name);
    const [fork, setFork] = useState(mapping.fork);
    const [selector, setSelector] = useState(mapping.selector ?? 0);
    const [rateLimit, setRateLimit] = useState(String(mapping.rate_limit ?? 0));
    const [isEnabled, setIsEnabled] = useState(mapping.is_enabled);
    const [providerDropdownOpen, setProviderDropdownOpen] = useState(false);
    const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
    const [selectorDropdownOpen, setSelectorDropdownOpen] = useState(false);
    const [models, setModels] = useState<string[]>([]);
    const [loadingModels, setLoadingModels] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [userGroupIds, setUserGroupIds] = useState<number[]>(mapping.user_group_id ?? []);
    const [userGroupMenuOpen, setUserGroupMenuOpen] = useState(false);
    const [userGroupSearch, setUserGroupSearch] = useState('');
    const [userGroupBtnWidth, setUserGroupBtnWidth] = useState<number | undefined>(undefined);

    const providerBtnRef = useRef<HTMLButtonElement>(null);
    const modelBtnRef = useRef<HTMLButtonElement>(null);
    const selectorBtnRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        const allOptions = [t('All Groups'), ...userGroups.map((g) => `${g.name} #${g.id}`)];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
            let maxWidth = 0;
            for (const opt of allOptions) {
                const width = ctx.measureText(opt).width;
                if (width > maxWidth) maxWidth = width;
            }
            setUserGroupBtnWidth(Math.ceil(maxWidth) + 76);
        }
    }, [userGroups, t]);

    useEffect(() => {
        if (!provider) {
            setModels([]);
            return;
        }
        if (!canLoadModels) {
            setModels([]);
            return;
        }
        setLoadingModels(true);
        apiFetchAdmin<{ models: string[] }>(
            `/v0/admin/model-mappings/available-models?provider=${encodeURIComponent(provider)}`
        )
            .then((res) => {
                setModels(res.models || []);
            })
            .catch(() => {
                setModels([]);
            })
            .finally(() => {
                setLoadingModels(false);
            });
    }, [provider, canLoadModels]);

    const handleSubmit = async () => {
        if (!provider || !modelName || !newModelName) return;
        const parsedRateLimit = Number.parseInt(rateLimit, 10);
        const rateLimitValue = Number.isNaN(parsedRateLimit) ? 0 : Math.max(0, parsedRateLimit);
        setSubmitting(true);
        try {
            await apiFetchAdmin(`/v0/admin/model-mappings/${mapping.id}`, {
                method: 'PUT',
                body: JSON.stringify({
                    provider,
                    model_name: modelName,
                    new_model_name: newModelName,
                    fork,
                    selector,
                    rate_limit: rateLimitValue,
                    user_group_id: userGroupIds,
                    is_enabled: isEnabled,
                }),
            });
            onSuccess({
                ...mapping,
                provider,
                model_name: modelName,
                new_model_name: newModelName,
                fork,
                selector,
                rate_limit: rateLimitValue,
                user_group_id: userGroupIds,
                is_enabled: isEnabled,
            });
            onClose();
        } catch (err) {
            console.error('Failed to update model mapping:', err);
        } finally {
            setSubmitting(false);
        }
    };

    const selectedProviderLabel = providerOptions.find((p) => p.value === provider)?.label || provider;
    const selectedSelectorLabel = getModelMappingSelectorLabel(selector, t);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white dark:bg-surface-dark rounded-xl shadow-xl w-full max-w-md mx-4 border border-gray-200 dark:border-border-dark max-h-[90vh] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-border-dark shrink-0">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                        {t('Edit Model Mapping')}
                    </h2>
                    <button
                        onClick={onClose}
                        className="inline-flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
                    >
                        <Icon name="close" />
                    </button>
                </div>
                <div className="p-6 space-y-4 flex-1 overflow-y-auto">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Provider')}
                        </label>
                        <div className="relative">
                            <button
                                ref={providerBtnRef}
                                type="button"
                                onClick={() => setProviderDropdownOpen(!providerDropdownOpen)}
                                className="w-full flex items-center justify-between px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            >
                                <span>{selectedProviderLabel}</span>
                                <Icon name="expand_more" size={18} />
                            </button>
                            {providerDropdownOpen && (
                                <DropdownPortal
                                    anchorRef={providerBtnRef}
                                    options={providerOptions}
                                    selected={provider}
                                    onSelect={(val) => {
                                        if (val !== provider) {
                                            setProvider(val);
                                            setModelName('');
                                        }
                                        setProviderDropdownOpen(false);
                                    }}
                                    onClose={() => setProviderDropdownOpen(false)}
                                />
                            )}
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Model')}
                        </label>
                        <div className="relative">
                            <button
                                ref={modelBtnRef}
                                type="button"
                                disabled={!provider || loadingModels || !canLoadModels}
                                onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                                className="w-full flex items-center justify-between px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <span className={modelName ? '' : 'text-gray-400'}>
                                    {!canLoadModels
                                        ? t('No permission to load models')
                                        : loadingModels
                                            ? t('Loading...')
                                            : modelName || t('Select Model')}
                                </span>
                                <Icon
                                    name={loadingModels ? 'progress_activity' : 'expand_more'}
                                    size={18}
                                    className={loadingModels ? 'animate-spin' : ''}
                                />
                            </button>
                            {modelDropdownOpen && models.length > 0 && (
                                <DropdownPortal
                                    anchorRef={modelBtnRef}
                                    options={models.map((m) => ({ label: m, value: m }))}
                                    selected={modelName}
                                    onSelect={(val) => {
                                        setModelName(val);
                                        setModelDropdownOpen(false);
                                    }}
                                    onClose={() => setModelDropdownOpen(false)}
                                />
                            )}
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Map To')}
                        </label>
                        <input
                            type="text"
                            value={newModelName}
                            onChange={(e) => setNewModelName(e.target.value)}
                            placeholder={t('Enter target model name')}
                            className="w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Selector')}
                        </label>
                        <div className="relative">
                            <button
                                ref={selectorBtnRef}
                                type="button"
                                onClick={() => setSelectorDropdownOpen(!selectorDropdownOpen)}
                                className="w-full flex items-center justify-between px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            >
                                <span>{selectedSelectorLabel}</span>
                                <Icon name="expand_more" size={18} />
                            </button>
                            {selectorDropdownOpen && (
                                <DropdownPortal
                                    anchorRef={selectorBtnRef}
                                    options={selectorOptions}
                                    selected={String(selector)}
                                    onSelect={(val) => {
                                        const next = Number.parseInt(val, 10);
                                        setSelector(Number.isFinite(next) ? next : 0);
                                        setSelectorDropdownOpen(false);
                                    }}
                                    onClose={() => setSelectorDropdownOpen(false)}
                                />
                            )}
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Rate limit')}
                        </label>
                        <input
                            type="number"
                            step="1"
                            value={rateLimit}
                            onChange={(e) => setRateLimit(e.target.value)}
                            placeholder="0"
                            className="w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('User Group')}
                        </label>
                        <div className="relative">
                            <button
                                type="button"
                                id="edit-model-mapping-user-groups-btn"
                                onClick={() => setUserGroupMenuOpen(!userGroupMenuOpen)}
                                className="flex items-center justify-between gap-2 w-full bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark text-slate-900 dark:text-white text-sm rounded-lg focus:ring-primary focus:border-primary px-4 py-2.5"
                                style={userGroupBtnWidth ? { minWidth: userGroupBtnWidth } : undefined}
                                title={
                                    userGroupIds.length === 0
                                        ? t('All Groups')
                                        : userGroupIds
                                              .map((id) => userGroups.find((g) => g.id === id)?.name || `#${id}`)
                                              .join(', ')
                                }
                            >
                                <span className="truncate">
                                    {userGroupIds.length === 0
                                        ? t('All Groups')
                                        : t('Selected {{count}}', { count: userGroupIds.length })}
                                </span>
                                <Icon name={userGroupMenuOpen ? 'expand_less' : 'expand_more'} size={18} />
                            </button>
                            {userGroupMenuOpen && (
                                <MultiGroupDropdownMenu
                                    anchorId="edit-model-mapping-user-groups-btn"
                                    groups={userGroups}
                                    selectedIds={userGroupIds}
                                    search={userGroupSearch}
                                    emptyLabel={t('All Groups')}
                                    menuWidth={userGroupBtnWidth}
                                    onSearchChange={setUserGroupSearch}
                                    onToggle={(value) =>
                                        setUserGroupIds((prev) =>
                                            prev.includes(value) ? prev.filter((id) => id !== value) : [...prev, value]
                                        )
                                    }
                                    onClear={() => setUserGroupIds([])}
                                    onClose={() => setUserGroupMenuOpen(false)}
                                />
                            )}
                        </div>
                        <p className="mt-1 text-xs text-slate-500 dark:text-text-secondary">
                            {t('Empty means all user groups can use this model mapping.')}
                        </p>
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                {t('Fork')}
                            </label>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                {t('Keep the upstream model and add this alias.')}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setFork(!fork)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                fork ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'
                            }`}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                    fork ? 'translate-x-6' : 'translate-x-1'
                                }`}
                            />
                        </button>
                    </div>

                    <div className="flex items-center justify-between">
                        <div className="flex items-center justify-between w-full">
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('Enabled')}</span>
                            <button
                                type="button"
                                onClick={() => setIsEnabled(!isEnabled)}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                    isEnabled ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
                                }`}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                        isEnabled ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                                />
                            </button>
                        </div>
                    </div>
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
                        disabled={!provider || !modelName || !newModelName || submitting}
                        className="flex-1 py-2.5 bg-primary hover:bg-blue-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {submitting ? t('Saving...') : t('Save')}
                    </button>
                </div>
            </div>
        </div>
    );
}

interface DropdownPortalProps {
    anchorRef: React.RefObject<HTMLButtonElement | null>;
    options: { label: string; value: string }[];
    selected: string;
    onSelect: (value: string) => void;
    onClose: () => void;
}

function DropdownPortal({ anchorRef, options, selected, onSelect, onClose }: DropdownPortalProps) {
    const [position, setPosition] = useState({ top: 0, left: 0, width: 160 });

    useLayoutEffect(() => {
        if (anchorRef.current) {
            const rect = anchorRef.current.getBoundingClientRect();
            setPosition({
                top: rect.bottom + 4,
                left: rect.left,
                width: rect.width,
            });
        }
    }, [anchorRef]);

    return createPortal(
        <>
            <div className="fixed inset-0 z-[60]" onClick={onClose} />
            <div
                className="fixed z-[70] bg-white dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg shadow-lg overflow-hidden max-h-60 overflow-y-auto"
                style={{ top: position.top, left: position.left, width: position.width }}
            >
                {options.map((opt) => (
                    <button
                        key={opt.value}
                        type="button"
                        onClick={() => onSelect(opt.value)}
                        className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-100 dark:hover:bg-background-dark transition-colors ${
                            selected === opt.value
                                ? 'bg-gray-100 dark:bg-background-dark text-primary font-medium'
                                : 'text-slate-900 dark:text-white'
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

interface PayloadRulesModalProps {
    mapping: ModelMapping;
    onClose: () => void;
    onSaved: (message: string) => void;
    canList: boolean;
    canCreate: boolean;
    canUpdate: boolean;
    canDelete: boolean;
}

interface ConfirmDialogState {
    title: string;
    message: string;
    confirmText?: string;
    danger?: boolean;
    onConfirm: () => void;
}

function PayloadRulesModal({
    mapping,
    onClose,
    onSaved,
    canList,
    canCreate,
    canUpdate,
    canDelete,
}: PayloadRulesModalProps) {
    const { t } = useTranslation();
    const [rule, setRule] = useState<ModelPayloadRuleForm | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
    const [paramRuleTypeMenuFor, setParamRuleTypeMenuFor] = useState<number | null>(null);
    const [paramValueTypeMenuFor, setParamValueTypeMenuFor] = useState<number | null>(null);

    const fetchRules = useCallback(async () => {
        if (!canList) {
            setRule(null);
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const res = await apiFetchAdmin<ModelPayloadRuleResponse>(
                `/v0/admin/model-mappings/${mapping.id}/payload-rules`
            );
            const first = res.rules && res.rules.length > 0 ? res.rules[0] : null;
            if (first) {
                const buildValue = (val: unknown): string => {
                    if (typeof val === 'string') return val;
                    if (val === undefined) return '';
                    return JSON.stringify(val, null, 2);
                };
                const inferValueType = (val: unknown): ParamValueType => {
                    if (typeof val === 'number') return 'number';
                    if (typeof val === 'boolean') return 'boolean';
                    if (val !== null && typeof val === 'object') return 'json';
                    return 'string';
                };
                const entries: ParamEntry[] = (() => {
                    if (Array.isArray(first.params)) {
                        return first.params
                            .filter((item) => item && typeof item === 'object')
                            .map((item) => {
                                const obj = item as {
                                    path?: string;
                                    rule_type?: string;
                                    ruleType?: string;
                                    value_type?: string;
                                    valueType?: string;
                                    value?: unknown;
                                };
                                const ruleType = obj.rule_type === 'override' || obj.ruleType === 'override' ? 'override' : 'default';
                                const valueTypeRaw = obj.value_type ?? obj.valueType;
                                const valueType =
                                    valueTypeRaw === 'number' || valueTypeRaw === 'boolean' || valueTypeRaw === 'json'
                                        ? valueTypeRaw
                                        : valueTypeRaw === 'string'
                                            ? 'string'
                                            : inferValueType(obj.value);
                                return {
                                    path: obj.path ? String(obj.path) : '',
                                    value: buildValue(obj.value),
                                    ruleType,
                                    valueType,
                                };
                            });
                    }
                    if (first.params && typeof first.params === 'object') {
                        return Object.entries(first.params as Record<string, unknown>).map(([path, val]) => {
                            let ruleType: ParamRuleType = 'default';
                            let valueType: ParamValueType = inferValueType(val);
                            let value = val;
                            if (val && typeof val === 'object' && !Array.isArray(val)) {
                                const meta = val as { rule_type?: string; type?: string; value?: unknown; value_type?: string };
                                if (meta.rule_type === 'override' || meta.type === 'override') {
                                    ruleType = 'override';
                                }
                                if (meta.value_type === 'string' || meta.value_type === 'number' || meta.value_type === 'boolean' || meta.value_type === 'json') {
                                    valueType = meta.value_type;
                                }
                                if (meta.value !== undefined) {
                                    value = meta.value;
                                }
                            }
                            return {
                                path,
                                value: buildValue(value),
                                ruleType,
                                valueType,
                            };
                        });
                    }
                    return [];
                })();
                setRule({
                    ...first,
                    protocol: first.protocol || '',
                    paramEntries: entries.length > 0 ? entries : [{ path: '', value: '', ruleType: 'default', valueType: 'string' }],
                    isNew: false,
                });
            } else {
                setRule({
                    id: Date.now(),
                    protocol: '',
                    paramEntries: [{ path: '', value: '', ruleType: 'default', valueType: 'string' }],
                    is_enabled: true,
                    description: '',
                    isNew: true,
                });
            }
        } catch (err) {
            console.error('Failed to fetch payload rules:', err);
            setRule({
                id: Date.now(),
                protocol: '',
                paramEntries: [{ path: '', value: '', ruleType: 'default', valueType: 'string' }],
                is_enabled: true,
                description: '',
                isNew: true,
            });
        } finally {
            setLoading(false);
            setParamRuleTypeMenuFor(null);
            setParamValueTypeMenuFor(null);
        }
    }, [mapping.id, canList]);

    const ruleTypeLabels: Record<ParamRuleType, string> = {
        default: t('Default'),
        override: t('Override'),
    };
    const valueTypeLabels: Record<ParamValueType, string> = {
        string: t('String'),
        number: t('Number'),
        boolean: t('Boolean'),
        json: t('JSON'),
    };
    const RULE_TYPE_OPTIONS: { label: string; value: ParamRuleType }[] = [
        { label: ruleTypeLabels.default, value: 'default' },
        { label: ruleTypeLabels.override, value: 'override' },
    ];
    const VALUE_TYPE_OPTIONS: { label: string; value: ParamValueType }[] = [
        { label: valueTypeLabels.string, value: 'string' },
        { label: valueTypeLabels.number, value: 'number' },
        { label: valueTypeLabels.boolean, value: 'boolean' },
        { label: valueTypeLabels.json, value: 'json' },
    ];

    const ParamRuleTypeDropdownMenu = ({
        anchorId,
        selected,
        onSelect,
    }: {
        anchorId: string;
        selected: ParamRuleType;
        onSelect: (value: ParamRuleType) => void;
    }) => {
        const [pos, setPos] = useState({ top: 0, left: 0, width: 200 });

        useLayoutEffect(() => {
            const btn = document.getElementById(anchorId);
            if (!btn) return;
            const rect = btn.getBoundingClientRect();
            setPos({
                top: rect.bottom + 4,
                left: rect.left,
                width: rect.width,
            });
        }, [anchorId]);

        return createPortal(
            <>
                <div className="fixed inset-0 z-40" onClick={() => setParamRuleTypeMenuFor(null)} />
                <div
                    className="fixed z-50 bg-white dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg shadow-lg overflow-hidden"
                    style={{ top: pos.top, left: pos.left, width: pos.width }}
                >
                    {RULE_TYPE_OPTIONS.map((opt) => (
                        <button
                            key={opt.value}
                            type="button"
                            onClick={() => {
                                onSelect(opt.value);
                                setParamRuleTypeMenuFor(null);
                            }}
                            className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-100 dark:hover:bg-background-dark transition-colors ${
                                selected === opt.value
                                    ? 'bg-gray-100 dark:bg-background-dark text-primary font-medium'
                                    : 'text-slate-900 dark:text-white'
                            }`}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            </>,
            document.body
        );
    };

    const ParamValueTypeDropdownMenu = ({
        anchorId,
        selected,
        onSelect,
    }: {
        anchorId: string;
        selected: ParamValueType;
        onSelect: (value: ParamValueType) => void;
    }) => {
        const [pos, setPos] = useState({ top: 0, left: 0, width: 200 });

        useLayoutEffect(() => {
            const btn = document.getElementById(anchorId);
            if (!btn) return;
            const rect = btn.getBoundingClientRect();
            setPos({
                top: rect.bottom + 4,
                left: rect.left,
                width: rect.width,
            });
        }, [anchorId]);

        return createPortal(
            <>
                <div className="fixed inset-0 z-40" onClick={() => setParamValueTypeMenuFor(null)} />
                <div
                    className="fixed z-50 bg-white dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg shadow-lg overflow-hidden"
                    style={{ top: pos.top, left: pos.left, width: pos.width }}
                >
                    {VALUE_TYPE_OPTIONS.map((opt) => (
                        <button
                            key={opt.value}
                            type="button"
                            onClick={() => {
                                onSelect(opt.value);
                                setParamValueTypeMenuFor(null);
                            }}
                            className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-100 dark:hover:bg-background-dark transition-colors ${
                                selected === opt.value
                                    ? 'bg-gray-100 dark:bg-background-dark text-primary font-medium'
                                    : 'text-slate-900 dark:text-white'
                            }`}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            </>,
            document.body
        );
    };

    useEffect(() => {
        fetchRules();
    }, [fetchRules]);

    const updateRuleField = (field: keyof ModelPayloadRuleForm, value: unknown) => {
        setRule((prev) => (prev ? { ...prev, [field]: value } : prev));
    };

    const updateParamEntry = (idx: number, field: keyof ParamEntry, value: string | ParamRuleType | ParamValueType) => {
        setRule((prev) => {
            if (!prev) return prev;
            const entries = [...prev.paramEntries];
            entries[idx] = { ...entries[idx], [field]: value } as ParamEntry;
            return { ...prev, paramEntries: entries };
        });
    };

    const addParamEntry = () => {
        setRule((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                paramEntries: [...prev.paramEntries, { path: '', value: '', ruleType: 'default', valueType: 'string' }],
            };
        });
    };

    const removeParamEntry = (idx: number) => {
        setRule((prev) => {
            if (!prev) return prev;
            if (prev.paramEntries.length === 1) {
                return { ...prev, paramEntries: [{ path: '', value: '', ruleType: 'default', valueType: 'string' }] };
            }
            const entries = prev.paramEntries.filter((_, i) => i !== idx);
            return { ...prev, paramEntries: entries };
        });
    };

    const saveRule = async () => {
        if (!rule) return;
        const canSave = rule.isNew ? canCreate : canUpdate;
        if (!canSave) {
            alert(t('Permission denied'));
            return;
        }
        let hasInvalidValue = false;
        const params = rule.paramEntries
            .map((entry) => {
                const key = entry.path.trim();
                if (!key) return null;
                let value: unknown = entry.value;
                const trimmed = entry.value.trim();
                if (entry.valueType === 'json') {
                    try {
                        value = trimmed === '' ? null : JSON.parse(trimmed);
                    } catch {
                        alert(t('Invalid JSON for path "{{path}}"', { path: key }));
                        hasInvalidValue = true;
                        return null;
                    }
                } else if (entry.valueType === 'number') {
                    const num = Number(trimmed);
                    if (!Number.isFinite(num)) {
                        alert(t('Invalid number for path "{{path}}"', { path: key }));
                        hasInvalidValue = true;
                        return null;
                    }
                    value = num;
                } else if (entry.valueType === 'boolean') {
                    const lower = trimmed.toLowerCase();
                    if (lower === 'true') value = true;
                    else if (lower === 'false') value = false;
                    else {
                        alert(t('Invalid boolean for path "{{path}}"', { path: key }));
                        hasInvalidValue = true;
                        return null;
                    }
                } else {
                    value = entry.value;
                }
                return {
                    path: key,
                    rule_type: entry.ruleType,
                    value_type: entry.valueType,
                    value,
                };
            })
            .filter((item) => item !== null);

        if (hasInvalidValue) {
            return;
        }

        const body = {
            params,
            is_enabled: rule.is_enabled,
            description: rule.description,
        };
        setSaving(true);
        try {
            if (rule.isNew) {
                await apiFetchAdmin(`/v0/admin/model-mappings/${mapping.id}/payload-rules`, {
                    method: 'POST',
                    body: JSON.stringify(body),
                });
            } else {
                await apiFetchAdmin(`/v0/admin/model-mappings/${mapping.id}/payload-rules/${rule.id}`, {
                    method: 'PUT',
                    body: JSON.stringify(body),
                });
            }
            onSaved(t('Payload rule saved'));
            onClose();
        } catch (err) {
            console.error('Failed to save payload rule:', err);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
            <div className="bg-white dark:bg-surface-dark w-full max-w-4xl rounded-xl shadow-xl border border-gray-200 dark:border-border-dark max-h-[90vh] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-border-dark flex-shrink-0">
                    <div>
                        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('Payload Rules')}</h2>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            {t('Mapping #{{id}} · {{name}}', {
                                id: mapping.id,
                                name: mapping.new_model_name,
                            })}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="inline-flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
                    >
                        <Icon name="close" />
                    </button>
                </div>

                <div className="p-6 space-y-4 overflow-y-auto flex-1">
                    {!canList ? (
                        <div className="py-10 text-center text-gray-500 dark:text-gray-400">
                            {t('No access.')}
                        </div>
                    ) : loading ? (
                        <div className="flex items-center justify-center py-10 text-gray-500 dark:text-gray-400">
                            <Icon name="progress_activity" className="animate-spin mr-2" />
                            {t('Loading...')}
                        </div>
                    ) : rule ? (
                        <div className="space-y-4">
                            <div
                                className="border border-gray-200 dark:border-border-dark rounded-lg p-4 bg-gray-50 dark:bg-background-dark"
                            >
                                    <div className="grid grid-cols-1 gap-4">
                                        <div className="flex flex-col gap-1">
                                            <label className="text-xs text-gray-500 dark:text-gray-400">{t('Description')}</label>
                                            <input
                                                type="text"
                                                value={rule.description || ''}
                                                onChange={(e) => updateRuleField('description', e.target.value)}
                                                placeholder={t('Optional note')}
                                                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-border-dark bg-white dark:bg-surface-dark text-slate-900 dark:text-white"
                                            />
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <label className="text-xs text-gray-500 dark:text-gray-400">{t('Enabled')}</label>
                                            <div className="flex items-center">
                                                <button
                                                    type="button"
                                                    onClick={() => updateRuleField('is_enabled', !rule.is_enabled)}
                                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                                        rule.is_enabled ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
                                                    }`}
                                                >
                                                    <span
                                                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                                            rule.is_enabled ? 'translate-x-6' : 'translate-x-1'
                                                        }`}
                                                    />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="mt-3 space-y-2">
                                        <label className="text-xs text-gray-500 dark:text-gray-400">{t('Params')}</label>
                                        {rule.paramEntries.map((entry, idx) => (
                                            <div
                                                key={idx}
                                                className="grid grid-cols-[minmax(0,2.6fr)_minmax(0,2.6fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_minmax(0,96px)] gap-2 items-center w-full"
                                            >
                                                <input
                                                    type="text"
                                                    value={entry.path}
                                                    onChange={(e) => updateParamEntry(idx, 'path', e.target.value)}
                                                    placeholder={t('path (gjson)')}
                                                    className="h-10 px-3 text-sm rounded-lg border border-gray-200 dark:border-border-dark bg-white dark:bg-surface-dark text-slate-900 dark:text-white w-full"
                                                />
                                                <input
                                                    type="text"
                                                    value={entry.value}
                                                    onChange={(e) => updateParamEntry(idx, 'value', e.target.value)}
                                                    placeholder={t('value')}
                                                    className="h-10 px-3 text-sm rounded-lg border border-gray-200 dark:border-border-dark bg-white dark:bg-surface-dark text-slate-900 dark:text-white w-full"
                                                />
                                                <div className="relative w-full">
                                                    <button
                                                        type="button"
                                                        id={`payload-param-rule-type-btn-${idx}`}
                                                        onClick={() =>
                                                            setParamRuleTypeMenuFor((prev) => (prev === idx ? null : idx))
                                                        }
                                                        className="flex items-center justify-between gap-2 bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark text-slate-900 dark:text-white text-sm rounded-lg focus:ring-primary focus:border-primary px-3 h-10 w-full"
                                                    >
                                                        <span>{ruleTypeLabels[entry.ruleType]}</span>
                                                        <Icon
                                                            name={paramRuleTypeMenuFor === idx ? 'expand_less' : 'expand_more'}
                                                            size={18}
                                                        />
                                                    </button>
                                                    {paramRuleTypeMenuFor === idx && (
                                                        <ParamRuleTypeDropdownMenu
                                                            anchorId={`payload-param-rule-type-btn-${idx}`}
                                                            selected={entry.ruleType}
                                                            onSelect={(val) => updateParamEntry(idx, 'ruleType', val)}
                                                        />
                                                    )}
                                                </div>
                                                <div className="relative w-full">
                                                    <button
                                                        type="button"
                                                        id={`payload-param-value-type-btn-${idx}`}
                                                        onClick={() =>
                                                            setParamValueTypeMenuFor((prev) => (prev === idx ? null : idx))
                                                        }
                                                        className="flex items-center justify-between gap-2 bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark text-slate-900 dark:text-white text-sm rounded-lg focus:ring-primary focus:border-primary px-3 h-10 w-full"
                                                    >
                                                        <span>{valueTypeLabels[entry.valueType]}</span>
                                                        <Icon
                                                            name={paramValueTypeMenuFor === idx ? 'expand_less' : 'expand_more'}
                                                            size={18}
                                                        />
                                                    </button>
                                                    {paramValueTypeMenuFor === idx && (
                                                        <ParamValueTypeDropdownMenu
                                                            anchorId={`payload-param-value-type-btn-${idx}`}
                                                            selected={entry.valueType}
                                                            onSelect={(val) => updateParamEntry(idx, 'valueType', val)}
                                                        />
                                                    )}
                                                </div>
                                                <div className="flex items-center justify-between gap-1 w-full">
                                                    <button
                                                        type="button"
                                                        onClick={addParamEntry}
                                                        className="inline-flex items-center justify-center h-10 w-10 rounded-lg border border-gray-200 dark:border-border-dark text-gray-600 hover:bg-gray-100 dark:hover:bg-background-dark"
                                                        title={t('Add row')}
                                                    >
                                                        <Icon name="add" size={18} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => removeParamEntry(idx)}
                                                        className="inline-flex items-center justify-center h-10 w-10 rounded-lg border border-gray-200 dark:border-border-dark text-gray-600 hover:bg-gray-100 dark:hover:bg-background-dark"
                                                        title={t('Remove row')}
                                                    >
                                                        <Icon name="remove" size={18} />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="mt-4" />
                                </div>
                        </div>
                    ) : (
                        <div className="py-10 text-center text-gray-500 dark:text-gray-400">{t('No payload rule.')}</div>
                    )}
                </div>

                <div className="px-6 py-4 border-t border-gray-200 dark:border-border-dark flex justify-end gap-2 flex-shrink-0">
                    <button
                        type="button"
                        onClick={() => {
                            if (!rule || rule.isNew) return;
                            if (!canDelete) return;
                            setConfirmDialog({
                                title: t('Delete Payload Rule'),
                                message: t('Are you sure you want to delete this payload rule? This action cannot be undone.'),
                                confirmText: t('Delete'),
                                danger: true,
                                onConfirm: async () => {
                                    setSaving(true);
                                    try {
                                        await apiFetchAdmin(
                                            `/v0/admin/model-mappings/${mapping.id}/payload-rules/${rule.id}`,
                                            { method: 'DELETE' }
                                        );
                                        onSaved(t('Payload rule deleted'));
                                        onClose();
                                    } catch (err) {
                                        console.error('Failed to delete payload rule:', err);
                                    } finally {
                                        setSaving(false);
                                        setConfirmDialog(null);
                                    }
                                },
                            });
                        }}
                        className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-60"
                        disabled={!rule || rule.isNew || saving || !canDelete}
                    >
                        <Icon name="delete" size={18} />
                        {t('Delete')}
                    </button>
                    <button
                        type="button"
                        onClick={saveRule}
                        className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-primary hover:bg-blue-600 text-white transition-colors disabled:opacity-60"
                        disabled={!rule || saving || !(rule.isNew ? canCreate : canUpdate)}
                    >
                        <Icon name="save" size={18} />
                        {saving ? t('Saving...') : t('Save')}
                    </button>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-background-dark hover:bg-gray-200 dark:hover:bg-gray-700 text-slate-900 dark:text-white border border-gray-200 dark:border-border-dark"
                    >
                        {t('Close')}
                    </button>
                </div>
            </div>
            {confirmDialog && (
                <ConfirmDialog
                    title={confirmDialog.title}
                    message={confirmDialog.message}
                    confirmText={confirmDialog.confirmText}
                    danger={confirmDialog.danger}
                    onConfirm={confirmDialog.onConfirm}
                    onCancel={() => setConfirmDialog(null)}
                />
            )}
        </div>
    );
}

export function AdminModels() {
    const { t } = useTranslation();
    const { hasPermission } = useAdminPermissions();
    const canListMappings = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/model-mappings'));
    const canListUserGroups = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/user-groups'));
    const canListAvailableModels = hasPermission(
        buildAdminPermissionKey('GET', '/v0/admin/model-mappings/available-models')
    );
    const canListProviderApiKeys = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/provider-api-keys'));
    const canCreateMapping = hasPermission(buildAdminPermissionKey('POST', '/v0/admin/model-mappings'));
    const canUpdateMapping = hasPermission(buildAdminPermissionKey('PUT', '/v0/admin/model-mappings/:id'));
    const canDeleteMapping = hasPermission(buildAdminPermissionKey('DELETE', '/v0/admin/model-mappings/:id'));
    const canEnableMapping = hasPermission(
        buildAdminPermissionKey('POST', '/v0/admin/model-mappings/:id/enable')
    );
    const canDisableMapping = hasPermission(
        buildAdminPermissionKey('POST', '/v0/admin/model-mappings/:id/disable')
    );
    const canListPayloadRules = hasPermission(
        buildAdminPermissionKey('GET', '/v0/admin/model-mappings/:id/payload-rules')
    );
    const canCreatePayloadRules = hasPermission(
        buildAdminPermissionKey('POST', '/v0/admin/model-mappings/:id/payload-rules')
    );
    const canUpdatePayloadRules = hasPermission(
        buildAdminPermissionKey('PUT', '/v0/admin/model-mappings/:id/payload-rules/:rule_id')
    );
    const canDeletePayloadRules = hasPermission(
        buildAdminPermissionKey('DELETE', '/v0/admin/model-mappings/:id/payload-rules/:rule_id')
    );

    const [mappings, setMappings] = useState<ModelMapping[]>([]);
    const [loading, setLoading] = useState(true);
    const [userGroups, setUserGroups] = useState<UserGroup[]>([]);
    const [providerApiKeys, setProviderApiKeys] = useState<ProviderApiKeyRef[]>([]);
    const [providerFilter, setProviderFilter] = useState('');
    const [providerDropdownOpen, setProviderDropdownOpen] = useState(false);
    const [modelSearch, setModelSearch] = useState('');
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [confirmDialog, setConfirmDialog] = useState<{
        title: string;
        message: string;
        onConfirm: () => void;
        confirmText?: string;
        danger?: boolean;
    } | null>(null);
    const [createModalOpen, setCreateModalOpen] = useState(false);
    const [editMapping, setEditMapping] = useState<ModelMapping | null>(null);
    const [payloadModalMapping, setPayloadModalMapping] = useState<ModelMapping | null>(null);
    const [toast, setToast] = useState<{ show: boolean; message: string }>({ show: false, message: '' });
    const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const fetchData = useCallback(async () => {
        if (!canListMappings) {
            return;
        }
        setLoading(true);
        try {
            const res = await apiFetchAdmin<ListResponse>('/v0/admin/model-mappings');
            setMappings(res.model_mappings || []);
        } catch (err) {
            console.error('Failed to fetch model mappings:', err);
        } finally {
            setLoading(false);
        }
    }, [canListMappings]);

    useEffect(() => {
        if (canListMappings) {
            fetchData();
        }
    }, [fetchData, canListMappings]);

    useEffect(() => {
        if (!canListUserGroups) {
            return;
        }
        apiFetchAdmin<UserGroupsResponse>('/v0/admin/user-groups')
            .then((res) => setUserGroups(res.user_groups || []))
            .catch(console.error);
    }, [canListUserGroups]);

    const fetchProviderApiKeys = useCallback(async () => {
        if (!canListProviderApiKeys) {
            return;
        }
        try {
            const res = await apiFetchAdmin<ProviderApiKeysListResponse>('/v0/admin/provider-api-keys');
            const next = (res.api_keys || []).map((row) => ({
                id: row.id,
                provider: row.provider,
                name: row.name,
            }));
            setProviderApiKeys(next);
        } catch (err) {
            console.error('Failed to fetch provider api keys:', err);
            setProviderApiKeys([]);
        }
    }, [canListProviderApiKeys]);

    useEffect(() => {
        if (canListProviderApiKeys) {
            fetchProviderApiKeys();
        }
    }, [fetchProviderApiKeys, canListProviderApiKeys]);

    const providerFilterOptions = (() => {
        const options: ProviderFilterOption[] = [{ value: '', label: t('All Providers'), providerKey: '' }];
        const seen = new Set<string>(['']);

        const addOption = (opt: ProviderFilterOption) => {
            if (seen.has(opt.value)) return;
            seen.add(opt.value);
            options.push(opt);
        };

        const apiKeyOptions: ProviderFilterOption[] = [];
        providerApiKeys.forEach((row) => {
            const provider = row.provider.trim().toLowerCase();
            if (!provider) return;

            const providerLabel = getAPIKeyProviderLabel(provider, t);
            const name = row.name.trim();
            const providerKey = provider === 'openai-compatibility'
                ? normalizeOpenAICompatProviderKey(name)
                : provider;
            if (!providerKey) return;

            const label = name ? `${providerLabel} / ${name}` : providerLabel;
            apiKeyOptions.push({
                value: `apikey:${row.id}`,
                label,
                providerKey,
            });
        });

        apiKeyOptions
            .sort((a, b) => a.label.localeCompare(b.label))
            .forEach((opt) => addOption(opt));

        const providerKeysCoveredByApiKeys = new Set<string>(apiKeyOptions.map((opt) => opt.providerKey));

        Array.from(new Set(mappings.map((m) => m.provider)))
            .filter((p) => p.trim() !== '')
            .sort((a, b) => a.localeCompare(b))
            .forEach((providerKey) => {
                if (providerKeysCoveredByApiKeys.has(providerKey)) {
                    return;
                }
                addOption({
                    value: `provider:${providerKey}`,
                    label: getAPIKeyProviderLabel(providerKey, t),
                    providerKey,
                });
            });

        return options;
    })();

    const providerKeyFilter = (() => {
        if (!providerFilter) {
            return '';
        }
        if (providerFilter.startsWith('provider:')) {
            return providerFilter.slice('provider:'.length);
        }
        if (providerFilter.startsWith('apikey:')) {
            const id = Number(providerFilter.slice('apikey:'.length));
            if (!Number.isFinite(id)) {
                return '';
            }
            const row = providerApiKeys.find((k) => k.id === id);
            if (!row) {
                return '';
            }
            const provider = row.provider.trim().toLowerCase();
            if (!provider) {
                return '';
            }
            const name = row.name.trim();
            return provider === 'openai-compatibility'
                ? normalizeOpenAICompatProviderKey(name)
                : provider;
        }
        return providerFilter;
    })();

    const selectedProviderLabel = (() => {
        if (!providerFilter) {
            return t('All Providers');
        }
        const label = providerFilterOptions.find((opt) => opt.value === providerFilter)?.label;
        if (label) {
            return label;
        }
        if (providerFilter.startsWith('provider:')) {
            return providerFilter.slice('provider:'.length);
        }
        return providerFilter;
    })();

    const normalizedModelSearch = modelSearch.trim().toLowerCase();

    const filteredMappings = mappings.filter((m) => {
        if (providerKeyFilter && m.provider !== providerKeyFilter) {
            return false;
        }

        if (!normalizedModelSearch) {
            return true;
        }

        const modelName = m.model_name?.toLowerCase() || '';
        const newModelName = m.new_model_name?.toLowerCase() || '';
        return modelName.includes(normalizedModelSearch) || newModelName.includes(normalizedModelSearch);
    });

    const { tableScrollRef, handleTableScroll, showActionsDivider } = useStickyActionsDivider(
        filteredMappings.length,
        loading
    );

    useEffect(() => {
        setSelectedIds((prev) => {
            if (prev.size === 0) return prev;
            const existingIds = new Set(mappings.map((m) => m.id));
            const next = new Set<number>();
            prev.forEach((id) => {
                if (existingIds.has(id)) next.add(id);
            });
            return next;
        });
    }, [mappings]);

    const filteredIds = filteredMappings.map((m) => m.id);
    const anyFilteredSelected = filteredIds.some((id) => selectedIds.has(id));
    const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id));
    const selectedCount = selectedIds.size;

    const handleToggleStatus = async (mapping: ModelMapping) => {
        const enabled = !mapping.is_enabled;
        const canToggle = enabled ? (canEnableMapping || canUpdateMapping) : (canDisableMapping || canUpdateMapping);
        if (!canToggle) {
            return;
        }
        try {
            if (enabled && canEnableMapping) {
                await apiFetchAdmin(`/v0/admin/model-mappings/${mapping.id}/enable`, { method: 'POST' });
            } else if (!enabled && canDisableMapping) {
                await apiFetchAdmin(`/v0/admin/model-mappings/${mapping.id}/disable`, { method: 'POST' });
            } else {
                await apiFetchAdmin(`/v0/admin/model-mappings/${mapping.id}`, {
                    method: 'PUT',
                    body: JSON.stringify({ is_enabled: enabled }),
                });
            }
            setMappings((prev) =>
                prev.map((item) =>
                    item.id === mapping.id
                        ? { ...item, is_enabled: enabled }
                        : item
                )
            );
        } catch (err) {
            console.error('Failed to toggle model mapping status:', err);
        }
    };

    const handleEdit = (mapping: ModelMapping) => {
        if (!canUpdateMapping) {
            return;
        }
        setEditMapping(mapping);
    };

    const handleEditSave = (updated: ModelMapping) => {
        setMappings((prev) =>
            prev.map((item) => (item.id === updated.id ? updated : item))
        );
        setEditMapping(null);
    };

    const showToast = useCallback((message: string) => {
        setToast({ show: true, message });
        if (toastTimeoutRef.current) {
            clearTimeout(toastTimeoutRef.current);
        }
        toastTimeoutRef.current = setTimeout(() => {
            setToast({ show: false, message: '' });
        }, 3000);
    }, []);

    useEffect(() => {
        return () => {
            if (toastTimeoutRef.current) {
                clearTimeout(toastTimeoutRef.current);
            }
        };
    }, []);

    const handleDelete = (id: number) => {
        if (!canDeleteMapping) {
            return;
        }
        setConfirmDialog({
            title: t('Delete Model Mapping'),
            message: t('Are you sure you want to delete this model mapping? This action cannot be undone.'),
            confirmText: t('Delete'),
            danger: true,
            onConfirm: async () => {
                try {
                    await apiFetchAdmin(`/v0/admin/model-mappings/${id}`, { method: 'DELETE' });
                    fetchData();
                } catch (err) {
                    console.error('Failed to delete model mapping:', err);
                }
                setConfirmDialog(null);
            },
        });
    };

    const handleBulkSetEnabled = (enabled: boolean) => {
        const ids = Array.from(selectedIds);
        const idsSet = new Set(ids);
        if (ids.length === 0) return;

        const canBulkEnable = enabled ? (canEnableMapping || canUpdateMapping) : (canDisableMapping || canUpdateMapping);
        if (!canBulkEnable) return;

        const actionLabel = enabled ? t('Enable') : t('Disable');
        setConfirmDialog({
            title: t('{{action}} Model Mappings', { action: actionLabel }),
            message: t('Are you sure you want to {{action}} {{count}} model mapping(s)?', {
                action: actionLabel,
                count: ids.length,
            }),
            confirmText: actionLabel,
            danger: !enabled,
            onConfirm: async () => {
                try {
                    const results = await Promise.allSettled(
                        ids.map(async (id) => {
                            if (enabled && canEnableMapping) {
                                await apiFetchAdmin(`/v0/admin/model-mappings/${id}/enable`, { method: 'POST' });
                                return;
                            }
                            if (!enabled && canDisableMapping) {
                                await apiFetchAdmin(`/v0/admin/model-mappings/${id}/disable`, { method: 'POST' });
                                return;
                            }
                            await apiFetchAdmin(`/v0/admin/model-mappings/${id}`, {
                                method: 'PUT',
                                body: JSON.stringify({ is_enabled: enabled }),
                            });
                        })
                    );

                    const hasFailures = results.some((r) => r.status === 'rejected');
                    setMappings((prev) =>
                        prev.map((item) => (idsSet.has(item.id) ? { ...item, is_enabled: enabled } : item))
                    );

                    if (!hasFailures) {
                        setSelectedIds(new Set());
                    }
                } catch (err) {
                    console.error('Failed to bulk update model mapping status:', err);
                } finally {
                    setConfirmDialog(null);
                }
            },
        });
    };

    if (!canListMappings) {
        return (
            <AdminDashboardLayout
                title={t('Model Mappings')}
                subtitle={t('Manage model name mappings and routing')}
            >
                <AdminNoAccessCard />
            </AdminDashboardLayout>
        );
    }

    return (
        <AdminDashboardLayout
            title={t('Model Mappings')}
            subtitle={t('Manage model name mappings and routing')}
        >
            <div className="space-y-6">
                {canCreateMapping && (
                    <div className="flex justify-end">
                            <button
                                onClick={() => setCreateModalOpen(true)}
                                className="flex items-center gap-2 px-4 py-2 text-sm bg-primary hover:bg-blue-600 text-white rounded-lg font-medium transition-colors"
                            >
                                <Icon name="add" size={18} />
                                <span>{t('New')}</span>
                            </button>
                        </div>
                    )}

                <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-white dark:bg-surface-dark p-3 rounded-xl border border-gray-200 dark:border-border-dark shadow-sm">
                    <div className="flex gap-3 w-full md:w-auto">
                        <div className="relative">
                            <button
                                id="provider-dropdown-btn"
                                type="button"
                                onClick={() => setProviderDropdownOpen(!providerDropdownOpen)}
                                className="flex items-center justify-between gap-2 bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark text-slate-900 dark:text-white text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5 whitespace-nowrap"
                            >
                                <span className="flex items-center gap-2">
                                    <Icon name="filter_list" size={18} />
                                    {selectedProviderLabel}
                                </span>
                                <Icon name="expand_more" size={18} />
                            </button>
                            {providerDropdownOpen && (
                                <ProviderDropdownMenu
                                    selected={providerFilter}
                                    options={providerFilterOptions}
                                    onSelect={(value) => {
                                        setProviderFilter(value);
                                        setProviderDropdownOpen(false);
                                    }}
                                    onClose={() => setProviderDropdownOpen(false)}
                                />
                            )}
                        </div>
                        <div className="relative flex-1 md:flex-none md:w-72">
                            <input
                                type="text"
                                value={modelSearch}
                                onChange={(e) => setModelSearch(e.target.value)}
                                placeholder={t('Search model name or new name')}
                                className="w-full bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark text-slate-900 dark:text-white text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5 pr-10"
                            />
                            <Icon
                                name="search"
                                size={18}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                            />
                        </div>
                    </div>

                    <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end">
                        {selectedCount > 0 ? (
                            <div className="text-sm text-slate-700 dark:text-text-secondary">
                                {t('Selected')}:{" "}
                                <span className="font-medium text-slate-900 dark:text-white">{selectedCount}</span>
                            </div>
                        ) : (
                            <div />
                        )}
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => handleBulkSetEnabled(true)}
                                disabled={selectedCount === 0 || !(canEnableMapping || canUpdateMapping)}
                                className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg font-medium transition-colors bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                title={t('Bulk enable selected')}
                            >
                                <Icon name="toggle_on" size={18} />
                                <span>{t('Enable')}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => handleBulkSetEnabled(false)}
                                disabled={selectedCount === 0 || !(canDisableMapping || canUpdateMapping)}
                                className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg font-medium transition-colors bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                title={t('Bulk disable selected')}
                            >
                                <Icon name="toggle_off" size={18} />
                                <span>{t('Disable')}</span>
                            </button>
                        </div>
                    </div>
                </div>

                <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark overflow-hidden">
                    <div ref={tableScrollRef} className="overflow-x-auto" onScroll={handleTableScroll}>
                        <table className="w-full text-left text-sm">
                            <thead className="bg-gray-50 dark:bg-surface-dark text-gray-500 dark:text-gray-400 uppercase text-xs font-semibold border-b border-gray-200 dark:border-border-dark">
                                <tr>
                                    <th className="px-6 py-4 w-12">
                                            <AdminCheckbox
                                                checked={allFilteredSelected}
                                                indeterminate={!allFilteredSelected && anyFilteredSelected}
                                                disabled={loading || filteredIds.length === 0}
                                            onChange={(nextChecked) => {
                                                setSelectedIds((prev) => {
                                                    const next = new Set(prev);
                                                    if (nextChecked) {
                                                        filteredIds.forEach((id) => next.add(id));
                                                        return next;
                                                    }
                                                    filteredIds.forEach((id) => next.delete(id));
                                                    return next;
                                                });
                                            }}
                                            title={t('Select all')}
                                        />
                                    </th>
                                    <th className="px-6 py-4">{t('Provider')}</th>
                                    <th className="px-6 py-4">{t('Model Name')}</th>
                                    <th className="px-6 py-4">{t('New Model Name')}</th>
                                    <th className="px-6 py-4">{t('Rate limit')}</th>
                                    <th className="px-6 py-4">{t('User Group')}</th>
                                    <th className="px-6 py-4">{t('Fork')}</th>
                                    <th className="px-6 py-4">{t('Status')}</th>
                                    <th
                                        className={`px-6 py-4 text-center sticky right-0 z-20 bg-gray-50 dark:bg-surface-dark relative after:content-[''] after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-gray-200 dark:after:bg-border-dark after:pointer-events-none ${
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
                                    <td colSpan={9} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                                        <div className="flex items-center justify-center gap-2">
                                            <Icon name="progress_activity" className="animate-spin" />
                                            <span>{t('Loading...')}</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : filteredMappings.length === 0 ? (
                                <tr>
                                    <td colSpan={9} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                                        {t('No model mappings found')}
                                    </td>
                                </tr>
                            ) : (
                                filteredMappings.map((mapping) => (
                                    <tr
                                        key={mapping.id}
                                        className="hover:bg-gray-50 dark:hover:bg-background-dark group"
                                    >
                                        <td className="px-6 py-4">
                                            <AdminCheckbox
                                                checked={selectedIds.has(mapping.id)}
                                                onChange={(nextChecked) => {
                                                    setSelectedIds((prev) => {
                                                        const next = new Set(prev);
                                                        if (nextChecked) {
                                                            next.add(mapping.id);
                                                        } else {
                                                            next.delete(mapping.id);
                                                        }
                                                        return next;
                                                    });
                                                }}
                                                title={t('Select row')}
                                            />
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`inline-flex px-2.5 py-1 text-xs font-medium rounded-full border ${getProviderStyle(mapping.provider)}`}>
                                                {mapping.provider}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900 dark:text-white font-mono">
                                            {mapping.model_name}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900 dark:text-white font-mono">
                                            {mapping.new_model_name}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 dark:text-text-secondary font-mono">
                                            {mapping.rate_limit.toLocaleString()}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary">
                                            <span
                                                className="truncate"
                                                title={
                                                    mapping.user_group_id.length === 0
                                                        ? t('All Groups')
                                                        : mapping.user_group_id
                                                              .map((id) => userGroups.find((g) => g.id === id)?.name || `#${id}`)
                                                              .join(', ')
                                                }
                                            >
                                                {mapping.user_group_id.length === 0
                                                    ? t('All Groups')
                                                    : t('Selected {{count}}', { count: mapping.user_group_id.length })}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span
                                                className={`inline-flex px-2.5 py-1 text-xs font-medium rounded-full border ${
                                                    mapping.fork
                                                        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 border-indigo-100 dark:border-indigo-800'
                                                        : 'bg-gray-50 text-gray-600 dark:bg-gray-900/30 dark:text-gray-400 border-gray-100 dark:border-gray-800'
                                                }`}
                                            >
                                                {mapping.fork ? t('Yes') : t('No')}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`inline-flex px-2.5 py-1 text-xs font-medium rounded-full border ${getStatusStyle(mapping.is_enabled)}`}>
                                                {mapping.is_enabled ? t('Enabled') : t('Disabled')}
                                            </span>
                                        </td>
                                        <td
                                            className={`px-6 py-4 text-center sticky right-0 z-10 bg-white dark:bg-surface-dark group-hover:bg-gray-50 dark:group-hover:bg-background-dark relative after:content-[''] after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-gray-200 dark:after:bg-border-dark after:pointer-events-none ${
                                                showActionsDivider ? 'after:opacity-100' : 'after:opacity-0'
                                            }`}
                                        >
                                            <div className="flex items-center justify-center gap-1">
                                                {canListPayloadRules && (
                                                    <button
                                                        onClick={() => setPayloadModalMapping(mapping)}
                                                        className="p-2 text-gray-400 hover:text-purple-600 hover:bg-gray-100 dark:hover:bg-background-dark rounded-lg transition-colors"
                                                        title={t('Payload injection rules')}
                                                    >
                                                        <Icon name="data_object" size={18} />
                                                    </button>
                                                )}
                                                {canUpdateMapping && (
                                                    <button
                                                        onClick={() => handleEdit(mapping)}
                                                        className="p-2 text-gray-400 hover:text-primary hover:bg-gray-100 dark:hover:bg-background-dark rounded-lg transition-colors"
                                                        title={t('Edit')}
                                                    >
                                                        <Icon name="edit" size={18} />
                                                    </button>
                                                )}
                                                {(mapping.is_enabled ? (canDisableMapping || canUpdateMapping) : (canEnableMapping || canUpdateMapping)) && (
                                                    <button
                                                        onClick={() => handleToggleStatus(mapping)}
                                                        className={`p-2 rounded-lg transition-colors ${
                                                            mapping.is_enabled
                                                                ? 'text-gray-400 hover:text-amber-500 hover:bg-gray-100 dark:hover:bg-background-dark'
                                                                : 'text-gray-400 hover:text-emerald-500 hover:bg-gray-100 dark:hover:bg-background-dark'
                                                        }`}
                                                        title={mapping.is_enabled ? t('Disable') : t('Enable')}
                                                    >
                                                        <Icon
                                                            name={mapping.is_enabled ? 'toggle_off' : 'toggle_on'}
                                                            size={18}
                                                        />
                                                    </button>
                                                )}
                                                {canDeleteMapping && (
                                                    <button
                                                        onClick={() => handleDelete(mapping.id)}
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

            {confirmDialog && (
                <ConfirmDialog
                    title={confirmDialog.title}
                    message={confirmDialog.message}
                    confirmText={confirmDialog.confirmText}
                    danger={confirmDialog.danger}
                    onConfirm={confirmDialog.onConfirm}
                    onCancel={() => setConfirmDialog(null)}
                />
            )}

            {createModalOpen && (
                <CreateModal
                    onClose={() => setCreateModalOpen(false)}
                    onSuccess={fetchData}
                    canLoadModels={canListAvailableModels}
                    userGroups={userGroups}
                />
            )}

            {editMapping && (
                <EditModal
                    mapping={editMapping}
                    onClose={() => setEditMapping(null)}
                    onSuccess={handleEditSave}
                    canLoadModels={canListAvailableModels}
                    userGroups={userGroups}
                />
            )}

            {payloadModalMapping && (
                <PayloadRulesModal
                    mapping={payloadModalMapping}
                    onClose={() => setPayloadModalMapping(null)}
                    onSaved={showToast}
                    canList={canListPayloadRules}
                    canCreate={canCreatePayloadRules}
                    canUpdate={canUpdatePayloadRules}
                    canDelete={canDeletePayloadRules}
                />
            )}

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
        </AdminDashboardLayout>
    );
}
