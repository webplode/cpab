import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AdminDashboardLayout } from '../../components/admin/AdminDashboardLayout';
import { AdminNoAccessCard } from '../../components/admin/AdminNoAccessCard';
import { apiFetchAdmin } from '../../api/config';
import { Icon } from '../../components/Icon';
import { buildAdminPermissionKey, useAdminPermissions } from '../../utils/adminPermissions';
import { useStickyActionsDivider } from '../../utils/stickyActionsDivider';
import { useTranslation } from 'react-i18next';

interface Bill {
    id: number;
    plan_id: number;
    user_id: number;
    user_group_id: number[];
    period_type: number;
    amount: number;
    period_start: string;
    period_end: string;
    total_quota: number;
    daily_quota: number;
    rate_limit: number;
    used_quota: number;
    left_quota: number;
    used_count: number;
    is_enabled: boolean;
    status: number;
    created_at: string;
    updated_at: string;
}

interface BillsResponse {
    bills: Bill[];
}

const STATUS_MAP: Record<number, { label: string; className: string }> = {
    1: {
        label: 'Pending',
        className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/10 dark:text-yellow-400 border-yellow-200 dark:border-yellow-500/20',
    },
    2: {
        label: 'Active',
        className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20',
    },
    3: {
        label: 'Expired',
        className: 'bg-gray-100 text-gray-800 dark:bg-gray-500/10 dark:text-gray-400 border-gray-200 dark:border-gray-500/20',
    },
    4: {
        label: 'Refunded',
        className: 'bg-red-100 text-red-800 dark:bg-red-500/10 dark:text-red-400 border-red-200 dark:border-red-500/20',
    },
};

const PERIOD_MAP: Record<number, string> = {
    1: 'Monthly',
    2: 'Yearly',
};

const PAGE_SIZE = 10;

interface StatusDropdownMenuProps {
    statusFilter: number | null;
    menuWidth?: number;
    onSelect: (value: number | null) => void;
    onClose: () => void;
}

function StatusDropdownMenu({ statusFilter, menuWidth, onSelect, onClose }: StatusDropdownMenuProps) {
    const { t } = useTranslation();
    const btn = document.getElementById('status-dropdown-btn');
    const rect = btn ? btn.getBoundingClientRect() : null;
    const position = rect
        ? { top: rect.bottom + 4, left: rect.left, width: rect.width }
        : { top: 0, left: 0, width: 0 };

    const options = [
        { value: null, label: t('All') },
        { value: 1, label: t('Pending') },
        { value: 2, label: t('Active') },
        { value: 3, label: t('Expired') },
        { value: 4, label: t('Refunded') },
    ];

    return createPortal(
        <>
            <div className="fixed inset-0 z-40" onClick={onClose} />
            <div
                className="fixed z-50 bg-white dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto"
                style={{ top: position.top, left: position.left, width: position.width || menuWidth }}
            >
                {options.map((opt) => (
                    <button
                        key={opt.value ?? 'all'}
                        type="button"
                        onClick={() => onSelect(opt.value)}
                        className={`w-full text-left px-4 py-2.5 text-sm truncate hover:bg-gray-100 dark:hover:bg-background-dark transition-colors ${
                            statusFilter === opt.value
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

export function AdminBills() {
    const { t, i18n } = useTranslation();
    const { hasPermission } = useAdminPermissions();
    const canListBills = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/bills'));
    const canUpdateBill = hasPermission(buildAdminPermissionKey('PUT', '/v0/admin/bills/:id'));
    const canDeleteBill = hasPermission(buildAdminPermissionKey('DELETE', '/v0/admin/bills/:id'));
    const canEnableBill = hasPermission(buildAdminPermissionKey('POST', '/v0/admin/bills/:id/enable'));
    const canDisableBill = hasPermission(buildAdminPermissionKey('POST', '/v0/admin/bills/:id/disable'));

    const [bills, setBills] = useState<Bill[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState<number | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
    const statusBtnWidth = useMemo(() => {
        const allOptions = [
            t('All'),
            t('Pending'),
            t('Active'),
            t('Expired'),
            t('Refunded'),
        ];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return null;
        }
        ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
        let maxWidth = 0;
        for (const opt of allOptions) {
            const width = ctx.measureText(opt).width;
            if (width > maxWidth) maxWidth = width;
        }
        return Math.ceil(maxWidth) + 76;
    }, [t]);
    const locale = i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US';

    const fetchBills = useCallback(() => {
        if (!canListBills) {
            return;
        }
        setLoading(true);
        apiFetchAdmin<BillsResponse>('/v0/admin/bills')
            .then((res) => setBills(res.bills || []))
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [canListBills]);

    useEffect(() => {
        if (!canListBills) {
            return;
        }
        queueMicrotask(() => {
            fetchBills();
        });
    }, [fetchBills, canListBills]);


    const filteredBills = statusFilter
        ? bills.filter((b) => b.status === statusFilter)
        : bills;

    const totalPages = Math.ceil(filteredBills.length / PAGE_SIZE);
    const paginatedBills = filteredBills.slice(
        (currentPage - 1) * PAGE_SIZE,
        currentPage * PAGE_SIZE
    );

    const { tableScrollRef, handleTableScroll, showActionsDivider } = useStickyActionsDivider(
        paginatedBills.length,
        loading
    );

    const handleStatusFilterChange = (status: number | null) => {
        setStatusFilter(status);
        setCurrentPage(1);
    };

    const handleToggleEnabled = async (bill: Bill) => {
        if (bill.is_enabled && !canDisableBill) {
            return;
        }
        if (!bill.is_enabled && !canEnableBill) {
            return;
        }
        try {
            const endpoint = bill.is_enabled
                ? `/v0/admin/bills/${bill.id}/disable`
                : `/v0/admin/bills/${bill.id}/enable`;
            await apiFetchAdmin(endpoint, { method: 'POST' });
            setBills((prev) =>
                prev.map((item) =>
                    item.id === bill.id
                        ? { ...item, is_enabled: !bill.is_enabled }
                        : item
                )
            );
        } catch (err) {
            console.error(err);
        }
    };

    const handleDelete = async (bill: Bill) => {
        if (!canDeleteBill) {
            return;
        }
        if (!confirm(t('Are you sure you want to delete bill #{{id}}?', { id: bill.id }))) {
            return;
        }
        try {
            await apiFetchAdmin(`/v0/admin/bills/${bill.id}`, { method: 'DELETE' });
            fetchBills();
        } catch (err) {
            console.error(err);
        }
    };

    const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString(locale);

    if (!canListBills) {
        return (
            <AdminDashboardLayout title={t('Bills')} subtitle={t('Manage subscription bills')}>
                <AdminNoAccessCard />
            </AdminDashboardLayout>
        );
    }

    return (
        <AdminDashboardLayout title={t('Bills')} subtitle={t('Manage subscription bills')}>
            <div className="space-y-6">
                <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-white dark:bg-surface-dark p-3 rounded-xl border border-gray-200 dark:border-border-dark shadow-sm">
                    <div className="flex gap-3 w-full md:w-auto items-center">
                        <span className="text-sm text-slate-500 dark:text-text-secondary">{t('Status')}:</span>
                        <div className="relative">
                            <button
                                type="button"
                                id="status-dropdown-btn"
                                onClick={() => setStatusDropdownOpen(!statusDropdownOpen)}
                                className="flex items-center justify-between gap-2 bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark text-slate-900 dark:text-white text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5 whitespace-nowrap"
                                style={statusBtnWidth ? { width: statusBtnWidth } : undefined}
                            >
                                <span>
                                    {statusFilter ? t(STATUS_MAP[statusFilter]?.label ?? 'All') : t('All')}
                                </span>
                                <Icon name={statusDropdownOpen ? 'expand_less' : 'expand_more'} size={18} />
                            </button>
                            {statusDropdownOpen && (
                                <StatusDropdownMenu
                                    statusFilter={statusFilter}
                                    menuWidth={statusBtnWidth ?? undefined}
                                    onSelect={(value) => {
                                        handleStatusFilterChange(value);
                                        setStatusDropdownOpen(false);
                                    }}
                                    onClose={() => setStatusDropdownOpen(false)}
                                />
                            )}
                        </div>
                    </div>
                </div>

                <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-sm overflow-hidden">
                    <div ref={tableScrollRef} className="overflow-x-auto" onScroll={handleTableScroll}>
                        <table className="w-full text-left text-sm">
                            <thead className="bg-gray-50 dark:bg-surface-dark text-gray-500 dark:text-gray-400 uppercase text-xs font-semibold border-b border-gray-200 dark:border-border-dark">
                                <tr>
                                    <th className="px-6 py-4">{t('ID')}</th>
                                    <th className="px-6 py-4">{t('User ID')}</th>
                                    <th className="px-6 py-4">{t('Plan ID')}</th>
                                    <th className="px-6 py-4">{t('User Group')}</th>
                                    <th className="px-6 py-4">{t('Period')}</th>
                                    <th className="px-6 py-4">{t('Amount')}</th>
                                    <th className="px-6 py-4">{t('Quota Used')}</th>
                                    <th className="px-6 py-4">{t('Rate limit')}</th>
                                    <th className="px-6 py-4">{t('Status')}</th>
                                    <th className="px-6 py-4">{t('Enabled')}</th>
                                    <th className="px-6 py-4">{t('Created At')}</th>
                                    <th
                                        className={`px-6 py-4 text-center sticky right-0 z-20 bg-gray-50 dark:bg-surface-dark relative after:content-[''] after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-gray-200 dark:after:bg-border-dark after:pointer-events-none ${
                                            showActionsDivider ? 'after:opacity-100' : 'after:opacity-0'
                                        }`}
                                    >
                                        {t('Actions')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-border-dark">
                                {loading ? (
                                    [...Array(5)].map((_, i) => (
                                        <tr key={i}>
                                            <td colSpan={12} className="px-6 py-4">
                                                <div className="animate-pulse h-4 bg-slate-200 dark:bg-border-dark rounded"></div>
                                            </td>
                                        </tr>
                                    ))
                                ) : paginatedBills.length === 0 ? (
                                    <tr>
                                        <td colSpan={12} className="px-6 py-8 text-center text-slate-500 dark:text-text-secondary">
                                            {t('No bills found')}
                                        </td>
                                    </tr>
                                ) : (
                                    paginatedBills.map((bill) => {
                                        const statusInfo = STATUS_MAP[bill.status] || {
                                            label: 'Unknown',
                                            className: 'bg-gray-100 text-gray-800',
                                        };
                                        return (
                                            <tr
                                                key={bill.id}
                                                className="hover:bg-gray-50 dark:hover:bg-background-dark group"
                                            >
                                                <td className="px-6 py-4 whitespace-nowrap text-slate-700 dark:text-white font-medium">
                                                    {bill.id}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary">
                                                    {bill.user_id}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary">
                                                    {bill.plan_id}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary">
                                                    <span
                                                        className="block truncate"
                                                        title={
                                                            bill.user_group_id.length === 0
                                                                ? t('No Group')
                                                                : bill.user_group_id.map((id) => `#${id}`).join(', ')
                                                        }
                                                    >
                                                        {bill.user_group_id.length === 0
                                                            ? t('No Group')
                                                            : t('Selected {{count}}', { count: bill.user_group_id.length })}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary">
                                                    {t(PERIOD_MAP[bill.period_type] || 'Unknown')}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-slate-700 dark:text-white font-mono">
                                                    ${Number(bill.amount).toFixed(2)}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary font-mono">
                                                    {bill.used_quota.toLocaleString()} / {bill.total_quota.toLocaleString()}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary font-mono">
                                                    {bill.rate_limit.toLocaleString()}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusInfo.className}`}>
                                                        {t(statusInfo.label)}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                                                        bill.is_enabled
                                                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20'
                                                            : 'bg-gray-100 text-gray-800 dark:bg-gray-500/10 dark:text-gray-400 border-gray-200 dark:border-gray-500/20'
                                                    }`}>
                                                        {bill.is_enabled ? t('Yes') : t('No')}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary font-mono text-xs">
                                                    {formatDate(bill.created_at)}
                                                </td>
                                                <td
                                                    className={`px-6 py-4 whitespace-nowrap text-center sticky right-0 z-10 bg-white dark:bg-surface-dark group-hover:bg-gray-50 dark:group-hover:bg-background-dark relative after:content-[''] after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-gray-200 dark:after:bg-border-dark after:pointer-events-none ${
                                                        showActionsDivider ? 'after:opacity-100' : 'after:opacity-0'
                                                    }`}
                                                >
                                                    <div className="flex items-center justify-center gap-1">
                                                        {canUpdateBill && (
                                                            <button
                                                                onClick={() => window.location.href = `/admin/bills/${bill.id}/edit`}
                                                                className="p-2 text-gray-400 hover:text-primary hover:bg-gray-100 dark:hover:bg-background-dark rounded-lg transition-colors"
                                                                title={t('Edit')}
                                                            >
                                                                <Icon name="edit" size={18} />
                                                            </button>
                                                        )}
                                                        {(bill.is_enabled ? canDisableBill : canEnableBill) && (
                                                            <button
                                                                onClick={() => handleToggleEnabled(bill)}
                                                                className={`p-2 rounded-lg transition-colors ${
                                                                    bill.is_enabled
                                                                        ? 'text-gray-400 hover:text-amber-500 hover:bg-gray-100 dark:hover:bg-background-dark'
                                                                    : 'text-gray-400 hover:text-emerald-500 hover:bg-gray-100 dark:hover:bg-background-dark'
                                                            }`}
                                                            title={bill.is_enabled ? t('Disable') : t('Enable')}
                                                        >
                                                            <Icon
                                                                name={bill.is_enabled ? 'toggle_off' : 'toggle_on'}
                                                                size={18}
                                                            />
                                                        </button>
                                                    )}
                                                    {canDeleteBill && (
                                                        <button
                                                            onClick={() => handleDelete(bill)}
                                                            className="p-2 text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-background-dark rounded-lg transition-colors"
                                                            title={t('Delete')}
                                                        >
                                                            <Icon name="delete" size={18} />
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
                    {totalPages > 1 && (
                        <div className="px-6 py-4 border-t border-gray-200 dark:border-border-dark flex items-center justify-between">
                            <div className="text-sm text-slate-500 dark:text-text-secondary">
                            {t('Showing {{from}} to {{to}} of {{total}} bills', {
                                from: (currentPage - 1) * PAGE_SIZE + 1,
                                to: Math.min(currentPage * PAGE_SIZE, filteredBills.length),
                                total: filteredBills.length,
                            })}
                            </div>
                            <div className="flex items-center gap-2">
                            <button
                                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 dark:border-border-dark bg-white dark:bg-surface-dark text-slate-700 dark:text-white hover:bg-slate-50 dark:hover:bg-border-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {t('Previous')}
                            </button>
                            <span className="text-sm text-slate-600 dark:text-text-secondary">
                                {t('Page {{current}} of {{total}}', {
                                    current: currentPage,
                                    total: totalPages,
                                })}
                            </span>
                            <button
                                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                                className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 dark:border-border-dark bg-white dark:bg-surface-dark text-slate-700 dark:text-white hover:bg-slate-50 dark:hover:bg-border-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {t('Next')}
                            </button>
                        </div>
                    </div>
                )}
            </div>
            </div>
        </AdminDashboardLayout>
    );
}
