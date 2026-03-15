import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AdminDashboardLayout } from '../../components/admin/AdminDashboardLayout';
import { AdminNoAccessCard } from '../../components/admin/AdminNoAccessCard';
import { Icon } from '../../components/Icon';
import { apiFetchAdmin } from '../../api/config';
import { buildAdminPermissionKey, useAdminPermissions } from '../../utils/adminPermissions';
import { useTranslation } from 'react-i18next';

interface ModelDropdownMenuProps {
    models: string[];
    modelFilter: string;
    menuWidth?: number;
    onSelect: (value: string) => void;
    onClose: () => void;
}

function ModelDropdownMenu({ models, modelFilter, menuWidth, onSelect, onClose }: ModelDropdownMenuProps) {
    const { t } = useTranslation();
    const menuRef = useRef<HTMLDivElement>(null);
    const btn = document.getElementById('admin-model-dropdown-btn');
    const rect = btn ? btn.getBoundingClientRect() : null;
    const position = rect
        ? { top: rect.bottom + 4, left: rect.left, width: rect.width }
        : { top: 0, left: 0, width: 0 };

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

interface ListResponse {
    logs: LogEntry[];
    total: number;
    page: number;
    limit: number;
}

interface ModelsResponse {
    models: string[];
}

interface LogDetail {
    requested_at: string;
    username: string;
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

export function AdminLogs() {
    const { t, i18n } = useTranslation();
    const { hasPermission } = useAdminPermissions();
    const locale = i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US';
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [stats, setStats] = useState<LogsStats | null>(null);
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

    const canListLogs = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/logs'));
    const canViewStats = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/logs/stats'));
    const canViewModels = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/logs/models'));
    const canViewDetail = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/logs/detail'));
    const hasAnyAccess = canListLogs || canViewStats;
    const shouldShowFilters = canListLogs;

    useEffect(() => {
        const allOptions = ['All Models', ...models];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
            let maxWidth = 0;
            for (const opt of allOptions) {
                const width = ctx.measureText(opt).width;
                if (width > maxWidth) maxWidth = width;
            }
            setModelBtnWidth(Math.ceil(maxWidth) + 96);
        }
    }, [models]);

    const fetchData = useCallback(async () => {
        if (!canListLogs && !canViewStats && !canViewModels) {
            setLogs([]);
            setTotal(0);
            setStats(null);
            setModels([]);
            setLoading(false);
            return;
        }
        if (canListLogs) {
            setLoading(true);
        }
        try {
            const params = new URLSearchParams();
            if (canListLogs) {
                params.set('page', page.toString());
                params.set('limit', limit.toString());
                if (startDate) params.set('start_date', startDate);
                if (endDate) params.set('end_date', endDate);
                if (modelFilter) params.set('model', modelFilter);
            }

            const [listRes, statsRes, modelsRes] = await Promise.all([
                canListLogs
                    ? apiFetchAdmin<ListResponse>(`/v0/admin/logs?${params.toString()}`)
                    : Promise.resolve<ListResponse | null>(null),
                canViewStats
                    ? apiFetchAdmin<LogsStats>('/v0/admin/logs/stats')
                    : Promise.resolve<LogsStats | null>(null),
                canViewModels
                    ? apiFetchAdmin<ModelsResponse>('/v0/admin/logs/models')
                    : Promise.resolve<ModelsResponse | null>(null),
            ]);

            if (listRes) {
                setLogs(normalizeLogs(listRes.logs || []));
                setTotal(listRes.total || 0);
            } else {
                setLogs([]);
                setTotal(0);
            }

            if (statsRes) {
                setStats(statsRes);
            } else {
                setStats(null);
            }

            if (modelsRes) {
                setModels(modelsRes.models || []);
            } else {
                setModels([]);
            }
        } catch (err) {
            console.error('Failed to fetch logs:', err);
        } finally {
            setLoading(false);
        }
    }, [
        page,
        limit,
        startDate,
        endDate,
        modelFilter,
        canListLogs,
        canViewStats,
        canViewModels,
    ]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const toDateKey = (entry: LogEntry) => {
        if (entry.date_raw) {
            return entry.date_raw;
        }
        const parsed = new Date(entry.date);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toISOString().slice(0, 10);
        }
        return '';
    };

    const formatDetailTime = (value: string) => {
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return value;
        return d.toLocaleString(locale);
    };

    const formatLogDate = (value: string) => {
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return value;
        return d.toLocaleDateString(locale);
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

    const handleOpenDetail = async (entry: LogEntry) => {
        if (!canViewDetail) return;
        const dateKey = toDateKey(entry);
        if (!dateKey) {
            console.error('Invalid date for detail view', entry.date);
            return;
        }
        setDetailModel(entry.model);
        setDetailDate(entry.date_raw || entry.date);
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
            if (entry.project) params.set('project', entry.project);
            const res = await apiFetchAdmin<DetailResponse>(`/v0/admin/logs/detail?${params.toString()}`);
            setDetailItems(res.details || []);
        } catch (err) {
            console.error('Failed to fetch log details:', err);
            setDetailError('Failed to load details. Please try again.');
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
            iconColor: 'text-orange-500',
            change: `${stats?.request_time_change && stats.request_time_change >= 0 ? '+' : ''}${(stats?.request_time_change ?? 0).toFixed(0)}%`,
            positive: (stats?.request_time_change ?? 0) >= 0,
        },
        {
            label: t('Error Rate'),
            value: stats?.error_rate_display ?? '0%',
            icon: 'error_outline',
            iconColor: 'text-red-500',
            change: `${stats?.error_rate_change && stats.error_rate_change >= 0 ? '+' : ''}${(stats?.error_rate_change ?? 0).toFixed(0)}%`,
            positive: (stats?.error_rate_change ?? 0) <= 0,
        },
    ];

    if (!hasAnyAccess) {
        return (
            <AdminDashboardLayout title={t('Logs')} subtitle={t('Monitor usage activity')}>
                <AdminNoAccessCard />
            </AdminDashboardLayout>
        );
    }

    return (
        <AdminDashboardLayout title={t('Logs')} subtitle={t('Monitor usage activity')}>
            <div className="space-y-6">
                {canViewStats && (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                        {statsCards.map((card) => (
                            <div
                                key={card.label}
                                className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark p-4 shadow-sm"
                            >
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm text-slate-500 dark:text-text-secondary">
                                            {card.label}
                                        </p>
                                        <p className="text-2xl font-bold text-slate-900 dark:text-white">
                                            {card.value}
                                        </p>
                                    </div>
                                    <div className={`h-10 w-10 inline-flex items-center justify-center rounded-lg bg-slate-100 dark:bg-background-dark ${card.iconColor}`}>
                                        <Icon name={card.icon} size={20} />
                                    </div>
                                </div>
                                <div className={`mt-3 text-sm ${card.positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                    {t('{{value}} vs last period', { value: card.change })}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {shouldShowFilters && (
                    <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark p-3 shadow-sm">
                        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
                            <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
                                <div className="flex items-center gap-2">
                                    <Icon name="event" size={18} className="text-slate-400" />
                                    <input
                                        type="date"
                                        value={startDate}
                                        onChange={(e) => setStartDate(e.target.value)}
                                        className="px-3 py-2 text-sm border border-gray-200 dark:border-border-dark rounded-lg bg-white dark:bg-background-dark text-slate-900 dark:text-white"
                                    />
                                    <span className="text-slate-400">{t('to')}</span>
                                    <input
                                        type="date"
                                        value={endDate}
                                        onChange={(e) => setEndDate(e.target.value)}
                                        className="px-3 py-2 text-sm border border-gray-200 dark:border-border-dark rounded-lg bg-white dark:bg-background-dark text-slate-900 dark:text-white"
                                    />
                                </div>
                                {canViewModels && (
                                    <div className="relative">
                                        <button
                                            id="admin-model-dropdown-btn"
                                            type="button"
                                            onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                                            className="flex items-center justify-between gap-2 px-4 py-2 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors whitespace-nowrap"
                                            style={modelBtnWidth ? { width: modelBtnWidth } : undefined}
                                        >
                                            <div className="flex items-center gap-2 min-w-0">
                                                <Icon name="filter_list" size={18} />
                                                <span className="whitespace-nowrap">{modelFilter || t('All Models')}</span>
                                            </div>
                                            <Icon name="expand_more" size={18} />
                                        </button>
                                        {modelDropdownOpen && (
                                            <ModelDropdownMenu
                                                models={models}
                                                modelFilter={modelFilter}
                                                menuWidth={modelBtnWidth}
                                                onSelect={(value) => {
                                                    setModelFilter(value);
                                                    setModelDropdownOpen(false);
                                                }}
                                                onClose={() => setModelDropdownOpen(false)}
                                            />
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {canListLogs && (
                    <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-gray-50 dark:bg-surface-dark text-gray-500 dark:text-gray-400 uppercase text-xs font-semibold border-b border-gray-200 dark:border-border-dark">
                                    <tr>
                                        <th className="px-6 py-4">{t('Date')}</th>
                                        <th className="px-6 py-4">{t('Model')}</th>
                                        <th className="px-6 py-4">{t('Provider')}</th>
                                        <th className="px-6 py-4">{t('Requests')}</th>
                                        <th className="px-6 py-4">{t('Input Tokens')}</th>
                                        <th className="px-6 py-4">{t('Output Tokens')}</th>
                                        <th className="px-6 py-4">{t('Total Tokens')}</th>
                                        <th className="px-6 py-4">{t('Cost')}</th>
                                        <th className="px-6 py-4">{t('Status')}</th>
                                        <th className="px-6 py-4 text-right">{t('Detail')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 dark:divide-border-dark">
                                    {loading ? (
                                        [...Array(6)].map((_, i) => (
                                            <tr key={i}>
                                                <td colSpan={10} className="px-6 py-4">
                                                    <div className="animate-pulse h-4 bg-slate-200 dark:bg-border-dark rounded" />
                                                </td>
                                            </tr>
                                        ))
                                    ) : logs.length === 0 ? (
                                        <tr>
                                            <td colSpan={10} className="px-6 py-8 text-center text-slate-500 dark:text-text-secondary">
                                                {t('No logs found')}
                                            </td>
                                        </tr>
                                    ) : (
                                        logs.map((log, index) => (
                                            <tr key={`${log.date}-${log.model}-${log.provider}-${index}`} className="hover:bg-gray-50 dark:hover:bg-background-dark transition-colors">
                                                <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary">
                                                    {formatLogDate(log.date_raw || log.date)}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${getModelStyle(log.model)}`}>
                                                        {log.model}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-slate-600 dark:text-text-secondary">
                                                    {log.provider}
                                                </td>
                                                <td className="px-6 py-4 text-slate-600 dark:text-text-secondary font-mono">
                                                    {formatNumber(log.requests)}
                                                </td>
                                                <td className="px-6 py-4 text-slate-600 dark:text-text-secondary font-mono">
                                                    {formatNumber(log.input_tokens)}
                                                </td>
                                                <td className="px-6 py-4 text-slate-600 dark:text-text-secondary font-mono">
                                                    {formatNumber(log.output_tokens)}
                                                </td>
                                                <td className="px-6 py-4 text-slate-600 dark:text-text-secondary font-mono">
                                                    {formatNumber(log.total_tokens)}
                                                </td>
                                                <td className="px-6 py-4 text-slate-600 dark:text-text-secondary font-mono">
                                                    {log.cost}
                                                </td>
                                                <td className="px-6 py-4 text-sm">
                                                    <div className={`flex items-center gap-2 ${getStatusStyle(log.status)}`}>
                                                        <Icon name={getStatusIcon(log.status)} size={16} />
                                                        <span>{formatStatusText(log)}</span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-sm text-right">
                                                    {canViewDetail ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleOpenDetail(log)}
                                                            className="text-primary hover:text-primary-dark font-medium"
                                                        >
                                                            {t('Details')}
                                                        </button>
                                                    ) : (
                                                        <span className="text-slate-400">-</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                        <div className="px-6 py-4 border-t border-gray-200 dark:border-border-dark flex items-center justify-between">
                            <div className="text-sm text-slate-500 dark:text-text-secondary">
                                {t('Page {{current}} of {{total}}', { current: page, total: totalPages })}
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                                    disabled={page === 1}
                                    className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 dark:border-border-dark bg-white dark:bg-surface-dark text-slate-700 dark:text-white hover:bg-slate-50 dark:hover:bg-border-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    {t('Previous')}
                                </button>
                                <button
                                    onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                                    disabled={page === totalPages}
                                    className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 dark:border-border-dark bg-white dark:bg-surface-dark text-slate-700 dark:text-white hover:bg-slate-50 dark:hover:bg-border-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    {t('Next')}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
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
                                    <p className="text-sm text-gray-500 dark:text-text-secondary">
                                        {formatLogDate(detailDate)}
                                    </p>
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
                                                    <th className="px-4 py-3 font-semibold">{t('Username')}</th>
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
                                                        <td className="px-4 py-3 text-slate-900 dark:text-white">
                                                            {item.username || t('N/A')}
                                                        </td>
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
                                        {t('Page {{current}} of {{total}}', {
                                            current: detailPage,
                                            total: Math.max(1, Math.ceil(detailItems.length / detailLimit)),
                                        })}
                                    </span>
                                    <div className="inline-flex gap-2">
                                        <button
                                            onClick={() => setDetailPage((p) => Math.max(1, p - 1))}
                                            disabled={detailPage <= 1}
                                            className="px-3 h-8 text-sm font-medium rounded-lg border border-gray-300 dark:border-border-dark bg-white dark:bg-background-dark text-gray-600 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {t('Previous')}
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
        </AdminDashboardLayout>
    );
}
