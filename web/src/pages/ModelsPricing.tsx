import { useCallback, useEffect, useRef, useState } from 'react';
import { DashboardLayout } from '../components/DashboardLayout';
import { Icon } from '../components/Icon';
import { apiFetch } from '../api/config';
import { useTranslation } from 'react-i18next';

interface ModelPricingItem {
    provider: string;
    model: string;
    display_name: string;
    original_model?: string;
    billing_type: number;
    rule_id?: number;
    price_per_request?: number | null;
    price_input_token?: number | null;
    price_output_token?: number | null;
    price_cache_create_token?: number | null;
    price_cache_read_token?: number | null;
}

interface PricingResponse {
    per_request: ModelPricingItem[];
    per_token: ModelPricingItem[];
    unpriced: ModelPricingItem[];
    only_mapped: boolean;
}

interface GroupedItem {
    model: string;
    display_name: string;
    original_model?: string;
    price_per_request?: string;
    price_input_token?: string;
    price_output_token?: string;
    price_cache_create_token?: string;
    price_cache_read_token?: string;
}

function formatDecimal(value: number): string {
    if (!Number.isFinite(value)) return '';
    let str = value.toString();
    if (/[eE]/.test(str)) {
        str = value.toFixed(12);
    }
    if (!str.includes('.')) {
        return `${str}.00`;
    }
    const [intPart, decPart] = str.split('.');
    if (decPart.length >= 2) {
        return `${intPart}.${decPart}`;
    }
    return `${intPart}.${decPart.padEnd(2, '0')}`;
}

function formatPrice(value?: number | null): string {
    if (value === null || value === undefined || Number.isNaN(value)) {
        return '';
    }
    return formatDecimal(value);
}

function formatCurrencyDisplay(value?: string): string {
    if (!value) return '';
    return value
        .split('/')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => `$${part}`)
        .join('/');
}

interface ToastState {
    show: boolean;
    message: string;
}

function CopyButton({ text, onCopied }: { text: string; onCopied: () => void }) {
    const { t } = useTranslation();
    const handleCopy = async () => {
        try {
            if (navigator?.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
            }
            onCopied();
        } catch (err) {
            // swallow copy errors silently
            console.error('copy failed', err);
        }
    };

    return (
        <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-gray-100 dark:bg-surface-dark text-slate-700 dark:text-white border border-gray-200 dark:border-border-dark hover:bg-gray-200 dark:hover:bg-background-dark transition-colors"
            aria-label={t('Copy model name')}
        >
            <Icon name="content_copy" size={14} />
            {t('Copy model name')}
        </button>
    );
}

function ModelCell({ item, onCopy }: { item: GroupedItem; onCopy: () => void }) {
    return (
        <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-slate-900 dark:text-white">{item.model}</span>
            <div className="flex items-center gap-2">
                <CopyButton text={item.model} onCopied={onCopy} />
            </div>
        </div>
    );
}

function PerRequestTable({ items, onCopy }: { items: GroupedItem[]; onCopy: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 dark:bg-surface-dark text-gray-500 dark:text-gray-400 uppercase text-xs font-semibold border-b border-gray-200 dark:border-border-dark">
                    <tr>
                        <th className="px-6 py-4">{t('Model')}</th>
                        <th className="px-6 py-4 text-right">{t('Price / request')}</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-border-dark">
                    {items.length ? (
                        items.map((item) => (
                            <tr key={item.model} className="hover:bg-gray-50 dark:hover:bg-background-dark transition-colors">
                                <td className="px-6 py-4">
                                    <ModelCell item={item} onCopy={onCopy} />
                                </td>
                                <td className="px-6 py-4 text-right font-mono text-xs text-slate-900 dark:text-white whitespace-nowrap">
                                    {item.price_per_request
                                        ? formatCurrencyDisplay(item.price_per_request)
                                        : t('Not configured')}
                                </td>
                            </tr>
                        ))
                    ) : (
                        <tr>
                            <td colSpan={2} className="px-6 py-8 text-center text-slate-500 dark:text-text-secondary">
                                {t('No per-request models available.')}
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}

function TokenTable({ items, onCopy }: { items: GroupedItem[]; onCopy: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 dark:bg-surface-dark text-gray-500 dark:text-gray-400 uppercase text-xs font-semibold border-b border-gray-200 dark:border-border-dark">
                    <tr>
                        <th className="px-6 py-4">{t('Model')}</th>
                        <th className="px-6 py-4 text-right">{t('Input Token')}</th>
                        <th className="px-6 py-4 text-right">{t('Output Token')}</th>
                        <th className="px-6 py-4 text-right">{t('Cache Create')}</th>
                        <th className="px-6 py-4 text-right">{t('Cache Read')}</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-border-dark">
                    {items.length ? (
                        items.map((item) => (
                            <tr key={item.model} className="hover:bg-gray-50 dark:hover:bg-background-dark transition-colors">
                                <td className="px-6 py-4">
                                    <ModelCell item={item} onCopy={onCopy} />
                                </td>
                                <td className="px-6 py-4 text-right font-mono text-xs text-slate-900 dark:text-white whitespace-nowrap">
                                    {item.price_input_token
                                        ? formatCurrencyDisplay(item.price_input_token)
                                        : t('Not configured')}
                                </td>
                                <td className="px-6 py-4 text-right font-mono text-xs text-slate-900 dark:text-white whitespace-nowrap">
                                    {item.price_output_token
                                        ? formatCurrencyDisplay(item.price_output_token)
                                        : t('Not configured')}
                                </td>
                                <td className="px-6 py-4 text-right font-mono text-xs text-slate-900 dark:text-white whitespace-nowrap">
                                    {item.price_cache_create_token
                                        ? formatCurrencyDisplay(item.price_cache_create_token)
                                        : t('Not configured')}
                                </td>
                                <td className="px-6 py-4 text-right font-mono text-xs text-slate-900 dark:text-white whitespace-nowrap">
                                    {item.price_cache_read_token
                                        ? formatCurrencyDisplay(item.price_cache_read_token)
                                        : t('Not configured')}
                                </td>
                            </tr>
                        ))
                    ) : (
                        <tr>
                            <td colSpan={5} className="px-6 py-8 text-center text-slate-500 dark:text-text-secondary">
                                {t('No per-token models available.')}
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}

function UnpricedList({ items, onCopy }: { items: ModelPricingItem[]; onCopy: () => void }) {
    const { t } = useTranslation();
    if (!items.length) return null;

    return (
        <div className="flex flex-col gap-3">
            {items.map((item) => (
                <div key={`${item.provider}-${item.model}`} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-surface-dark rounded-lg border border-dashed border-gray-200 dark:border-border-dark">
                    <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-semibold text-slate-900 dark:text-white">{item.model}</span>
                        <div className="flex items-center gap-2">
                            <CopyButton text={item.model} onCopied={onCopy} />
                        </div>
                    </div>
                    <span className="text-sm text-amber-600 dark:text-amber-400">{t('No billing rule')}</span>
                </div>
            ))}
        </div>
    );
}

export function ModelsPricing() {
    const { t } = useTranslation();
    const [data, setData] = useState<PricingResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [toast, setToast] = useState<ToastState>({ show: false, message: '' });
    const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showToast = useCallback((message: string) => {
        if (toastRef.current) {
            clearTimeout(toastRef.current);
        }
        setToast({ show: true, message });
        toastRef.current = setTimeout(() => {
            setToast({ show: false, message: '' });
        }, 3000);
    }, []);

    const groupItems = useCallback((items: ModelPricingItem[], isToken: boolean): GroupedItem[] => {
        const map = new Map<string, GroupedItem>();
        items.forEach((item) => {
            const key = item.model;
            const grouped = map.get(key) || {
                model: item.model,
                display_name: item.display_name,
                original_model: item.original_model,
            };

            if (isToken) {
                const append = (current?: string, next?: number | null) => {
                    const nextVal = formatPrice(next);
                    const parts = [...new Set([...(current ? current.split('/').filter(Boolean) : []), nextVal].filter(Boolean))];
                    return parts.join('/');
                };
                grouped.price_input_token = append(grouped.price_input_token, item.price_input_token);
                grouped.price_output_token = append(grouped.price_output_token, item.price_output_token);
                grouped.price_cache_create_token = append(
                    grouped.price_cache_create_token,
                    item.price_cache_create_token
                );
                grouped.price_cache_read_token = append(grouped.price_cache_read_token, item.price_cache_read_token);
            } else {
                const parts = [...new Set([...(grouped.price_per_request ? grouped.price_per_request.split('/').filter(Boolean) : []), formatPrice(item.price_per_request)].filter(Boolean))];
                grouped.price_per_request = parts.join('/');
            }
            map.set(key, grouped);
        });

        return Array.from(map.values()).sort((a, b) => a.model.localeCompare(b.model));
    }, []);

    const loadData = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const res = await apiFetch<PricingResponse>('/v0/front/models/pricing');
            setData(res);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('Failed to load model pricing'));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    useEffect(() => {
        return () => {
            if (toastRef.current) {
                clearTimeout(toastRef.current);
            }
        };
    }, []);

    return (
        <DashboardLayout
            title={t('Models')}
            subtitle={t('Available models and pricing based on current configuration')}
        >
            {error && (
                <div className="p-4 rounded-lg border border-red-200 bg-red-50 text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
                    {error}
                </div>
            )}

            {loading ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {[...Array(2)].map((_, idx) => (
                        <div key={idx} className="h-48 bg-gray-100 dark:bg-border-dark rounded-xl animate-pulse" />
                    ))}
                </div>
            ) : (
                <div className="flex flex-col gap-6">
                    <div className="flex flex-col gap-4">
                        <div>
                            <h2 className="text-[22px] font-bold leading-tight tracking-[-0.015em] text-slate-900 dark:text-white">
                                {t('Per-request pricing')}
                            </h2>
                            <p className="mt-1 text-sm text-slate-600 dark:text-text-secondary">
                                {t('Billed per API call.')}
                            </p>
                        </div>
                        <section className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-sm overflow-hidden">
                            <PerRequestTable
                                items={groupItems(data?.per_request || [], false)}
                                onCopy={() => showToast(t('Model name copied'))}
                            />
                        </section>
                    </div>

                    <div className="flex flex-col gap-4">
                        <div>
                            <h2 className="text-[22px] font-bold leading-tight tracking-[-0.015em] text-slate-900 dark:text-white">
                                {t('Per-token pricing')}
                            </h2>
                            <p className="mt-1 text-sm text-slate-600 dark:text-text-secondary">
                                {t('Token-based pricing for generation and cache.')}
                            </p>
                        </div>
                        <section className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-sm overflow-hidden">
                            <TokenTable
                                items={groupItems(data?.per_token || [], true)}
                                onCopy={() => showToast(t('Model name copied'))}
                            />
                        </section>
                    </div>

                    {data?.unpriced?.length ? (
                        <section className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-sm overflow-hidden">
                            <div className="bg-gray-50 dark:bg-surface-dark border-b border-gray-200 dark:border-border-dark">
                                <div className="flex items-center justify-between gap-4 px-6 py-4">
                                    <div className="min-w-0">
                                        <div className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                                            {t('Unpriced models')}
                                        </div>
                                        <div className="mt-1 text-sm font-normal text-slate-600 dark:text-text-secondary normal-case">
                                            {t('No billing rule matched. Configure a BillingRule to enable pricing.')}
                                        </div>
                                    </div>
                                    <div className="h-10 w-10 shrink-0 rounded-full bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center text-amber-600 dark:text-amber-200">
                                        <Icon name="warning" />
                                    </div>
                                </div>
                            </div>
                            <div className="p-6">
                                <UnpricedList items={data.unpriced} onCopy={() => showToast(t('Model name copied'))} />
                            </div>
                        </section>
                    ) : null}
                </div>
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
        </DashboardLayout>
    );
}
