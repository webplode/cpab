import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DashboardLayout } from '../components/DashboardLayout';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Icon } from '../components/Icon';
import { apiFetch } from '../api/config';
import { useTranslation } from 'react-i18next';

interface PlanItem {
    id: number;
    name: string;
    month_price: number;
    description: string;
    support_models?: unknown;
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

interface BillItem {
    id: number;
    plan_id: number;
    status: number;
    is_enabled: boolean;
    period_start: string;
    period_end: string;
}

interface PlansResponse {
    plans: PlanItem[];
}

interface BillsResponse {
    bills: BillItem[];
}

interface ConfirmDialogState {
    plan: PlanItem;
    message: string;
    confirmText: string;
}

interface ToastState {
    show: boolean;
    message: string;
}

function formatPrice(value: number): string {
    if (!Number.isFinite(value)) {
        return '0';
    }
    if (value % 1 === 0) {
        return value.toFixed(0);
    }
    return value.toFixed(2);
}

function formatQuota(value: number): string {
    if (!Number.isFinite(value)) {
        return '0';
    }
    return value.toLocaleString();
}

function buildPlanFeatures(
    plan: PlanItem,
    t: (key: string, options?: { [key: string]: unknown }) => string
): string[] {
    const features = [plan.feature1, plan.feature2, plan.feature3, plan.feature4]
        .map((item) => item?.trim())
        .filter((item): item is string => Boolean(item));
    const rateLimitValue = plan.rate_limit ?? 0;
    if (features.length > 0) {
        if (rateLimitValue > 0) {
            features.push(t('Rate limit (req/s): {{value}}', { value: rateLimitValue }));
        }
        return features;
    }

    const quotaFeatures: string[] = [];
    if (plan.total_quota > 0) {
        quotaFeatures.push(t('{{value}} Tokens / month', { value: formatQuota(plan.total_quota) }));
    }
    if (plan.daily_quota > 0) {
        quotaFeatures.push(t('{{value}} Tokens / day', { value: formatQuota(plan.daily_quota) }));
    }
    if (rateLimitValue > 0) {
        quotaFeatures.push(t('Rate limit (req/s): {{value}}', { value: rateLimitValue }));
    }
    return quotaFeatures;
}

export function Plan() {
    const { t } = useTranslation();
    const [plans, setPlans] = useState<PlanItem[]>([]);
    const [currentPlanCounts, setCurrentPlanCounts] = useState<Record<number, number>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [actionError, setActionError] = useState('');
    const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
    const [submittingPlanId, setSubmittingPlanId] = useState<number | null>(null);
    const [toast, setToast] = useState<ToastState>({ show: false, message: '' });
    const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const buildActivePlanCounts = useCallback((bills: BillItem[]) => {
        const counts: Record<number, number> = {};
        bills.forEach((bill) => {
            const planId = Number(bill.plan_id);
            if (!Number.isNaN(planId)) {
                counts[planId] = (counts[planId] ?? 0) + 1;
            }
        });
        return counts;
    }, []);

    const refreshActiveBills = useCallback(async () => {
        try {
            const billsRes = await apiFetch<BillsResponse>('/v0/front/bills?active=true');
            setCurrentPlanCounts(buildActivePlanCounts(billsRes.bills || []));
        } catch (err) {
            console.error(err);
            setActionError(t('Failed to refresh current plan.'));
        }
    }, [buildActivePlanCounts, t]);

    const showToast = useCallback((message: string) => {
        if (toastRef.current) {
            clearTimeout(toastRef.current);
        }
        setToast({ show: true, message });
        toastRef.current = setTimeout(() => {
            setToast({ show: false, message: '' });
        }, 3000);
    }, []);

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            setError('');
            try {
                const [plansRes, billsRes] = await Promise.all([
                    apiFetch<PlansResponse>('/v0/front/plans'),
                    apiFetch<BillsResponse>('/v0/front/bills?active=true'),
                ]);
                setPlans(plansRes.plans || []);
                setCurrentPlanCounts(buildActivePlanCounts(billsRes.bills || []));
            } catch (err) {
                console.error(err);
                setError(t('Failed to load plans.'));
            } finally {
                setLoading(false);
            }
        };

        load();
    }, [buildActivePlanCounts, t]);

    useEffect(() => {
        return () => {
            if (toastRef.current) {
                clearTimeout(toastRef.current);
            }
        };
    }, []);

    const handleSubscribe = async (plan: PlanItem) => {
        setActionError('');
        try {
            const billsRes = await apiFetch<BillsResponse>(`/v0/front/bills?plan_id=${plan.id}`);
            const hasHistory = (billsRes.bills || []).length > 0;
            const message = hasHistory
                ? t('You already purchased this plan. During overlapping periods, plan benefits stack but the original subscription period will not be extended. Do you want to continue?')
                : t('Do you want to purchase the {{plan}} plan for ${{price}}/mo?', {
                      plan: plan.name,
                      price: formatPrice(plan.month_price),
                  });
            setConfirmDialog({
                plan,
                message,
                confirmText: t('Confirm Purchase'),
            });
        } catch (err) {
            console.error(err);
            setActionError(t('Failed to check plan status.'));
        }
    };

    const handleConfirmPurchase = async () => {
        if (!confirmDialog || submittingPlanId !== null) {
            return;
        }
        setSubmittingPlanId(confirmDialog.plan.id);
        setActionError('');
        try {
            await apiFetch('/v0/front/bills', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ plan_id: confirmDialog.plan.id }),
            });
            await refreshActiveBills();
            showToast(t('Subscription successful.'));
            setConfirmDialog(null);
        } catch (err) {
            console.error(err);
            const message =
                err instanceof Error && err.message
                    ? err.message
                    : t('Failed to create subscription.');
            setActionError(message);
            setConfirmDialog(null);
        } finally {
            setSubmittingPlanId(null);
        }
    };

    return (
        <DashboardLayout title={t('Plans')} subtitle={t('Compare available plans.')}>
            {/* Available Plans */}
            <section className="flex flex-col gap-6 pt-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <h2 className="text-[22px] font-bold leading-tight tracking-[-0.015em] text-slate-900 dark:text-white">
                        {t('Available Plans')}
                    </h2>
                </div>

                {actionError && !error && (
                    <div className="rounded-xl border border-slate-200 dark:border-border-dark bg-white dark:bg-surface-dark p-4 text-sm text-slate-500 dark:text-slate-400">
                        {actionError}
                    </div>
                )}

                {loading ? (
                    <div className="flex flex-col gap-4">
                        {[...Array(3)].map((_, index) => (
                            <div
                                key={index}
                                className="rounded-xl border border-slate-200 dark:border-border-dark bg-white dark:bg-surface-dark p-6 shadow-sm animate-pulse"
                            >
                                <div className="h-6 w-40 bg-slate-200 dark:bg-slate-700 rounded" />
                                <div className="mt-4 h-4 w-56 bg-slate-200 dark:bg-slate-700 rounded" />
                                <div className="mt-4 h-4 w-72 bg-slate-200 dark:bg-slate-700 rounded" />
                            </div>
                        ))}
                    </div>
                ) : error ? (
                    <div className="rounded-xl border border-slate-200 dark:border-border-dark bg-white dark:bg-surface-dark p-6 text-sm text-slate-500 dark:text-slate-400">
                        {error}
                    </div>
                ) : (
                    <div className="flex flex-col gap-4">
                        {plans.map((plan) => {
                            const activeCount = currentPlanCounts[plan.id] ?? 0;
                            const isCurrent = activeCount > 0;
                            const features = buildPlanFeatures(plan, t);
                            const cardClass = isCurrent
                                ? 'relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-xl border-2 border-primary bg-white dark:bg-surface-dark p-6 shadow-md'
                                : 'flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-xl border border-slate-200 dark:border-border-dark bg-white dark:bg-surface-dark p-6 shadow-sm hover:border-slate-300 dark:hover:border-slate-600 transition-colors';
                            const detailClass = isCurrent
                                ? 'flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8 mt-2 sm:mt-0'
                                : 'flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8';
                            const iconClass = isCurrent ? 'text-primary' : 'text-slate-400';
                            const currentLabel =
                                activeCount > 1
                                    ? t('Current Plan x {{count}}', { count: activeCount })
                                    : t('Current Plan');
                            return (
                                <div key={plan.id} className={cardClass}>
                                    {isCurrent && (
                                        <div className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-0.5 text-xs font-bold text-white tracking-wider">
                                            {currentLabel}
                                        </div>
                                    )}
                                    <div className={detailClass}>
                                        <div className="min-w-[140px]">
                                            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                                                {plan.name}
                                            </h3>
                                            <div className="mt-1 flex items-baseline gap-1">
                                                <span className="text-2xl font-bold text-slate-900 dark:text-white">
                                                    ${formatPrice(plan.month_price)}
                                                </span>
                                                <span className="text-sm text-slate-500 dark:text-slate-400">{t('/mo')}</span>
                                            </div>
                                            {plan.description && (
                                                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                                    {plan.description}
                                                </p>
                                            )}
                                        </div>
                                        {features.length > 0 && (
                                            <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600 dark:text-slate-300">
                                                {features.map((feature) => (
                                                    <li key={feature} className="flex items-center gap-2">
                                                        <Icon name="check" size={18} className={iconClass} />
                                                        {feature}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => handleSubscribe(plan)}
                                        disabled={submittingPlanId === plan.id}
                                        className="w-full sm:w-auto rounded-lg bg-primary px-6 py-2.5 text-sm font-bold text-white hover:bg-blue-600 transition-colors shadow-lg shadow-primary/25 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {t('Subscribe')}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>
            {confirmDialog &&
                createPortal(
                    <ConfirmDialog
                        title={t('Confirm Subscription')}
                        message={confirmDialog.message}
                        confirmText={confirmDialog.confirmText}
                        onCancel={() => setConfirmDialog(null)}
                        onConfirm={handleConfirmPurchase}
                    />,
                    document.body
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
