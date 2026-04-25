import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { AdminDashboardLayout } from '../../components/admin/AdminDashboardLayout';
import { AdminNoAccessCard } from '../../components/admin/AdminNoAccessCard';
import { Icon } from '../../components/Icon';
import { apiFetchAdmin } from '../../api/config';
import { buildAdminPermissionKey, useAdminPermissions } from '../../utils/adminPermissions';

interface AdminUsageSummary {
    requests: number;
    input_tokens: number;
    output_tokens: number;
    cached_tokens: number;
    reasoning_tokens: number;
    total_tokens: number;
    cost_micros: number;
    avg_request_time_ms: number;
    error_rate: number;
}

interface AdminUsageTrendPoint {
    label: string;
    bucket: string;
    requests: number;
    total_tokens: number;
    cost_micros: number;
    failed_count: number;
}

interface AdminUsageBreakdownItem {
    name: string;
    requests: number;
    total_tokens: number;
    cost_micros: number;
    failed_count: number;
    error_rate: number;
    avg_request_time_ms: number;
}

interface AdminUsageRecentItem {
    label: string;
    bucket: string;
    model: string;
    provider: string;
    requests: number;
    total_tokens: number;
    cost_micros: number;
    failed_count: number;
    error_rate: number;
    avg_request_time_ms: number;
}

interface AdminUsageFilters {
    range?: string;
    monthly_buckets?: boolean;
    start_date?: string;
    end_date?: string;
    model?: string;
    provider?: string;
    project?: string;
    available_models?: string[];
    available_providers?: string[];
}

interface AdminUsageResponse {
    summary: AdminUsageSummary;
    trend: AdminUsageTrendPoint[];
    top_models: AdminUsageBreakdownItem[];
    top_providers: AdminUsageBreakdownItem[];
    recent: AdminUsageRecentItem[];
    filters: AdminUsageFilters;
}

interface OptionDropdownMenuProps {
    anchorId: string;
    allLabel: string;
    options: string[];
    selectedValue: string;
    menuWidth?: number;
    onSelect: (value: string) => void;
    onClose: () => void;
}

function OptionDropdownMenu({
    anchorId,
    allLabel,
    options,
    selectedValue,
    menuWidth,
    onSelect,
    onClose,
}: OptionDropdownMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);
    const btn = document.getElementById(anchorId);
    const rect = btn ? btn.getBoundingClientRect() : null;
    const position = rect
        ? { top: rect.bottom + 4, left: rect.left, width: rect.width }
        : { top: 0, left: 0, width: 0 };

    const items = [{ value: '', label: allLabel }, ...options.map((option) => ({ value: option, label: option }))];

    return createPortal(
        <>
            <div className="fixed inset-0 z-40" onClick={onClose} />
            <div
                ref={menuRef}
                className="fixed z-50 bg-white dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto"
                style={{ top: position.top, left: position.left, width: position.width || menuWidth }}
            >
                {items.map((item) => (
                    <button
                        key={item.value}
                        type="button"
                        onClick={() => onSelect(item.value)}
                        className={`w-full text-left px-4 py-2.5 text-sm truncate hover:bg-gray-100 dark:hover:bg-background-dark transition-colors ${
                            selectedValue === item.value
                                ? 'bg-gray-100 dark:bg-background-dark text-primary font-medium'
                                : 'text-slate-900 dark:text-white'
                        }`}
                        title={item.label}
                    >
                        {item.label}
                    </button>
                ))}
            </div>
        </>,
        document.body
    );
}

function formatNumber(value: number): string {
    return value.toLocaleString();
}

function formatTokenCompact(value: number): string {
    if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return value.toLocaleString();
}

function formatMoney(costMicros: number): string {
    return `$${(costMicros / 1_000_000).toFixed(2)}`;
}

function formatPercent(value: number): string {
    return `${value.toFixed(2)}%`;
}

function getBarWidth(value: number, maxValue: number): string {
    if (maxValue <= 0) return '0%';
    return `${Math.max((value / maxValue) * 100, 6)}%`;
}

const rangeOptions = [
    { value: 'today', labelKey: 'Today' },
    { value: 'last7d', labelKey: 'Last 7 Days' },
    { value: 'last30d', labelKey: 'Last 30 Days' },
    { value: 'mtd', labelKey: 'Month to Date' },
    { value: 'all', labelKey: 'All Time' },
    { value: 'custom', labelKey: 'Custom Range' },
];

export function AdminUsage() {
    const { t } = useTranslation();
    const { hasPermission } = useAdminPermissions();
    const canViewUsage = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/usage'));

    const [data, setData] = useState<AdminUsageResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [range, setRange] = useState('last30d');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [modelFilter, setModelFilter] = useState('');
    const [providerFilter, setProviderFilter] = useState('');
    const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
    const [providerDropdownOpen, setProviderDropdownOpen] = useState(false);
    const [modelBtnWidth, setModelBtnWidth] = useState<number | undefined>(undefined);
    const [providerBtnWidth, setProviderBtnWidth] = useState<number | undefined>(undefined);

    const availableModels = useMemo(() => data?.filters.available_models || [], [data]);
    const availableProviders = useMemo(() => data?.filters.available_providers || [], [data]);

    useEffect(() => {
        const allOptions = [t('All Models'), ...availableModels];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
            let maxWidth = 0;
            for (const option of allOptions) {
                maxWidth = Math.max(maxWidth, ctx.measureText(option).width);
            }
            setModelBtnWidth(Math.ceil(maxWidth) + 96);
        }
    }, [availableModels, t]);

    useEffect(() => {
        const allOptions = [t('All Providers'), ...availableProviders];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
            let maxWidth = 0;
            for (const option of allOptions) {
                maxWidth = Math.max(maxWidth, ctx.measureText(option).width);
            }
            setProviderBtnWidth(Math.ceil(maxWidth) + 96);
        }
    }, [availableProviders, t]);

    const fetchData = useCallback(async () => {
        if (!canViewUsage) {
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const params = new URLSearchParams();
            params.set('range', range);
            if (range === 'custom') {
                if (startDate) params.set('start_date', startDate);
                if (endDate) params.set('end_date', endDate);
            }
            if (modelFilter) params.set('model', modelFilter);
            if (providerFilter) params.set('provider', providerFilter);
            const response = await apiFetchAdmin<AdminUsageResponse>(`/v0/admin/usage?${params.toString()}`);
            setData(response);
        } catch (err) {
            console.error('Failed to fetch usage dashboard:', err);
        } finally {
            setLoading(false);
        }
    }, [canViewUsage, range, startDate, endDate, modelFilter, providerFilter]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const trendMaxRequests = useMemo(
        () => Math.max(...(data?.trend.map((item) => item.requests) || [0]), 1),
        [data]
    );
    const trendMaxTokens = useMemo(
        () => Math.max(...(data?.trend.map((item) => item.total_tokens) || [0]), 1),
        [data]
    );
    const topModelMaxCost = useMemo(
        () => Math.max(...(data?.top_models.map((item) => item.cost_micros) || [0]), 1),
        [data]
    );
    const topProviderMaxCost = useMemo(
        () => Math.max(...(data?.top_providers.map((item) => item.cost_micros) || [0]), 1),
        [data]
    );

    const statCards = [
        {
            label: t('Requests Made'),
            value: formatNumber(data?.summary.requests || 0),
            icon: 'api',
            iconColor: 'text-blue-500',
            bgClass: 'bg-blue-50 dark:bg-blue-500/10',
        },
        {
            label: t('Total Tokens'),
            value: formatTokenCompact(data?.summary.total_tokens || 0),
            icon: 'data_usage',
            iconColor: 'text-purple-500',
            bgClass: 'bg-purple-50 dark:bg-purple-500/10',
        },
        {
            label: t('Token Price Burned'),
            value: formatMoney(data?.summary.cost_micros || 0),
            icon: 'attach_money',
            iconColor: 'text-emerald-500',
            bgClass: 'bg-emerald-50 dark:bg-emerald-500/10',
        },
        {
            label: t('Error Rate'),
            value: formatPercent(data?.summary.error_rate || 0),
            icon: 'error_outline',
            iconColor: 'text-red-500',
            bgClass: 'bg-red-50 dark:bg-red-500/10',
        },
        {
            label: t('Avg. Request Time'),
            value: `${data?.summary.avg_request_time_ms || 0}ms`,
            icon: 'timer',
            iconColor: 'text-amber-500',
            bgClass: 'bg-amber-50 dark:bg-amber-500/10',
        },
    ];

    if (!canViewUsage) {
        return (
            <AdminDashboardLayout title={t('Usage')} subtitle={t('Explore filtered usage metrics and cost analytics.')}>
                <AdminNoAccessCard />
            </AdminDashboardLayout>
        );
    }

    return (
        <AdminDashboardLayout title={t('Usage')} subtitle={t('Explore filtered usage metrics and cost analytics.')}>
            <div className="space-y-6">
                <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark p-4 shadow-sm">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                        <div className="flex flex-wrap items-center gap-3">
                            <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-text-secondary">
                                    {t('Date Range')}
                                </label>
                                <select
                                    value={range}
                                    onChange={(e) => {
                                        setRange(e.target.value);
                                        if (e.target.value !== 'custom') {
                                            setStartDate('');
                                            setEndDate('');
                                        }
                                    }}
                                    className="rounded-lg border border-gray-200 dark:border-border-dark bg-gray-50 dark:bg-background-dark px-3 py-2 text-sm text-slate-900 dark:text-white"
                                >
                                    {rangeOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {t(option.labelKey)}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {range === 'custom' && (
                                <div className="flex flex-wrap items-end gap-3">
                                    <div>
                                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-text-secondary">
                                            {t('Start Date')}
                                        </label>
                                        <input
                                            type="date"
                                            value={startDate}
                                            onChange={(e) => setStartDate(e.target.value)}
                                            className="rounded-lg border border-gray-200 dark:border-border-dark bg-gray-50 dark:bg-background-dark px-3 py-2 text-sm text-slate-900 dark:text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-text-secondary">
                                            {t('End Date')}
                                        </label>
                                        <input
                                            type="date"
                                            value={endDate}
                                            onChange={(e) => setEndDate(e.target.value)}
                                            className="rounded-lg border border-gray-200 dark:border-border-dark bg-gray-50 dark:bg-background-dark px-3 py-2 text-sm text-slate-900 dark:text-white"
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="relative">
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-text-secondary">
                                    {t('Model')}
                                </label>
                                <button
                                    id="admin-usage-model-dropdown-btn"
                                    type="button"
                                    onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                                    className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-border-dark bg-gray-50 dark:bg-background-dark px-4 py-2 text-sm text-slate-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors whitespace-nowrap"
                                    style={modelBtnWidth ? { width: modelBtnWidth } : undefined}
                                >
                                    <span>{modelFilter || t('All Models')}</span>
                                    <Icon name="expand_more" size={18} />
                                </button>
                                {modelDropdownOpen && (
                                    <OptionDropdownMenu
                                        anchorId="admin-usage-model-dropdown-btn"
                                        allLabel={t('All Models')}
                                        options={availableModels}
                                        selectedValue={modelFilter}
                                        menuWidth={modelBtnWidth}
                                        onSelect={(value) => {
                                            setModelFilter(value);
                                            setModelDropdownOpen(false);
                                        }}
                                        onClose={() => setModelDropdownOpen(false)}
                                    />
                                )}
                            </div>

                            <div className="relative">
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-text-secondary">
                                    {t('Provider')}
                                </label>
                                <button
                                    id="admin-usage-provider-dropdown-btn"
                                    type="button"
                                    onClick={() => setProviderDropdownOpen(!providerDropdownOpen)}
                                    className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-border-dark bg-gray-50 dark:bg-background-dark px-4 py-2 text-sm text-slate-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors whitespace-nowrap"
                                    style={providerBtnWidth ? { width: providerBtnWidth } : undefined}
                                >
                                    <span>{providerFilter || t('All Providers')}</span>
                                    <Icon name="expand_more" size={18} />
                                </button>
                                {providerDropdownOpen && (
                                    <OptionDropdownMenu
                                        anchorId="admin-usage-provider-dropdown-btn"
                                        allLabel={t('All Providers')}
                                        options={availableProviders}
                                        selectedValue={providerFilter}
                                        menuWidth={providerBtnWidth}
                                        onSelect={(value) => {
                                            setProviderFilter(value);
                                            setProviderDropdownOpen(false);
                                        }}
                                        onClose={() => setProviderDropdownOpen(false)}
                                    />
                                )}
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                onClick={() => {
                                    setRange('last30d');
                                    setStartDate('');
                                    setEndDate('');
                                    setModelFilter('');
                                    setProviderFilter('');
                                }}
                                className="rounded-lg border border-gray-200 dark:border-border-dark bg-gray-50 dark:bg-background-dark px-4 py-2 text-sm text-slate-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            >
                                {t('Reset Filters')}
                            </button>
                            <button
                                type="button"
                                onClick={fetchData}
                                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 transition-colors"
                            >
                                <Icon name="refresh" size={18} />
                                {t('Refresh Data')}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
                    {statCards.map((card) => (
                        <div
                            key={card.label}
                            className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark p-5 shadow-sm"
                        >
                            <div className="mb-4 flex items-center justify-between">
                                <div className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${card.bgClass}`}>
                                    <Icon name={card.icon} size={20} className={card.iconColor} />
                                </div>
                            </div>
                            <div className="text-sm font-medium text-slate-500 dark:text-text-secondary">
                                {card.label}
                            </div>
                            <div className="mt-1 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                                {card.value}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
                    <div className="xl:col-span-3 bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark p-6 shadow-sm">
                        <div className="mb-6 flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                                    {t('Usage Trend')}
                                </h3>
                                <p className="text-sm text-slate-500 dark:text-text-secondary">
                                    {t('Requests and tokens across the selected range.')}
                                </p>
                            </div>
                            <div className="flex gap-3 text-xs text-slate-500 dark:text-text-secondary">
                                <span className="inline-flex items-center gap-1">
                                    <span className="size-2 rounded-full bg-primary" />
                                    {t('Requests')}
                                </span>
                                <span className="inline-flex items-center gap-1">
                                    <span className="size-2 rounded-full bg-purple-500" />
                                    {t('Tokens')}
                                </span>
                            </div>
                        </div>
                        {loading ? (
                            <div className="h-64 animate-pulse rounded-lg bg-slate-100 dark:bg-background-dark" />
                        ) : data?.trend.length ? (
                            <div className="h-64 flex items-end gap-2">
                                {data.trend.map((item) => (
                                    <div key={item.bucket} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                                        <div className="flex h-48 w-full items-end justify-center gap-1">
                                            <div
                                                className="w-1/3 rounded-t-sm bg-primary"
                                                style={{ height: `${Math.max((item.requests / trendMaxRequests) * 100, 5)}%` }}
                                            />
                                            <div
                                                className="w-1/3 rounded-t-sm bg-purple-500"
                                                style={{ height: `${Math.max((item.total_tokens / trendMaxTokens) * 100, 5)}%` }}
                                            />
                                        </div>
                                        <span className="max-w-full truncate text-xs font-medium text-slate-500 dark:text-text-secondary">
                                            {item.label}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="rounded-lg border border-dashed border-gray-200 dark:border-border-dark px-6 py-12 text-center text-sm text-slate-500 dark:text-text-secondary">
                                {t('No usage data found for the selected filters.')}
                            </div>
                        )}
                    </div>

                    <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark p-6 shadow-sm">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                            {t('Token Breakdown')}
                        </h3>
                        <div className="mt-4 space-y-3 text-sm text-slate-600 dark:text-text-secondary">
                            <div className="flex items-center justify-between">
                                <span>{t('Input Tokens')}</span>
                                <span className="font-mono text-slate-900 dark:text-white">
                                    {formatTokenCompact(data?.summary.input_tokens || 0)}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span>{t('Output Tokens')}</span>
                                <span className="font-mono text-slate-900 dark:text-white">
                                    {formatTokenCompact(data?.summary.output_tokens || 0)}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span>{t('Cached Tokens')}</span>
                                <span className="font-mono text-slate-900 dark:text-white">
                                    {formatTokenCompact(data?.summary.cached_tokens || 0)}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span>{t('Reasoning Tokens')}</span>
                                <span className="font-mono text-slate-900 dark:text-white">
                                    {formatTokenCompact(data?.summary.reasoning_tokens || 0)}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark p-6 shadow-sm">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                            {t('Top Models')}
                        </h3>
                        <div className="mt-4 space-y-4">
                            {(data?.top_models || []).map((item) => (
                                <div key={item.name}>
                                    <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                                        <span className="truncate font-medium text-slate-900 dark:text-white">{item.name}</span>
                                        <span className="shrink-0 font-mono text-slate-500 dark:text-text-secondary">{formatMoney(item.cost_micros)}</span>
                                    </div>
                                    <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-background-dark">
                                        <div
                                            className="h-2.5 rounded-full bg-primary"
                                            style={{ width: getBarWidth(item.cost_micros, topModelMaxCost) }}
                                        />
                                    </div>
                                    <div className="mt-1 flex items-center justify-between text-xs text-slate-500 dark:text-text-secondary">
                                        <span>{t('{{count}} requests', { count: item.requests })}</span>
                                        <span>{formatTokenCompact(item.total_tokens)} {t('Tokens')}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark p-6 shadow-sm">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                            {t('Top Providers')}
                        </h3>
                        <div className="mt-4 space-y-4">
                            {(data?.top_providers || []).map((item) => (
                                <div key={item.name}>
                                    <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                                        <span className="truncate font-medium text-slate-900 dark:text-white">{item.name}</span>
                                        <span className="shrink-0 font-mono text-slate-500 dark:text-text-secondary">{formatMoney(item.cost_micros)}</span>
                                    </div>
                                    <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-background-dark">
                                        <div
                                            className="h-2.5 rounded-full bg-emerald-500"
                                            style={{ width: getBarWidth(item.cost_micros, topProviderMaxCost) }}
                                        />
                                    </div>
                                    <div className="mt-1 flex items-center justify-between text-xs text-slate-500 dark:text-text-secondary">
                                        <span>{t('{{count}} requests', { count: item.requests })}</span>
                                        <span>{formatPercent(item.error_rate)} {t('Error Rate')}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark overflow-hidden shadow-sm">
                    <div className="flex items-center justify-between border-b border-gray-200 dark:border-border-dark px-6 py-4">
                        <div>
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                                {t('Recent Aggregates')}
                            </h3>
                            <p className="text-sm text-slate-500 dark:text-text-secondary">
                                {t('Latest filtered usage groups across the selected range.')}
                            </p>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-gray-50 dark:bg-surface-dark text-gray-500 dark:text-gray-400 uppercase text-xs font-semibold border-b border-gray-200 dark:border-border-dark">
                                <tr>
                                    <th className="px-6 py-4">{t('Date')}</th>
                                    <th className="px-6 py-4">{t('Model')}</th>
                                    <th className="px-6 py-4">{t('Provider')}</th>
                                    <th className="px-6 py-4">{t('Requests')}</th>
                                    <th className="px-6 py-4">{t('Total Tokens')}</th>
                                    <th className="px-6 py-4">{t('Cost')}</th>
                                    <th className="px-6 py-4">{t('Error Rate')}</th>
                                    <th className="px-6 py-4">{t('Avg. Request Time')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-border-dark">
                                {loading ? (
                                    [...Array(6)].map((_, index) => (
                                        <tr key={index}>
                                            <td colSpan={8} className="px-6 py-4">
                                                <div className="h-4 animate-pulse rounded bg-slate-200 dark:bg-border-dark" />
                                            </td>
                                        </tr>
                                    ))
                                ) : !(data?.recent.length) ? (
                                    <tr>
                                        <td colSpan={8} className="px-6 py-10 text-center text-slate-500 dark:text-text-secondary">
                                            {t('No usage data found for the selected filters.')}
                                        </td>
                                    </tr>
                                ) : (
                                    data.recent.map((item) => (
                                        <tr key={`${item.bucket}-${item.model}-${item.provider}`} className="hover:bg-gray-50 dark:hover:bg-background-dark transition-colors">
                                            <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary">
                                                {item.label}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-slate-900 dark:text-white">
                                                {item.model}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary">
                                                {item.provider || '—'}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap font-mono text-slate-600 dark:text-text-secondary">
                                                {formatNumber(item.requests)}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap font-mono text-slate-600 dark:text-text-secondary">
                                                {formatTokenCompact(item.total_tokens)}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap font-mono text-slate-600 dark:text-text-secondary">
                                                {formatMoney(item.cost_micros)}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap font-mono text-slate-600 dark:text-text-secondary">
                                                {formatPercent(item.error_rate)}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap font-mono text-slate-600 dark:text-text-secondary">
                                                {item.avg_request_time_ms}ms
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </AdminDashboardLayout>
    );
}
