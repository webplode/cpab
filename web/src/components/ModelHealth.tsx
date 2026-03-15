import { useState, useEffect } from 'react';
import { apiFetch } from '../api/config';
import { useTranslation } from 'react-i18next';

interface HealthItem {
    provider: string;
    status: 'healthy' | 'degraded';
    latency: string;
}

interface HealthData {
    items: HealthItem[];
}

export function ModelHealth() {
    const { t } = useTranslation();
    const [items, setItems] = useState<HealthItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        apiFetch<HealthData>('/v0/front/dashboard/model-health')
            .then((res) => setItems(res.items || []))
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    return (
        <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark p-6 shadow-sm">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-3">
                {t('Model Health')}
            </h3>
            {loading ? (
                <div className="space-y-3">
                    {[...Array(3)].map((_, i) => (
                        <div key={i} className="animate-pulse h-10 bg-slate-100 dark:bg-border-dark rounded-lg"></div>
                    ))}
                </div>
            ) : (
                <div className="space-y-3">
                    {items.map((item) => (
                        <div
                            key={item.provider}
                            className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-background-dark/50 transition-colors"
                        >
                            <div className="flex items-center gap-3">
                                <div
                                    className={`w-2 h-2 rounded-full ${
                                        item.status === 'healthy'
                                            ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
                                            : 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]'
                                    }`}
                                />
                                <span className="text-sm font-medium text-slate-700 dark:text-white">
                                    {item.provider}
                                </span>
                            </div>
                            <span
                                className={`text-xs font-mono ${
                                    item.status === 'healthy'
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : 'text-amber-600 dark:text-amber-400'
                                }`}
                            >
                                {item.latency}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
