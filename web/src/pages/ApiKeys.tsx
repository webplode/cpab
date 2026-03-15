import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DashboardLayout } from '../components/DashboardLayout';
import { Icon } from '../components/Icon';
import { apiFetch } from '../api/config';
import { useStickyActionsDivider } from '../utils/stickyActionsDivider';
import { useTranslation } from 'react-i18next';

interface StatusDropdownMenuProps {
    statusFilter: string;
    onSelect: (value: string) => void;
    onClose: () => void;
    t: (key: string) => string;
}

function StatusDropdownMenu({ statusFilter, onSelect, onClose, t }: StatusDropdownMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);
    const btn = document.getElementById('status-dropdown-btn');
    const rect = btn ? btn.getBoundingClientRect() : null;
    const position = rect
        ? { top: rect.bottom + 4, left: rect.left, width: rect.width }
        : { top: 0, left: 0, width: 140 };

    const options = [
        { value: '', label: t('All Status') },
        { value: 'active', label: t('Active') },
        { value: 'revoked', label: t('Revoked') },
        { value: 'expiring', label: t('Expiring') },
    ];

    return createPortal(
        <>
            <div className="fixed inset-0 z-40" onClick={onClose} />
            <div
                ref={menuRef}
                className="fixed z-50 bg-white dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg shadow-lg overflow-hidden"
                style={{ top: position.top, left: position.left, width: position.width }}
            >
                {options.map((opt) => (
                    <button
                        key={opt.value}
                        type="button"
                        onClick={() => onSelect(opt.value)}
                        className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-100 dark:hover:bg-background-dark transition-colors ${
                            statusFilter === opt.value
                                ? 'bg-gray-100 dark:bg-background-dark text-primary font-medium'
                                : 'text-slate-900 dark:text-white'
                        }`}
                    >
                        {opt.label}
                    </button>
                ))}
            </div>
        </>,
        document.body
    );
}

interface ApiKey {
    id: number;
    name: string;
    key: string;
    key_prefix: string;
    active: boolean;
    status: 'active' | 'expiring' | 'revoked';
    expires_at: string | null;
    revoked_at: string | null;
    last_used_at: string | null;
    created_at: string;
}

interface ApiKeyStats {
    total_keys: number;
    active_keys: number;
    expiring_keys: number;
    total_usage_30d: number;
    total_usage_30d_display: string;
}

interface ListResponse {
    api_keys: ApiKey[];
    total: number;
    page: number;
    limit: number;
}

function getStatusStyle(status: string) {
    switch (status) {
        case 'active':
            return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-100 dark:border-emerald-800';
        case 'expiring':
            return 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-100 dark:border-amber-800';
        case 'revoked':
            return 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 border-red-100 dark:border-red-900/30';
        default:
            return '';
    }
}

function getStatusText(key: ApiKey, t: (key: string, options?: { [key: string]: unknown }) => string): string {
    if (key.status === 'revoked') return t('Revoked');
    if (key.status === 'expiring' && key.expires_at) {
        const days = Math.ceil(
            (new Date(key.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        );
        return t('Expiring in {{days}}d', { days });
    }
    return t('Active');
}

function formatDate(dateStr: string, locale: string): string {
    return new Date(dateStr).toLocaleDateString(locale, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

function formatLastUsed(
    dateStr: string | null,
    t: (key: string, options?: { [key: string]: unknown }) => string
): string {
    if (!dateStr) return t('Never');
    const date = new Date(dateStr);
    const now = Date.now();
    const diff = now - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('Just now');
    if (mins < 60) return t('{{count}} mins ago', { count: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t('{{count}} hr ago', { count: hours });
    const days = Math.floor(hours / 24);
    if (days < 30) return t('{{count}} days ago', { count: days });
    const months = Math.floor(days / 30);
    return t('{{count}} months ago', { count: months });
}

export function ApiKeys() {
    const { t, i18n } = useTranslation();
    const locale = i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US';
    const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
    const [stats, setStats] = useState<ApiKeyStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [limit] = useState(20);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newKeyToken, setNewKeyToken] = useState<string | null>(null);
    const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
    const [editingKey, setEditingKey] = useState<ApiKey | null>(null);
    const [confirmDialog, setConfirmDialog] = useState<{
        title: string;
        message: string;
        onConfirm: () => void;
        confirmText?: string;
        danger?: boolean;
    } | null>(null);
    const [toast, setToast] = useState<{ show: boolean; message: string }>({ show: false, message: '' });
    const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const { tableScrollRef, handleTableScroll, showActionsDivider } = useStickyActionsDivider(
        apiKeys.length,
        loading
    );

    const showToast = useCallback((message: string) => {
        if (toastTimeoutRef.current) {
            clearTimeout(toastTimeoutRef.current);
        }
        setToast({ show: true, message });
        toastTimeoutRef.current = setTimeout(() => {
            setToast({ show: false, message: '' });
        }, 2000);
    }, []);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            params.set('page', page.toString());
            params.set('limit', limit.toString());
            if (search) params.set('search', search);
            if (statusFilter) params.set('status', statusFilter);

            const [listRes, statsRes] = await Promise.all([
                apiFetch<ListResponse>(`/v0/front/api-keys?${params}`),
                apiFetch<ApiKeyStats>('/v0/front/api-keys/stats'),
            ]);

            setApiKeys(listRes.api_keys);
            setTotal(listRes.total);
            setStats(statsRes);
        } catch (err) {
            console.error('Failed to fetch api keys:', err);
        } finally {
            setLoading(false);
        }
    }, [page, limit, search, statusFilter]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleCreate = async (name: string, expiresInDays?: number) => {
        try {
            const res = await apiFetch<{ id: number; name: string; token: string }>(
                '/v0/front/api-keys',
                {
                    method: 'POST',
                    body: JSON.stringify({
                        name,
                        expires_in_days: expiresInDays,
                    }),
                }
            );
            setNewKeyToken(res.token);
            fetchData();
        } catch (err) {
            console.error('Failed to create api key:', err);
            alert(t('Failed to create API key'));
        }
    };

    const handleUpdate = async (id: number, name: string, expiresInDays?: number) => {
        try {
            await apiFetch(`/v0/front/api-keys/${id}`, {
                method: 'PUT',
                body: JSON.stringify({
                    name,
                    expires_in_days: expiresInDays === undefined ? 0 : expiresInDays,
                }),
            });
            setEditingKey(null);
            fetchData();
        } catch (err) {
            console.error('Failed to update api key:', err);
            alert(t('Failed to update API key'));
        }
    };

    const handleRevoke = (id: number) => {
        setConfirmDialog({
            title: t('Revoke API Key'),
            message: t('Are you sure you want to revoke this API key? It will no longer be usable.'),
            confirmText: t('Revoke'),
            danger: true,
            onConfirm: async () => {
                try {
                    await apiFetch(`/v0/front/api-keys/${id}/revoke`, { method: 'POST' });
                    fetchData();
                } catch (err) {
                    console.error('Failed to revoke api key:', err);
                }
                setConfirmDialog(null);
            },
        });
    };

    const handleDelete = (id: number) => {
        setConfirmDialog({
            title: t('Delete API Key'),
            message: t('Are you sure you want to permanently delete this API key? This action cannot be undone.'),
            confirmText: t('Delete'),
            danger: true,
            onConfirm: async () => {
                try {
                    await apiFetch(`/v0/front/api-keys/${id}`, { method: 'DELETE' });
                    fetchData();
                } catch (err) {
                    console.error('Failed to delete api key:', err);
                }
                setConfirmDialog(null);
            },
        });
    };

    const handleRenew = async (id: number) => {
        try {
            await apiFetch(`/v0/front/api-keys/${id}/renew`, {
                method: 'POST',
                body: JSON.stringify({ days: 90 }),
            });
            fetchData();
        } catch (err) {
            console.error('Failed to renew api key:', err);
        }
    };

    const handleCopy = async (key: string) => {
        await navigator.clipboard.writeText(key);
        showToast(t('API Key copied'));
    };

    const totalPages = Math.ceil(total / limit);

    const statsCards = [
        { label: t('Total Keys'), value: stats?.total_keys?.toString() ?? '0', icon: 'vpn_key', iconColor: 'text-primary' },
        { label: t('Active Keys'), value: stats?.active_keys?.toString() ?? '0', icon: 'check_circle', iconColor: 'text-green-500' },
        { label: t('Expiring Soon (7d)'), value: stats?.expiring_keys?.toString() ?? '0', icon: 'warning', iconColor: 'text-amber-500' },
        { label: t('Total Usage (30d)'), value: stats?.total_usage_30d_display ?? '0', unit: t('Tokens'), icon: 'bar_chart', iconColor: 'text-purple-500' },
    ];

    return (
        <DashboardLayout
            title={t('API Credentials')}
            subtitle={t('Create, manage, and revoke API keys for your projects.')}
        >
            {/* Action Button */}
            <div className="flex justify-end">
                <button
                    onClick={() => setShowCreateModal(true)}
                    className="flex items-center justify-center rounded-lg h-10 px-5 bg-primary hover:bg-blue-600 text-white gap-2 text-sm font-bold shadow-lg shadow-blue-900/20 transition-all"
                >
                    <Icon name="add" />
                    <span>{t('Generate New Key')}</span>
                </button>
            </div>

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
                            <Icon name={stat.icon} className={stat.iconColor} />
                        </div>
                        <p className="text-slate-900 dark:text-white text-2xl font-bold leading-tight">
                            {stat.value}
                            {stat.unit && (
                                <span className="text-xs font-normal text-gray-400 ml-1">
                                    {stat.unit}
                                </span>
                            )}
                        </p>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-white dark:bg-surface-dark p-3 rounded-xl border border-gray-200 dark:border-border-dark shadow-sm">
                <div className="relative w-full md:w-96">
                    <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                        <Icon name="search" className="text-gray-400" />
                    </div>
                    <input
                        className="block w-full p-2.5 pl-10 text-sm text-slate-900 dark:text-white bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark rounded-lg focus:ring-primary focus:border-primary placeholder-gray-400 dark:placeholder-gray-500"
                        placeholder={t('Search by name or key prefix...')}
                        type="text"
                        value={search}
                        onChange={(e) => {
                            setSearch(e.target.value);
                            setPage(1);
                        }}
                    />
                </div>
                <div className="flex gap-2 w-full md:w-auto pb-1 md:pb-0">
                    <div className="relative">
                        <button
                            type="button"
                            id="status-dropdown-btn"
                            onClick={() => setStatusDropdownOpen(!statusDropdownOpen)}
                            className="flex items-center justify-between gap-2 bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark text-slate-900 dark:text-white text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5 min-w-[140px]"
                        >
                            <span>
                                {statusFilter === '' && t('All Status')}
                                {statusFilter === 'active' && t('Active')}
                                {statusFilter === 'revoked' && t('Revoked')}
                                {statusFilter === 'expiring' && t('Expiring')}
                            </span>
                            <Icon name={statusDropdownOpen ? 'expand_less' : 'expand_more'} size={18} />
                        </button>
                        {statusDropdownOpen && (
                            <StatusDropdownMenu
                                statusFilter={statusFilter}
                                onSelect={(value) => {
                                    setStatusFilter(value);
                                    setPage(1);
                                    setStatusDropdownOpen(false);
                                }}
                                onClose={() => setStatusDropdownOpen(false)}
                                t={t}
                            />
                        )}
                    </div>
                    <button
                        onClick={fetchData}
                        className="text-gray-500 dark:text-text-secondary hover:bg-gray-100 dark:hover:bg-background-dark p-2.5 rounded-lg border border-transparent hover:border-gray-200 dark:hover:border-border-dark transition-colors"
                        title={t('Refresh Data')}
                    >
                        <Icon name="refresh" />
                    </button>
                </div>
            </div>

            {/* Table */}
            <div
                ref={tableScrollRef}
                className="relative overflow-x-auto rounded-xl border border-gray-200 dark:border-border-dark shadow-sm"
                onScroll={handleTableScroll}
            >
                <table className="w-full text-sm text-left text-gray-500 dark:text-gray-400">
                    <thead className="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-surface-dark dark:text-gray-400 border-b border-gray-200 dark:border-border-dark">
                        <tr>
                            <th className="px-6 py-4 font-semibold tracking-wider">{t('Key Name / Value')}</th>
                            <th className="px-6 py-4 font-semibold tracking-wider">{t('Created')}</th>
                            <th className="px-6 py-4 font-semibold tracking-wider">{t('Expires')}</th>
                            <th className="px-6 py-4 font-semibold tracking-wider">{t('Last Used')}</th>
                            <th className="px-6 py-4 font-semibold tracking-wider">{t('Status')}</th>
                            <th
                                className={`px-6 py-4 font-semibold tracking-wider text-center sticky right-0 z-20 bg-gray-50 dark:bg-surface-dark relative after:content-[''] after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-gray-200 dark:after:bg-border-dark after:pointer-events-none ${
                                    showActionsDivider ? 'after:opacity-100' : 'after:opacity-0'
                                }`}
                            >
                                {t('Actions')}
                            </th>
                        </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-background-dark divide-y divide-gray-200 dark:divide-border-dark">
                        {loading ? (
                            <tr>
                                <td colSpan={6} className="px-6 py-12 text-center">
                                    {t('Loading...')}
                                </td>
                            </tr>
                        ) : apiKeys.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="px-6 py-12 text-center">
                                    {t('No API keys found')}
                                </td>
                            </tr>
                        ) : (
                            apiKeys.map((key) => (
                                <tr
                                    key={key.id}
                                    className={`bg-white dark:bg-background-dark hover:bg-gray-50 dark:hover:bg-surface-dark/50 group ${
                                        key.status === 'revoked' ? 'bg-gray-50/50 dark:bg-[#151b28] text-gray-400' : ''
                                    }`}
                                >
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col gap-1">
                                            <span
                                                className={`text-slate-900 dark:text-white font-medium ${
                                                    key.status === 'revoked' ? 'text-gray-500 dark:text-gray-400 line-through' : ''
                                                }`}
                                            >
                                                {key.name}
                                            </span>
                                            <div className="flex items-center gap-2 group-hover:opacity-100 opacity-80 transition-opacity">
                                                <code
                                                    className={`font-mono text-xs px-2 py-0.5 rounded border ${
                                                        key.status === 'revoked'
                                                            ? 'bg-transparent border-gray-200 dark:border-gray-700 text-gray-400'
                                                            : 'bg-gray-100 dark:bg-[#1a2436] border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
                                                    }`}
                                                >
                                                    {key.key_prefix}
                                                </code>
                                                {key.status !== 'revoked' && (
                                                    <button
                                                        onClick={() => handleCopy(key.key)}
                                                        className="text-gray-400 hover:text-primary transition-colors"
                                                        title={t('Copy Key')}
                                                    >
                                                        <Icon name="content_copy" size={16} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                    <td className={`px-6 py-4 font-mono text-xs ${key.status === 'revoked' ? 'opacity-50' : ''}`}>
                                        {formatDate(key.created_at, locale)}
                                    </td>
                                    <td className={`px-6 py-4 font-mono text-xs ${key.status === 'revoked' ? 'opacity-50' : ''}`}>
                                        {key.expires_at ? formatDate(key.expires_at, locale) : t('Never')}
                                    </td>
                                    <td className={`px-6 py-4 ${key.status === 'revoked' ? 'opacity-50' : ''}`}>
                                        <span className="text-gray-700 dark:text-gray-300 text-xs">
                                            {formatLastUsed(key.last_used_at, t)}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span
                                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${getStatusStyle(key.status)}`}
                                        >
                                            {getStatusText(key, t)}
                                        </span>
                                    </td>
                                    <td
                                        className={`px-6 py-4 text-center sticky right-0 z-10 bg-inherit relative after:content-[''] after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-gray-200 dark:after:bg-border-dark after:pointer-events-none ${
                                            showActionsDivider ? 'after:opacity-100' : 'after:opacity-0'
                                        }`}
                                    >
                                        <div className="flex items-center justify-center gap-2">
                                            {key.status === 'revoked' ? (
                                                <button
                                                    onClick={() => handleDelete(key.id)}
                                                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                                    title={t('Delete Permanently')}
                                                >
                                                    <Icon name="delete" size={18} />
                                                </button>
                                            ) : key.status === 'expiring' ? (
                                                <>
                                                    <button
                                                        onClick={() => setEditingKey(key)}
                                                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                                        title={t('Edit')}
                                                    >
                                                        <Icon name="edit" size={18} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleRenew(key.id)}
                                                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 dark:text-gray-400 hover:text-primary dark:hover:text-primary hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                                                        title={t('Renew Key')}
                                                    >
                                                        <Icon name="autorenew" size={18} />
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <button
                                                        onClick={() => setEditingKey(key)}
                                                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                                        title={t('Edit')}
                                                    >
                                                        <Icon name="edit" size={18} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleRevoke(key.id)}
                                                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                                        title={t('Revoke Key')}
                                                    >
                                                        <Icon name="block" size={18} />
                                                    </button>
                                                </>
                                            )}
                                        </div>
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
                        <span className="font-semibold text-slate-900 dark:text-white">{total}</span>
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

            {/* Create Modal */}
            {showCreateModal && (
                <CreateApiKeyModal
                    onClose={() => {
                        setShowCreateModal(false);
                        setNewKeyToken(null);
                    }}
                    onCreate={handleCreate}
                    newToken={newKeyToken}
                />
            )}

            {/* Edit Modal */}
            {editingKey && (
                <EditApiKeyModal
                    apiKey={editingKey}
                    onClose={() => setEditingKey(null)}
                    onUpdate={handleUpdate}
                />
            )}

            {/* Confirm Dialog */}
            {confirmDialog && (
                <ConfirmDialog
                    title={confirmDialog.title}
                    message={confirmDialog.message}
                    confirmText={confirmDialog.confirmText}
                    danger={confirmDialog.danger}
                    onConfirm={confirmDialog.onConfirm}
                    onCancel={() => setConfirmDialog(null)}
                />
            )}

            {/* Toast */}
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

interface CreateApiKeyModalProps {
    onClose: () => void;
    onCreate: (name: string, expiresInDays?: number) => void;
    newToken: string | null;
}

function CreateApiKeyModal({ onClose, onCreate, newToken }: CreateApiKeyModalProps) {
    const { t } = useTranslation();
    const [name, setName] = useState('');
    const [neverExpires, setNeverExpires] = useState(false);
    const [expiresInDays, setExpiresInDays] = useState<number | undefined>(90);
    const [copied, setCopied] = useState(false);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onCreate(name, neverExpires ? undefined : expiresInDays);
    };

    const handleCopyToken = async () => {
        if (newToken) {
            await navigator.clipboard.writeText(newToken);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white dark:bg-surface-dark rounded-xl shadow-xl w-full max-w-md mx-4 border border-gray-200 dark:border-border-dark max-h-[90vh] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-border-dark shrink-0">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                        {newToken ? t('API Key Created') : t('Generate New API Key')}
                    </h2>
                    <button
                        onClick={onClose}
                        className="inline-flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
                    >
                        <Icon name="close" />
                    </button>
                </div>

                {newToken ? (
                    <div className="p-6 flex-1 overflow-y-auto">
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                            {t("Your API key has been created. Copy it now as you won't be able to see it again.")}
                        </p>
                        <div className="flex items-center gap-2 p-3 bg-gray-100 dark:bg-background-dark rounded-lg border border-gray-200 dark:border-border-dark">
                            <code className="flex-1 font-mono text-sm text-slate-900 dark:text-white break-all">
                                {newToken}
                            </code>
                            <button
                                onClick={handleCopyToken}
                                className="p-2 text-gray-500 hover:text-primary transition-colors"
                            >
                                <Icon name={copied ? 'check' : 'content_copy'} size={18} />
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="p-6 flex-1 overflow-y-auto">
                        <form id="create-api-key-form" onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-900 dark:text-white mb-1">
                                    {t('Key Name')}
                                </label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder={t('e.g., Production-Backend')}
                                    className="w-full p-2.5 text-sm text-slate-900 dark:text-white bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark rounded-lg focus:ring-primary focus:border-primary"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-900 dark:text-white mb-1">
                                    {t('Expires In (Days)')}
                                </label>
                                <input
                                    type="number"
                                    value={neverExpires ? '' : (expiresInDays ?? '')}
                                    onChange={(e) =>
                                        setExpiresInDays(e.target.value ? parseInt(e.target.value) : undefined)
                                    }
                                    disabled={neverExpires}
                                    placeholder={t('e.g., 90')}
                                    className="w-full p-2.5 text-sm text-slate-900 dark:text-white bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark rounded-lg focus:ring-primary focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="never-expires"
                                    checked={neverExpires}
                                    onChange={(e) => setNeverExpires(e.target.checked)}
                                    className="w-4 h-4 text-primary bg-gray-50 dark:bg-background-dark border-gray-300 dark:border-border-dark rounded focus:ring-primary"
                                />
                                <label
                                    htmlFor="never-expires"
                                    className="text-sm text-slate-900 dark:text-white cursor-pointer"
                                >
                                    {t('Never expires')}
                                </label>
                            </div>
                        </form>
                    </div>
                )}
                {newToken ? (
                    <div className="px-6 py-4 border-t border-gray-200 dark:border-border-dark shrink-0">
                        <button
                            onClick={onClose}
                            className="w-full py-2.5 bg-primary hover:bg-blue-600 text-white rounded-lg font-medium transition-colors"
                        >
                            {t('Done')}
                        </button>
                    </div>
                ) : (
                    <div className="px-6 py-4 border-t border-gray-200 dark:border-border-dark shrink-0">
                        <button
                            type="submit"
                            form="create-api-key-form"
                            className="w-full py-2.5 bg-primary hover:bg-blue-600 text-white rounded-lg font-medium transition-colors"
                        >
                            {t('Generate Key')}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

interface EditApiKeyModalProps {
    apiKey: ApiKey;
    onClose: () => void;
    onUpdate: (id: number, name: string, expiresInDays?: number) => void;
}

function EditApiKeyModal({ apiKey, onClose, onUpdate }: EditApiKeyModalProps) {
    const { t } = useTranslation();
    const [name, setName] = useState(apiKey.name);
    const [neverExpires, setNeverExpires] = useState(!apiKey.expires_at);
    const [expiresInDays, setExpiresInDays] = useState<number | undefined>(() => {
        if (!apiKey.expires_at) return undefined;
        const days = Math.ceil(
            (new Date(apiKey.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        );
        return days > 0 ? days : 90;
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onUpdate(apiKey.id, name, neverExpires ? undefined : expiresInDays);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white dark:bg-surface-dark rounded-xl shadow-xl w-full max-w-md mx-4 border border-gray-200 dark:border-border-dark max-h-[90vh] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-border-dark shrink-0">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                        {t('Edit API Key')}
                    </h2>
                    <button
                        onClick={onClose}
                        className="inline-flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
                    >
                        <Icon name="close" />
                    </button>
                </div>

                <div className="p-6 flex-1 overflow-y-auto">
                    <form id="edit-api-key-form" onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-900 dark:text-white mb-1">
                                {t('Key Name')}
                            </label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder={t('e.g., Production-Backend')}
                                className="w-full p-2.5 text-sm text-slate-900 dark:text-white bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark rounded-lg focus:ring-primary focus:border-primary"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-900 dark:text-white mb-1">
                                {t('Expires In (Days)')}
                            </label>
                            <input
                                type="number"
                                value={neverExpires ? '' : (expiresInDays ?? '')}
                                onChange={(e) =>
                                    setExpiresInDays(e.target.value ? parseInt(e.target.value) : undefined)
                                }
                                disabled={neverExpires}
                                placeholder={t('e.g., 90')}
                                className="w-full p-2.5 text-sm text-slate-900 dark:text-white bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark rounded-lg focus:ring-primary focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="edit-never-expires"
                                checked={neverExpires}
                                onChange={(e) => setNeverExpires(e.target.checked)}
                                className="w-4 h-4 text-primary bg-gray-50 dark:bg-background-dark border-gray-300 dark:border-border-dark rounded focus:ring-primary"
                            />
                            <label
                                htmlFor="edit-never-expires"
                                className="text-sm text-slate-900 dark:text-white cursor-pointer"
                            >
                                {t('Never expires')}
                            </label>
                        </div>
                    </form>
                </div>
                <div className="px-6 py-4 border-t border-gray-200 dark:border-border-dark shrink-0">
                    <button
                        type="submit"
                        form="edit-api-key-form"
                        className="w-full py-2.5 bg-primary hover:bg-blue-600 text-white rounded-lg font-medium transition-colors"
                    >
                        {t('Save Changes')}
                    </button>
                </div>
            </div>
        </div>
    );
}
