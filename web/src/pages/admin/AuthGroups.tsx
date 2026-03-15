import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminDashboardLayout } from '../../components/admin/AdminDashboardLayout';
import { AdminNoAccessCard } from '../../components/admin/AdminNoAccessCard';
import { MultiGroupDropdownMenu } from '../../components/admin/MultiGroupDropdownMenu';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { apiFetchAdmin } from '../../api/config';
import { Icon } from '../../components/Icon';
import { buildAdminPermissionKey, useAdminPermissions } from '../../utils/adminPermissions';
import { useStickyActionsDivider } from '../../utils/stickyActionsDivider';
import { useTranslation } from 'react-i18next';

interface AuthGroup {
    id: number;
    name: string;
    is_default: boolean;
    rate_limit: number;
    user_group_id: number[];
    created_at: string;
    updated_at: string;
}

interface ListResponse {
    auth_groups: AuthGroup[];
}

interface UserGroup {
    id: number;
    name: string;
}

interface UserGroupsResponse {
    user_groups: UserGroup[];
}

interface AuthGroupFormData {
    name: string;
    is_default: boolean;
    rate_limit: string;
    user_group_id: number[];
}

interface ConfirmDialogState {
    title: string;
    message: string;
    confirmText?: string;
    danger?: boolean;
    onConfirm: () => void;
}

interface AuthGroupModalProps {
    title: string;
    initialData: AuthGroupFormData;
    userGroups: UserGroup[];
    submitting: boolean;
    onClose: () => void;
    onSubmit: (payload: Record<string, unknown>) => void;
}

const PAGE_SIZE = 10;

const inputClassName =
    'w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent';

function AuthGroupModal({ title, initialData, userGroups, submitting, onClose, onSubmit }: AuthGroupModalProps) {
    const { t } = useTranslation();
    const [formData, setFormData] = useState<AuthGroupFormData>(initialData);
    const [error, setError] = useState('');
    const [groupMenuOpen, setGroupMenuOpen] = useState(false);
    const [groupSearch, setGroupSearch] = useState('');
    const groupBtnWidth = useMemo(() => {
        const allOptions = [t('All Groups'), ...userGroups.map((g) => `${g.name} #${g.id}`)];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return undefined;
        }
        ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
        let maxWidth = 0;
        for (const opt of allOptions) {
            const width = ctx.measureText(opt).width;
            if (width > maxWidth) maxWidth = width;
        }
        return Math.ceil(maxWidth) + 76;
    }, [userGroups, t]);

    const handleSubmit = () => {
        const name = formData.name.trim();
        if (!name) {
            setError('Name is required.');
            return;
        }
        const rateLimitRaw = formData.rate_limit.trim();
        const rateLimit = rateLimitRaw === '' ? 0 : Number.parseInt(rateLimitRaw, 10);
        if (Number.isNaN(rateLimit) || rateLimit < 0) {
            setError('Rate limit must be a non-negative integer.');
            return;
        }
        setError('');
        onSubmit({
            name,
            is_default: formData.is_default,
            rate_limit: rateLimit,
            user_group_id: formData.user_group_id,
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white dark:bg-surface-dark rounded-xl shadow-xl w-full max-w-lg mx-4 border border-gray-200 dark:border-border-dark max-h-[90vh] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-border-dark shrink-0">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                        {title}
                    </h2>
                    <button
                        onClick={onClose}
                        className="inline-flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
                    >
                        <Icon name="close" />
                    </button>
                </div>
                <div className="p-6 space-y-4 flex-1 overflow-y-auto">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Name')}
                        </label>
                        <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            placeholder={t('Enter group name')}
                            className={inputClassName}
                        />
                    </div>
                    <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            {t('Default')}
                        </label>
                        <button
                            type="button"
                            onClick={() => setFormData({ ...formData, is_default: !formData.is_default })}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                formData.is_default ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
                            }`}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                    formData.is_default ? 'translate-x-6' : 'translate-x-1'
                                }`}
                            />
                        </button>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Rate limit')}
                        </label>
                        <input
                            type="number"
                            step="1"
                            value={formData.rate_limit}
                            onChange={(e) => setFormData({ ...formData, rate_limit: e.target.value })}
                            placeholder="0"
                            className={inputClassName}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('User Group')}
                        </label>
                        <div className="relative">
                            <button
                                type="button"
                                id="auth-group-user-groups-btn"
                                onClick={() => setGroupMenuOpen(!groupMenuOpen)}
                                className="flex items-center justify-between gap-2 w-full bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark text-slate-900 dark:text-white text-sm rounded-lg focus:ring-primary focus:border-primary px-4 py-2.5"
                                style={groupBtnWidth ? { minWidth: groupBtnWidth } : undefined}
                                title={
                                    formData.user_group_id.length === 0
                                        ? t('All Groups')
                                        : formData.user_group_id
                                              .map((id) => userGroups.find((g) => g.id === id)?.name || `#${id}`)
                                              .join(', ')
                                }
                            >
                                <span className="truncate">
                                    {formData.user_group_id.length === 0
                                        ? t('All Groups')
                                        : t('Selected {{count}}', { count: formData.user_group_id.length })}
                                </span>
                                <Icon name={groupMenuOpen ? 'expand_less' : 'expand_more'} size={18} />
                            </button>
                            {groupMenuOpen && (
                                <MultiGroupDropdownMenu
                                    anchorId="auth-group-user-groups-btn"
                                    groups={userGroups}
                                    selectedIds={formData.user_group_id}
                                    search={groupSearch}
                                    emptyLabel={t('All Groups')}
                                    menuWidth={groupBtnWidth}
                                    onSearchChange={setGroupSearch}
                                    onToggle={(value) =>
                                        setFormData((prev) => ({
                                            ...prev,
                                            user_group_id: prev.user_group_id.includes(value)
                                                ? prev.user_group_id.filter((id) => id !== value)
                                                : [...prev.user_group_id, value],
                                        }))
                                    }
                                    onClear={() => setFormData((prev) => ({ ...prev, user_group_id: [] }))}
                                    onClose={() => setGroupMenuOpen(false)}
                                />
                            )}
                        </div>
                        <p className="mt-1 text-xs text-slate-500 dark:text-text-secondary">
                            {t('Empty means all user groups can use this auth group.')}
                        </p>
                    </div>
                    {error && (
                        <div className="text-sm text-red-600 dark:text-red-400">
                            {t(error)}
                        </div>
                    )}
                </div>
                <div className="flex gap-3 px-6 py-4 border-t border-gray-200 dark:border-border-dark shrink-0">
                    <button
                        onClick={onClose}
                        className="flex-1 py-2.5 bg-gray-100 dark:bg-background-dark hover:bg-gray-200 dark:hover:bg-gray-700 text-slate-900 dark:text-white rounded-lg font-medium transition-colors border border-gray-200 dark:border-border-dark"
                    >
                        {t('Cancel')}
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={submitting}
                        className="flex-1 py-2.5 bg-primary hover:bg-blue-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {submitting ? t('Saving...') : t('Save')}
                    </button>
                </div>
            </div>
        </div>
    );
}

function buildFormData(group?: AuthGroup): AuthGroupFormData {
    if (!group) {
        return {
            name: '',
            is_default: false,
            rate_limit: '0',
            user_group_id: [],
        };
    }
    return {
        name: group.name,
        is_default: group.is_default,
        rate_limit: String(group.rate_limit ?? 0),
        user_group_id: group.user_group_id ?? [],
    };
}

export function AdminAuthGroups() {
    const { t, i18n } = useTranslation();
    const { hasPermission } = useAdminPermissions();
    const canListGroups = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/auth-groups'));
    const canCreateGroup = hasPermission(buildAdminPermissionKey('POST', '/v0/admin/auth-groups'));
    const canUpdateGroup = hasPermission(buildAdminPermissionKey('PUT', '/v0/admin/auth-groups/:id'));
    const canDeleteGroup = hasPermission(buildAdminPermissionKey('DELETE', '/v0/admin/auth-groups/:id'));
    const canSetDefault = hasPermission(
        buildAdminPermissionKey('POST', '/v0/admin/auth-groups/:id/default')
    );
    const canListUserGroups = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/user-groups'));

    const [groups, setGroups] = useState<AuthGroup[]>([]);
    const [userGroups, setUserGroups] = useState<UserGroup[]>([]);
    const [loading, setLoading] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);
    const [createOpen, setCreateOpen] = useState(false);
    const [editGroup, setEditGroup] = useState<AuthGroup | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
    const locale = i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US';

    const fetchGroups = useCallback(() => {
        if (!canListGroups) {
            return;
        }
        setLoading(true);
        apiFetchAdmin<ListResponse>('/v0/admin/auth-groups')
            .then((res) => setGroups(res.auth_groups || []))
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [canListGroups]);

    useEffect(() => {
        if (canListGroups) {
            fetchGroups();
        }
    }, [fetchGroups, canListGroups]);

    useEffect(() => {
        if (!canListUserGroups) {
            return;
        }
        apiFetchAdmin<UserGroupsResponse>('/v0/admin/user-groups')
            .then((res) => setUserGroups(res.user_groups || []))
            .catch(console.error);
    }, [canListUserGroups]);

    const totalPages = Math.ceil(groups.length / PAGE_SIZE);
    const paginatedGroups = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return groups.slice(start, start + PAGE_SIZE);
    }, [groups, currentPage]);

    const { tableScrollRef, handleTableScroll, showActionsDivider } = useStickyActionsDivider(
        paginatedGroups.length,
        loading
    );

    const handleCreate = async (payload: Record<string, unknown>) => {
        if (!canCreateGroup) {
            return;
        }
        setSubmitting(true);
        try {
            await apiFetchAdmin('/v0/admin/auth-groups', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            setCreateOpen(false);
            fetchGroups();
        } catch (err) {
            console.error(err);
        } finally {
            setSubmitting(false);
        }
    };

    const handleUpdate = async (payload: Record<string, unknown>) => {
        if (!editGroup || !canUpdateGroup) return;
        setSubmitting(true);
        try {
            await apiFetchAdmin(`/v0/admin/auth-groups/${editGroup.id}`, {
                method: 'PUT',
                body: JSON.stringify(payload),
            });
            setGroups((prev) =>
                prev.map((item) =>
                    item.id === editGroup.id
                        ? { ...item, ...payload }
                        : item
                )
            );
            setEditGroup(null);
        } catch (err) {
            console.error(err);
        } finally {
            setSubmitting(false);
        }
    };

    const handleSetDefault = async (group: AuthGroup) => {
        if (group.is_default || !canSetDefault) return;
        try {
            await apiFetchAdmin(`/v0/admin/auth-groups/${group.id}/default`, {
                method: 'POST',
            });
            fetchGroups();
        } catch (err) {
            console.error(err);
        }
    };

    const handleDelete = async (group: AuthGroup) => {
        if (!canDeleteGroup) {
            return;
        }
        setConfirmDialog({
            title: t('Delete Authentication Group'),
            message: t(
                'Are you sure you want to delete authentication group #{{id}}? This action cannot be undone.',
                { id: group.id }
            ),
            confirmText: t('Delete'),
            danger: true,
            onConfirm: async () => {
                try {
                    await apiFetchAdmin(`/v0/admin/auth-groups/${group.id}`, { method: 'DELETE' });
                    fetchGroups();
                } catch (err) {
                    console.error(err);
                } finally {
                    setConfirmDialog(null);
                }
            },
        });
    };

    const pageInfo = useMemo(() => {
        if (!groups.length) return t('No auth groups found');
        const start = (currentPage - 1) * PAGE_SIZE + 1;
        const end = Math.min(currentPage * PAGE_SIZE, groups.length);
        return t('Showing {{from}} to {{to}} of {{total}} authentication groups', {
            from: start,
            to: end,
            total: groups.length,
        });
    }, [groups.length, currentPage, t]);

    if (!canListGroups) {
        return (
            <AdminDashboardLayout
                title={t('Authentication Files Groups')}
                subtitle={t('Manage credential group assignments')}
            >
                <AdminNoAccessCard />
            </AdminDashboardLayout>
        );
    }

    return (
        <AdminDashboardLayout
            title={t('Authentication Files Groups')}
            subtitle={t('Manage credential group assignments')}
        >
            <div className="space-y-6">
                {canCreateGroup && (
                    <div className="flex justify-end">
                        <button
                            onClick={() => setCreateOpen(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors font-medium"
                        >
                            <Icon name="add" size={18} />
                            {t('New Group')}
                        </button>
                    </div>
                )}

                <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-sm overflow-hidden">
                    <div ref={tableScrollRef} className="overflow-x-auto" onScroll={handleTableScroll}>
                        <table className="w-full text-left text-sm">
                            <thead className="bg-gray-50 dark:bg-surface-dark text-gray-500 dark:text-gray-400 uppercase text-xs font-semibold border-b border-gray-200 dark:border-border-dark">
                                <tr>
                                    <th className="px-6 py-4">{t('ID')}</th>
                                    <th className="px-6 py-4">{t('Name')}</th>
                                    <th className="px-6 py-4">{t('Default')}</th>
                                    <th className="px-6 py-4">{t('Rate limit')}</th>
                                    <th className="px-6 py-4">{t('User Group')}</th>
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
                                        <td colSpan={7} className="px-6 py-4">
                                            <div className="animate-pulse h-4 bg-slate-200 dark:bg-border-dark rounded"></div>
                                        </td>
                                    </tr>
                                ))
                            ) : paginatedGroups.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-6 py-8 text-center text-slate-500 dark:text-text-secondary">
                                        {t('No auth groups found')}
                                    </td>
                                </tr>
                            ) : (
                                paginatedGroups.map((group) => (
                                    <tr
                                        key={group.id}
                                        className="hover:bg-gray-50 dark:hover:bg-background-dark group"
                                    >
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-700 dark:text-white font-medium">
                                            {group.id}
                                        </td>
                                        <td className="px-6 py-4 text-slate-600 dark:text-text-secondary">
                                            {group.name}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                                                group.is_default
                                                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20'
                                                    : 'bg-gray-100 text-gray-800 dark:bg-gray-500/10 dark:text-gray-400 border-gray-200 dark:border-gray-500/20'
                                            }`}>
                                                {group.is_default ? t('Yes') : t('No')}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary font-mono">
                                            {group.rate_limit.toLocaleString()}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary">
                                            <span
                                                className="truncate"
                                                title={
                                                    group.user_group_id.length === 0
                                                        ? t('All Groups')
                                                        : group.user_group_id
                                                              .map((id) => userGroups.find((g) => g.id === id)?.name || `#${id}`)
                                                              .join(', ')
                                                }
                                            >
                                                {group.user_group_id.length === 0
                                                    ? t('All Groups')
                                                    : t('Selected {{count}}', { count: group.user_group_id.length })}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary font-mono text-xs">
                                            {new Date(group.created_at).toLocaleDateString(locale)}
                                        </td>
                                        <td
                                            className={`px-6 py-4 whitespace-nowrap text-center sticky right-0 z-10 bg-white dark:bg-surface-dark group-hover:bg-gray-50 dark:group-hover:bg-background-dark relative after:content-[''] after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-gray-200 dark:after:bg-border-dark after:pointer-events-none ${
                                                showActionsDivider ? 'after:opacity-100' : 'after:opacity-0'
                                            }`}
                                        >
                                            <div className="flex items-center justify-center gap-1">
                                                {canUpdateGroup && (
                                                    <button
                                                        onClick={() => setEditGroup(group)}
                                                        className="p-2 text-gray-400 hover:text-primary hover:bg-gray-100 dark:hover:bg-background-dark rounded-lg transition-colors"
                                                        title={t('Edit')}
                                                    >
                                                        <Icon name="edit" size={18} />
                                                    </button>
                                                )}
                                                {canSetDefault && (
                                                    <button
                                                        onClick={() => handleSetDefault(group)}
                                                        className={`p-2 rounded-lg transition-colors ${
                                                            group.is_default
                                                                ? 'text-gray-300 cursor-not-allowed'
                                                                : 'text-gray-400 hover:text-emerald-500 hover:bg-gray-100 dark:hover:bg-background-dark'
                                                        }`}
                                                        title={group.is_default ? t('Default') : t('Set Default')}
                                                        disabled={group.is_default}
                                                    >
                                                        <Icon name="check_circle" size={18} />
                                                    </button>
                                                )}
                                                {canDeleteGroup && (
                                                    <button
                                                        onClick={() => handleDelete(group)}
                                                        className="p-2 text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-background-dark rounded-lg transition-colors"
                                                        title={t('Delete')}
                                                    >
                                                        <Icon name="delete" size={18} />
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                {totalPages > 1 && (
                    <div className="px-6 py-4 border-t border-gray-200 dark:border-border-dark flex items-center justify-between">
                        <div className="text-sm text-slate-500 dark:text-text-secondary">
                            {pageInfo}
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

            {createOpen && (
                <AuthGroupModal
                    title={t('New Authentication Group')}
                    initialData={buildFormData()}
                    userGroups={userGroups}
                    submitting={submitting}
                    onClose={() => setCreateOpen(false)}
                    onSubmit={handleCreate}
                />
            )}
            {editGroup && (
                <AuthGroupModal
                    title={t('Edit Authentication Group #{{id}}', { id: editGroup.id })}
                    initialData={buildFormData(editGroup)}
                    userGroups={userGroups}
                    submitting={submitting}
                    onClose={() => setEditGroup(null)}
                    onSubmit={handleUpdate}
                />
            )}
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
        </AdminDashboardLayout>
    );
}
