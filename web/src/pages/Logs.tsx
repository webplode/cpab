import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { DashboardLayout } from '../components/DashboardLayout';
import { Icon } from '../components/Icon';
import { apiFetch } from '../api/config';
import { useTranslation } from 'react-i18next';

interface ModelDropdownMenuProps {
    models: string[];
    modelFilter: string;
    menuWidth?: number;
    onSelect: (value: string) => void;
    onClose: () => void;
    t: (key: string) => string;
}

function ModelDropdownMenu({ models, modelFilter, menuWidth, onSelect, onClose, t }: ModelDropdownMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState(() => {
        const btn = document.getElementById('model-dropdown-btn');
        if (!btn) {
            return { top: 0, left: 0, width: 0 };
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
            const btn = document.getElementById('model-dropdown-btn');
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
    }, [menuWidth]);

    const options = [{ value: '', label: t('All Models') }, ...models.map((m) => ({ value: m, label: m }))];

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
                            modelFilter === opt.value
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

interface LogEntry {
    date: string;
    date_raw?: string;
    project?: string;
    model: string;
    provider: string;
    providers?: string[];
    requests: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cost: string;
    cost_micros?: number;
    failed_count?: number;
    status: 'normal' | 'warning' | 'error';
    status_text: string;
}

interface LogsStats {
    requests_today: number;
    requests_today_display: string;
    requests_change: number;
    tokens_consumed: number;
    tokens_consumed_display: string;
    tokens_change: number;
    avg_request_time_ms: number;
    request_time_change: number;
    error_rate: number;
    error_rate_display: string;
    error_rate_change: number;
}

interface TrendItem {
    day: string;
    date: string;
    requests: number;
    tokens: number;
    requests_raw?: number;
    tokens_raw?: number;
    active: boolean;
}

interface ListResponse {
    logs: LogEntry[];
    total: number;
    page: number;
    limit: number;
}

interface ModelsResponse {
    models: string[];
}

interface TrendResponse {
    trend: TrendItem[];
}

interface LogDetail {
    requested_at: string;
    input_tokens: number;
    output_tokens: number;
    cached_tokens: number;
    total_tokens: number;
    cost: string;
    success: boolean;
}

interface DetailResponse {
    details: LogDetail[];
}

function getModelStyle(model: string) {
    const lowerModel = model.toLowerCase();
    if (lowerModel.includes('gpt-4') || lowerModel.includes('gpt4')) {
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300';
    }
    if (lowerModel.includes('gpt-3') || lowerModel.includes('gpt3') || lowerModel.includes('turbo')) {
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
    }
    if (lowerModel.includes('claude')) {
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300';
    }
    if (lowerModel.includes('gemini')) {
        return 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-300';
    }
    return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
}

function getStatusStyle(status: string) {
    switch (status) {
        case 'normal':
            return 'text-emerald-600 dark:text-emerald-400';
        case 'warning':
            return 'text-amber-600 dark:text-amber-400';
        case 'error':
            return 'text-red-600 dark:text-red-400';
        default:
            return '';
    }
}

function getStatusIcon(status: string) {
    switch (status) {
        case 'normal':
            return 'check_circle';
        case 'warning':
            return 'warning';
        case 'error':
            return 'error';
        default:
            return 'check_circle';
    }
}

function formatNumber(num: number): string {
    return num.toLocaleString();
}

function normalizeLogs(entries: LogEntry[]): LogEntry[] {
    return (entries || []).map((entry) => {
        const providers = entry.provider
            ? entry.provider
                  .split(',')
                  .map((p) => p.trim())
                  .filter(Boolean)
            : [];
        return {
            ...entry,
            providers,
            provider: providers.join(', '),
        };
    });
}

export function Logs() {
    const { t, i18n } = useTranslation();
    const locale = i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US';
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [stats, setStats] = useState<LogsStats | null>(null);
    const [trend, setTrend] = useState<TrendItem[]>([]);
    const [models, setModels] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [limit] = useState(20);
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [modelFilter, setModelFilter] = useState('');
    const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
    const [modelBtnWidth, setModelBtnWidth] = useState<number | undefined>(undefined);

    const [detailModalOpen, setDetailModalOpen] = useState(false);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailItems, setDetailItems] = useState<LogDetail[]>([]);
    const [detailPage, setDetailPage] = useState(1);
    const detailLimit = 10;
    const [detailModel, setDetailModel] = useState('');
    const [detailDate, setDetailDate] = useState('');
    const [detailError, setDetailError] = useState('');

    useEffect(() => {
        const allOptions = [t('All Models'), ...models];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
            let maxWidth = 0;
            for (const opt of allOptions) {
                const width = ctx.measureText(opt).width;
                if (width > maxWidth) maxWidth = width;
            }
            // 32px for menu item padding (px-4 * 2), 20px for button padding, 24px for icon + gap
            setModelBtnWidth(Math.ceil(maxWidth) + 76);
        }
    }, [models, t]);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            params.set('page', page.toString());
            params.set('limit', limit.toString());
            if (startDate) params.set('start_date', startDate);
            if (endDate) params.set('end_date', endDate);
            if (modelFilter) params.set('model', modelFilter);

            const [listRes, statsRes, trendRes, modelsRes] = await Promise.all([
                apiFetch<ListResponse>(`/v0/front/logs?${params}`),
                apiFetch<LogsStats>('/v0/front/logs/stats'),
                apiFetch<TrendResponse>('/v0/front/logs/trend'),
                apiFetch<ModelsResponse>('/v0/front/logs/models'),
            ]);

            setLogs(normalizeLogs(listRes.logs || []));
            setTotal(listRes.total);
            setStats(statsRes);
            setTrend(trendRes.trend);
            setModels(modelsRes.models);
        } catch (err) {
            console.error('Failed to fetch logs:', err);
        } finally {
            setLoading(false);
        }
    }, [page, limit, startDate, endDate, modelFilter]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const toDateKey = (entry: LogEntry) => {
        if (entry.date_raw) return entry.date_raw;
        const parsed = new Date(entry.date);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toISOString().slice(0, 10);
        }
        return '';
    };

    const handleOpenDetail = async (entry: LogEntry) => {
        const dateKey = toDateKey(entry);
        if (!dateKey) {
            console.error('Invalid date for detail view', entry.date);
            return;
        }
        setDetailModel(entry.model);
        setDetailDate(entry.date);
        setDetailItems([]);
        setDetailPage(1);
        setDetailError('');
        setDetailModalOpen(true);
        setDetailLoading(true);
        try {
            const params = new URLSearchParams();
            params.set('date', dateKey);
            params.set('model', entry.model);
            const providerParam =
                entry.providers && entry.providers.length === 1
                    ? entry.providers[0]
                    : entry.provider && entry.provider.includes(',')
                        ? ''
                        : entry.provider;
            if (providerParam) params.set('provider', providerParam);
            const res = await apiFetch<DetailResponse>(`/v0/front/logs/detail?${params.toString()}`);
            setDetailItems(res.details);
        } catch (err) {
            console.error('Failed to fetch log details:', err);
            setDetailError(t('Failed to load details. Please try again.'));
        } finally {
            setDetailLoading(false);
        }
    };

    const handleCloseDetail = () => {
        setDetailModalOpen(false);
        setDetailItems([]);
        setDetailPage(1);
        setDetailError('');
    };

    const formatDetailTime = (value: string) => {
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return value;
        return d.toLocaleString(locale);
    };

    const formatStatusText = (entry: LogEntry) => {
        if (entry.status === 'normal') {
            return t('Normal');
        }
        const match = entry.status_text.match(/^([0-9.]+)%\s*Errors$/i);
        if (match) {
            return `${match[1]}% ${t('Errors')}`;
        }
        if (entry.failed_count && entry.requests) {
            const rate = (entry.failed_count / entry.requests) * 100;
            return `${rate.toFixed(1)}% ${t('Errors')}`;
        }
        return entry.status_text;
    };

    const totalPages = Math.ceil(total / limit);

    const statsCards = [
        {
            label: t('Requests Today'),
            value: stats?.requests_today_display ?? '0',
            icon: 'api',
            iconColor: 'text-blue-500',
            change: `${stats?.requests_change && stats.requests_change >= 0 ? '+' : ''}${(stats?.requests_change ?? 0).toFixed(0)}%`,
            positive: (stats?.requests_change ?? 0) >= 0,
        },
        {
            label: t('Tokens Consumed'),
            value: stats?.tokens_consumed_display ?? '0',
            icon: 'data_usage',
            iconColor: 'text-purple-500',
            change: `${stats?.tokens_change && stats.tokens_change >= 0 ? '+' : ''}${(stats?.tokens_change ?? 0).toFixed(0)}%`,
            positive: (stats?.tokens_change ?? 0) >= 0,
        },
        {
            label: t('Avg. Request Time'),
            value: `${stats?.avg_request_time_ms ?? 0}ms`,
            icon: 'timer',
            iconColor: 'text-amber-500',
            change: `${stats?.request_time_change && stats.request_time_change >= 0 ? '+' : ''}${(stats?.request_time_change ?? 0).toFixed(0)}%`,
            positive: (stats?.request_time_change ?? 0) <= 0,
        },
        {
            label: t('Error Rate (24h)'),
            value: stats?.error_rate_display ?? '0%',
            icon: 'error_outline',
            iconColor: 'text-red-500',
            change: `${stats?.error_rate_change && stats.error_rate_change >= 0 ? '+' : ''}${(stats?.error_rate_change ?? 0).toFixed(2)}%`,
            positive: (stats?.error_rate_change ?? 0) <= 0,
        },
    ];

    return (
        <DashboardLayout
            title={t('Daily Usage Logs')}
            subtitle={t('View daily token consumption, request counts, and cost estimates across all your projects.')}
        >
            {/* Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {statsCards.map((stat) => (
                    <div
                        key={stat.label}
                        className="flex flex-col gap-2 rounded-xl p-5 bg-white dark:bg-surface-dark border border-gray-200 dark:border-border-dark shadow-sm"
                    >
                        <div className="flex justify-between items-start">
                            <p className="text-gray-500 dark:text-text-secondary text-sm font-medium">
                                {stat.label}
                            </p>
                            <Icon name={stat.icon} size={20} className={stat.iconColor} />
                        </div>
                        <div className="flex items-end gap-2">
                            <p className="text-slate-900 dark:text-white text-2xl font-bold leading-tight">
                                {stat.value}
                            </p>
                            <span
                                className={`text-xs font-medium mb-1 flex items-center ${
                                    stat.positive ? 'text-emerald-500' : 'text-red-400'
                                }`}
                            >
                                <Icon
                                    name={stat.positive ? 'arrow_upward' : 'arrow_downward'}
                                    size={14}
                                />
                                {stat.change}
                            </span>
                        </div>
                    </div>
                ))}
            </div>

            {/* Usage Trend Chart */}
            <div className="w-full bg-white dark:bg-surface-dark p-6 rounded-xl border border-gray-200 dark:border-border-dark shadow-sm">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-slate-900 dark:text-white text-lg font-bold">
                        {t('Usage Trend (Last 7 Days)')}
                    </h3>
                    <div className="flex gap-2">
                        <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                            <span className="size-2 rounded-full bg-primary" /> {t('Requests')}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                            <span className="size-2 rounded-full bg-purple-500" /> {t('Tokens (x1000)')}
                        </span>
                    </div>
                </div>
                <div className="h-48 flex items-end justify-between gap-2 md:gap-4 w-full">
                    {trend.map((item) => (
                        <div
                            key={item.date}
                            className="flex flex-col items-center flex-1 gap-2 group cursor-pointer"
                        >
                            <div className="w-full flex gap-1 h-32 items-end justify-center">
                                <div
                                    className={`w-1/3 rounded-t-sm transition-all ${
                                        item.active
                                            ? 'bg-primary shadow-[0_0_15px_-3px_var(--color-primary)]'
                                            : 'bg-primary/20 dark:bg-primary/30 group-hover:bg-primary/40'
                                    }`}
                                    style={{ height: `${Math.max(item.requests, 5)}%` }}
                                />
                                <div
                                    className={`w-1/3 rounded-t-sm transition-all ${
                                        item.active
                                            ? 'bg-purple-500 shadow-[0_0_15px_-3px_rgba(168,85,247,1)]'
                                            : 'bg-purple-500/20 dark:bg-purple-500/30 group-hover:bg-purple-500/40'
                                    }`}
                                    style={{ height: `${Math.max(item.tokens, 5)}%` }}
                                />
                            </div>
                            <span
                                className={`text-xs font-mono ${
                                    item.active ? 'font-bold text-white' : 'text-gray-400'
                                }`}
                            >
                                {item.day}
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-white dark:bg-surface-dark p-3 rounded-xl border border-gray-200 dark:border-border-dark shadow-sm">
                <div className="flex gap-2 w-full md:w-auto">
                    <input
                        type="date"
                        value={startDate}
                        onChange={(e) => {
                            setStartDate(e.target.value);
                            setPage(1);
                        }}
                        className="p-2.5 text-sm text-slate-900 dark:text-white bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark rounded-lg focus:ring-primary focus:border-primary"
                    />
                    <span className="flex items-center text-gray-400">-</span>
                    <input
                        type="date"
                        value={endDate}
                        onChange={(e) => {
                            setEndDate(e.target.value);
                            setPage(1);
                        }}
                        className="p-2.5 text-sm text-slate-900 dark:text-white bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark rounded-lg focus:ring-primary focus:border-primary"
                    />
                </div>
                <div className="flex gap-2 w-full md:w-auto pb-1 md:pb-0">
                    <div className="relative">
                        <button
                            type="button"
                            id="model-dropdown-btn"
                            onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                            className="flex items-center justify-between gap-2 bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark text-slate-900 dark:text-white text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5 whitespace-nowrap"
                            style={modelBtnWidth ? { width: modelBtnWidth } : undefined}
                        >
                            <span>
                                {modelFilter || t('All Models')}
                            </span>
                            <Icon name={modelDropdownOpen ? 'expand_less' : 'expand_more'} size={18} />
                        </button>
                        {modelDropdownOpen && (
                            <ModelDropdownMenu
                                models={models}
                                modelFilter={modelFilter}
                                menuWidth={modelBtnWidth}
                                onSelect={(value) => {
                                    setModelFilter(value);
                                    setPage(1);
                                    setModelDropdownOpen(false);
                                }}
                                onClose={() => setModelDropdownOpen(false)}
                                t={t}
                            />
                        )}
                    </div>
                    <button
                        onClick={fetchData}
                        className="text-gray-500 dark:text-text-secondary hover:bg-gray-100 dark:hover:bg-background-dark p-2.5 rounded-lg border border-transparent hover:border-gray-200 dark:hover:border-border-dark transition-colors"
                        title={t('Refresh Data')}
                    >
                        <Icon name="refresh" size={20} />
                    </button>
                </div>
            </div>

            {/* Logs Table */}
            <div className="relative overflow-x-auto rounded-xl border border-gray-200 dark:border-border-dark shadow-sm">
                <table className="w-full text-sm text-left text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    <thead className="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-surface-dark dark:text-gray-400 border-b border-gray-200 dark:border-border-dark">
                        <tr>
                            <th className="px-6 py-4 font-semibold tracking-wider whitespace-nowrap">{t('Date')}</th>
                            <th className="px-6 py-4 font-semibold tracking-wider whitespace-nowrap">{t('Model')}</th>
                            <th className="px-6 py-4 font-semibold tracking-wider text-right whitespace-nowrap">{t('Requests')}</th>
                            <th className="px-6 py-4 font-semibold tracking-wider text-right whitespace-nowrap">{t('Input Tokens')}</th>
                            <th className="px-6 py-4 font-semibold tracking-wider text-right whitespace-nowrap">{t('Output Tokens')}</th>
                            <th className="px-6 py-4 font-semibold tracking-wider text-right whitespace-nowrap">{t('Total Cost ($)')}</th>
                            <th className="px-6 py-4 font-semibold tracking-wider text-right whitespace-nowrap">{t('Status')}</th>
                            <th className="px-6 py-4 font-semibold tracking-wider text-right whitespace-nowrap">{t('Details')}</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-background-dark divide-y divide-gray-200 dark:divide-border-dark">
                        {loading ? (
                            <tr>
                                <td colSpan={8} className="px-6 py-12 text-center">
                                    {t('Loading...')}
                                </td>
                            </tr>
                        ) : logs.length === 0 ? (
                            <tr>
                                <td colSpan={8} className="px-6 py-12 text-center">
                                    {t('No logs found')}
                                </td>
                            </tr>
                        ) : (
                            logs.map((entry, index) => (
                                <tr
                                    key={`${entry.date}-${entry.model}-${index}`}
                                    className="hover:bg-gray-50 dark:hover:bg-surface-dark/50 transition-colors"
                                >
                                    <td className="px-6 py-4 font-mono text-xs whitespace-nowrap">{entry.date}</td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <span
                                            className={`text-xs font-medium px-2.5 py-0.5 rounded ${getModelStyle(entry.model)}`}
                                        >
                                            {entry.model}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-right font-mono text-slate-900 dark:text-white whitespace-nowrap">
                                        {formatNumber(entry.requests)}
                                    </td>
                                    <td className="px-6 py-4 text-right font-mono whitespace-nowrap">
                                        {formatNumber(entry.input_tokens)}
                                    </td>
                                    <td className="px-6 py-4 text-right font-mono whitespace-nowrap">
                                        {formatNumber(entry.output_tokens)}
                                    </td>
                                    <td className="px-6 py-4 text-right font-bold text-slate-900 dark:text-white whitespace-nowrap">
                                        {entry.cost}
                                    </td>
                                    <td className="px-6 py-4 text-right whitespace-nowrap">
                                        <span
                                            className={`inline-flex items-center gap-1 text-xs ${getStatusStyle(entry.status)}`}
                                        >
                                            <Icon name={getStatusIcon(entry.status)} size={14} />
                                            {formatStatusText(entry)}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-right whitespace-nowrap">
                                        <button
                                            onClick={() => handleOpenDetail(entry)}
                                            className="text-primary hover:text-primary-dark text-xs font-medium"
                                        >
                                            {t('Details')}
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>

                {/* Pagination */}
                <div className="flex items-center justify-between p-4 border-t border-gray-200 dark:border-border-dark bg-gray-50 dark:bg-surface-dark rounded-b-xl">
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                        {t('Showing')}{' '}
                        <span className="font-semibold text-slate-900 dark:text-white">
                            {total > 0 ? (page - 1) * limit + 1 : 0}-{Math.min(page * limit, total)}
                        </span>{' '}
                        {t('of')}{' '}
                        <span className="font-semibold text-slate-900 dark:text-white">{total}</span> {t('results')}
                    </span>
                    <div className="inline-flex mt-2 xs:mt-0 gap-2">
                        <button
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            disabled={page <= 1}
                            className="flex items-center justify-center px-3 h-8 text-sm font-medium text-gray-500 bg-white dark:bg-background-dark border border-gray-300 dark:border-border-dark rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {t('Prev')}
                        </button>
                        <button
                            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                            disabled={page >= totalPages}
                            className="flex items-center justify-center px-3 h-8 text-sm font-medium text-gray-500 bg-white dark:bg-background-dark border border-gray-300 dark:border-border-dark rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {t('Next')}
                        </button>
                    </div>
                </div>
            </div>

            {detailModalOpen &&
                createPortal(
                    <div className="fixed inset-0 z-50 flex items-center justify-center">
                        <div
                            className="absolute inset-0 bg-black/50"
                            onClick={handleCloseDetail}
                            role="presentation"
                        />
                        <div className="relative bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-2xl w-full max-w-5xl mx-4 max-h-[90vh] flex flex-col overflow-hidden">
                            <div className="flex items-start justify-between px-6 py-4 border-b border-gray-200 dark:border-border-dark shrink-0">
                                <div className="space-y-1">
                                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                                        {detailModel || t('Details')}
                                    </h2>
                                    <p className="text-sm text-gray-500 dark:text-text-secondary">{detailDate}</p>
                                </div>
                                <button
                                    onClick={handleCloseDetail}
                                    className="inline-flex h-8 w-8 items-center justify-center text-gray-500 hover:text-slate-900 dark:hover:text-white rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                >
                                    <Icon name="close" size={20} />
                                </button>
                            </div>
                            <div className="p-6 flex-1 overflow-y-auto">
                                {detailLoading ? (
                                    <div className="text-center text-gray-500 dark:text-text-secondary">{t('Loading...')}</div>
                                ) : detailError ? (
                                    <div className="text-center text-red-500 text-sm">{detailError}</div>
                                ) : detailItems.length === 0 ? (
                                    <div className="text-center text-gray-500 dark:text-text-secondary text-sm">
                                        {t('No records found for this date.')}
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm text-left text-gray-600 dark:text-gray-300 whitespace-nowrap">
                                            <thead className="bg-gray-50 dark:bg-background-dark text-xs uppercase text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-border-dark">
                                                <tr>
                                                    <th className="px-4 py-3 font-semibold">{t('Time')}</th>
                                                    <th className="px-4 py-3 font-semibold text-right">{t('Input Tokens')}</th>
                                                    <th className="px-4 py-3 font-semibold text-right">{t('Output Tokens')}</th>
                                                    <th className="px-4 py-3 font-semibold text-right">{t('Cached Tokens')}</th>
                                                    <th className="px-4 py-3 font-semibold text-right">{t('Total Tokens')}</th>
                                                    <th className="px-4 py-3 font-semibold text-right">{t('Price')}</th>
                                                    <th className="px-4 py-3 font-semibold text-right">{t('Success')}</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-200 dark:divide-border-dark">
                                                {detailItems
                                                    .slice((detailPage - 1) * detailLimit, detailPage * detailLimit)
                                                    .map((item, idx) => (
                                                    <tr key={`${item.requested_at}-${idx}`}>
                                                        <td className="px-4 py-3 font-mono text-xs text-slate-900 dark:text-white">
                                                            {formatDetailTime(item.requested_at)}
                                                        </td>
                                                        <td className="px-4 py-3 text-right font-mono">
                                                            {formatNumber(item.input_tokens)}
                                                        </td>
                                                        <td className="px-4 py-3 text-right font-mono">
                                                            {formatNumber(item.output_tokens)}
                                                        </td>
                                                        <td className="px-4 py-3 text-right font-mono">
                                                            {formatNumber(item.cached_tokens)}
                                                        </td>
                                                        <td className="px-4 py-3 text-right font-mono">
                                                            {formatNumber(item.total_tokens)}
                                                        </td>
                                                        <td className="px-4 py-3 text-right font-mono text-slate-900 dark:text-white">
                                                            {item.cost}
                                                        </td>
                                                        <td className="px-4 py-3 text-right">
                                                            <span
                                                                className={`inline-flex items-center gap-1 text-xs font-medium ${
                                                                    item.success
                                                                        ? 'text-emerald-600 dark:text-emerald-400'
                                                                        : 'text-red-600 dark:text-red-400'
                                                                }`}
                                                            >
                                                                <Icon
                                                                    name={item.success ? 'check_circle' : 'error'}
                                                                    size={16}
                                                                />
                                                                {item.success ? t('Yes') : t('No')}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                            {!detailLoading && !detailError && detailItems.length > 0 && (
                                <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-border-dark bg-gray-50 dark:bg-background-dark shrink-0">
                                    <span className="text-sm text-gray-500 dark:text-gray-400">
                                        {t('Page')} {detailPage} {t('of')} {Math.max(1, Math.ceil(detailItems.length / detailLimit))}
                                    </span>
                                    <div className="inline-flex gap-2">
                                        <button
                                            onClick={() => setDetailPage((p) => Math.max(1, p - 1))}
                                            disabled={detailPage <= 1}
                                            className="px-3 h-8 text-sm font-medium rounded-lg border border-gray-300 dark:border-border-dark bg-white dark:bg-background-dark text-gray-600 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {t('Prev')}
                                        </button>
                                        <button
                                            onClick={() =>
                                                setDetailPage((p) =>
                                                    Math.min(Math.max(1, Math.ceil(detailItems.length / detailLimit)), p + 1)
                                                )
                                            }
                                            disabled={detailPage >= Math.max(1, Math.ceil(detailItems.length / detailLimit))}
                                            className="px-3 h-8 text-sm font-medium rounded-lg border border-gray-300 dark:border-border-dark bg-white dark:bg-background-dark text-gray-600 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {t('Next')}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>,
                    document.body
                )}
        </DashboardLayout>
    );
}
