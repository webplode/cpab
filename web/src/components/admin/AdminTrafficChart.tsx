import { useState, useEffect } from 'react';
import { apiFetchAdmin } from '../../api/config';
import { useTranslation } from 'react-i18next';

interface TrafficPoint {
    time: string;
    requests: number;
    errors: number;
}

interface TrafficData {
    points: TrafficPoint[];
}

type ChartMode = 'vol' | 'err';

export function AdminTrafficChart() {
    const { t } = useTranslation();
    const [data, setData] = useState<TrafficPoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [mode, setMode] = useState<ChartMode>('vol');

    useEffect(() => {
        apiFetchAdmin<TrafficData>('/v0/admin/dashboard/traffic')
            .then((res) => setData(res.points || []))
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    const getValue = (p: TrafficPoint) => (mode === 'vol' ? p.requests : p.errors);
    const maxValue = Math.max(...data.map(getValue), 1);

    const generatePath = () => {
        if (data.length === 0) return '';
        const width = 1000;
        const height = 300;
        const padding = 20;

        const points = data.map((p, i) => {
            const x = (i / (data.length - 1)) * width;
            const y = height - padding - (getValue(p) / maxValue) * (height - 2 * padding);
            return `${x},${y}`;
        });

        return `M${points.join(' L')}`;
    };

    const generateAreaPath = () => {
        const linePath = generatePath();
        if (!linePath) return '';
        return `${linePath} L1000,300 L0,300 Z`;
    };

    const timeLabels = data.filter((_, i) => i % 4 === 0).map((p) => p.time);

    return (
        <div className="lg:col-span-2 bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                        {mode === 'vol' ? t('Traffic Volume') : t('Error Rate')}
                    </h3>
                    <p className="text-sm text-slate-500 dark:text-text-secondary">
                        {mode === 'vol'
                            ? t('Requests per hour over time')
                            : t('Errors per hour over time')}
                    </p>
                </div>
                <div className="flex items-center gap-2 text-sm bg-slate-50 dark:bg-background-dark/50 p-1 rounded-lg border border-gray-200 dark:border-border-dark">
                    <button
                        onClick={() => setMode('vol')}
                        className={`px-3 py-1 rounded-md font-medium ${
                            mode === 'vol'
                                ? 'bg-white dark:bg-surface-dark text-slate-900 dark:text-white shadow-sm'
                                : 'text-slate-500 dark:text-text-secondary hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        {t('Vol')}
                    </button>
                    <button
                        onClick={() => setMode('err')}
                        className={`px-3 py-1 rounded-md font-medium ${
                            mode === 'err'
                                ? 'bg-white dark:bg-surface-dark text-slate-900 dark:text-white shadow-sm'
                                : 'text-slate-500 dark:text-text-secondary hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        {t('Err')}
                    </button>
                </div>
            </div>

            <div className="relative w-full h-[250px] sm:h-[300px]">
                {loading ? (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                    </div>
                ) : (
                    <>
                        <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                            {[...Array(5)].map((_, i) => (
                                <div
                                    key={i}
                                    className="w-full h-px bg-slate-100 dark:bg-border-dark/50 border-dashed border-t border-slate-200 dark:border-border-dark"
                                />
                            ))}
                        </div>

                        <svg
                            className="absolute inset-0 w-full h-full"
                            viewBox="0 0 1000 300"
                            preserveAspectRatio="none"
                        >
                            <defs>
                                <linearGradient
                                    id="adminChartGradientVol"
                                    x1="0"
                                    y1="0"
                                    x2="0"
                                    y2="1"
                                >
                                    <stop
                                        offset="0%"
                                        stopColor="#135bec"
                                        stopOpacity="0.3"
                                    />
                                    <stop
                                        offset="100%"
                                        stopColor="#135bec"
                                        stopOpacity="0"
                                    />
                                </linearGradient>
                                <linearGradient
                                    id="adminChartGradientErr"
                                    x1="0"
                                    y1="0"
                                    x2="0"
                                    y2="1"
                                >
                                    <stop
                                        offset="0%"
                                        stopColor="#ef4444"
                                        stopOpacity="0.3"
                                    />
                                    <stop
                                        offset="100%"
                                        stopColor="#ef4444"
                                        stopOpacity="0"
                                    />
                                </linearGradient>
                            </defs>
                            <path
                                d={generateAreaPath()}
                                fill={mode === 'vol' ? 'url(#adminChartGradientVol)' : 'url(#adminChartGradientErr)'}
                            />
                            <path
                                d={generatePath()}
                                fill="none"
                                stroke={mode === 'vol' ? '#135bec' : '#ef4444'}
                                strokeWidth="3"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        </svg>
                    </>
                )}
            </div>

            <div className="flex justify-between mt-4 text-xs font-medium text-slate-400 dark:text-text-secondary font-mono">
                {timeLabels.length > 0 ? (
                    timeLabels.map((t, i) => <span key={i}>{t}</span>)
                ) : (
                    <>
                        <span>00:00</span>
                        <span>04:00</span>
                        <span>08:00</span>
                        <span>12:00</span>
                        <span>16:00</span>
                        <span>20:00</span>
                        <span>23:59</span>
                    </>
                )}
            </div>
        </div>
    );
}
