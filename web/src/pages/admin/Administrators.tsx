import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminDashboardLayout } from '../../components/admin/AdminDashboardLayout';
import { AdminNoAccessCard } from '../../components/admin/AdminNoAccessCard';
import { Icon } from '../../components/Icon';
import { apiFetchAdmin } from '../../api/config';
import { buildAdminPermissionKey, useAdminPermissions } from '../../utils/adminPermissions';
import { useStickyActionsDivider } from '../../utils/stickyActionsDivider';
import { useTranslation } from 'react-i18next';

interface AdminItem {
    id: number;
    username: string;
    active: boolean;
    is_super_admin: boolean;
    permissions: string[];
    created_at: string;
    updated_at: string;
}

interface AdminListResponse {
    admins: AdminItem[];
}

interface PermissionDefinition {
    key: string;
    method: string;
    path: string;
    label: string;
    module: string;
}

interface PermissionsResponse {
    permissions: PermissionDefinition[];
}

interface AdminFormData {
    username: string;
    password: string;
    permissions: string[];
    is_super_admin: boolean;
}

interface AdminModalProps {
    mode: 'create' | 'edit';
    title: string;
    submitting: boolean;
    initialData: AdminFormData;
    permissionDefs: PermissionDefinition[];
    canEditPermissions: boolean;
    canChangePassword: boolean;
    onClose: () => void;
    onSubmit: (payload: AdminFormData) => void;
}

const PAGE_SIZE = 10;

const inputClassName =
    'w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent';

function normalizePermissions(permissions: string[]): string[] {
    return permissions.filter((item) => item.trim() !== '');
}

function groupPermissions(definitions: PermissionDefinition[]) {
    return definitions.reduce<Record<string, PermissionDefinition[]>>((acc, def) => {
        const key = def.module || 'Other';
        if (!acc[key]) {
            acc[key] = [];
        }
        acc[key].push(def);
        return acc;
    }, {});
}

function AdminModal({
    mode,
    title,
    submitting,
    initialData,
    permissionDefs,
    canEditPermissions,
    canChangePassword,
    onClose,
    onSubmit,
}: AdminModalProps) {
    const { t } = useTranslation();
    const [formData, setFormData] = useState<AdminFormData>(initialData);
    const [error, setError] = useState('');
    const [permissionSearch, setPermissionSearch] = useState('');

    const selectedPermissions = useMemo(
        () => new Set(formData.permissions),
        [formData.permissions]
    );

    const filteredPermissions = useMemo(() => {
        const query = permissionSearch.trim().toLowerCase();
        if (!query) {
            return permissionDefs;
        }
        return permissionDefs.filter((def) => {
            return (
                def.label.toLowerCase().includes(query) ||
                def.path.toLowerCase().includes(query) ||
                def.method.toLowerCase().includes(query) ||
                def.key.toLowerCase().includes(query)
            );
        });
    }, [permissionDefs, permissionSearch]);

    const groupedPermissions = useMemo(() => groupPermissions(filteredPermissions), [filteredPermissions]);

    const handleTogglePermission = (key: string) => {
        setFormData((prev) => {
            const next = new Set(prev.permissions);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return { ...prev, permissions: Array.from(next) };
        });
    };

    const handleSelectModule = (module: string, selected: boolean) => {
        setFormData((prev) => {
            const next = new Set(prev.permissions);
            const modulePermissions = permissionDefs
                .filter((def) => def.module === module)
                .map((def) => def.key);
            if (selected) {
                modulePermissions.forEach((key) => next.add(key));
            } else {
                modulePermissions.forEach((key) => next.delete(key));
            }
            return { ...prev, permissions: Array.from(next) };
        });
    };

    const handleSubmit = () => {
        const username = formData.username.trim();
        if (!username) {
            setError('Username is required.');
            return;
        }
        if (mode === 'create' && !formData.password.trim()) {
            setError('Password is required.');
            return;
        }
        setError('');
        onSubmit({
            ...formData,
            username,
            permissions: normalizePermissions(formData.permissions),
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white dark:bg-surface-dark rounded-xl shadow-xl w-full max-w-3xl mx-4 border border-gray-200 dark:border-border-dark max-h-[90vh] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-border-dark shrink-0">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
                    <button
                        onClick={onClose}
                        className="inline-flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
                    >
                        <Icon name="close" />
                    </button>
                </div>
                <div className="p-6 space-y-6 flex-1 overflow-y-auto">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                {t('Username')}
                            </label>
                            <input
                                type="text"
                                value={formData.username}
                                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                                placeholder={t('Enter username')}
                                className={inputClassName}
                            />
                        </div>
                        {canChangePassword && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                    {mode === 'create' ? t('Password') : t('New Password')}
                                </label>
                                <input
                                    type="password"
                                    value={formData.password}
                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                    placeholder={
                                        mode === 'create'
                                            ? t('Set password')
                                            : t('Leave empty to keep unchanged')
                                    }
                                    className={inputClassName}
                                />
                            </div>
                        )}
                    </div>

                    <div className="flex items-center justify-between gap-4 border border-gray-200 dark:border-border-dark rounded-lg px-4 py-3 bg-gray-50 dark:bg-background-dark">
                        <div>
                            <p className="text-sm font-medium text-slate-800 dark:text-white">{t('Super Admin')}</p>
                            <p className="text-xs text-slate-500 dark:text-text-secondary">
                                {t('Full access to all modules, regardless of permissions.')}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() =>
                                setFormData((prev) => ({
                                    ...prev,
                                    is_super_admin: !prev.is_super_admin,
                                }))
                            }
                            className={`w-14 h-7 rounded-full flex items-center px-1 transition-colors ${
                                formData.is_super_admin
                                    ? 'bg-emerald-500'
                                    : 'bg-gray-300 dark:bg-gray-600'
                            }`}
                        >
                            <span
                                className={`h-5 w-5 bg-white rounded-full shadow transform transition-transform ${
                                    formData.is_super_admin ? 'translate-x-7' : 'translate-x-0'
                                }`}
                            />
                        </button>
                    </div>

                    {!formData.is_super_admin && (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t('Permissions')}</h3>
                                    <p className="text-xs text-slate-500 dark:text-text-secondary">
                                        {t('Assign interface-level permissions for this administrator.')}
                                    </p>
                                </div>
                                {canEditPermissions && permissionDefs.length > 0 && (
                                    <div className="relative">
                                        <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <input
                                            type="text"
                                            value={permissionSearch}
                                            onChange={(e) => setPermissionSearch(e.target.value)}
                                            placeholder={t('Search permissions')}
                                            className="pl-9 pr-3 py-2 text-xs bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                                        />
                                    </div>
                                )}
                            </div>

                            {!canEditPermissions ? (
                                <div className="text-sm text-slate-500 dark:text-text-secondary border border-dashed border-gray-300 dark:border-border-dark rounded-lg p-4">
                                    {t('You do not have permission to edit access rules.')}
                                </div>
                            ) : permissionDefs.length === 0 ? (
                                <div className="text-sm text-slate-500 dark:text-text-secondary border border-dashed border-gray-300 dark:border-border-dark rounded-lg p-4">
                                    {t('No permission definitions available.')}
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {Object.entries(groupedPermissions).map(([module, items]) => {
                                        const moduleKeys = items.map((item) => item.key);
                                        const hasAll = moduleKeys.every((key) => selectedPermissions.has(key));
                                        return (
                                            <div
                                                key={module}
                                                className="border border-gray-200 dark:border-border-dark rounded-lg overflow-hidden"
                                            >
                                                <div className="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-background-dark">
                                                    <span className="text-sm font-medium text-slate-700 dark:text-gray-200">
                                                        {module}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleSelectModule(module, !hasAll)}
                                                        className="text-xs font-medium text-primary hover:text-blue-600"
                                                    >
                                                        {hasAll ? t('Clear') : t('Select all')}
                                                    </button>
                                                </div>
                                                <div className="divide-y divide-gray-200 dark:divide-border-dark">
                                                    {items.map((item) => (
                                                        <label
                                                            key={item.key}
                                                            className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-background-dark cursor-pointer"
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedPermissions.has(item.key)}
                                                                onChange={() => handleTogglePermission(item.key)}
                                                                className="mt-1 h-4 w-4 text-primary border-gray-300 rounded"
                                                            />
                                                            <div className="space-y-1">
                                                                <p className="text-sm font-medium text-slate-800 dark:text-gray-200">
                                                                    {item.label}
                                                                </p>
                                                                <p className="text-xs text-slate-500 dark:text-text-secondary font-mono">
                                                                    {item.method} {item.path}
                                                                </p>
                                                            </div>
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {error && <div className="text-sm text-red-600 dark:text-red-400">{t(error)}</div>}
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
                        {submitting ? t('Saving...') : mode === 'create' ? t('Create') : t('Save')}
                    </button>
                </div>
            </div>
        </div>
    );
}

function buildAdminFormData(admin?: AdminItem): AdminFormData {
    if (!admin) {
        return {
            username: '',
            password: '',
            permissions: [],
            is_super_admin: false,
        };
    }
    return {
        username: admin.username,
        password: '',
        permissions: admin.permissions || [],
        is_super_admin: admin.is_super_admin,
    };
}

export function AdminAdministrators() {
    const { t, i18n } = useTranslation();
    const { hasPermission } = useAdminPermissions();

    const canListAdmins = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/admins'));
    const canCreateAdmin = hasPermission(buildAdminPermissionKey('POST', '/v0/admin/admins'));
    const canUpdateAdmin = hasPermission(buildAdminPermissionKey('PUT', '/v0/admin/admins/:id'));
    const canDeleteAdmin = hasPermission(buildAdminPermissionKey('DELETE', '/v0/admin/admins/:id'));
    const canDisableAdmin = hasPermission(buildAdminPermissionKey('POST', '/v0/admin/admins/:id/disable'));
    const canEnableAdmin = hasPermission(buildAdminPermissionKey('POST', '/v0/admin/admins/:id/enable'));
    const canChangePassword = hasPermission(buildAdminPermissionKey('PUT', '/v0/admin/admins/:id/password'));
    const canListPermissions = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/permissions'));

    const [admins, setAdmins] = useState<AdminItem[]>([]);
    const [permissionDefs, setPermissionDefs] = useState<PermissionDefinition[]>([]);
    const [loading, setLoading] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [searchUsername, setSearchUsername] = useState('');
    const [searchId, setSearchId] = useState('');
    const [query, setQuery] = useState({ username: '', id: '' });
    const locale = i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US';

    const [createOpen, setCreateOpen] = useState(false);
    const [editAdmin, setEditAdmin] = useState<AdminItem | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const fetchAdmins = useCallback(async () => {
        if (!canListAdmins) {
            return;
        }
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (query.username) {
                params.set('username', query.username);
            }
            if (query.id) {
                params.set('id', query.id);
            }
            const url = params.toString()
                ? `/v0/admin/admins?${params.toString()}`
                : '/v0/admin/admins';
            const res = await apiFetchAdmin<AdminListResponse>(url);
            setAdmins(res.admins || []);
        } catch (err) {
            console.error('Failed to fetch admins:', err);
        } finally {
            setLoading(false);
        }
    }, [canListAdmins, query]);

    const fetchPermissions = useCallback(async () => {
        if (!canListPermissions) {
            return;
        }
        try {
            const res = await apiFetchAdmin<PermissionsResponse>('/v0/admin/permissions');
            setPermissionDefs(res.permissions || []);
        } catch (err) {
            console.error('Failed to fetch permissions:', err);
        }
    }, [canListPermissions]);

    useEffect(() => {
        fetchAdmins();
    }, [fetchAdmins]);

    useEffect(() => {
        fetchPermissions();
    }, [fetchPermissions]);

    useEffect(() => {
        const timer = setTimeout(() => {
            setQuery({
                username: searchUsername.trim(),
                id: searchId.trim(),
            });
            setCurrentPage(1);
        }, 300);
        return () => clearTimeout(timer);
    }, [searchUsername, searchId]);

    const totalPages = Math.ceil(admins.length / PAGE_SIZE);
    const paginatedAdmins = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return admins.slice(start, start + PAGE_SIZE);
    }, [admins, currentPage]);

    const { tableScrollRef, handleTableScroll, showActionsDivider } = useStickyActionsDivider(
        paginatedAdmins.length,
        loading
    );

    const handleCreate = async (payload: AdminFormData) => {
        if (!canCreateAdmin) {
            return;
        }
        setSubmitting(true);
        try {
            await apiFetchAdmin('/v0/admin/admins', {
                method: 'POST',
                body: JSON.stringify({
                    username: payload.username,
                    password: payload.password,
                    permissions: payload.permissions,
                    is_super_admin: payload.is_super_admin,
                }),
            });
            setCreateOpen(false);
            fetchAdmins();
        } catch (err) {
            console.error(err);
        } finally {
            setSubmitting(false);
        }
    };

    const handleUpdate = async (payload: AdminFormData) => {
        if (!editAdmin || !canUpdateAdmin) {
            return;
        }
        setSubmitting(true);
        try {
            await apiFetchAdmin(`/v0/admin/admins/${editAdmin.id}`, {
                method: 'PUT',
                body: JSON.stringify({
                    username: payload.username,
                    permissions: payload.permissions,
                    is_super_admin: payload.is_super_admin,
                }),
            });
            if (canChangePassword && payload.password.trim()) {
                await apiFetchAdmin(`/v0/admin/admins/${editAdmin.id}/password`, {
                    method: 'PUT',
                    body: JSON.stringify({ password: payload.password }),
                });
            }
            setAdmins((prev) =>
                prev.map((item) =>
                    item.id === editAdmin.id
                        ? {
                            ...item,
                            username: payload.username,
                            permissions: payload.permissions,
                            is_super_admin: payload.is_super_admin,
                        }
                        : item
                )
            );
            setEditAdmin(null);
        } catch (err) {
            console.error(err);
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (admin: AdminItem) => {
        if (!canDeleteAdmin) {
            return;
        }
        if (
            !confirm(
                t('Are you sure you want to delete administrator "{{username}}"?', {
                    username: admin.username,
                })
            )
        ) {
            return;
        }
        try {
            await apiFetchAdmin(`/v0/admin/admins/${admin.id}`, { method: 'DELETE' });
            setAdmins((prev) => prev.filter((item) => item.id !== admin.id));
        } catch (err) {
            console.error(err);
        }
    };

    const handleToggleActive = async (admin: AdminItem) => {
        if (admin.active && !canDisableAdmin) {
            return;
        }
        if (!admin.active && !canEnableAdmin) {
            return;
        }
        try {
            const endpoint = admin.active
                ? `/v0/admin/admins/${admin.id}/disable`
                : `/v0/admin/admins/${admin.id}/enable`;
            await apiFetchAdmin(endpoint, { method: 'POST' });
            setAdmins((prev) =>
                prev.map((item) =>
                    item.id === admin.id ? { ...item, active: !admin.active } : item
                )
            );
        } catch (err) {
            console.error(err);
        }
    };

    const formatDate = (dateString: string) => new Date(dateString).toLocaleString(locale);

    if (!canListAdmins) {
        return (
            <AdminDashboardLayout
                title={t('Administrators')}
                subtitle={t('Manage admin accounts and access permissions.')}
            >
                <AdminNoAccessCard />
            </AdminDashboardLayout>
        );
    }

    return (
        <AdminDashboardLayout
            title={t('Administrators')}
            subtitle={t('Manage admin accounts and access permissions.')}
        >
            <div className="space-y-6">
                {canCreateAdmin && (
                    <div className="flex justify-end">
                        <button
                            onClick={() => setCreateOpen(true)}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors font-medium"
                        >
                            <Icon name="add" size={18} />
                            {t('New Administrator')}
                        </button>
                    </div>
                )}

                <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-sm p-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex flex-col md:flex-row gap-3 w-full">
                        <div className="relative w-full md:w-72">
                            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                                <Icon name="search" className="text-gray-400" />
                            </div>
                            <input
                                className="block w-full p-2.5 pl-10 text-sm text-slate-900 dark:text-white bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark rounded-lg focus:ring-primary focus:border-primary placeholder-gray-400 dark:placeholder-gray-500"
                                placeholder={t('Search by username')}
                                type="text"
                                value={searchUsername}
                                onChange={(e) => setSearchUsername(e.target.value)}
                            />
                        </div>
                        <div className="relative w-full md:w-40">
                            <input
                                className="block w-full p-2.5 text-sm text-slate-900 dark:text-white bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark rounded-lg focus:ring-primary focus:border-primary placeholder-gray-400 dark:placeholder-gray-500"
                                placeholder={t('ID')}
                                type="text"
                                value={searchId}
                                onChange={(e) => setSearchId(e.target.value)}
                            />
                        </div>
                    </div>
                    <button
                        onClick={() => fetchAdmins()}
                        className="h-10 w-10 inline-flex items-center justify-center text-slate-500 hover:text-primary hover:bg-slate-50 dark:hover:bg-background-dark rounded-lg border border-gray-200 dark:border-border-dark transition-colors"
                        title={t('Refresh')}
                    >
                        <Icon name="refresh" size={18} />
                    </button>
                </div>

                <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-sm overflow-hidden">
                    <div ref={tableScrollRef} className="overflow-x-auto" onScroll={handleTableScroll}>
                        <table className="w-full text-left text-sm">
                            <thead className="bg-gray-50 dark:bg-surface-dark text-gray-500 dark:text-gray-400 uppercase text-xs font-semibold border-b border-gray-200 dark:border-border-dark">
                                <tr>
                                    <th className="px-6 py-4">{t('ID')}</th>
                                    <th className="px-6 py-4">{t('Username')}</th>
                                    <th className="px-6 py-4">{t('Status')}</th>
                                    <th className="px-6 py-4">{t('Role')}</th>
                                    <th className="px-6 py-4">{t('Permissions')}</th>
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
                                                <div className="animate-pulse h-4 bg-slate-200 dark:bg-border-dark rounded" />
                                            </td>
                                        </tr>
                                    ))
                                ) : paginatedAdmins.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="px-6 py-8 text-center text-slate-500 dark:text-text-secondary">
                                            {query.username || query.id
                                                ? t('No administrators found')
                                                : t('No administrators yet')}
                                        </td>
                                    </tr>
                                ) : (
                                    paginatedAdmins.map((admin) => (
                                        <tr
                                            key={admin.id}
                                            className="hover:bg-gray-50 dark:hover:bg-background-dark group"
                                        >
                                            <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary font-mono">
                                                {admin.id}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-slate-700 dark:text-white font-medium">
                                                {admin.username}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                {admin.active ? (
                                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20">
                                                        {t('Active')}
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-red-100 text-red-800 dark:bg-red-500/10 dark:text-red-400 border-red-200 dark:border-red-500/20">
                                                        {t('Disabled')}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                {admin.is_super_admin ? (
                                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-indigo-100 text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-400 border-indigo-200 dark:border-indigo-500/20">
                                                        {t('Super Admin')}
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-gray-100 text-gray-700 dark:bg-gray-500/10 dark:text-gray-300 border-gray-200 dark:border-gray-500/20">
                                                        {t('Standard')}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary">
                                                {admin.is_super_admin
                                                    ? t('Full access')
                                                    : admin.permissions?.length
                                                        ? t('{{count}} permissions', {
                                                            count: admin.permissions.length,
                                                        })
                                                        : t('No access')}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary font-mono text-xs">
                                                {formatDate(admin.created_at)}
                                            </td>
                                            <td
                                                className={`px-6 py-4 whitespace-nowrap text-center sticky right-0 z-10 bg-white dark:bg-surface-dark group-hover:bg-gray-50 dark:group-hover:bg-background-dark relative after:content-[''] after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-gray-200 dark:after:bg-border-dark after:pointer-events-none ${
                                                    showActionsDivider ? 'after:opacity-100' : 'after:opacity-0'
                                                }`}
                                            >
                                                <div className="flex items-center justify-center gap-1">
                                                    {canUpdateAdmin && (
                                                        <button
                                                            onClick={() => setEditAdmin(admin)}
                                                            className="p-2 text-gray-400 hover:text-primary hover:bg-gray-100 dark:hover:bg-background-dark rounded-lg transition-colors"
                                                            title={t('Edit')}
                                                        >
                                                            <Icon name="edit" size={18} />
                                                        </button>
                                                    )}
                                                    {(admin.active ? canDisableAdmin : canEnableAdmin) && (
                                                        <button
                                                            onClick={() => handleToggleActive(admin)}
                                                            className={`p-2 rounded-lg transition-colors ${
                                                                admin.active
                                                                    ? 'text-gray-400 hover:text-amber-500 hover:bg-gray-100 dark:hover:bg-background-dark'
                                                                    : 'text-gray-400 hover:text-emerald-500 hover:bg-gray-100 dark:hover:bg-background-dark'
                                                            }`}
                                                            title={admin.active ? t('Disable') : t('Enable')}
                                                        >
                                                            <Icon name={admin.active ? 'toggle_off' : 'toggle_on'} size={18} />
                                                        </button>
                                                    )}
                                                    {canDeleteAdmin && (
                                                        <button
                                                            onClick={() => handleDelete(admin)}
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
                            <span className="text-sm text-slate-500 dark:text-text-secondary">
                                {t('Showing {{from}} to {{to}} of {{total}} administrators', {
                                    from: (currentPage - 1) * PAGE_SIZE + 1,
                                    to: Math.min(currentPage * PAGE_SIZE, admins.length),
                                    total: admins.length,
                                })}
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                    disabled={currentPage === 1}
                                    className="p-2 rounded-lg border border-gray-200 dark:border-border-dark text-slate-600 dark:text-text-secondary hover:bg-slate-50 dark:hover:bg-background-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    <Icon name="chevron_left" size={18} />
                                </button>
                                <span className="text-sm text-slate-600 dark:text-text-secondary px-3">
                                    {t('Page {{current}} of {{total}}', {
                                        current: currentPage,
                                        total: totalPages,
                                    })}
                                </span>
                                <button
                                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                    disabled={currentPage === totalPages}
                                    className="p-2 rounded-lg border border-gray-200 dark:border-border-dark text-slate-600 dark:text-text-secondary hover:bg-slate-50 dark:hover:bg-background-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    <Icon name="chevron_right" size={18} />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {createOpen && (
                <AdminModal
                    mode="create"
                    title={t('Create Administrator')}
                    submitting={submitting}
                    initialData={buildAdminFormData()}
                    permissionDefs={permissionDefs}
                    canEditPermissions={canListPermissions}
                    canChangePassword={true}
                    onClose={() => setCreateOpen(false)}
                    onSubmit={handleCreate}
                />
            )}

            {editAdmin && (
                <AdminModal
                    mode="edit"
                    title={t('Edit {{name}}', { name: editAdmin.username })}
                    submitting={submitting}
                    initialData={buildAdminFormData(editAdmin)}
                    permissionDefs={permissionDefs}
                    canEditPermissions={canListPermissions}
                    canChangePassword={canChangePassword}
                    onClose={() => setEditAdmin(null)}
                    onSubmit={handleUpdate}
                />
            )}
        </AdminDashboardLayout>
    );
}
