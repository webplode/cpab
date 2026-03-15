import { useState, useEffect } from 'react';
import { apiFetch } from '../api/config';
import { useTranslation } from 'react-i18next';

interface CostItem {
    model: string;
    cost_micros: number;
    percentage: number;
}

interface CostData {
    items: CostItem[];
}

const colorClasses = [
    'bg-primary',
    'bg-purple-500',
    'bg-orange-500',
    'bg-slate-500',
    'bg-emerald-500',
    'bg-pink-500',
];

export function CostDistribution() {
    const { t } = useTranslation();
    const [items, setItems] = useState<CostItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        apiFetch<CostData>('/v0/front/dashboard/cost-distribution')
            .then((res) => setItems(res.items || []))
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    return (
        <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark p-6 shadow-sm flex-1 flex flex-col min-h-0">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">
                {t('Cost Distribution')}
            </h3>
            <div className="flex-1 min-h-0">
                {loading ? (
                    <div className="space-y-4">
                        {[...Array(3)].map((_, i) => (
                            <div key={i} className="animate-pulse">
                                <div className="h-4 bg-slate-200 dark:bg-border-dark rounded mb-2"></div>
                                <div className="h-2.5 bg-slate-100 dark:bg-background-dark rounded-full"></div>
                            </div>
                        ))}
                    </div>
                ) : items.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-text-secondary">
                        {t('No cost data available')}
                    </p>
                ) : (
                    <div className="flex flex-col gap-4 overflow-y-auto pr-2 h-full">
                        {items.map((item, index) => (
                            <div key={item.model} className="flex flex-col gap-1">
                                <div className="flex justify-between text-xs font-medium">
                                    <span className="text-slate-700 dark:text-white">
                                        {item.model}
                                    </span>
                                    <span className="text-slate-500 dark:text-text-secondary">
                                        ${(item.cost_micros / 1000000).toFixed(2)} ({item.percentage.toFixed(0)}%)
                                    </span>
                                </div>
                                <div className="w-full bg-slate-100 dark:bg-background-dark rounded-full h-2.5 overflow-hidden">
                                    <div
                                        className={`${colorClasses[index % colorClasses.length]} h-2.5 rounded-full`}
                                        style={{ width: `${item.percentage}%` }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
