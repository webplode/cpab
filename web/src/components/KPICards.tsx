import { useState, useEffect } from 'react';
import { Icon } from './Icon';
import { apiFetch } from '../api/config';
import { useTranslation } from 'react-i18next';

interface KPICardProps {
    icon: string;
    iconBgClass: string;
    iconTextClass: string;
    label: string;
    value: string;
    trend: string;
    trendType: 'up' | 'down' | 'flat';
}

function KPICard({
    icon,
    iconBgClass,
    iconTextClass,
    label,
    value,
    trend,
    trendType,
}: KPICardProps) {
    const trendIcon =
        trendType === 'up'
            ? 'trending_up'
            : trendType === 'down'
              ? 'trending_down'
              : 'trending_flat';

    const trendColorClass =
        trendType === 'down'
            ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10'
            : trendType === 'up'
              ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10'
              : 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10';

    return (
        <div className="bg-white dark:bg-surface-dark rounded-xl p-6 border border-gray-200 dark:border-border-dark shadow-sm hover:border-primary/50 transition-colors group">
            <div className="flex justify-between items-start mb-4">
                <div
                    className={`h-10 w-10 inline-flex items-center justify-center ${iconBgClass} rounded-lg group-hover:bg-opacity-80 transition-colors`}
                >
                    <Icon name={icon} size={24} className={iconTextClass} />
                </div>
                <span
                    className={`inline-flex items-center gap-1 text-xs font-medium ${trendColorClass} px-2 py-1 rounded-full`}
                >
                    <Icon name={trendIcon} size={14} />
                    {trend}
                </span>
            </div>
            <p className="text-sm text-slate-500 dark:text-text-secondary font-medium">
                {label}
            </p>
            <h3 className="text-3xl font-bold text-slate-900 dark:text-white mt-1 font-mono tracking-tight">
                {value}
            </h3>
        </div>
    );
}

interface KPIData {
    total_requests: number;
    requests_trend: number;
    avg_tokens: number;
    avg_tokens_trend: number;
    success_rate: number;
    success_rate_trend: number;
    mtd_cost_micros: number;
    cost_trend: number;
}

function formatNumber(num: number): string {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}

function formatTrend(trend: number): string {
    const sign = trend >= 0 ? '+' : '';
    return `${sign}${trend.toFixed(1)}%`;
}

function getTrendType(trend: number): 'up' | 'down' | 'flat' {
    if (trend > 0.1) return 'up';
    if (trend < -0.1) return 'down';
    return 'flat';
}

export function KPICards() {
    const { t } = useTranslation();
    const [data, setData] = useState<KPIData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        apiFetch<KPIData>('/v0/front/dashboard/kpi')
            .then(setData)
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="bg-white dark:bg-surface-dark rounded-xl p-6 border border-gray-200 dark:border-border-dark shadow-sm animate-pulse">
                        <div className="h-20"></div>
                    </div>
                ))}
            </div>
        );
    }

    const cards: KPICardProps[] = [
        {
            icon: 'data_usage',
            iconBgClass: 'bg-blue-50 dark:bg-blue-500/10',
            iconTextClass: 'text-primary',
            label: t('Total Requests'),
            value: formatNumber(data?.total_requests ?? 0),
            trend: formatTrend(data?.requests_trend ?? 0),
            trendType: getTrendType(data?.requests_trend ?? 0),
        },
        {
            icon: 'token',
            iconBgClass: 'bg-indigo-50 dark:bg-indigo-500/10',
            iconTextClass: 'text-indigo-500',
            label: t('Avg Tokens'),
            value: formatNumber(Math.round(data?.avg_tokens ?? 0)),
            trend: formatTrend(data?.avg_tokens_trend ?? 0),
            trendType: getTrendType(data?.avg_tokens_trend ?? 0),
        },
        {
            icon: 'check_circle',
            iconBgClass: 'bg-emerald-50 dark:bg-emerald-500/10',
            iconTextClass: 'text-emerald-500',
            label: t('Success Rate'),
            value: `${(data?.success_rate ?? 100).toFixed(2)}%`,
            trend: formatTrend(data?.success_rate_trend ?? 0),
            trendType: getTrendType(data?.success_rate_trend ?? 0),
        },
        {
            icon: 'attach_money',
            iconBgClass: 'bg-orange-50 dark:bg-orange-500/10',
            iconTextClass: 'text-orange-500',
            label: t('MTD Cost'),
            value: `$${((data?.mtd_cost_micros ?? 0) / 1000000).toFixed(2)}`,
            trend: formatTrend(data?.cost_trend ?? 0),
            trendType: getTrendType(-(data?.cost_trend ?? 0)),
        },
    ];

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {cards.map((card) => (
                <KPICard key={card.label} {...card} />
            ))}
        </div>
    );
}
