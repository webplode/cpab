import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AdminDashboardLayout } from '../../components/admin/AdminDashboardLayout';
import { AdminNoAccessCard } from '../../components/admin/AdminNoAccessCard';
import { apiFetchAdmin } from '../../api/config';
import { Icon } from '../../components/Icon';
import { buildAdminPermissionKey, useAdminPermissions } from '../../utils/adminPermissions';
import { useStickyActionsDivider } from '../../utils/stickyActionsDivider';
import { useTranslation } from 'react-i18next';

interface BillingRule {
    id: number;
    auth_group_id: number;
    user_group_id: number;
    provider: string;
    model: string;
    billing_type: number;
    price_per_request: number | null;
    price_input_token: number | null;
    price_output_token: number | null;
    price_cache_create_token: number | null;
    price_cache_read_token: number | null;
    is_enabled: boolean;
    created_at: string;
    updated_at: string;
}

interface ListResponse {
    billing_rules: BillingRule[];
}

interface GroupResponse {
    id: number;
    name: string;
}

interface AuthGroupsResponse {
    auth_groups: GroupResponse[];
}

interface UserGroupsResponse {
    user_groups: GroupResponse[];
}

interface BillingRuleFormData {
    auth_group_id: string;
    user_group_id: string;
    provider: string;
    model: string;
    billing_type: number;
    price_per_request: string;
    price_input_token: string;
    price_output_token: string;
    price_cache_create_token: string;
    price_cache_read_token: string;
    is_enabled: boolean;
}

interface BillingRuleModalProps {
    title: string;
    initialData: BillingRuleFormData;
    authGroups: GroupOption[];
    userGroups: GroupOption[];
    canListProviderApiKeys: boolean;
    canLoadModelReferencePrice: boolean;
    submitting: boolean;
    onClose: () => void;
    onSubmit: (payload: Record<string, unknown>) => void;
}

const PAGE_SIZE = 10;

const BILLING_TYPE_LABELS: Record<number, string> = {
    1: 'Per Request',
    2: 'Per Token',
};

const inputClassName =
    'w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent';

const PROVIDER_OPTIONS = [
    { label: 'Gemini CLI', value: 'gemini-cli' },
    { label: 'Antigravity', value: 'antigravity' },
    { label: 'Codex', value: 'codex' },
    { label: 'Claude Code', value: 'claude' },
    { label: 'iFlow', value: 'iflow' },
    { label: 'Vertex', value: 'vertex' },
    { label: 'Qwen', value: 'qwen' },
];

interface GroupOption {
    id: number;
    name: string;
}

interface ModelListResponse {
    models: string[];
}

interface ModelReferencePriceResponse {
    provider: string;
    model: string;
    price_input_token: number | null;
    price_output_token: number | null;
    price_cache_create_token: number | null;
    price_cache_read_token: number | null;
}

interface ProviderApiKeyOption {
    provider: string;
    models: string[];
}

interface ProviderApiKeyOptionsResponse {
    providers: ProviderApiKeyOption[];
}

interface DropdownOption {
    label: string;
    value: string;
}

interface DropdownPortalProps {
    anchorRef: React.RefObject<HTMLButtonElement | null>;
    options: DropdownOption[];
    selected: string;
    onSelect: (value: string) => void;
    onClose: () => void;
}

function DropdownPortal({ anchorRef, options, selected, onSelect, onClose }: DropdownPortalProps) {
    const menuRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });

    useEffect(() => {
        const update = () => {
            const anchor = anchorRef.current;
            if (!anchor) return;
            const rect = anchor.getBoundingClientRect();
            setPosition({
                top: rect.bottom + 4,
                left: rect.left,
                width: rect.width,
            });
        };

        update();
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => {
            window.removeEventListener('resize', update);
            window.removeEventListener('scroll', update, true);
        };
    }, [anchorRef]);

    return createPortal(
        <>
            <div className="fixed inset-0 z-40" onClick={onClose} />
            <div
                ref={menuRef}
                className="fixed z-50 bg-white dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto"
                style={{ top: position.top, left: position.left, width: position.width }}
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

interface FilterOption {
    id: number | string;
    name: string;
}

interface FilterMultiSelectProps {
    anchorRef: React.RefObject<HTMLButtonElement | null>;
    options: FilterOption[];
    selected: (number | string)[];
    onToggle: (value: number | string) => void;
    onClear: () => void;
    onClose: () => void;
}

function FilterMultiSelect({
    anchorRef,
    options,
    selected,
    onToggle,
    onClear,
    onClose,
}: FilterMultiSelectProps) {
    const { t } = useTranslation();
    const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
    const [search, setSearch] = useState('');
    const menuRef = useRef<HTMLDivElement>(null);

    const updatePosition = useCallback(() => {
        if (anchorRef.current) {
            const rect = anchorRef.current.getBoundingClientRect();
            setPosition({
                top: rect.bottom + 4,
                left: rect.left,
                width: Math.max(rect.width, 200),
            });
        }
    }, [anchorRef]);

    useLayoutEffect(() => {
        updatePosition();
    }, [updatePosition]);

    useEffect(() => {
        const handleMove = () => updatePosition();
        window.addEventListener('scroll', handleMove, true);
        window.addEventListener('resize', handleMove);
        return () => {
            window.removeEventListener('scroll', handleMove, true);
            window.removeEventListener('resize', handleMove);
        };
    }, [updatePosition]);

    useEffect(() => {
        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (!target) return;
            if (menuRef.current && menuRef.current.contains(target)) return;
            if (anchorRef.current && anchorRef.current.contains(target)) return;
            onClose();
        };
        document.addEventListener('pointerdown', handlePointerDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
        };
    }, [anchorRef, onClose]);

    const filteredOptions = useMemo(() => {
        const keyword = search.trim().toLowerCase();
        if (!keyword) return options;
        return options.filter((opt) => {
            const idStr = String(opt.id);
            return (
                opt.name.toLowerCase().includes(keyword) ||
                idStr.includes(keyword)
            );
        });
    }, [options, search]);

    return createPortal(
        <>
            <div className="fixed inset-0 z-40" onClick={onClose} />
            <div
                ref={menuRef}
                className="fixed z-50 bg-white dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg shadow-lg overflow-hidden max-h-72"
                style={{ top: position.top, left: position.left, width: position.width }}
            >
                <div className="px-3 py-2 border-b border-gray-200 dark:border-border-dark flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-500 dark:text-text-secondary">
                        {t('Selected {{count}}', { count: selected.length })}
                    </span>
                    <button
                        type="button"
                        onClick={onClear}
                        disabled={selected.length === 0}
                        className="px-2 py-1 text-xs border border-gray-200 dark:border-border-dark rounded-md text-slate-600 dark:text-text-secondary hover:text-slate-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-background-dark transition-colors disabled:text-slate-400 disabled:cursor-not-allowed"
                    >
                        {t('Clear')}
                    </button>
                </div>
                <div className="px-3 py-2 border-b border-gray-200 dark:border-border-dark">
                    <div className="relative">
                        <Icon
                            name="search"
                            size={16}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                        />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={t('Search...')}
                            className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                        />
                    </div>
                </div>
                <div className="max-h-48 overflow-y-auto">
                    {filteredOptions.length === 0 ? (
                        <div className="px-4 py-3 text-sm text-slate-500 dark:text-text-secondary">
                            {t('No options found')}
                        </div>
                    ) : (
                        filteredOptions.map((opt) => {
                            const isSelected = selected.includes(opt.id);
                            return (
                                <button
                                    key={opt.id}
                                    type="button"
                                    onClick={() => onToggle(opt.id)}
                                    className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-background-dark transition-colors ${
                                        isSelected
                                            ? 'bg-gray-100 dark:bg-background-dark text-slate-900 dark:text-white font-medium'
                                            : 'text-slate-900 dark:text-white'
                                    }`}
                                    title={opt.name}
                                >
                                    <span
                                        className={`flex items-center justify-center h-4 w-4 rounded border ${
                                            isSelected
                                                ? 'border-primary text-primary bg-primary/10'
                                                : 'border-gray-300 dark:border-border-dark text-transparent'
                                        }`}
                                    >
                                        {isSelected && <Icon name="check" size={14} />}
                                    </span>
                                    <span className="truncate">{opt.name}</span>
                                </button>
                            );
                        })
                    )}
                </div>
            </div>
        </>,
        document.body
    );
}

interface SearchableDropdownMenuProps {
    anchorId: string;
    options: GroupOption[];
    selectedId: number | null;
    search: string;
    menuWidth?: number;
    onSearchChange: (value: string) => void;
    onSelect: (value: number) => void;
    onClose: () => void;
}

function SearchableDropdownMenu({
    anchorId,
    options,
    selectedId,
    search,
    menuWidth,
    onSearchChange,
    onSelect,
    onClose,
}: SearchableDropdownMenuProps) {
    const { t } = useTranslation();
    const btn = document.getElementById(anchorId);
    const rect = btn ? btn.getBoundingClientRect() : null;
    const position = rect
        ? { top: rect.bottom + 4, left: rect.left, width: rect.width }
        : { top: 0, left: 0, width: 0 };

    return createPortal(
        <>
            <div className="fixed inset-0 z-40" onClick={onClose} />
            <div
                className="fixed z-50 bg-white dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg shadow-lg overflow-hidden max-h-72"
                style={{ top: position.top, left: position.left, width: position.width || menuWidth }}
            >
                <div className="p-3 border-b border-gray-200 dark:border-border-dark">
                    <div className="relative">
                        <Icon
                            name="search"
                            size={16}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                        />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => onSearchChange(e.target.value)}
                            placeholder={t('Search by name or ID...')}
                            className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                        />
                    </div>
                </div>
                <div className="max-h-56 overflow-y-auto">
                    {options.length === 0 ? (
                        <div className="px-4 py-3 text-sm text-slate-500 dark:text-text-secondary">
                            {t('No groups found')}
                        </div>
                    ) : (
                        options.map((opt) => (
                            <button
                                key={opt.id}
                                type="button"
                                onClick={() => onSelect(opt.id)}
                                className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-100 dark:hover:bg-background-dark transition-colors ${
                                    selectedId === opt.id
                                        ? 'bg-gray-100 dark:bg-background-dark text-primary font-medium'
                                        : 'text-slate-900 dark:text-white'
                                }`}
                            >
                                <span className="font-mono text-xs text-slate-500 dark:text-text-secondary mr-2">
                                    #{opt.id}
                                </span>
                                {opt.name}
                            </button>
                        ))
                    )}
                </div>
            </div>
        </>,
        document.body
    );
}

function formatPrice(value: number | null): string {
    if (value === null || Number.isNaN(value)) {
        return '-';
    }
    return `$${Number(value).toFixed(2)}`;
}

function inferReferenceProvider(modelName: string): string {
    const name = modelName.toLowerCase();
    if (name.includes('gpt')) {
        return 'OpenAI';
    }
    if (name.includes('claude')) {
        return 'Anthropic';
    }
    if (name.includes('gemini')) {
        return 'Google';
    }
    if (name.includes('qwen')) {
        return 'Alibaba';
    }
    return '';
}

function stringifyPrice(value: number | null | undefined): string {
    if (value === null || value === undefined) {
        return '';
    }
    return value.toString();
}

function BillingRuleModal({
    title,
    initialData,
    authGroups,
    userGroups,
    canListProviderApiKeys,
    canLoadModelReferencePrice,
    submitting,
    onClose,
    onSubmit,
}: BillingRuleModalProps) {
    const { t } = useTranslation();
    const [formData, setFormData] = useState<BillingRuleFormData>(initialData);
    const [error, setError] = useState('');
    const [authGroupMenuOpen, setAuthGroupMenuOpen] = useState(false);
    const [userGroupMenuOpen, setUserGroupMenuOpen] = useState(false);
    const [authGroupSearch, setAuthGroupSearch] = useState('');
    const [userGroupSearch, setUserGroupSearch] = useState('');
    const [providerDropdownOpen, setProviderDropdownOpen] = useState(false);
    const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
    const [models, setModels] = useState<string[]>([]);
    const [loadingModels, setLoadingModels] = useState(false);
    const [apiKeyProviders, setApiKeyProviders] = useState<ProviderApiKeyOption[]>([]);
    const priceRequestRef = useRef(0);

    const providerBtnRef = useRef<HTMLButtonElement>(null);
    const modelBtnRef = useRef<HTMLButtonElement>(null);

    const isPerRequest = formData.billing_type === 1;

    const loadReferencePrice = useCallback(
        async (modelName: string) => {
            if (!canLoadModelReferencePrice) {
                return;
            }
            const trimmed = modelName.trim();
            if (!trimmed) {
                return;
            }
            const providerName = inferReferenceProvider(trimmed);
            const requestId = priceRequestRef.current + 1;
            priceRequestRef.current = requestId;
            const params = new URLSearchParams({ model_id: trimmed });
            if (providerName) {
                params.set('provider', providerName);
            }
            try {
                const res = await apiFetchAdmin<ModelReferencePriceResponse>(
                    `/v0/admin/model-references/price?${params.toString()}`
                );
                if (priceRequestRef.current !== requestId) {
                    return;
                }
                setFormData((prev) => {
                    if (prev.model !== trimmed) {
                        return prev;
                    }
                    return {
                        ...prev,
                        price_input_token: stringifyPrice(res.price_input_token),
                        price_output_token: stringifyPrice(res.price_output_token),
                        price_cache_create_token: stringifyPrice(res.price_cache_create_token),
                        price_cache_read_token: stringifyPrice(res.price_cache_read_token),
                    };
                });
            } catch {
                if (priceRequestRef.current !== requestId) {
                    return;
                }
            }
        },
        [canLoadModelReferencePrice]
    );

    useEffect(() => {
        if (!canListProviderApiKeys) {
            return;
        }
        apiFetchAdmin<ProviderApiKeyOptionsResponse>('/v0/admin/provider-api-keys?options=1')
            .then((res) => {
                setApiKeyProviders(res.providers || []);
            })
            .catch(() => {
                setApiKeyProviders([]);
            });
    }, [canListProviderApiKeys]);

    const apiKeyProviderModels = useMemo(() => {
        if (!canListProviderApiKeys) {
            return {};
        }
        const out: Record<string, string[]> = {};
        (apiKeyProviders || []).forEach((item) => {
            if (item.provider) {
                out[item.provider] = item.models || [];
            }
        });
        return out;
    }, [apiKeyProviders, canListProviderApiKeys]);

    const providerOptions = useMemo(() => {
        const labels: Record<string, string> = {
            gemini: 'Gemini',
            codex: 'Codex',
            claude: 'Claude Code',
            'openai-compatibility': 'OpenAI Chat Completions',
        };
        const next: DropdownOption[] = [...PROVIDER_OPTIONS];
        const seen = new Set(next.map((opt) => opt.value));
        Object.keys(apiKeyProviderModels).forEach((provider) => {
            if (!provider || seen.has(provider)) return;
            next.push({ label: labels[provider] || provider, value: provider });
            seen.add(provider);
        });
        return next;
    }, [apiKeyProviderModels]);

    const resolvedModels = useMemo(() => {
        if (!formData.provider) {
            return [];
        }
        const providerModels = apiKeyProviderModels[formData.provider];
        if (providerModels && providerModels.length > 0) {
            return providerModels;
        }
        return models;
    }, [formData.provider, apiKeyProviderModels, models]);

    useEffect(() => {
        if (!formData.provider) {
            return;
        }
        if (Object.prototype.hasOwnProperty.call(apiKeyProviderModels, formData.provider)) {
            const list = apiKeyProviderModels[formData.provider] || [];
            if (list.length > 0) {
                return;
            }
            queueMicrotask(() => setLoadingModels(true));
            apiFetchAdmin<ModelListResponse>(
                `/v0/admin/model-mappings/available-models?provider=${encodeURIComponent(formData.provider)}`
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
            return;
        }

        queueMicrotask(() => setLoadingModels(true));
        apiFetchAdmin<ModelListResponse>(
            `/v0/admin/model-mappings/available-models?provider=${encodeURIComponent(formData.provider)}&mapped=1`
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
    }, [formData.provider, apiKeyProviderModels]);

    const measureButton = useCallback((labels: string[]) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return undefined;
        ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
        let maxWidth = 0;
        for (const label of labels) {
            const width = ctx.measureText(label).width;
            if (width > maxWidth) maxWidth = width;
        }
        return Math.ceil(maxWidth) + 76;
    }, []);

    const authGroupBtnWidth = useMemo(
        () => measureButton(authGroups.map((g) => `${g.name} #${g.id}`)),
        [authGroups, measureButton]
    );
    const userGroupBtnWidth = useMemo(
        () => measureButton(userGroups.map((g) => `${g.name} #${g.id}`)),
        [userGroups, measureButton]
    );

    const handleSubmit = () => {
        const authGroupID = Number(formData.auth_group_id);
        const userGroupID = Number(formData.user_group_id);

        if (!Number.isInteger(authGroupID) || authGroupID <= 0) {
            setError('Auth Group ID must be a positive integer.');
            return;
        }
        if (!Number.isInteger(userGroupID) || userGroupID <= 0) {
            setError('User Group ID must be a positive integer.');
            return;
        }
        if (!formData.provider.trim()) {
            setError('Provider is required.');
            return;
        }
        if (!formData.model.trim()) {
            setError('Model is required.');
            return;
        }

        const parsePrice = (value: string): number | null => {
            if (!value.trim()) return null;
            const parsed = Number(value);
            if (Number.isNaN(parsed)) return null;
            return parsed;
        };

        const payload = {
            auth_group_id: authGroupID,
            user_group_id: userGroupID,
            provider: formData.provider.trim(),
            model: formData.model.trim(),
            billing_type: formData.billing_type,
            price_per_request: isPerRequest ? parsePrice(formData.price_per_request) : null,
            price_input_token: !isPerRequest ? parsePrice(formData.price_input_token) : null,
            price_output_token: !isPerRequest ? parsePrice(formData.price_output_token) : null,
            price_cache_create_token: !isPerRequest ? parsePrice(formData.price_cache_create_token) : null,
            price_cache_read_token: !isPerRequest ? parsePrice(formData.price_cache_read_token) : null,
            is_enabled: formData.is_enabled,
        };

        if (isPerRequest && payload.price_per_request === null) {
            setError('Price per request is required for Per Request billing.');
            return;
        }
        if (!isPerRequest) {
            if (payload.price_input_token === null) {
                setError('Price per input token is required for Per Token billing.');
                return;
            }
            if (payload.price_output_token === null) {
                setError('Price per output token is required for Per Token billing.');
                return;
            }
            if (payload.price_cache_create_token === null) {
                setError('Price per cache create token is required for Per Token billing.');
                return;
            }
            if (payload.price_cache_read_token === null) {
                setError('Price per cache read token is required for Per Token billing.');
                return;
            }
        }

        setError('');
        onSubmit(payload);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white dark:bg-surface-dark rounded-xl shadow-xl w-full max-w-xl mx-4 border border-gray-200 dark:border-border-dark max-h-[90vh] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-border-dark shrink-0">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                        {title}
                    </h2>
                    <button
                        onClick={onClose}
                        className="inline-flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
                    >
                        <Icon name="close" />
                    </button>
                </div>
                <div className="p-6 space-y-4 overflow-y-auto flex-1">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Auth Group')}
                        </label>
                        <div className="relative">
                                <button
                                    type="button"
                                    id="auth-group-dropdown-btn"
                                    onClick={() => setAuthGroupMenuOpen(!authGroupMenuOpen)}
                                    className="flex items-center justify-between gap-2 w-full bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark text-slate-900 dark:text-white text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5"
                                    style={authGroupBtnWidth ? { minWidth: authGroupBtnWidth } : undefined}
                                >
                                    <span className={formData.auth_group_id ? '' : 'text-gray-400'}>
                                        {formData.auth_group_id
                                            ? authGroups.find((g) => g.id === Number(formData.auth_group_id))?.name ||
                                              t('Select Auth Group')
                                            : t('Select Auth Group')}
                                    </span>
                                    <Icon name={authGroupMenuOpen ? 'expand_less' : 'expand_more'} size={18} />
                                </button>
                            {authGroupMenuOpen && (
                                <SearchableDropdownMenu
                                    anchorId="auth-group-dropdown-btn"
                                    options={authGroups.filter((g) => {
                                        const query = authGroupSearch.trim().toLowerCase();
                                        if (!query) return true;
                                        return g.name.toLowerCase().includes(query) || g.id.toString().includes(query);
                                    })}
                                    selectedId={formData.auth_group_id ? Number(formData.auth_group_id) : null}
                                    search={authGroupSearch}
                                    menuWidth={authGroupBtnWidth}
                                    onSearchChange={setAuthGroupSearch}
                                    onSelect={(value) => {
                                        setFormData({ ...formData, auth_group_id: value.toString() });
                                        setAuthGroupMenuOpen(false);
                                    }}
                                    onClose={() => setAuthGroupMenuOpen(false)}
                                />
                            )}
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('User Group')}
                        </label>
                        <div className="relative">
                                <button
                                    type="button"
                                    id="user-group-dropdown-btn"
                                    onClick={() => setUserGroupMenuOpen(!userGroupMenuOpen)}
                                    className="flex items-center justify-between gap-2 w-full bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark text-slate-900 dark:text-white text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5"
                                    style={userGroupBtnWidth ? { minWidth: userGroupBtnWidth } : undefined}
                                >
                                    <span className={formData.user_group_id ? '' : 'text-gray-400'}>
                                        {formData.user_group_id
                                            ? userGroups.find((g) => g.id === Number(formData.user_group_id))?.name ||
                                              t('Select User Group')
                                            : t('Select User Group')}
                                    </span>
                                    <Icon name={userGroupMenuOpen ? 'expand_less' : 'expand_more'} size={18} />
                                </button>
                            {userGroupMenuOpen && (
                                <SearchableDropdownMenu
                                    anchorId="user-group-dropdown-btn"
                                    options={userGroups.filter((g) => {
                                        const query = userGroupSearch.trim().toLowerCase();
                                        if (!query) return true;
                                        return g.name.toLowerCase().includes(query) || g.id.toString().includes(query);
                                    })}
                                    selectedId={formData.user_group_id ? Number(formData.user_group_id) : null}
                                    search={userGroupSearch}
                                    menuWidth={userGroupBtnWidth}
                                    onSearchChange={setUserGroupSearch}
                                    onSelect={(value) => {
                                        setFormData({ ...formData, user_group_id: value.toString() });
                                        setUserGroupMenuOpen(false);
                                    }}
                                    onClose={() => setUserGroupMenuOpen(false)}
                                />
                            )}
                        </div>
                    </div>
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
                                    <span className={formData.provider ? '' : 'text-gray-400'}>
                                        {providerOptions.find((p) => p.value === formData.provider)?.label ||
                                            t('Select Provider')}
                                    </span>
                                    <Icon name="expand_more" size={18} />
                                </button>
                                {providerDropdownOpen && (
                                    <DropdownPortal
                                        anchorRef={providerBtnRef}
                                        options={providerOptions}
                                        selected={formData.provider}
                                        onSelect={(val) => {
                                            setFormData((prev) => ({
                                                ...prev,
                                                provider: val,
                                                model: '',
                                            }));
                                            setModels([]);
                                            setModelDropdownOpen(false);
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
                                onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                                className="w-full flex items-center justify-between px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-60"
                                    disabled={!formData.provider || loadingModels || resolvedModels.length === 0}
                            >
                                <span className={formData.model ? '' : 'text-gray-400'}>
                                    {loadingModels ? t('Loading models...') : formData.model || t('Select Model')}
                                </span>
                                <Icon name="expand_more" size={18} />
                            </button>
                            {modelDropdownOpen && (
                                <DropdownPortal
                                    anchorRef={modelBtnRef}
                                        options={resolvedModels.map((m) => ({ label: m, value: m }))}
                                    selected={formData.model}
                                    onSelect={(val) => {
                                        setFormData((prev) => ({ ...prev, model: val }));
                                        void loadReferencePrice(val);
                                        setModelDropdownOpen(false);
                                    }}
                                    onClose={() => setModelDropdownOpen(false)}
                                />
                            )}
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            {t('Billing Type')}
                        </label>
                        <div className="flex items-center gap-2">
                            {[1, 2].map((value) => (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => setFormData({ ...formData, billing_type: value })}
                                    className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                                        formData.billing_type === value
                                            ? 'bg-primary text-white border-primary'
                                            : 'bg-white dark:bg-surface-dark text-slate-700 dark:text-white border-gray-200 dark:border-border-dark hover:bg-gray-50 dark:hover:bg-background-dark'
                                    }`}
                                >
                                    {t(BILLING_TYPE_LABELS[value])}
                                </button>
                            ))}
                        </div>
                    </div>

                    {isPerRequest ? (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                {t('Price Per Request')}
                            </label>
                            <input
                                type="number"
                                step="0.0000000001"
                                value={formData.price_per_request}
                                onChange={(e) => setFormData({ ...formData, price_per_request: e.target.value })}
                                placeholder={t('Enter price per request')}
                                className={inputClassName}
                            />
                        </div>
                    ) : (
                        <>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                    {t('Price Input Token (per 1M tokens)')}
                                </label>
                                <input
                                    type="number"
                                    step="0.0000000001"
                                    value={formData.price_input_token}
                                    onChange={(e) => setFormData({ ...formData, price_input_token: e.target.value })}
                                    placeholder={t('Enter price per 1M input tokens')}
                                    className={inputClassName}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                    {t('Price Output Token (per 1M tokens)')}
                                </label>
                                <input
                                    type="number"
                                    step="0.0000000001"
                                    value={formData.price_output_token}
                                    onChange={(e) => setFormData({ ...formData, price_output_token: e.target.value })}
                                    placeholder={t('Enter price per 1M output tokens')}
                                    className={inputClassName}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                    {t('Price Cache Create Token (per 1M tokens)')}
                                </label>
                                <input
                                    type="number"
                                    step="0.0000000001"
                                    value={formData.price_cache_create_token}
                                    onChange={(e) => setFormData({ ...formData, price_cache_create_token: e.target.value })}
                                    placeholder={t('Enter price per 1M cache create tokens')}
                                    className={inputClassName}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                    {t('Price Cache Read Token (per 1M tokens)')}
                                </label>
                                <input
                                    type="number"
                                    step="0.0000000001"
                                    value={formData.price_cache_read_token}
                                    onChange={(e) => setFormData({ ...formData, price_cache_read_token: e.target.value })}
                                    placeholder={t('Enter price per 1M cache read tokens')}
                                    className={inputClassName}
                                />
                            </div>
                        </>
                    )}

                    <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            {t('Enabled')}
                        </label>
                        <button
                            type="button"
                            onClick={() => setFormData({ ...formData, is_enabled: !formData.is_enabled })}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                formData.is_enabled ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
                            }`}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                    formData.is_enabled ? 'translate-x-6' : 'translate-x-1'
                                }`}
                            />
                        </button>
                    </div>

                    {error && (
                        <div className="text-sm text-red-600 dark:text-red-400">
                            {t(error)}
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

interface BatchImportModalProps {
    authGroups: GroupOption[];
    userGroups: GroupOption[];
    submitting: boolean;
    onClose: () => void;
    onSubmit: (authGroupId: number, userGroupId: number, billingType: number) => void;
}

function BatchImportModal({
    authGroups,
    userGroups,
    submitting,
    onClose,
    onSubmit,
}: BatchImportModalProps) {
    const { t } = useTranslation();
    const [authGroupId, setAuthGroupId] = useState<number | null>(null);
    const [userGroupId, setUserGroupId] = useState<number | null>(null);
    const [billingType, setBillingType] = useState<number>(2);
    const [authGroupMenuOpen, setAuthGroupMenuOpen] = useState(false);
    const [userGroupMenuOpen, setUserGroupMenuOpen] = useState(false);
    const [billingTypeMenuOpen, setBillingTypeMenuOpen] = useState(false);
    const [authGroupSearch, setAuthGroupSearch] = useState('');
    const [userGroupSearch, setUserGroupSearch] = useState('');
    const [error, setError] = useState('');
    const billingTypeBtnRef = useRef<HTMLButtonElement>(null);

    const BILLING_TYPE_OPTIONS: DropdownOption[] = [
        { label: t('Per Request'), value: '1' },
        { label: t('Per Token'), value: '2' },
    ];

    const filteredAuthGroups = useMemo(() => {
        if (!authGroupSearch.trim()) return authGroups;
        const lower = authGroupSearch.toLowerCase();
        return authGroups.filter(
            (g) => g.name.toLowerCase().includes(lower) || g.id.toString().includes(lower)
        );
    }, [authGroups, authGroupSearch]);

    const filteredUserGroups = useMemo(() => {
        if (!userGroupSearch.trim()) return userGroups;
        const lower = userGroupSearch.toLowerCase();
        return userGroups.filter(
            (g) => g.name.toLowerCase().includes(lower) || g.id.toString().includes(lower)
        );
    }, [userGroups, userGroupSearch]);

    const selectedAuthGroup = authGroups.find((g) => g.id === authGroupId);
    const selectedUserGroup = userGroups.find((g) => g.id === userGroupId);

    const handleSubmit = () => {
        setError('');
        if (!authGroupId) {
            setError(t('Please select an Auth Group'));
            return;
        }
        if (!userGroupId) {
            setError(t('Please select a User Group'));
            return;
        }
        onSubmit(authGroupId, userGroupId, billingType);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white dark:bg-surface-dark rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-border-dark">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                        {t('Import All Models')}
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-text-secondary mt-1">
                        {t('Import billing rules for all enabled model mappings')}
                    </p>
                </div>
                <div className="p-6 overflow-y-auto space-y-4">
                    {error && (
                        <div className="p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg text-sm">
                            {error}
                        </div>
                    )}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            {t('Auth Group')} *
                        </label>
                        <button
                            type="button"
                            id="batch-import-auth-group-btn"
                            onClick={() => setAuthGroupMenuOpen(!authGroupMenuOpen)}
                            className={inputClassName + ' text-left flex items-center justify-between'}
                        >
                            <span className={selectedAuthGroup ? '' : 'text-gray-400'}>
                                {selectedAuthGroup ? (
                                    <>
                                        <span className="font-mono text-xs text-slate-500 dark:text-text-secondary mr-2">
                                            #{selectedAuthGroup.id}
                                        </span>
                                        {selectedAuthGroup.name}
                                    </>
                                ) : (
                                    t('Select Auth Group')
                                )}
                            </span>
                            <Icon name="expand_more" size={18} className="text-gray-400" />
                        </button>
                        {authGroupMenuOpen && (
                            <SearchableDropdownMenu
                                anchorId="batch-import-auth-group-btn"
                                options={filteredAuthGroups}
                                selectedId={authGroupId}
                                search={authGroupSearch}
                                menuWidth={320}
                                onSearchChange={setAuthGroupSearch}
                                onSelect={(id) => {
                                    setAuthGroupId(id);
                                    setAuthGroupMenuOpen(false);
                                }}
                                onClose={() => setAuthGroupMenuOpen(false)}
                            />
                        )}
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            {t('User Group')} *
                        </label>
                        <button
                            type="button"
                            id="batch-import-user-group-btn"
                            onClick={() => setUserGroupMenuOpen(!userGroupMenuOpen)}
                            className={inputClassName + ' text-left flex items-center justify-between'}
                        >
                            <span className={selectedUserGroup ? '' : 'text-gray-400'}>
                                {selectedUserGroup ? (
                                    <>
                                        <span className="font-mono text-xs text-slate-500 dark:text-text-secondary mr-2">
                                            #{selectedUserGroup.id}
                                        </span>
                                        {selectedUserGroup.name}
                                    </>
                                ) : (
                                    t('Select User Group')
                                )}
                            </span>
                            <Icon name="expand_more" size={18} className="text-gray-400" />
                        </button>
                        {userGroupMenuOpen && (
                            <SearchableDropdownMenu
                                anchorId="batch-import-user-group-btn"
                                options={filteredUserGroups}
                                selectedId={userGroupId}
                                search={userGroupSearch}
                                menuWidth={320}
                                onSearchChange={setUserGroupSearch}
                                onSelect={(id) => {
                                    setUserGroupId(id);
                                    setUserGroupMenuOpen(false);
                                }}
                                onClose={() => setUserGroupMenuOpen(false)}
                            />
                        )}
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            {t('Billing Type')} *
                        </label>
                        <button
                            type="button"
                            ref={billingTypeBtnRef}
                            onClick={() => setBillingTypeMenuOpen(!billingTypeMenuOpen)}
                            className={inputClassName + ' text-left flex items-center justify-between'}
                        >
                            <span>
                                {BILLING_TYPE_OPTIONS.find((o) => o.value === billingType.toString())?.label}
                            </span>
                            <Icon name="expand_more" size={18} className="text-gray-400" />
                        </button>
                        {billingTypeMenuOpen && (
                            <DropdownPortal
                                anchorRef={billingTypeBtnRef}
                                options={BILLING_TYPE_OPTIONS}
                                selected={billingType.toString()}
                                onSelect={(val) => {
                                    setBillingType(Number(val));
                                    setBillingTypeMenuOpen(false);
                                }}
                                onClose={() => setBillingTypeMenuOpen(false)}
                            />
                        )}
                        {billingType === 2 && (
                            <p className="mt-2 text-xs text-slate-500 dark:text-text-secondary">
                                {t('Token prices will be loaded from model reference data automatically')}
                            </p>
                        )}
                    </div>
                </div>
                <div className="px-6 py-4 border-t border-gray-200 dark:border-border-dark flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-gray-100 dark:bg-background-dark rounded-lg hover:bg-gray-200 dark:hover:bg-border-dark transition-colors"
                    >
                        {t('Cancel')}
                    </button>
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={submitting}
                        className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50"
                    >
                        {submitting ? t('Importing...') : t('Import')}
                    </button>
                </div>
            </div>
        </div>
    );
}

interface InlinePriceEditorProps {
    value: number | null;
    canEdit: boolean;
    onSave: (val: number) => Promise<void>;
}

function InlinePriceEditor({ value, canEdit, onSave }: InlinePriceEditorProps) {
    const [editing, setEditing] = useState(false);
    const [tempValue, setTempValue] = useState('');
    const [saving, setSaving] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (editing && inputRef.current) {
            inputRef.current.focus();
        }
    }, [editing]);

    const handleStartEdit = () => {
        if (!canEdit) return;
        setTempValue(value === null ? '' : value.toString());
        setEditing(true);
    };

    const handleCancel = () => {
        setEditing(false);
        setTempValue('');
    };

    const handleSave = async () => {
        const num = parseFloat(tempValue);
        if (isNaN(num) || num < 0) {
            return;
        }
        setSaving(true);
        try {
            await onSave(num);
            setEditing(false);
        } catch (e) {
            console.error(e);
        } finally {
            setSaving(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSave();
        } else if (e.key === 'Escape') {
            handleCancel();
        }
    };

    if (editing) {
        return (
            <div className="flex items-center gap-1 min-w-[140px]">
                <input
                    ref={inputRef}
                    type="text"
                    inputMode="decimal"
                    className="w-20 px-1 py-0.5 text-xs bg-white dark:bg-background-dark border border-gray-300 dark:border-border-dark rounded focus:outline-none focus:border-primary"
                    value={tempValue}
                    onChange={(e) => {
                        const val = e.target.value;
                        if (/^\d*\.?\d*$/.test(val)) {
                            setTempValue(val);
                        }
                    }}
                    onKeyDown={handleKeyDown}
                    disabled={saving}
                />
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="p-0.5 text-emerald-600 hover:text-emerald-700 dark:text-emerald-500 dark:hover:text-emerald-400 rounded transition-colors"
                >
                    <Icon name="check" size={16} />
                </button>
                <button
                    onClick={handleCancel}
                    disabled={saving}
                    className="p-0.5 text-red-600 hover:text-red-700 dark:text-red-500 dark:hover:text-red-400 rounded transition-colors"
                >
                    <Icon name="close" size={16} />
                </button>
            </div>
        );
    }

    return (
        <div
            onClick={handleStartEdit}
            className={`cursor-pointer hover:text-primary transition-colors ${
                !canEdit ? 'cursor-default hover:text-inherit' : ''
            }`}
            title={canEdit ? 'Click to edit' : ''}
        >
            {formatPrice(value)}
        </div>
    );
}

function buildFormData(rule?: BillingRule): BillingRuleFormData {
    if (!rule) {
        return {
            auth_group_id: '',
            user_group_id: '',
            provider: '',
            model: '',
            billing_type: 1,
            price_per_request: '',
            price_input_token: '',
            price_output_token: '',
            price_cache_create_token: '',
            price_cache_read_token: '',
            is_enabled: true,
        };
    }

    return {
        auth_group_id: rule.auth_group_id.toString(),
        user_group_id: rule.user_group_id.toString(),
        provider: rule.provider ?? '',
        model: rule.model ?? '',
        billing_type: rule.billing_type,
        price_per_request: rule.price_per_request?.toString() ?? '',
        price_input_token: rule.price_input_token?.toString() ?? '',
        price_output_token: rule.price_output_token?.toString() ?? '',
        price_cache_create_token: rule.price_cache_create_token?.toString() ?? '',
        price_cache_read_token: rule.price_cache_read_token?.toString() ?? '',
        is_enabled: rule.is_enabled,
    };
}

export function AdminBillingRules() {
    const { t, i18n } = useTranslation();
    const { hasPermission } = useAdminPermissions();
    const canListRules = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/billing-rules'));
    const canCreateRule = hasPermission(buildAdminPermissionKey('POST', '/v0/admin/billing-rules'));
    const canUpdateRule = hasPermission(buildAdminPermissionKey('PUT', '/v0/admin/billing-rules/:id'));
    const canDeleteRule = hasPermission(buildAdminPermissionKey('DELETE', '/v0/admin/billing-rules/:id'));
    const canSetEnabled = hasPermission(
        buildAdminPermissionKey('POST', '/v0/admin/billing-rules/:id/enabled')
    );
    const canListAuthGroups = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/auth-groups'));
    const canListUserGroups = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/user-groups'));
    const canListProviderApiKeys = hasPermission(
        buildAdminPermissionKey('GET', '/v0/admin/provider-api-keys')
    );
    const canLoadModelReferencePrice = hasPermission(
        buildAdminPermissionKey('GET', '/v0/admin/model-references/price')
    );
    const canBatchImport = hasPermission(
        buildAdminPermissionKey('POST', '/v0/admin/billing-rules/batch-import')
    );

    const [rules, setRules] = useState<BillingRule[]>([]);
    const [loading, setLoading] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);
    const [createOpen, setCreateOpen] = useState(false);
    const [editRule, setEditRule] = useState<BillingRule | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [authGroups, setAuthGroups] = useState<GroupOption[]>([]);
    const [userGroups, setUserGroups] = useState<GroupOption[]>([]);
    const [batchImportOpen, setBatchImportOpen] = useState(false);
    const [toast, setToast] = useState<{ show: boolean; message: string }>({ show: false, message: '' });
    const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const locale = i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US';

    const [filterAuthGroupIds, setFilterAuthGroupIds] = useState<number[]>([]);
    const [filterUserGroupIds, setFilterUserGroupIds] = useState<number[]>([]);
    const [filterProviders, setFilterProviders] = useState<string[]>([]);
    const [filterModel, setFilterModel] = useState('');
    const [authGroupFilterOpen, setAuthGroupFilterOpen] = useState(false);
    const [userGroupFilterOpen, setUserGroupFilterOpen] = useState(false);
    const [providerFilterOpen, setProviderFilterOpen] = useState(false);
    const authGroupFilterBtnRef = useRef<HTMLButtonElement>(null);
    const userGroupFilterBtnRef = useRef<HTMLButtonElement>(null);
    const providerFilterBtnRef = useRef<HTMLButtonElement>(null);

    const providerFilterOptions = useMemo(() => {
        return PROVIDER_OPTIONS.map((p) => ({ id: p.value, name: p.label }));
    }, []);

    const showToast = useCallback((message: string) => {
        if (toastTimeoutRef.current) {
            clearTimeout(toastTimeoutRef.current);
        }
        setToast({ show: true, message });
        toastTimeoutRef.current = setTimeout(() => {
            setToast({ show: false, message: '' });
        }, 3000);
    }, []);

    const fetchRules = useCallback(() => {
        if (!canListRules) {
            return;
        }
        setLoading(true);
        apiFetchAdmin<ListResponse>('/v0/admin/billing-rules')
            .then((res) => setRules(res.billing_rules || []))
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [canListRules]);

    const fetchGroups = useCallback(async () => {
        if (!canListAuthGroups && !canListUserGroups) {
            return;
        }
        try {
            const [authRes, userRes] = await Promise.all([
                canListAuthGroups
                    ? apiFetchAdmin<AuthGroupsResponse>('/v0/admin/auth-groups')
                    : Promise.resolve({ auth_groups: [] }),
                canListUserGroups
                    ? apiFetchAdmin<UserGroupsResponse>('/v0/admin/user-groups')
                    : Promise.resolve({ user_groups: [] }),
            ]);
            setAuthGroups(authRes.auth_groups || []);
            setUserGroups(userRes.user_groups || []);
        } catch (err) {
            console.error('Failed to fetch groups:', err);
        }
    }, [canListAuthGroups, canListUserGroups]);

    useEffect(() => {
        if (canListRules) {
            fetchRules();
        }
    }, [fetchRules, canListRules]);

    useEffect(() => {
        fetchGroups();
    }, [fetchGroups]);

    const filteredRules = useMemo(() => {
        let result = rules;
        if (filterAuthGroupIds.length > 0) {
            result = result.filter((r) => filterAuthGroupIds.includes(r.auth_group_id));
        }
        if (filterUserGroupIds.length > 0) {
            result = result.filter((r) => filterUserGroupIds.includes(r.user_group_id));
        }
        if (filterProviders.length > 0) {
            result = result.filter((r) => filterProviders.includes(r.provider));
        }
        if (filterModel.trim()) {
            const keyword = filterModel.trim().toLowerCase();
            result = result.filter((r) => r.model.toLowerCase().includes(keyword));
        }
        return result;
    }, [rules, filterAuthGroupIds, filterUserGroupIds, filterProviders, filterModel]);

    useEffect(() => {
        setCurrentPage(1);
    }, [filterAuthGroupIds, filterUserGroupIds, filterProviders, filterModel]);

    const totalPages = Math.ceil(filteredRules.length / PAGE_SIZE);
    const paginatedRules = filteredRules.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    const { tableScrollRef, handleTableScroll, showActionsDivider } = useStickyActionsDivider(
        paginatedRules.length,
        loading
    );

    const handleCreate = async (payload: Record<string, unknown>) => {
        if (!canCreateRule) {
            return;
        }
        setSubmitting(true);
        try {
            await apiFetchAdmin('/v0/admin/billing-rules', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            setCreateOpen(false);
            fetchRules();
        } catch (err) {
            console.error(err);
        } finally {
            setSubmitting(false);
        }
    };

    const handleUpdate = async (payload: Record<string, unknown>) => {
        if (!editRule || !canUpdateRule) return;
        setSubmitting(true);
        try {
            await apiFetchAdmin(`/v0/admin/billing-rules/${editRule.id}`, {
                method: 'PUT',
                body: JSON.stringify(payload),
            });
            setRules((prev) =>
                prev.map((item) =>
                    item.id === editRule.id
                        ? { ...item, ...payload }
                        : item
                )
            );
            setEditRule(null);
        } catch (err) {
            console.error(err);
        } finally {
            setSubmitting(false);
        }
    };

    const handleToggleEnabled = async (rule: BillingRule) => {
        if (!canSetEnabled) {
            return;
        }
        try {
            await apiFetchAdmin(`/v0/admin/billing-rules/${rule.id}/enabled`, {
                method: 'POST',
                body: JSON.stringify({ is_enabled: !rule.is_enabled }),
            });
            setRules((prev) =>
                prev.map((item) =>
                    item.id === rule.id
                        ? { ...item, is_enabled: !rule.is_enabled }
                        : item
                )
            );
        } catch (err) {
            console.error(err);
        }
    };

    const handleDelete = async (rule: BillingRule) => {
        if (!canDeleteRule) {
            return;
        }
        if (
            !confirm(
                t('Are you sure you want to delete billing rule #{{id}}?', { id: rule.id })
            )
        ) {
            return;
        }
        try {
            await apiFetchAdmin(`/v0/admin/billing-rules/${rule.id}`, { method: 'DELETE' });
            fetchRules();
        } catch (err) {
            console.error(err);
        }
    };

    const handleBatchImport = async (authGroupId: number, userGroupId: number, billingType: number) => {
        if (!canBatchImport) {
            return;
        }
        setSubmitting(true);
        try {
            const res = await apiFetchAdmin<{ created: number; updated: number }>(
                '/v0/admin/billing-rules/batch-import',
                {
                    method: 'POST',
                    body: JSON.stringify({
                        auth_group_id: authGroupId,
                        user_group_id: userGroupId,
                        billing_type: billingType,
                    }),
                }
            );
            setBatchImportOpen(false);
            fetchRules();
            showToast(t('Import completed: {{created}} created, {{updated}} updated', { created: res.created, updated: res.updated }));
        } catch (err) {
            console.error(err);
        } finally {
            setSubmitting(false);
        }
    };

    const handleInlineUpdate = async (rule: BillingRule, field: string, value: number) => {
        try {
            await apiFetchAdmin(`/v0/admin/billing-rules/${rule.id}`, {
                method: 'PUT',
                body: JSON.stringify({ [field]: value }),
            });
            setRules((prev) =>
                prev.map((item) =>
                    item.id === rule.id ? { ...item, [field]: value } : item
                )
            );
            showToast(t('Updated successfully'));
        } catch (err) {
            console.error(err);
        }
    };

    const pageInfo = useMemo(() => {
        if (!filteredRules.length) return t('No billing rules found');
        const start = (currentPage - 1) * PAGE_SIZE + 1;
        const end = Math.min(currentPage * PAGE_SIZE, filteredRules.length);
        return t('Showing {{from}} to {{to}} of {{total}} billing rules', {
            from: start,
            to: end,
            total: filteredRules.length,
        });
    }, [filteredRules.length, currentPage, t]);

    if (!canListRules) {
        return (
            <AdminDashboardLayout title={t('Billing Rules')} subtitle={t('Manage pricing rules for usage')}>
                <AdminNoAccessCard />
            </AdminDashboardLayout>
        );
    }

    return (
        <AdminDashboardLayout title={t('Billing Rules')} subtitle={t('Manage pricing rules for usage')}>
            <div className="space-y-6">
                {canCreateRule && (
                    <div className="flex justify-end gap-2">
                        {canBatchImport && (
                            <button
                                onClick={() => setBatchImportOpen(true)}
                                className="flex items-center gap-2 px-4 py-2 border border-primary text-primary bg-white dark:bg-surface-dark rounded-lg hover:bg-primary/10 transition-colors font-medium"
                            >
                                <Icon name="download" size={18} />
                                {t('Import All Models')}
                            </button>
                        )}
                        <button
                            onClick={() => setCreateOpen(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors font-medium"
                        >
                            <Icon name="add" size={18} />
                            {t('New Rule')}
                        </button>
                    </div>
                )}

                <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark p-3 shadow-sm">
                    <div className="flex flex-col md:flex-row gap-3 items-start md:items-center">
                        <div className="relative">
                            <button
                                ref={authGroupFilterBtnRef}
                                type="button"
                                onClick={() => setAuthGroupFilterOpen(!authGroupFilterOpen)}
                                className="flex items-center justify-between gap-2 px-4 py-2 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors whitespace-nowrap min-w-[140px]"
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    <Icon name="filter_list" size={18} />
                                    <span className="whitespace-nowrap">
                                        {filterAuthGroupIds.length > 0
                                            ? t('Auth Group ({{count}})', { count: filterAuthGroupIds.length })
                                            : t('Auth Group')}
                                    </span>
                                </div>
                                <Icon name="expand_more" size={18} />
                            </button>
                            {authGroupFilterOpen && (
                                <FilterMultiSelect
                                    anchorRef={authGroupFilterBtnRef}
                                    options={authGroups}
                                    selected={filterAuthGroupIds}
                                    onToggle={(id) => {
                                        setFilterAuthGroupIds((prev) =>
                                            prev.includes(id as number)
                                                ? prev.filter((v) => v !== id)
                                                : [...prev, id as number]
                                        );
                                    }}
                                    onClear={() => setFilterAuthGroupIds([])}
                                    onClose={() => setAuthGroupFilterOpen(false)}
                                />
                            )}
                        </div>

                        <div className="relative">
                            <button
                                ref={userGroupFilterBtnRef}
                                type="button"
                                onClick={() => setUserGroupFilterOpen(!userGroupFilterOpen)}
                                className="flex items-center justify-between gap-2 px-4 py-2 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors whitespace-nowrap min-w-[140px]"
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    <Icon name="filter_list" size={18} />
                                    <span className="whitespace-nowrap">
                                        {filterUserGroupIds.length > 0
                                            ? t('User Group ({{count}})', { count: filterUserGroupIds.length })
                                            : t('User Group')}
                                    </span>
                                </div>
                                <Icon name="expand_more" size={18} />
                            </button>
                            {userGroupFilterOpen && (
                                <FilterMultiSelect
                                    anchorRef={userGroupFilterBtnRef}
                                    options={userGroups}
                                    selected={filterUserGroupIds}
                                    onToggle={(id) => {
                                        setFilterUserGroupIds((prev) =>
                                            prev.includes(id as number)
                                                ? prev.filter((v) => v !== id)
                                                : [...prev, id as number]
                                        );
                                    }}
                                    onClear={() => setFilterUserGroupIds([])}
                                    onClose={() => setUserGroupFilterOpen(false)}
                                />
                            )}
                        </div>

                        <div className="relative">
                            <button
                                ref={providerFilterBtnRef}
                                type="button"
                                onClick={() => setProviderFilterOpen(!providerFilterOpen)}
                                className="flex items-center justify-between gap-2 px-4 py-2 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors whitespace-nowrap min-w-[140px]"
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    <Icon name="filter_list" size={18} />
                                    <span className="whitespace-nowrap">
                                        {filterProviders.length > 0
                                            ? t('Provider ({{count}})', { count: filterProviders.length })
                                            : t('Provider')}
                                    </span>
                                </div>
                                <Icon name="expand_more" size={18} />
                            </button>
                            {providerFilterOpen && (
                                <FilterMultiSelect
                                    anchorRef={providerFilterBtnRef}
                                    options={providerFilterOptions}
                                    selected={filterProviders}
                                    onToggle={(id) => {
                                        setFilterProviders((prev) =>
                                            prev.includes(id as string)
                                                ? prev.filter((v) => v !== id)
                                                : [...prev, id as string]
                                        );
                                    }}
                                    onClear={() => setFilterProviders([])}
                                    onClose={() => setProviderFilterOpen(false)}
                                />
                            )}
                        </div>

                        <div className="relative flex-1 min-w-[200px]">
                            <input
                                type="text"
                                value={filterModel}
                                onChange={(e) => setFilterModel(e.target.value)}
                                placeholder={t('Filter by model...')}
                                className="w-full px-4 py-2 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                            />
                            <Icon
                                name="search"
                                size={18}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                            />
                        </div>
                    </div>
                </div>

                <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-sm overflow-hidden">
                    <div ref={tableScrollRef} className="overflow-x-auto" onScroll={handleTableScroll}>
                        <table className="w-full text-left text-sm">
                            <thead className="bg-gray-50 dark:bg-surface-dark text-gray-500 dark:text-gray-400 uppercase text-xs font-semibold border-b border-gray-200 dark:border-border-dark whitespace-nowrap">
                                <tr>
                                    <th className="px-6 py-4">{t('ID')}</th>
                                    <th className="px-6 py-4">{t('Auth Group')}</th>
                                    <th className="px-6 py-4">{t('User Group')}</th>
                                    <th className="px-6 py-4">{t('Provider')}</th>
                                    <th className="px-6 py-4">{t('Model')}</th>
                                    <th className="px-6 py-4">{t('Billing Type')}</th>
                                    <th className="px-6 py-4">{t('Price Per Request')}</th>
                                    <th className="px-6 py-4">{t('Input Token')}</th>
                                    <th className="px-6 py-4">{t('Output Token')}</th>
                                    <th className="px-6 py-4">{t('Cache Create')}</th>
                                    <th className="px-6 py-4">{t('Cache Read')}</th>
                                    <th className="px-6 py-4">{t('Enabled')}</th>
                                    <th className="px-6 py-4">{t('Created At')}</th>
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
                                [...Array(5)].map((_, i) => (
                                    <tr key={i}>
                                        <td colSpan={14} className="px-6 py-4">
                                            <div className="animate-pulse h-4 bg-slate-200 dark:bg-border-dark rounded"></div>
                                        </td>
                                    </tr>
                                ))
                            ) : paginatedRules.length === 0 ? (
                                <tr>
                                    <td colSpan={14} className="px-6 py-8 text-center text-slate-500 dark:text-text-secondary">
                                        {t('No billing rules found')}
                                    </td>
                                </tr>
                            ) : (
                                paginatedRules.map((rule) => (
                                    <tr
                                        key={rule.id}
                                        className="hover:bg-gray-50 dark:hover:bg-background-dark group"
                                    >
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-700 dark:text-white font-medium">
                                            {rule.id}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary">
                                            {authGroups.find((g) => g.id === rule.auth_group_id)?.name || `#${rule.auth_group_id}`}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary">
                                            {userGroups.find((g) => g.id === rule.user_group_id)?.name || `#${rule.user_group_id}`}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary">
                                            {rule.provider || '-'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary">
                                            {rule.model || '-'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary">
                                            {t(BILLING_TYPE_LABELS[rule.billing_type] || 'Unknown')}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-700 dark:text-white font-mono text-xs">
                                            <InlinePriceEditor
                                                value={rule.price_per_request}
                                                canEdit={canUpdateRule && rule.billing_type === 1}
                                                onSave={(val) => handleInlineUpdate(rule, 'price_per_request', val)}
                                            />
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-700 dark:text-white font-mono text-xs">
                                            <InlinePriceEditor
                                                value={rule.price_input_token}
                                                canEdit={canUpdateRule && rule.billing_type === 2}
                                                onSave={(val) => handleInlineUpdate(rule, 'price_input_token', val)}
                                            />
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-700 dark:text-white font-mono text-xs">
                                            <InlinePriceEditor
                                                value={rule.price_output_token}
                                                canEdit={canUpdateRule && rule.billing_type === 2}
                                                onSave={(val) => handleInlineUpdate(rule, 'price_output_token', val)}
                                            />
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-700 dark:text-white font-mono text-xs">
                                            <InlinePriceEditor
                                                value={rule.price_cache_create_token}
                                                canEdit={canUpdateRule && rule.billing_type === 2}
                                                onSave={(val) => handleInlineUpdate(rule, 'price_cache_create_token', val)}
                                            />
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-700 dark:text-white font-mono text-xs">
                                            <InlinePriceEditor
                                                value={rule.price_cache_read_token}
                                                canEdit={canUpdateRule && rule.billing_type === 2}
                                                onSave={(val) => handleInlineUpdate(rule, 'price_cache_read_token', val)}
                                            />
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                                                rule.is_enabled
                                                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20'
                                                    : 'bg-gray-100 text-gray-800 dark:bg-gray-500/10 dark:text-gray-400 border-gray-200 dark:border-gray-500/20'
                                            }`}>
                                                {rule.is_enabled ? t('Yes') : t('No')}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary font-mono text-xs">
                                            {new Date(rule.created_at).toLocaleDateString(locale)}
                                        </td>
                                        <td
                                            className={`px-6 py-4 whitespace-nowrap text-center sticky right-0 z-10 bg-white dark:bg-surface-dark group-hover:bg-gray-50 dark:group-hover:bg-background-dark relative after:content-[''] after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-gray-200 dark:after:bg-border-dark after:pointer-events-none ${
                                                showActionsDivider ? 'after:opacity-100' : 'after:opacity-0'
                                            }`}
                                        >
                                            <div className="flex items-center justify-center gap-1">
                                                {canUpdateRule && (
                                                    <button
                                                        onClick={() => setEditRule(rule)}
                                                        className="p-2 text-gray-400 hover:text-primary hover:bg-gray-100 dark:hover:bg-background-dark rounded-lg transition-colors"
                                                        title={t('Edit')}
                                                    >
                                                        <Icon name="edit" size={18} />
                                                    </button>
                                                )}
                                                {canSetEnabled && (
                                                    <button
                                                        onClick={() => handleToggleEnabled(rule)}
                                                        className={`p-2 rounded-lg transition-colors ${
                                                            rule.is_enabled
                                                                ? 'text-gray-400 hover:text-amber-500 hover:bg-gray-100 dark:hover:bg-background-dark'
                                                                : 'text-gray-400 hover:text-emerald-500 hover:bg-gray-100 dark:hover:bg-background-dark'
                                                        }`}
                                                        title={rule.is_enabled ? t('Disable') : t('Enable')}
                                                    >
                                                        <Icon
                                                            name={rule.is_enabled ? 'toggle_off' : 'toggle_on'}
                                                            size={18}
                                                        />
                                                    </button>
                                                )}
                                                {canDeleteRule && (
                                                    <button
                                                        onClick={() => handleDelete(rule)}
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
                {totalPages > 1 && (
                    <div className="px-6 py-4 border-t border-gray-200 dark:border-border-dark flex items-center justify-between">
                        <div className="text-sm text-slate-500 dark:text-text-secondary">
                            {pageInfo}
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 dark:border-border-dark bg-white dark:bg-surface-dark text-slate-700 dark:text-white hover:bg-slate-50 dark:hover:bg-border-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {t('Previous')}
                            </button>
                            <span className="text-sm text-slate-600 dark:text-text-secondary">
                                {t('Page {{current}} of {{total}}', {
                                    current: currentPage,
                                    total: totalPages,
                                })}
                            </span>
                            <button
                                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                                className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 dark:border-border-dark bg-white dark:bg-surface-dark text-slate-700 dark:text-white hover:bg-slate-50 dark:hover:bg-border-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {t('Next')}
                            </button>
                        </div>
                    </div>
                )}
            </div>
            </div>

            {createOpen && (
                <BillingRuleModal
                    title={t('New Billing Rule')}
                    initialData={buildFormData()}
                    authGroups={authGroups}
                    userGroups={userGroups}
                    canListProviderApiKeys={canListProviderApiKeys}
                    canLoadModelReferencePrice={canLoadModelReferencePrice}
                    submitting={submitting}
                    onClose={() => setCreateOpen(false)}
                    onSubmit={handleCreate}
                />
            )}
            {editRule && (
                <BillingRuleModal
                    title={t('Edit Billing Rule #{{id}}', { id: editRule.id })}
                    initialData={buildFormData(editRule)}
                    authGroups={authGroups}
                    userGroups={userGroups}
                    canListProviderApiKeys={canListProviderApiKeys}
                    canLoadModelReferencePrice={canLoadModelReferencePrice}
                    submitting={submitting}
                    onClose={() => setEditRule(null)}
                    onSubmit={handleUpdate}
                />
            )}
            {batchImportOpen && (
                <BatchImportModal
                    authGroups={authGroups}
                    userGroups={userGroups}
                    submitting={submitting}
                    onClose={() => setBatchImportOpen(false)}
                    onSubmit={handleBatchImport}
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
