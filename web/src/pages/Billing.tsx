import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { DashboardLayout } from '../components/DashboardLayout';
import { Icon } from '../components/Icon';
import { apiFetch } from '../api/config';
import { useTranslation } from 'react-i18next';

interface Bill {
    id: number;
    amount: number;
    status: number;
    rate_limit: number;
    created_at: string;
}

interface ActiveBill {
    id: number;
    plan_id: number;
    amount?: number;
    created_at?: string;
    period_start?: string;
    period_end?: string;
    total_quota?: number;
    used_quota?: number;
    left_quota?: number;
    rate_limit?: number;
}

interface PlanItem {
    id: number;
    name: string;
    month_price: number;
    sort_order: number;
    rate_limit: number;
}

interface PrepaidCard {
    id: number;
    name: string;
    card_sn: string;
    amount: number;
    balance: number;
    valid_days: number;
    expires_at: string | null;
    redeemed_at: string | null;
}

interface PrepaidCardResponse {
    card: PrepaidCard | null;
}

interface PrepaidCardsResponse {
    cards: PrepaidCard[];
}

interface PlansResponse {
    plans: PlanItem[];
}

interface BillsResponse {
    bills: Bill[];
}

interface ActiveBillsResponse {
    bills: ActiveBill[];
}

type BillStatus = 'paid' | 'refunded' | 'pending' | 'refund requested';

const BILL_PAGE_SIZE = 10;
const RECENT_BILL_COUNT = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

function formatPrice(value: number): string {
    if (!Number.isFinite(value)) {
        return '0.00';
    }
    return value.toFixed(2);
}

function mapBillStatus(status: number): BillStatus {
    switch (status) {
        case 2:
            return 'paid';
        case 3:
            return 'refund requested';
        case 4:
            return 'refunded';
        default:
            return 'pending';
    }
}

function getStatusStyle(status: BillStatus) {
    switch (status) {
        case 'paid':
            return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400';
        case 'refund requested':
        case 'refunded':
            return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400';
        case 'pending':
            return 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400';
        default:
            return '';
    }
}

export function Billing() {
    const { t, i18n } = useTranslation();
    const locale = i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US';
    const [cards, setCards] = useState<PrepaidCard[]>([]);
    const [cardLoading, setCardLoading] = useState(false);
    const [cardError, setCardError] = useState('');
    const [availableBalance, setAvailableBalance] = useState(0);
    const [redeemOpen, setRedeemOpen] = useState(false);
    const [redeemSubmitting, setRedeemSubmitting] = useState(false);
    const [cardSN, setCardSN] = useState('');
    const [password, setPassword] = useState('');
    const [redeemMessage, setRedeemMessage] = useState('');
    const [bills, setBills] = useState<Bill[]>([]);
    const [billLoading, setBillLoading] = useState(false);
    const [billError, setBillError] = useState('');
    const [transactionsOpen, setTransactionsOpen] = useState(false);
    const [billPage, setBillPage] = useState(1);
    const [plans, setPlans] = useState<PlanItem[]>([]);
    const [currentPlanIndex, setCurrentPlanIndex] = useState(0);
    const [planLoading, setPlanLoading] = useState(false);
    const [planError, setPlanError] = useState('');
    const [activeBills, setActiveBills] = useState<ActiveBill[]>([]);
    const [planSlideDirection, setPlanSlideDirection] = useState<'left' | 'right'>('right');
    const [planSlideKey, setPlanSlideKey] = useState(0);

    const computeAvailableBalance = useCallback((list: PrepaidCard[]) => {
        const now = Date.now();
        const total = list.reduce((sum, card) => {
            if (card.balance <= 0) return sum;
            if (card.valid_days === 0) return sum + card.balance;
            if (!card.expires_at) return sum + card.balance;
            const exp = new Date(card.expires_at).getTime();
            if (exp >= now) {
                return sum + card.balance;
            }
            return sum;
        }, 0);
        setAvailableBalance(total);
    }, []);

    const loadCurrentPlans = useCallback(async () => {
        setPlanLoading(true);
        setPlanError('');
        try {
            const [plansRes, billsRes] = await Promise.all([
                apiFetch<PlansResponse>('/v0/front/plans'),
                apiFetch<ActiveBillsResponse>('/v0/front/bills?active=true'),
            ]);
            setPlans(plansRes.plans || []);
            setActiveBills(billsRes.bills || []);
        } catch (err) {
            console.error(err);
            setPlanError(t('Failed to load current plan.'));
        } finally {
            setPlanLoading(false);
        }
    }, [t]);

    const loadCards = useCallback(async () => {
        setCardLoading(true);
        setCardError('');
        try {
            const res = await apiFetch<PrepaidCardsResponse>('/v0/front/prepaid-cards');
            const list = res.cards || [];
            setCards(list);
            computeAvailableBalance(list);
        } catch (err) {
            console.error(err);
            setCardError(t('Failed to load prepaid card.'));
        } finally {
            setCardLoading(false);
        }
    }, [computeAvailableBalance, t]);

    const loadBills = useCallback(async () => {
        setBillLoading(true);
        setBillError('');
        try {
            const res = await apiFetch<BillsResponse>('/v0/front/bills');
            setBills(res.bills || []);
        } catch (err) {
            console.error(err);
            setBillError(t('Failed to load bills.'));
        } finally {
            setBillLoading(false);
        }
    }, [t]);

    useEffect(() => {
        loadCards();
        loadBills();
        loadCurrentPlans();
    }, [loadCards, loadBills, loadCurrentPlans]);

    const activePlanEntries = useMemo(() => {
        if (!activeBills.length) {
            return [];
        }
        const planMap = new Map(plans.map((plan) => [plan.id, plan]));
        const list = activeBills.map((bill) => ({
            bill,
            plan: planMap.get(bill.plan_id),
        }));
        list.sort((a, b) => {
            const aTimeRaw = a.bill.created_at ? Date.parse(a.bill.created_at) : 0;
            const bTimeRaw = b.bill.created_at ? Date.parse(b.bill.created_at) : 0;
            const aTime = Number.isNaN(aTimeRaw) ? 0 : aTimeRaw;
            const bTime = Number.isNaN(bTimeRaw) ? 0 : bTimeRaw;
            if (aTime !== bTime) {
                return bTime - aTime;
            }
            const aOrder = a.plan ? a.plan.sort_order : 0;
            const bOrder = b.plan ? b.plan.sort_order : 0;
            if (aOrder !== bOrder) {
                return aOrder - bOrder;
            }
            const aName = a.plan?.name ?? '';
            const bName = b.plan?.name ?? '';
            return aName.localeCompare(bName);
        });
        return list;
    }, [activeBills, plans]);

    const activePlanEntry = activePlanEntries[currentPlanIndex];
    const activePlan = activePlanEntry?.plan;
    const activeRateLimit = activePlanEntry?.bill.rate_limit ?? activePlan?.rate_limit ?? 0;
    const hasMultiplePlans = activePlanEntries.length > 1;
    const stackedPlanBalance = useMemo(() => {
        if (!activeBills.length) {
            return 0;
        }
        return activeBills.reduce((sum, bill) => {
            const leftQuota = typeof bill.left_quota === 'number' ? bill.left_quota : 0;
            if (!Number.isFinite(leftQuota) || leftQuota <= 0) {
                return sum;
            }
            return sum + leftQuota;
        }, 0);
    }, [activeBills]);
    const planUsageSummary = useMemo(() => {
        if (!activeBills.length) {
            return { usedAmount: 0, totalAmount: 0, percent: 0 };
        }
        let usedAmount = 0;
        let totalAmount = 0;
        activeBills.forEach((bill) => {
            const totalQuota = typeof bill.total_quota === 'number' ? bill.total_quota : 0;
            const usedQuota = typeof bill.used_quota === 'number' ? bill.used_quota : 0;
            const leftQuota = typeof bill.left_quota === 'number' ? bill.left_quota : 0;
            const safeTotal = Number.isFinite(totalQuota) ? totalQuota : 0;
            const safeUsed = Number.isFinite(usedQuota)
                ? usedQuota
                : Number.isFinite(leftQuota)
                    ? Math.max(0, safeTotal - leftQuota)
                    : 0;
            const inferredTotal = safeTotal > 0 ? safeTotal : safeUsed + (Number.isFinite(leftQuota) ? leftQuota : 0);
            usedAmount += safeUsed;
            totalAmount += inferredTotal;
        });
        const percent = totalAmount > 0 ? Math.min(100, Math.max(0, (usedAmount / totalAmount) * 100)) : 0;
        return { usedAmount, totalAmount, percent };
    }, [activeBills]);
    const planExpiryInfo = useMemo(() => {
        if (!activeBills.length) {
            return null;
        }
        const now = Date.now();
        let nearestEnd: number | null = null;
        activeBills.forEach((bill) => {
            if (!bill.period_end) {
                return;
            }
            const endTime = Date.parse(bill.period_end);
            if (!Number.isFinite(endTime) || endTime < now) {
                return;
            }
            if (nearestEnd === null || endTime < nearestEnd) {
                nearestEnd = endTime;
            }
        });
        if (nearestEnd === null) {
            return null;
        }
        const daysLeft = Math.ceil((nearestEnd - now) / DAY_MS);
        return { daysLeft };
    }, [activeBills]);
    const planExpiryLabel = useMemo(() => {
        if (planLoading) {
            return t('Loading plan status...');
        }
        if (planError) {
            return t('Plan status unavailable');
        }
        if (!planExpiryInfo) {
            return t('No upcoming expiry');
        }
        if (planExpiryInfo.daysLeft <= 0) {
            return t('Expires today');
        }
        if (planExpiryInfo.daysLeft === 1) {
            return t('Expires in 1 day');
        }
        return t('Expires in {{count}} days', { count: planExpiryInfo.daysLeft });
    }, [planExpiryInfo, planLoading, planError, t]);

    const handlePlanSelect = (index: number) => {
        if (index === currentPlanIndex) {
            return;
        }
        setPlanSlideDirection(index > currentPlanIndex ? 'right' : 'left');
        setCurrentPlanIndex(index);
        setPlanSlideKey((prev) => prev + 1);
    };

    useEffect(() => {
        if (currentPlanIndex >= activePlanEntries.length) {
            setCurrentPlanIndex(0);
            setPlanSlideKey((prev) => prev + 1);
        }
    }, [activePlanEntries.length, currentPlanIndex]);

    const planSlideClass = hasMultiplePlans
        ? planSlideDirection === 'left'
            ? 'animate-slide-x-left'
            : 'animate-slide-x-right'
        : '';

    const sortedBills = useMemo(() => {
        const list = [...bills];
        list.sort((a, b) => {
            const aTime = new Date(a.created_at).getTime();
            const bTime = new Date(b.created_at).getTime();
            return bTime - aTime;
        });
        return list;
    }, [bills]);

    const recentBills = useMemo(() => sortedBills.slice(0, RECENT_BILL_COUNT), [sortedBills]);

    const totalPages = useMemo(() => {
        if (!sortedBills.length) {
            return 1;
        }
        return Math.ceil(sortedBills.length / BILL_PAGE_SIZE);
    }, [sortedBills.length]);

    const paginatedBills = useMemo(() => {
        const start = (billPage - 1) * BILL_PAGE_SIZE;
        return sortedBills.slice(start, start + BILL_PAGE_SIZE);
    }, [billPage, sortedBills]);

    useEffect(() => {
        if (billPage > totalPages) {
            setBillPage(totalPages);
        }
    }, [billPage, totalPages]);

    const handleRedeem = async () => {
        const snTrim = cardSN.trim();
        const passTrim = password.trim();
        if (!snTrim || !passTrim) {
            setRedeemMessage(t('Card number and password are required.'));
            return;
        }
        setRedeemSubmitting(true);
        setRedeemMessage('');
        try {
            const res = await apiFetch<PrepaidCardResponse>('/v0/front/prepaid-card/redeem', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ card_sn: snTrim, password: passTrim }),
            });
            if (res.card) {
                setCards((prev) => [res.card as PrepaidCard, ...prev]);
            }
            await loadCards();
            setRedeemOpen(false);
            setCardSN('');
            setPassword('');
        } catch (err) {
            console.error(err);
            setRedeemMessage(t('Redeem failed. Please check card info and try again.'));
        } finally {
            setRedeemSubmitting(false);
        }
    };

    return (
        <DashboardLayout
            title={t('Billing & Plans')}
            subtitle={t('Manage your subscription, payment methods, and billing history.')}
        >

                {/* Current Overview */}
                <section className="flex flex-col gap-6">
                    <div className="flex items-center justify-between">
                        <h2 className="text-[22px] font-bold leading-tight tracking-[-0.015em] text-slate-900 dark:text-white">
                            {t('Current Overview')}
                        </h2>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        {/* Current Plan */}
                        <div
                            key={planSlideKey}
                            className={`flex flex-col gap-2 rounded-xl p-6 border border-slate-200 dark:border-border-dark bg-white dark:bg-surface-dark shadow-sm ${planSlideClass}`}
                        >
                            <div className="flex items-center justify-between">
                                <p className="text-slate-500 dark:text-text-secondary text-sm font-medium uppercase tracking-wider">
                                    {t('Current Plan')}
                                </p>
                                <Icon
                                    name="verified"
                                    className={
                                        activePlanEntries.length > 0
                                            ? 'text-primary'
                                            : 'text-slate-300 dark:text-slate-600'
                                    }
                                />
                            </div>
                            <div className="flex flex-col gap-3">
                                {planLoading ? (
                                    <div className="space-y-2">
                                        <div className="h-6 w-32 rounded bg-slate-200 dark:bg-slate-700" />
                                        <div className="h-4 w-24 rounded bg-slate-100 dark:bg-slate-700/60" />
                                    </div>
                                ) : planError ? (
                                    <p className="text-sm text-red-500">{planError}</p>
                                ) : activePlanEntry ? (
                                    <div>
                                        <p className="text-2xl font-bold leading-tight text-slate-900 dark:text-white">
                                            {activePlan?.name ??
                                                t('Plan {{id}}', { id: activePlanEntry.bill.plan_id })}
                                        </p>
                                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                            {activePlan
                                                ? t('${{price}} / month', { price: formatPrice(activePlan.month_price) })
                                                : activePlanEntry.bill.amount
                                                    ? t('${{price}} / month', { price: formatPrice(activePlanEntry.bill.amount) })
                                                    : '-'}
                                        </p>
                                        {activeRateLimit > 0 && (
                                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                                {t('Rate limit (req/s): {{value}}', { value: activeRateLimit.toLocaleString() })}
                                            </p>
                                        )}
                                    </div>
                                ) : (
                                    <div>
                                        <p className="text-2xl font-bold leading-tight text-slate-900 dark:text-white">
                                            {t('No Active Plan')}
                                        </p>
                                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                            {t('Purchase a plan to get started')}
                                        </p>
                                    </div>
                                )}
                                {hasMultiplePlans && (
                                    <div className="flex items-center justify-center gap-2">
                                        {activePlanEntries.map((entry, index) => {
                                            const isActive = index === currentPlanIndex;
                                            const label =
                                                entry.plan?.name ??
                                                t('Plan {{id}}', { id: entry.bill.plan_id });
                                            return (
                                                <button
                                                    key={entry.bill.id}
                                                    type="button"
                                                    onClick={() => handlePlanSelect(index)}
                                                    className={`h-3 w-3 rounded-full border transition-colors ${
                                                        isActive
                                                            ? 'bg-primary border-primary'
                                                            : 'bg-slate-200 border-slate-200 dark:bg-slate-700 dark:border-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600'
                                                    }`}
                                                    aria-label={t('View {{label}}', { label })}
                                                    aria-current={isActive ? 'true' : undefined}
                                                />
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Available Balance */}
                        <div className="flex flex-col gap-2 rounded-xl p-6 border border-slate-200 dark:border-border-dark bg-white dark:bg-surface-dark shadow-sm">
                            <div className="flex items-center justify-between">
                                <p className="text-slate-500 dark:text-text-secondary text-sm font-medium uppercase tracking-wider">
                                    {t('Available Balance')}
                                </p>
                                <Icon name="attach_money" className="text-green-500" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold leading-tight text-slate-900 dark:text-white">
                                    ${availableBalance.toFixed(2)}
                                </p>
                                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                    {t('From active prepaid cards')}
                                </p>
                            </div>
                        </div>

                        {/* Plan Balance */}
                        <div className="flex flex-col gap-2 rounded-xl p-6 border border-slate-200 dark:border-border-dark bg-white dark:bg-surface-dark shadow-sm">
                            <div className="flex items-center justify-between">
                                <p className="text-slate-500 dark:text-text-secondary text-sm font-medium uppercase tracking-wider">
                                    {t('Available Plan Balance')}
                                </p>
                                <Icon name="account_balance_wallet" className="text-slate-400" />
                            </div>
                            <div>
                                {planLoading ? (
                                    <div className="space-y-2">
                                        <div className="h-6 w-32 rounded bg-slate-200 dark:bg-slate-700" />
                                        <div className="h-4 w-40 rounded bg-slate-100 dark:bg-slate-700/60" />
                                    </div>
                                ) : planError ? (
                                    <p className="text-sm text-red-500">{planError}</p>
                                ) : (
                                    <>
                                        <p className="text-2xl font-bold leading-tight text-slate-900 dark:text-white">
                                            ${formatPrice(stackedPlanBalance)}
                                        </p>
                                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                            {activePlanEntries.length > 0
                                                ? t('Stacked across {{count}} active plan{{suffix}}', {
                                                      count: activePlanEntries.length,
                                                      suffix: activePlanEntries.length > 1 ? 's' : '',
                                                  })
                                                : t('No active plans yet')}
                                        </p>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Usage Progress Bar */}
                    <div className="rounded-xl border border-slate-200 dark:border-border-dark bg-white dark:bg-surface-dark p-6 shadow-sm">
                        <div className="flex flex-col gap-4">
                            <div className="flex flex-wrap items-end justify-between gap-2">
                                <div>
                                    <p className="text-base font-medium leading-normal text-slate-900 dark:text-white">
                                        {t('Plan Usage')}
                                    </p>
                                    <p className="text-sm text-slate-500 dark:text-text-secondary">
                                        {planExpiryLabel}
                                    </p>
                                </div>
                                <p className="text-sm font-bold leading-normal text-slate-900 dark:text-white bg-slate-100 dark:bg-surface-dark px-2 py-1 rounded">
                                    ${formatPrice(planUsageSummary.usedAmount)} / ${formatPrice(planUsageSummary.totalAmount)}
                                </p>
                            </div>
                            <div className="h-3 w-full rounded-full bg-slate-100 dark:bg-border-dark overflow-hidden">
                                <div
                                    className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
                                    style={{ width: `${planUsageSummary.percent}%` }}
                                />
                            </div>
                            <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                                <span>0%</span>
                                <span>50%</span>
                                <span>100%</span>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Prepaid Card */}
                <div className="pt-6">
                    <section className="flex flex-col gap-4 w-full">
                        <h2 className="text-[22px] font-bold leading-tight tracking-[-0.015em] text-slate-900 dark:text-white">
                            {t('Prepaid Card')}
                        </h2>
                        {(cardLoading || cards.length > 0) && (
                            <div className="rounded-xl border border-slate-200 dark:border-border-dark bg-white dark:bg-surface-dark shadow-sm overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-sm">
                                        <thead className="bg-slate-50 dark:bg-surface-dark border-b border-slate-200 dark:border-border-dark text-slate-500 dark:text-slate-400">
                                            <tr>
                                                <th className="px-6 py-3 font-medium">{t('Name')}</th>
                                                <th className="px-6 py-3 font-medium">{t('Card SN')}</th>
                                                <th className="px-6 py-3 font-medium">{t('Amount')}</th>
                                                <th className="px-6 py-3 font-medium">{t('Balance')}</th>
                                                <th className="px-6 py-3 font-medium">{t('Valid Days')}</th>
                                                <th className="px-6 py-3 font-medium">{t('Valid Until')}</th>
                                                <th className="px-6 py-3 font-medium">{t('Redeemed At')}</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-border-dark text-slate-700 dark:text-slate-300">
                                            {cardLoading ? (
                                                <tr>
                                                    <td colSpan={7} className="px-6 py-4 text-center">
                                                        {t('Loading...')}
                                                    </td>
                                                </tr>
                                            ) : (
                                                cards.map((card) => (
                                                    <tr key={card.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                                                        <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">
                                                            {card.name || t('Prepaid Card')}
                                                        </td>
                                                        <td className="px-6 py-4 font-mono text-xs text-slate-800 dark:text-slate-200">
                                                            {card.card_sn}
                                                        </td>
                                                        <td className="px-6 py-4 text-slate-700 dark:text-slate-300">
                                                            ${card.amount.toFixed(2)}
                                                        </td>
                                                        <td className="px-6 py-4 text-slate-700 dark:text-slate-300">
                                                            ${card.balance.toFixed(2)}
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            {card.valid_days > 0 ? card.valid_days : t('Never')}
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            {card.valid_days === 0
                                                                ? t('Never')
                                                                : card.redeemed_at
                                                                    ? card.expires_at
                                                                        ? new Date(card.expires_at).toLocaleDateString(locale)
                                                                        : '-'
                                                                    : '-'}
                                                        </td>
                                                        <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                                                            {card.redeemed_at
                                                                ? new Date(card.redeemed_at).toLocaleString(locale)
                                                                : '-'}
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                {cardError && (
                                    <div className="border-t border-slate-100 dark:border-border-dark px-6 py-3 text-sm text-red-500">
                                        {cardError}
                                    </div>
                                )}
                            </div>
                        )}
                        <button
                            className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 dark:border-border-dark p-4 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-surface-dark/50 transition-colors w-full"
                            onClick={() => {
                                setRedeemOpen(true);
                                setRedeemMessage('');
                            }}
                        >
                            <Icon name="add" size={20} />
                            {t('Add Prepaid Card')}
                        </button>
                    </section>
                </div>

                {/* Billing History */}
                <section className="flex flex-col gap-4 pt-6 pb-12">
                    <div className="flex items-center justify-between">
                        <h2 className="text-[22px] font-bold leading-tight tracking-[-0.015em] text-slate-900 dark:text-white">
                            {t('Billing History')}
                        </h2>
                    </div>
                    <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-border-dark bg-white dark:bg-surface-dark">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-slate-50 dark:bg-surface-dark border-b border-slate-200 dark:border-border-dark text-slate-500 dark:text-slate-400">
                                    <tr>
                                        <th className="px-6 py-4 font-medium">{t('Invoice ID')}</th>
                                        <th className="px-6 py-4 font-medium">{t('Date')}</th>
                                        <th className="px-6 py-4 font-medium">{t('Amount')}</th>
                                        <th className="px-6 py-4 font-medium">{t('Rate limit')}</th>
                                        <th className="px-6 py-4 font-medium">{t('Status')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-border-dark text-slate-700 dark:text-slate-300">
                                    {billLoading ? (
                                        <tr>
                                            <td colSpan={5} className="px-6 py-4 text-center">
                                                {t('Loading...')}
                                            </td>
                                        </tr>
                                    ) : billError ? (
                                        <tr>
                                            <td colSpan={5} className="px-6 py-4 text-center text-red-500">
                                                {billError}
                                            </td>
                                        </tr>
                                    ) : recentBills.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} className="px-6 py-4 text-center text-slate-500 dark:text-slate-400">
                                                {t('No transactions yet.')}
                                            </td>
                                        </tr>
                                    ) : (
                                        recentBills.map((bill) => {
                                            const status = mapBillStatus(bill.status);
                                            const date = bill.created_at
                                                ? new Date(bill.created_at).toLocaleDateString(locale)
                                                : '-';
                                            return (
                                                <tr
                                                    key={bill.id}
                                                    className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                                                >
                                                    <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">
                                                        INV-{bill.id}
                                                    </td>
                                                    <td className="px-6 py-4">{date}</td>
                                                    <td className="px-6 py-4">${bill.amount.toFixed(2)}</td>
                                                    <td className="px-6 py-4">
                                                        {bill.rate_limit > 0 ? bill.rate_limit.toLocaleString() : ''}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <span
                                                            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium capitalize ${getStatusStyle(status)}`}
                                                        >
                                                            {t(status)}
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                        <div className="border-t border-slate-100 dark:border-border-dark bg-slate-50 dark:bg-surface-dark/50 px-6 py-3">
                            <button
                                className="text-sm font-medium text-primary hover:text-blue-400"
                                onClick={() => {
                                    setTransactionsOpen(true);
                                    setBillPage(1);
                                }}
                            >
                                {t('View All Transactions')}
                            </button>
                        </div>
                    </div>
                </section>

            {transactionsOpen &&
                createPortal(
                    <div className="fixed inset-0 z-50 flex items-center justify-center">
                        <div
                            className="absolute inset-0 bg-black/50"
                            onClick={() => setTransactionsOpen(false)}
                            role="presentation"
                        />
                        <div className="relative bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-2xl w-full max-w-4xl mx-4 max-h-[90vh] flex flex-col overflow-hidden">
                            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-border-dark shrink-0">
                                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                                    {t('All Transactions')}
                                </h3>
                                <button
                                    onClick={() => setTransactionsOpen(false)}
                                    className="text-slate-500 hover:text-slate-900 dark:hover:text-white"
                                    type="button"
                                >
                                    <Icon name="close" size={20} />
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-sm">
                                        <thead className="bg-slate-50 dark:bg-surface-dark border-b border-slate-200 dark:border-border-dark text-slate-500 dark:text-slate-400">
                                            <tr>
                                                <th className="px-6 py-4 font-medium">{t('Invoice ID')}</th>
                                                <th className="px-6 py-4 font-medium">{t('Date')}</th>
                                                <th className="px-6 py-4 font-medium">{t('Amount')}</th>
                                                <th className="px-6 py-4 font-medium">{t('Rate limit')}</th>
                                                <th className="px-6 py-4 font-medium">{t('Status')}</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-border-dark text-slate-700 dark:text-slate-300">
                                            {billLoading ? (
                                                <tr>
                                                    <td colSpan={5} className="px-6 py-4 text-center">
                                                        {t('Loading...')}
                                                    </td>
                                                </tr>
                                            ) : billError ? (
                                                <tr>
                                                    <td colSpan={5} className="px-6 py-4 text-center text-red-500">
                                                        {billError}
                                                    </td>
                                                </tr>
                                            ) : paginatedBills.length === 0 ? (
                                                <tr>
                                                    <td colSpan={5} className="px-6 py-4 text-center text-slate-500 dark:text-slate-400">
                                                        {t('No transactions yet.')}
                                                    </td>
                                                </tr>
                                            ) : (
                                                paginatedBills.map((bill) => {
                                                    const status = mapBillStatus(bill.status);
                                                    const date = bill.created_at
                                                        ? new Date(bill.created_at).toLocaleDateString(locale)
                                                        : '-';
                                                    return (
                                                        <tr
                                                            key={bill.id}
                                                            className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                                                        >
                                                            <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">
                                                                INV-{bill.id}
                                                            </td>
                                                            <td className="px-6 py-4">{date}</td>
                                                            <td className="px-6 py-4">${bill.amount.toFixed(2)}</td>
                                                            <td className="px-6 py-4">
                                                                {bill.rate_limit > 0 ? bill.rate_limit.toLocaleString() : ''}
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                <span
                                                                    className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium capitalize ${getStatusStyle(status)}`}
                                                                >
                                                                    {t(status)}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    );
                                                })
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            <div className="px-6 py-4 border-t border-slate-200 dark:border-border-dark bg-slate-50 dark:bg-surface-dark/50 flex items-center justify-between shrink-0">
                                <span className="text-sm text-slate-500 dark:text-slate-400">
                                    {t('Showing')}{' '}
                                    <span className="font-semibold text-slate-900 dark:text-white">
                                        {sortedBills.length > 0 ? (billPage - 1) * BILL_PAGE_SIZE + 1 : 0}-
                                        {Math.min(billPage * BILL_PAGE_SIZE, sortedBills.length)}
                                    </span>{' '}
                                    {t('of')}{' '}
                                    <span className="font-semibold text-slate-900 dark:text-white">
                                        {sortedBills.length}
                                    </span>
                                </span>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setBillPage((prev) => Math.max(1, prev - 1))}
                                        disabled={billPage <= 1}
                                        className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-border-dark text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-surface-dark disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {t('Previous')}
                                    </button>
                                    <span className="text-sm text-slate-600 dark:text-slate-300">
                                        {t('Page')} {billPage} {t('of')} {totalPages}
                                    </span>
                                    <button
                                        onClick={() => setBillPage((prev) => Math.min(totalPages, prev + 1))}
                                        disabled={billPage >= totalPages}
                                        className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-border-dark text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-surface-dark disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {t('Next')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}

            {redeemOpen &&
                createPortal(
                    <div className="fixed inset-0 z-50 flex items-center justify-center">
                        <div
                            className="absolute inset-0 bg-black/50"
                            onClick={() => {
                                if (!redeemSubmitting) {
                                    setRedeemOpen(false);
                                    setRedeemMessage('');
                                }
                            }}
                            role="presentation"
                        />
                        <div className="relative bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-2xl w-full max-w-md mx-4 max-h-[90vh] flex flex-col overflow-hidden">
                            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-border-dark shrink-0">
                                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                                    {t('Bind Prepaid Card')}
                                </h3>
                                <button
                                    onClick={() => {
                                        if (!redeemSubmitting) {
                                            setRedeemOpen(false);
                                            setRedeemMessage('');
                                        }
                                    }}
                                    className="text-slate-500 hover:text-slate-900 dark:hover:text-white"
                                    type="button"
                                >
                                    <Icon name="close" size={20} />
                                </button>
                            </div>
                            <div className="px-6 py-5 flex flex-col gap-3 flex-1 overflow-y-auto">
                                <label className="text-sm text-slate-700 dark:text-slate-300 flex flex-col gap-1">
                                    {t('Card Number')}
                                    <input
                                        type="text"
                                        value={cardSN}
                                        onChange={(e) => setCardSN(e.target.value)}
                                        className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-border-dark bg-white dark:bg-background-dark text-slate-900 dark:text-white"
                                        placeholder={t('Enter card SN')}
                                        disabled={redeemSubmitting}
                                    />
                                </label>
                                <label className="text-sm text-slate-700 dark:text-slate-300 flex flex-col gap-1">
                                    {t('Password')}
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-border-dark bg-white dark:bg-background-dark text-slate-900 dark:text-white"
                                        placeholder={t('Enter card password')}
                                        disabled={redeemSubmitting}
                                    />
                                </label>
                                {redeemMessage && (
                                    <p className="text-sm text-red-500">{redeemMessage}</p>
                                )}
                            </div>
                            <div className="px-6 py-4 border-t border-gray-200 dark:border-border-dark flex justify-end gap-3 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (!redeemSubmitting) {
                                            setRedeemOpen(false);
                                            setRedeemMessage('');
                                        }
                                    }}
                                    className="px-4 py-2 rounded-lg border border-slate-200 dark:border-border-dark bg-white dark:bg-background-dark text-slate-700 dark:text-white hover:bg-slate-50 dark:hover:bg-slate-700"
                                    disabled={redeemSubmitting}
                                >
                                    {t('Cancel')}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleRedeem}
                                    className="px-4 py-2 rounded-lg bg-primary text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                    disabled={redeemSubmitting}
                                >
                                    {redeemSubmitting ? t('Binding...') : t('Bind Card')}
                                </button>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}
        </DashboardLayout>
    );
}
