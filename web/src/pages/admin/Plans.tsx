import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AdminDashboardLayout } from '../../components/admin/AdminDashboardLayout';
import { AdminNoAccessCard } from '../../components/admin/AdminNoAccessCard';
import { MultiGroupDropdownMenu } from '../../components/admin/MultiGroupDropdownMenu';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { apiFetchAdmin } from '../../api/config';
import { Icon } from '../../components/Icon';
import { buildAdminPermissionKey, useAdminPermissions } from '../../utils/adminPermissions';
import { useStickyActionsDivider } from '../../utils/stickyActionsDivider';
import { useTranslation } from 'react-i18next';

interface Plan {
    id: number;
    name: string;
    month_price: number;
    description: string;
    support_models?: SupportModel[] | string[] | string | null;
    user_group_id: number[];
    feature1: string;
    feature2: string;
    feature3: string;
    feature4: string;
    sort_order: number;
    total_quota: number;
    daily_quota: number;
    rate_limit: number;
    is_enabled: boolean;
    created_at: string;
    updated_at: string;
}

interface PlansResponse {
    plans: Plan[];
}

interface SupportModel {
    provider: string;
    name: string;
}

interface ModelMapping {
    id: number;
    provider: string;
    new_model_name: string;
    is_enabled: boolean;
}

interface ModelMappingsResponse {
    model_mappings: ModelMapping[];
}

interface UserGroup {
    id: number;
    name: string;
}

interface UserGroupsResponse {
    user_groups: UserGroup[];
}

interface PlanFormData {
    name: string;
    month_price: string;
    description: string;
    support_models: SupportModel[];
    user_group_id: number[];
    feature1: string;
    feature2: string;
    feature3: string;
    feature4: string;
    sort_order: string;
    total_quota: string;
    daily_quota: string;
    rate_limit: string;
    is_enabled: boolean;
}

interface ConfirmDialogState {
    title: string;
    message: string;
    confirmText?: string;
    danger?: boolean;
    onConfirm: () => void;
}

interface PlanModalProps {
    title: string;
    initialData: PlanFormData;
    userGroups: UserGroup[];
    submitting: boolean;
    canListModelMappings: boolean;
    onClose: () => void;
    onSubmit: (payload: Record<string, unknown>) => void;
}

const PAGE_SIZE = 10;

const inputClassName =
    'w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent';

const textareaClassName =
    'w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent min-h-[96px]';

interface MultiSelectOption {
    key: string;
    value: string;
    label: string;
    provider: string;
    name: string;
}

interface MultiSelectDropdownMenuProps {
    anchorRef: React.RefObject<HTMLButtonElement | null>;
    options: MultiSelectOption[];
    selected: string[];
    scrollContainerRef?: React.RefObject<HTMLElement | null>;
    onClear: () => void;
    onSelectAll: (values: string[]) => void;
    onUnselectAll: (values: string[]) => void;
    onToggle: (value: string) => void;
    onClose: () => void;
}

function MultiSelectDropdownMenu({
    anchorRef,
    options,
    selected,
    scrollContainerRef,
    onClear,
    onSelectAll,
    onUnselectAll,
    onToggle,
    onClose,
}: MultiSelectDropdownMenuProps) {
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
                width: rect.width,
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
        const container = scrollContainerRef?.current;
        if (container) {
            container.addEventListener('scroll', handleMove, { passive: true });
        }
        return () => {
            window.removeEventListener('scroll', handleMove, true);
            window.removeEventListener('resize', handleMove);
            if (container) {
                container.removeEventListener('scroll', handleMove);
            }
        };
    }, [scrollContainerRef, updatePosition]);

    useEffect(() => {
        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (!target) {
                return;
            }
            if (menuRef.current && menuRef.current.contains(target)) {
                return;
            }
            if (anchorRef.current && anchorRef.current.contains(target)) {
                return;
            }
            onClose();
        };
        document.addEventListener('pointerdown', handlePointerDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
        };
    }, [anchorRef, onClose]);

    const filteredOptions = useMemo(() => {
        const keyword = search.trim().toLowerCase();
        if (!keyword) {
            return options;
        }
        return options.filter((opt) => {
            return (
                opt.label.toLowerCase().includes(keyword) ||
                opt.value.toLowerCase().includes(keyword)
            );
        });
    }, [options, search]);

    return createPortal(
        <>
            <div className="fixed inset-0 z-40" onClick={onClose} />
            <div
                ref={menuRef}
                className="fixed z-50 bg-white dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto"
                style={{ top: position.top, left: position.left, width: position.width }}
            >
                <div className="px-4 py-3 border-b border-gray-200 dark:border-border-dark flex items-center justify-between gap-3">
                    <span className="text-xs text-slate-500 dark:text-text-secondary">
                        {t('Selected {{count}}', { count: selected.length })}
                    </span>
                    <div className="flex items-center gap-2 text-xs">
                        <button
                            type="button"
                            onClick={() => onSelectAll(filteredOptions.map((opt) => opt.key))}
                            disabled={filteredOptions.length === 0}
                            className="px-2 py-1 border border-gray-200 dark:border-border-dark rounded-md text-slate-600 dark:text-text-secondary hover:text-slate-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-background-dark transition-colors disabled:text-slate-400 disabled:cursor-not-allowed"
                        >
                            {t('Select All')}
                        </button>
                        <button
                            type="button"
                            onClick={() => onUnselectAll(filteredOptions.map((opt) => opt.key))}
                            disabled={filteredOptions.length === 0}
                            className="px-2 py-1 border border-gray-200 dark:border-border-dark rounded-md text-slate-600 dark:text-text-secondary hover:text-slate-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-background-dark transition-colors disabled:text-slate-400 disabled:cursor-not-allowed"
                        >
                            {t('Unselect All')}
                        </button>
                        <button
                            type="button"
                            onClick={onClear}
                            disabled={selected.length === 0}
                            className="px-2 py-1 border border-gray-200 dark:border-border-dark rounded-md text-slate-600 dark:text-text-secondary hover:text-slate-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-background-dark transition-colors disabled:text-slate-400 disabled:cursor-not-allowed"
                        >
                            {t('Clear')}
                        </button>
                    </div>
                </div>
                <div className="px-4 py-3 border-b border-gray-200 dark:border-border-dark">
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
                            placeholder={t('Search models')}
                            className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                        />
                    </div>
                </div>
                {filteredOptions.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-slate-500 dark:text-text-secondary">
                        {t('No models found')}
                    </div>
                ) : (
                    filteredOptions.map((opt) => {
                        const isSelected = selected.includes(opt.key);
                        return (
                            <button
                                key={opt.key}
                                type="button"
                                onClick={() => onToggle(opt.key)}
                                className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-background-dark transition-colors ${
                                    isSelected
                                        ? 'bg-gray-100 dark:bg-background-dark text-slate-900 dark:text-white font-medium'
                                        : 'text-slate-900 dark:text-white'
                                }`}
                                title={opt.label}
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
                                <span className="truncate">{opt.label}</span>
                            </button>
                        );
                    })
                )}
            </div>
        </>,
        document.body
    );
}

const buildSupportModelKey = (provider: string, name: string) => `${provider}::${name}`;

function normalizeSupportModels(value?: SupportModel[] | string[] | string | null): SupportModel[] {
    if (!value) {
        return [];
    }
    if (Array.isArray(value)) {
        const normalized: SupportModel[] = [];
        value.forEach((item) => {
            if (typeof item === 'string') {
                const name = item.trim();
                if (name) {
                    normalized.push({ provider: '', name });
                }
                return;
            }
            if (typeof item === 'object' && item) {
                const candidate = item as SupportModel;
                const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
                if (!name) {
                    return;
                }
                const provider = typeof candidate.provider === 'string' ? candidate.provider.trim() : '';
                normalized.push({ provider, name });
            }
        });
        return normalized;
    }
    try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
            return normalizeSupportModels(parsed as SupportModel[] | string[]);
        }
    } catch {
        return [];
    }
    return [];
}

function cleanSupportModels(models: SupportModel[]): SupportModel[] {
    const unique = new Map<string, SupportModel>();
    models.forEach((item) => {
        const name = item.name?.trim();
        if (!name) {
            return;
        }
        const provider = item.provider?.trim() || '';
        const key = buildSupportModelKey(provider, name);
        if (!unique.has(key)) {
            unique.set(key, { provider, name });
        }
    });
    return Array.from(unique.values());
}

function buildFormData(plan?: Plan): PlanFormData {
    if (!plan) {
        return {
            name: '',
            month_price: '0',
            description: '',
            support_models: [],
            user_group_id: [],
            feature1: '',
            feature2: '',
            feature3: '',
            feature4: '',
            sort_order: '0',
            total_quota: '0',
            daily_quota: '0',
            rate_limit: '0',
            is_enabled: true,
        };
    }
    return {
        name: plan.name ?? '',
        month_price: String(plan.month_price ?? 0),
        description: plan.description ?? '',
        support_models: normalizeSupportModels(plan.support_models),
        user_group_id: plan.user_group_id ?? [],
        feature1: plan.feature1 ?? '',
        feature2: plan.feature2 ?? '',
        feature3: plan.feature3 ?? '',
        feature4: plan.feature4 ?? '',
        sort_order: String(plan.sort_order ?? 0),
        total_quota: String(plan.total_quota ?? 0),
        daily_quota: String(plan.daily_quota ?? 0),
        rate_limit: String(plan.rate_limit ?? 0),
        is_enabled: plan.is_enabled ?? true,
    };
}

function PlanModal({ title, initialData, userGroups, submitting, canListModelMappings, onClose, onSubmit }: PlanModalProps) {
    const { t } = useTranslation();
    const [formData, setFormData] = useState<PlanFormData>(initialData);
    const [error, setError] = useState('');
    const [availableModels, setAvailableModels] = useState<MultiSelectOption[]>([]);
    const [modelsLoading, setModelsLoading] = useState(false);
    const [modelsDropdownOpen, setModelsDropdownOpen] = useState(false);
    const [userGroupMenuOpen, setUserGroupMenuOpen] = useState(false);
    const [userGroupSearch, setUserGroupSearch] = useState('');
    const userGroupBtnWidth = useMemo(() => {
        const allOptions = [t('No Group'), ...userGroups.map((g) => `${g.name} #${g.id}`)];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return undefined;
        }
        ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
        let maxWidth = 0;
        for (const opt of allOptions) {
            const width = ctx.measureText(opt).width;
            if (width > maxWidth) maxWidth = width;
        }
        return Math.ceil(maxWidth) + 72;
    }, [userGroups, t]);
    const modelsButtonRef = useRef<HTMLButtonElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);
    const visibleModels = useMemo(
        () => (canListModelMappings ? availableModels : []),
        [canListModelMappings, availableModels]
    );
    const availableModelMap = useMemo(() => {
        return new Map(visibleModels.map((option) => [option.key, option]));
    }, [visibleModels]);

    const parseNumber = (value: string, label: string, integer = false) => {
        const trimmed = value.trim();
        if (trimmed === '') {
            return 0;
        }
        const parsed = integer ? Number.parseInt(trimmed, 10) : Number(trimmed);
        if (Number.isNaN(parsed)) {
            setError(t('{{label}} must be a number.', { label }));
            return null;
        }
        return parsed;
    };

    useEffect(() => {
        if (!canListModelMappings) {
            return;
        }
        queueMicrotask(() => setModelsLoading(true));
        apiFetchAdmin<ModelMappingsResponse>('/v0/admin/model-mappings?is_enabled=true')
            .then((res) => {
                const unique = new Map<string, MultiSelectOption>();
                (res.model_mappings || []).forEach((item) => {
                    if (!item.is_enabled || !item.new_model_name) {
                        return;
                    }
                    const name = item.new_model_name.trim();
                    if (!name) {
                        return;
                    }
                    const provider = item.provider?.trim() || t('Unknown');
                    const key = `${provider}::${name}`;
                    if (!unique.has(key)) {
                        unique.set(key, {
                            value: name,
                            label: `${provider} / ${name}`,
                            key,
                            provider,
                            name,
                        });
                    }
                });

                const options = Array.from(unique.values());
                options.sort((a, b) => a.label.localeCompare(b.label));
                setAvailableModels(options);
            })
            .catch(() => {
                setAvailableModels([]);
            })
            .finally(() => {
                setModelsLoading(false);
            });
    }, [canListModelMappings, t]);

    const modelsBtnWidth = useMemo(() => {
        if (visibleModels.length === 0) {
            return null;
        }
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return null;
        }
        ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
        let maxWidth = 0;
        for (const model of visibleModels) {
            const width = ctx.measureText(model.label).width;
            if (width > maxWidth) {
                maxWidth = width;
            }
        }
        return Math.ceil(maxWidth) + 72;
    }, [visibleModels]);

    const handleSubmit = () => {
        setError('');
        const name = formData.name.trim();
        if (!name) {
            setError(t('Name is required.'));
            return;
        }

        const monthPrice = parseNumber(formData.month_price, t('Monthly price'));
        if (monthPrice === null) {
            return;
        }
        const sortOrder = parseNumber(formData.sort_order, t('Sort order'), true);
        if (sortOrder === null) {
            return;
        }
        const totalQuota = parseNumber(formData.total_quota, t('Total quota'));
        if (totalQuota === null) {
            return;
        }
        const dailyQuota = parseNumber(formData.daily_quota, t('Daily quota'));
        if (dailyQuota === null) {
            return;
        }
        const rateLimit = parseNumber(formData.rate_limit, t('Rate limit'), true);
        if (rateLimit === null) {
            return;
        }

        const payload = {
            name,
            month_price: monthPrice,
            description: formData.description.trim(),
            support_models: cleanSupportModels(formData.support_models),
            user_group_id: formData.user_group_id,
            feature1: formData.feature1.trim(),
            feature2: formData.feature2.trim(),
            feature3: formData.feature3.trim(),
            feature4: formData.feature4.trim(),
            sort_order: sortOrder,
            total_quota: totalQuota,
            daily_quota: dailyQuota,
            rate_limit: rateLimit,
            is_enabled: formData.is_enabled,
        };

        setError('');
        onSubmit(payload);
    };

    const selectedKeys = useMemo(() => {
        return formData.support_models.map((model) =>
            buildSupportModelKey(model.provider, model.name)
        );
    }, [formData.support_models]);
    const selectedModelsLabel =
        formData.support_models.length > 0
            ? t('{{count}} selected', { count: formData.support_models.length })
            : t('Select models');
    const selectedModelsTitle =
        formData.support_models.length > 0
            ? formData.support_models
                  .map((model) =>
                      model.provider
                          ? `${model.provider} / ${model.name}`
                          : model.name
                  )
                  .join(', ')
            : t('Select models');
    const toggleSupportModel = (key: string) => {
        const option = availableModelMap.get(key);
        if (!option) {
            return;
        }
        setFormData((prev) => {
            const exists = prev.support_models.some(
                (item) =>
                    buildSupportModelKey(item.provider, item.name) === key
            );
            if (exists) {
                return {
                    ...prev,
                    support_models: prev.support_models.filter(
                        (item) =>
                            buildSupportModelKey(item.provider, item.name) !== key
                    ),
                };
            }
            return {
                ...prev,
                support_models: [
                    ...prev.support_models,
                    { provider: option.provider, name: option.name },
                ],
            };
        });
    };
    const clearSupportModels = () => {
        setFormData((prev) => ({ ...prev, support_models: [] }));
    };
    const selectAllSupportModels = (values: string[]) => {
        setFormData((prev) => {
            if (values.length === 0) {
                return prev;
            }
            const merged = new Map<string, SupportModel>();
            prev.support_models.forEach((model) => {
                merged.set(buildSupportModelKey(model.provider, model.name), model);
            });
            values.forEach((key) => {
                const option = availableModelMap.get(key);
                if (!option) {
                    return;
                }
                merged.set(key, { provider: option.provider, name: option.name });
            });
            return { ...prev, support_models: Array.from(merged.values()) };
        });
    };
    const unselectAllSupportModels = (values: string[]) => {
        setFormData((prev) => {
            if (values.length === 0) {
                return prev;
            }
            const removing = new Set(values);
            return {
                ...prev,
                support_models: prev.support_models.filter(
                    (item) => !removing.has(buildSupportModelKey(item.provider, item.name))
                ),
            };
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white dark:bg-surface-dark rounded-xl shadow-xl w-full max-w-3xl mx-4 border border-gray-200 dark:border-border-dark max-h-[90vh] flex flex-col overflow-hidden">
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
                <div ref={contentRef} className="p-6 space-y-5 overflow-y-auto flex-1">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                {t('Name')}
                            </label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder={t('Enter plan name')}
                                className={inputClassName}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                {t('Monthly Price')}
                            </label>
                            <input
                                type="number"
                                step="0.01"
                                value={formData.month_price}
                                onChange={(e) => setFormData({ ...formData, month_price: e.target.value })}
                                placeholder="0.00"
                                className={inputClassName}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                {t('Sort Order')}
                            </label>
                            <input
                                type="number"
                                step="1"
                                value={formData.sort_order}
                                onChange={(e) => setFormData({ ...formData, sort_order: e.target.value })}
                                placeholder="0"
                                className={inputClassName}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                {t('Total Quota')}
                            </label>
                            <input
                                type="number"
                                step="0.0001"
                                value={formData.total_quota}
                                onChange={(e) => setFormData({ ...formData, total_quota: e.target.value })}
                                placeholder="0"
                                className={inputClassName}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                {t('Daily Quota')}
                            </label>
                            <input
                                type="number"
                                step="0.0001"
                                value={formData.daily_quota}
                                onChange={(e) => setFormData({ ...formData, daily_quota: e.target.value })}
                                placeholder="0"
                                className={inputClassName}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                {t('Rate limit')}
                            </label>
                            <input
                                type="number"
                                step="1"
                                value={formData.rate_limit}
                                onChange={(e) => setFormData({ ...formData, rate_limit: e.target.value })}
                                placeholder="0"
                                className={inputClassName}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('User Group')}
                        </label>
                        <div className="relative">
                            <button
                                type="button"
                                id="plan-user-groups-btn"
                                onClick={() => setUserGroupMenuOpen(!userGroupMenuOpen)}
                                className="w-full flex items-center justify-between gap-2 bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark text-slate-900 dark:text-white text-sm rounded-lg focus:ring-primary focus:border-primary px-3 py-2.5"
                                style={userGroupBtnWidth ? { minWidth: userGroupBtnWidth } : undefined}
                                title={
                                    formData.user_group_id.length === 0
                                        ? t('No Group')
                                        : formData.user_group_id
                                              .map((id) => userGroups.find((g) => g.id === id)?.name || `#${id}`)
                                              .join(', ')
                                }
                            >
                                <span className="truncate">
                                    {formData.user_group_id.length === 0
                                        ? t('No Group')
                                        : t('Selected {{count}}', { count: formData.user_group_id.length })}
                                </span>
                                <Icon name={userGroupMenuOpen ? 'expand_less' : 'expand_more'} size={18} />
                            </button>
                            {userGroupMenuOpen && (
                                <MultiGroupDropdownMenu
                                    anchorId="plan-user-groups-btn"
                                    groups={userGroups}
                                    selectedIds={formData.user_group_id}
                                    search={userGroupSearch}
                                    emptyLabel={t('No Group')}
                                    menuWidth={userGroupBtnWidth}
                                    onSearchChange={setUserGroupSearch}
                                    onToggle={(value) =>
                                        setFormData((prev) => ({
                                            ...prev,
                                            user_group_id: prev.user_group_id.includes(value)
                                                ? prev.user_group_id.filter((id) => id !== value)
                                                : [...prev.user_group_id, value],
                                        }))
                                    }
                                    onClear={() => setFormData((prev) => ({ ...prev, user_group_id: [] }))}
                                    onClose={() => setUserGroupMenuOpen(false)}
                                />
                            )}
                        </div>
                        <p className="mt-1 text-xs text-slate-500 dark:text-text-secondary">
                            {t('Selected user groups will be granted when users purchase this plan.')}
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Support Models')}
                        </label>
                        <div className="relative">
                            <button
                                type="button"
                                ref={modelsButtonRef}
                                onClick={() => {
                                    if (!canListModelMappings) {
                                        return;
                                    }
                                    setModelsDropdownOpen(!modelsDropdownOpen);
                                }}
                                disabled={!canListModelMappings}
                                className="w-full flex items-center justify-between gap-2 bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark text-slate-900 dark:text-white text-sm rounded-lg focus:ring-primary focus:border-primary px-3 py-2.5 disabled:opacity-60 disabled:cursor-not-allowed"
                                style={modelsBtnWidth ? { minWidth: modelsBtnWidth } : undefined}
                                title={selectedModelsTitle}
                            >
                                <span className="truncate">
                                    {selectedModelsLabel}
                                </span>
                                <Icon
                                    name={modelsLoading ? 'progress_activity' : modelsDropdownOpen ? 'expand_less' : 'expand_more'}
                                    size={18}
                                    className={modelsLoading ? 'animate-spin' : ''}
                                />
                            </button>
                            {modelsDropdownOpen && canListModelMappings && (
                                <MultiSelectDropdownMenu
                                    anchorRef={modelsButtonRef}
                                    options={visibleModels}
                                    selected={selectedKeys}
                                    scrollContainerRef={contentRef}
                                    onClear={clearSupportModels}
                                    onSelectAll={selectAllSupportModels}
                                    onUnselectAll={unselectAllSupportModels}
                                    onToggle={toggleSupportModel}
                                    onClose={() => setModelsDropdownOpen(false)}
                                />
                            )}
                        </div>
                        <p className="mt-1 text-xs text-slate-500 dark:text-text-secondary">
                            {canListModelMappings
                                ? t('Select from enabled model mappings.')
                                : t('No permission to load model list.')}
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Description')}
                        </label>
                        <textarea
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            placeholder={t('Describe this plan')}
                            className={textareaClassName}
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                {t('Feature 1')}
                            </label>
                            <input
                                type="text"
                                value={formData.feature1}
                                onChange={(e) => setFormData({ ...formData, feature1: e.target.value })}
                                placeholder={t('Feature highlight')}
                                className={inputClassName}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                {t('Feature 2')}
                            </label>
                            <input
                                type="text"
                                value={formData.feature2}
                                onChange={(e) => setFormData({ ...formData, feature2: e.target.value })}
                                placeholder={t('Feature highlight')}
                                className={inputClassName}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                {t('Feature 3')}
                            </label>
                            <input
                                type="text"
                                value={formData.feature3}
                                onChange={(e) => setFormData({ ...formData, feature3: e.target.value })}
                                placeholder={t('Feature highlight')}
                                className={inputClassName}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                {t('Feature 4')}
                            </label>
                            <input
                                type="text"
                                value={formData.feature4}
                                onChange={(e) => setFormData({ ...formData, feature4: e.target.value })}
                                placeholder={t('Feature highlight')}
                                className={inputClassName}
                            />
                        </div>
                    </div>

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
                            {error}
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

export function AdminPlans() {
    const { t, i18n } = useTranslation();
    const { hasPermission } = useAdminPermissions();
    const canListPlans = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/plans'));
    const canCreatePlan = hasPermission(buildAdminPermissionKey('POST', '/v0/admin/plans'));
    const canUpdatePlan = hasPermission(buildAdminPermissionKey('PUT', '/v0/admin/plans/:id'));
    const canDeletePlan = hasPermission(buildAdminPermissionKey('DELETE', '/v0/admin/plans/:id'));
    const canEnablePlan = hasPermission(buildAdminPermissionKey('POST', '/v0/admin/plans/:id/enable'));
    const canDisablePlan = hasPermission(buildAdminPermissionKey('POST', '/v0/admin/plans/:id/disable'));
    const canListModelMappings = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/model-mappings'));
    const canListUserGroups = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/user-groups'));

    const [plans, setPlans] = useState<Plan[]>([]);
    const [loading, setLoading] = useState(true);
    const [userGroups, setUserGroups] = useState<UserGroup[]>([]);
    const [currentPage, setCurrentPage] = useState(1);
    const [createOpen, setCreateOpen] = useState(false);
    const [editPlan, setEditPlan] = useState<Plan | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
    const locale = i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US';

    const fetchPlans = useCallback(() => {
        if (!canListPlans) {
            return;
        }
        setLoading(true);
        apiFetchAdmin<PlansResponse>('/v0/admin/plans')
            .then((res) => setPlans(res.plans || []))
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [canListPlans]);

    useEffect(() => {
        if (canListPlans) {
            fetchPlans();
        }
    }, [fetchPlans, canListPlans]);

    useEffect(() => {
        if (!canListUserGroups) {
            return;
        }
        apiFetchAdmin<UserGroupsResponse>('/v0/admin/user-groups')
            .then((res) => setUserGroups(res.user_groups || []))
            .catch(console.error);
    }, [canListUserGroups]);

    const totalPages = Math.ceil(plans.length / PAGE_SIZE);
    const paginatedPlans = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return plans.slice(start, start + PAGE_SIZE);
    }, [plans, currentPage]);

    const { tableScrollRef, handleTableScroll, showActionsDivider } = useStickyActionsDivider(
        paginatedPlans.length,
        loading
    );

    const pageInfo = useMemo(() => {
        if (!plans.length) {
            return t('No plans found');
        }
        const start = (currentPage - 1) * PAGE_SIZE + 1;
        const end = Math.min(currentPage * PAGE_SIZE, plans.length);
        return t('Showing {{from}} to {{to}} of {{total}} plans', {
            from: start,
            to: end,
            total: plans.length,
        });
    }, [plans.length, currentPage, t]);

    const handleCreate = async (payload: Record<string, unknown>) => {
        if (!canCreatePlan) {
            return;
        }
        setSubmitting(true);
        try {
            await apiFetchAdmin('/v0/admin/plans', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            setCreateOpen(false);
            fetchPlans();
        } catch (err) {
            console.error(err);
        } finally {
            setSubmitting(false);
        }
    };

    const handleUpdate = async (payload: Record<string, unknown>) => {
        if (!editPlan || !canUpdatePlan) {
            return;
        }
        setSubmitting(true);
        try {
            await apiFetchAdmin(`/v0/admin/plans/${editPlan.id}`, {
                method: 'PUT',
                body: JSON.stringify(payload),
            });
            setEditPlan(null);
            fetchPlans();
        } catch (err) {
            console.error(err);
        } finally {
            setSubmitting(false);
        }
    };

    const handleToggleEnabled = async (plan: Plan) => {
        if (plan.is_enabled && !canDisablePlan) {
            return;
        }
        if (!plan.is_enabled && !canEnablePlan) {
            return;
        }
        try {
            const endpoint = plan.is_enabled
                ? `/v0/admin/plans/${plan.id}/disable`
                : `/v0/admin/plans/${plan.id}/enable`;
            await apiFetchAdmin(endpoint, { method: 'POST' });
            setPlans((prev) =>
                prev.map((item) =>
                    item.id === plan.id
                        ? { ...item, is_enabled: !plan.is_enabled }
                        : item
                )
            );
        } catch (err) {
            console.error(err);
        }
    };

    const handleDelete = async (plan: Plan) => {
        if (!canDeletePlan) {
            return;
        }
        setConfirmDialog({
            title: t('Delete Plan'),
            message: t('Are you sure you want to delete plan #{{id}}? This action cannot be undone.', { id: plan.id }),
            confirmText: t('Delete'),
            danger: true,
            onConfirm: async () => {
                try {
                    await apiFetchAdmin(`/v0/admin/plans/${plan.id}`, { method: 'DELETE' });
                    fetchPlans();
                } catch (err) {
                    console.error(err);
                } finally {
                    setConfirmDialog(null);
                }
            },
        });
    };

    if (!canListPlans) {
        return (
            <AdminDashboardLayout title={t('Plans')} subtitle={t('Manage subscription plans')}>
                <AdminNoAccessCard />
            </AdminDashboardLayout>
        );
    }

    return (
        <AdminDashboardLayout title={t('Plans')} subtitle={t('Manage subscription plans')}>
            <div className="space-y-6">
                {canCreatePlan && (
                    <div className="flex justify-end">
                        <button
                            onClick={() => setCreateOpen(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors font-medium"
                        >
                            <Icon name="add" size={18} />
                            {t('New Plan')}
                        </button>
                    </div>
                )}

                <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-sm overflow-hidden">
                    <div ref={tableScrollRef} className="overflow-x-auto" onScroll={handleTableScroll}>
                        <table className="w-full text-left text-sm">
                            <thead className="bg-gray-50 dark:bg-surface-dark text-gray-500 dark:text-gray-400 uppercase text-xs font-semibold border-b border-gray-200 dark:border-border-dark">
                                <tr>
                                    <th className="px-6 py-4">{t('ID')}</th>
                                    <th className="px-6 py-4">{t('Name')}</th>
                                    <th className="px-6 py-4">{t('Monthly Price')}</th>
                                    <th className="px-6 py-4">{t('Models')}</th>
                                    <th className="px-6 py-4">{t('User Group')}</th>
                                    <th className="px-6 py-4">{t('Quota')}</th>
                                    <th className="px-6 py-4">{t('Rate limit')}</th>
                                    <th className="px-6 py-4">{t('Enabled')}</th>
                                    <th className="px-6 py-4">{t('Updated At')}</th>
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
                                            <td colSpan={10} className="px-6 py-4">
                                                <div className="animate-pulse h-4 bg-slate-200 dark:bg-border-dark rounded"></div>
                                            </td>
                                        </tr>
                                    ))
                                ) : paginatedPlans.length === 0 ? (
                                    <tr>
                                        <td colSpan={10} className="px-6 py-8 text-center text-slate-500 dark:text-text-secondary">
                                            {t('No plans found')}
                                        </td>
                                    </tr>
                                ) : (
                                    paginatedPlans.map((plan) => {
                                        const models = normalizeSupportModels(plan.support_models);
                                        const modelLabel =
                                            models.length > 0
                                                ? models
                                                      .map((model) =>
                                                          model.provider
                                                              ? `${model.provider} / ${model.name}`
                                                              : model.name
                                                      )
                                                      .join(', ')
                                                : '-';
                                        const userGroupTitle =
                                            plan.user_group_id.length === 0
                                                ? t('No Group')
                                                : plan.user_group_id
                                                      .map((id) => userGroups.find((g) => g.id === id)?.name || `#${id}`)
                                                      .join(', ');
                                        return (
                                            <tr
                                                key={plan.id}
                                                className="hover:bg-gray-50 dark:hover:bg-background-dark group"
                                            >
                                                <td className="px-6 py-4 whitespace-nowrap text-slate-700 dark:text-white font-medium">
                                                    {plan.id}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary">
                                                    {plan.name}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-slate-700 dark:text-white font-mono">
                                                    {plan.month_price.toFixed(2)}
                                                </td>
                                                <td className="px-6 py-4 text-slate-600 dark:text-text-secondary max-w-xs">
                                                    <span className="block truncate" title={modelLabel}>
                                                        {modelLabel}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary">
                                                    <span className="block truncate" title={userGroupTitle}>
                                                        {plan.user_group_id.length === 0
                                                            ? t('No Group')
                                                            : t('Selected {{count}}', { count: plan.user_group_id.length })}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary font-mono">
                                                    {plan.total_quota.toLocaleString()} / {plan.daily_quota.toLocaleString()}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary font-mono">
                                                    {plan.rate_limit.toLocaleString()}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                                                        plan.is_enabled
                                                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20'
                                                            : 'bg-gray-100 text-gray-800 dark:bg-gray-500/10 dark:text-gray-400 border-gray-200 dark:border-gray-500/20'
                                                    }`}>
                                                        {plan.is_enabled ? t('Yes') : t('No')}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary font-mono text-xs">
                                                    {new Date(plan.updated_at).toLocaleDateString(locale)}
                                                </td>
                                                <td
                                                    className={`px-6 py-4 whitespace-nowrap text-center sticky right-0 z-10 bg-white dark:bg-surface-dark group-hover:bg-gray-50 dark:group-hover:bg-background-dark relative after:content-[''] after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-gray-200 dark:after:bg-border-dark after:pointer-events-none ${
                                                        showActionsDivider ? 'after:opacity-100' : 'after:opacity-0'
                                                    }`}
                                                >
                                                    <div className="flex items-center justify-center gap-1">
                                                        {canUpdatePlan && (
                                                            <button
                                                                onClick={() => setEditPlan(plan)}
                                                                className="p-2 text-gray-400 hover:text-primary hover:bg-gray-100 dark:hover:bg-background-dark rounded-lg transition-colors"
                                                                title={t('Edit')}
                                                            >
                                                                <Icon name="edit" size={18} />
                                                            </button>
                                                        )}
                                                        {(plan.is_enabled ? canDisablePlan : canEnablePlan) && (
                                                            <button
                                                                onClick={() => handleToggleEnabled(plan)}
                                                                className={`p-2 rounded-lg transition-colors ${
                                                                    plan.is_enabled
                                                                        ? 'text-gray-400 hover:text-amber-500 hover:bg-gray-100 dark:hover:bg-background-dark'
                                                                        : 'text-gray-400 hover:text-emerald-500 hover:bg-gray-100 dark:hover:bg-background-dark'
                                                                }`}
                                                                title={plan.is_enabled ? t('Disable') : t('Enable')}
                                                            >
                                                                <Icon
                                                                    name={plan.is_enabled ? 'toggle_off' : 'toggle_on'}
                                                                    size={18}
                                                                />
                                                            </button>
                                                        )}
                                                        {canDeletePlan && (
                                                            <button
                                                                onClick={() => handleDelete(plan)}
                                                                className="p-2 text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-background-dark rounded-lg transition-colors"
                                                                title={t('Delete')}
                                                            >
                                                                <Icon name="delete" size={18} />
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
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
                <PlanModal
                    title={t('New Plan')}
                    initialData={buildFormData()}
                    userGroups={userGroups}
                    submitting={submitting}
                    canListModelMappings={canListModelMappings}
                    onClose={() => setCreateOpen(false)}
                    onSubmit={handleCreate}
                />
            )}
            {editPlan && (
                <PlanModal
                    title={t('Edit Plan #{{id}}', { id: editPlan.id })}
                    initialData={buildFormData(editPlan)}
                    userGroups={userGroups}
                    submitting={submitting}
                    canListModelMappings={canListModelMappings}
                    onClose={() => setEditPlan(null)}
                    onSubmit={handleUpdate}
                />
            )}
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
        </AdminDashboardLayout>
    );
}
