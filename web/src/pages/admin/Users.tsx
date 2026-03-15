import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AdminDashboardLayout } from '../../components/admin/AdminDashboardLayout';
import { AdminNoAccessCard } from '../../components/admin/AdminNoAccessCard';
import { apiFetchAdmin } from '../../api/config';
import { MultiGroupDropdownMenu } from '../../components/admin/MultiGroupDropdownMenu';
import { Icon } from '../../components/Icon';
import { buildAdminPermissionKey, useAdminPermissions } from '../../utils/adminPermissions';
import { useStickyActionsDivider } from '../../utils/stickyActionsDivider';
import { useTranslation } from 'react-i18next';

interface User {
    id: number;
    username: string;
    email: string;
    user_group_id: number[];
    bill_user_group_id: number[];
    daily_max_usage: number;
    rate_limit: number;
    active: boolean;
    disabled: boolean;
    created_at: string;
    updated_at: string;
}

interface UsersResponse {
    users: User[];
}

interface CreateFormData {
    username: string;
    email: string;
    password: string;
    user_group_id: number[];
    daily_max_usage: string;
    rate_limit: string;
    disabled: boolean;
}

interface EditFormData {
    username: string;
    email: string;
    password: string;
    user_group_id: number[];
    daily_max_usage: string;
    rate_limit: string;
    disabled: boolean;
}

interface GroupOption {
    id: number;
    name: string;
}

interface GroupListResponse {
    user_groups: GroupOption[];
}

interface SearchableDropdownMenuProps {
    anchorId: string;
    options: GroupOption[];
    selectedId: number | null;
    search: string;
    menuWidth?: number;
    onSearchChange: (value: string) => void;
    onSelect: (value: number) => void;
    onClose: () => void;
}

const PAGE_SIZE = 10;

function toggleGroupId(ids: number[], value: number) {
    if (ids.includes(value)) {
        return ids.filter((id) => id !== value);
    }
    return [...ids, value];
}

function SearchableDropdownMenu({
    anchorId,
    options,
    selectedId,
    search,
    menuWidth,
    onSearchChange,
    onSelect,
    onClose,
}: SearchableDropdownMenuProps) {
    const { t } = useTranslation();
    const btn = document.getElementById(anchorId);
    const rect = btn ? btn.getBoundingClientRect() : null;
    const position = rect
        ? { top: rect.bottom + 4, left: rect.left, width: rect.width }
        : { top: 0, left: 0, width: 0 };

    return createPortal(
        <>
            <div className="fixed inset-0 z-40" onClick={onClose} />
            <div
                className="fixed z-50 bg-white dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg shadow-lg overflow-hidden max-h-72"
                style={{ top: position.top, left: position.left, width: position.width || menuWidth }}
            >
                <div className="p-3 border-b border-gray-200 dark:border-border-dark">
                    <div className="relative">
                        <Icon
                            name="search"
                            size={16}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                        />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => onSearchChange(e.target.value)}
                            placeholder={t('Search by name or ID...')}
                            className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                        />
                    </div>
                </div>
                <div className="max-h-56 overflow-y-auto">
                    {options.length === 0 ? (
                        <div className="px-4 py-3 text-sm text-slate-500 dark:text-text-secondary">
                            {t('No groups found')}
                        </div>
                    ) : (
                        options.map((opt) => (
                            <button
                                key={opt.id}
                                type="button"
                                onClick={() => onSelect(opt.id)}
                                className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-100 dark:hover:bg-background-dark transition-colors ${
                                    selectedId === opt.id
                                        ? 'bg-gray-100 dark:bg-background-dark text-primary font-medium'
                                        : 'text-slate-900 dark:text-white'
                                }`}
                            >
                                {opt.id === 0 ? (
                                    opt.name
                                ) : (
                                    <>
                                        <span className="font-mono text-xs text-slate-500 dark:text-text-secondary mr-2">
                                            #{opt.id}
                                        </span>
                                        {opt.name}
                                    </>
                                )}
                            </button>
                        ))
                    )}
                </div>
            </div>
        </>,
        document.body
    );
}

function CreateUserModal({
    groups,
    canAssignGroup,
    onClose,
    onCreated,
}: {
    groups: GroupOption[];
    canAssignGroup: boolean;
    onClose: () => void;
    onCreated: (user: User) => void;
}) {
    const { t } = useTranslation();
    const [formData, setFormData] = useState<CreateFormData>({
        username: '',
        email: '',
        password: '',
        user_group_id: [],
        daily_max_usage: '0',
        rate_limit: '0',
        disabled: false,
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showPassword, setShowPassword] = useState(false);
    const [groupMenuOpen, setGroupMenuOpen] = useState(false);
    const [groupSearch, setGroupSearch] = useState('');
    const [groupBtnWidth, setGroupBtnWidth] = useState<number | undefined>(undefined);

    useEffect(() => {
        const allOptions = [t('No Group'), ...groups.map((g) => `${g.name} #${g.id}`)];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
            let maxWidth = 0;
            for (const opt of allOptions) {
                const width = ctx.measureText(opt).width;
                if (width > maxWidth) maxWidth = width;
            }
            setGroupBtnWidth(Math.ceil(maxWidth) + 76);
        }
    }, [groups, t]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value, type, checked } = e.target;
        setFormData((prev) => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value,
        }));
        setError(null);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const response = await apiFetchAdmin<{ id: number; username: string; email: string; rate_limit: number }>('/v0/admin/users', {
                method: 'POST',
                body: JSON.stringify({
                    username: formData.username.trim(),
                    email: formData.email.trim(),
                    password: formData.password,
                    rate_limit: Number.parseInt(formData.rate_limit, 10) || 0,
                }),
            });

            const newUser: User = {
                id: response.id,
                username: response.username,
                email: response.email,
                user_group_id: formData.user_group_id,
                bill_user_group_id: [],
                daily_max_usage: Number.parseFloat(formData.daily_max_usage) || 0,
                rate_limit: response.rate_limit,
                active: true,
                disabled: formData.disabled,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };
            onCreated(newUser);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Create failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={onClose} />
            <div className="relative bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-border-dark flex items-center justify-between shrink-0">
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                        {t('Create User')}
                    </h3>
                    <button
                        onClick={onClose}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-border-dark transition-colors"
                    >
                        <Icon name="close" size={20} />
                    </button>
                </div>

                <form id="admin-user-create-form" onSubmit={handleSubmit} className="p-6 flex-1 overflow-y-auto">
                    {error && (
                        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-sm">
                            {error}
                        </div>
                    )}

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                {t('Username')}
                            </label>
                            <input
                                type="text"
                                name="username"
                                value={formData.username}
                                onChange={handleInputChange}
                                disabled={loading}
                                className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-border-dark rounded-lg bg-white dark:bg-background-dark text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                {t('Email')}
                            </label>
                            <input
                                type="email"
                                name="email"
                                value={formData.email}
                                onChange={handleInputChange}
                                disabled={loading}
                                className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-border-dark rounded-lg bg-white dark:bg-background-dark text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                {t('Password')}
                            </label>
                            <div className="relative">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    name="password"
                                    value={formData.password}
                                    onChange={handleInputChange}
                                    disabled={loading}
                                    placeholder={t('Enter password')}
                                    className="w-full px-4 py-2.5 pr-11 text-sm border border-gray-200 dark:border-border-dark rounded-lg bg-white dark:bg-background-dark text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors"
                                >
                                    <Icon
                                        name={showPassword ? 'visibility_off' : 'visibility'}
                                        size={18}
                                    />
                                </button>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                {t('User Group')}
                            </label>
                            {canAssignGroup ? (
                                <div className="relative">
                                    <button
                                        type="button"
                                        id="create-user-group-dropdown-btn"
                                        onClick={() => setGroupMenuOpen(!groupMenuOpen)}
                                        className="flex items-center justify-between gap-2 w-full bg-white dark:bg-background-dark border border-gray-200 dark:border-border-dark text-slate-900 dark:text-white text-sm rounded-lg focus:ring-primary focus:border-primary px-4 py-2.5"
                                        style={groupBtnWidth ? { minWidth: groupBtnWidth } : undefined}
                                    >
                                        <span className="truncate">
                                            {formData.user_group_id.length === 0
                                                ? t('No Group')
                                                : t('Selected {{count}}', { count: formData.user_group_id.length })}
                                        </span>
                                        <Icon name={groupMenuOpen ? 'expand_less' : 'expand_more'} size={18} />
                                    </button>
                                    {groupMenuOpen && (
                                        <MultiGroupDropdownMenu
                                            anchorId="create-user-group-dropdown-btn"
                                            groups={groups}
                                            selectedIds={formData.user_group_id}
                                            search={groupSearch}
                                            emptyLabel={t('No Group')}
                                            menuWidth={groupBtnWidth}
                                            onSearchChange={setGroupSearch}
                                            onToggle={(value) => {
                                                setFormData((prev) => ({
                                                    ...prev,
                                                    user_group_id: toggleGroupId(prev.user_group_id, value),
                                                }));
                                            }}
                                            onClear={() => setFormData((prev) => ({ ...prev, user_group_id: [] }))}
                                            onClose={() => setGroupMenuOpen(false)}
                                        />
                                    )}
                                </div>
                            ) : (
                                <div className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-border-dark rounded-lg bg-gray-50 dark:bg-background-dark text-slate-500 dark:text-text-secondary">
                                    {t('No Group')}
                                </div>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                {t('Daily Max Usage ($)')}
                            </label>
                            <input
                                type="number"
                                name="daily_max_usage"
                                value={formData.daily_max_usage}
                                onChange={handleInputChange}
                                disabled={loading}
                                step="0.01"
                                className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-border-dark rounded-lg bg-white dark:bg-background-dark text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                {t('Rate limit')}
                            </label>
                            <input
                                type="number"
                                name="rate_limit"
                                value={formData.rate_limit}
                                onChange={handleInputChange}
                                disabled={loading}
                                step="1"
                                className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-border-dark rounded-lg bg-white dark:bg-background-dark text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50"
                            />
                        </div>

                        <div className="flex items-center gap-3 pt-2">
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    name="disabled"
                                    checked={formData.disabled}
                                    onChange={handleInputChange}
                                    disabled={loading}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-border-dark peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-red-500"></div>
                            </label>
                            <span className="text-sm text-slate-700 dark:text-slate-300">
                                {t('Disabled')}
                            </span>
                        </div>
                    </div>
                </form>
                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-border-dark shrink-0">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={loading}
                        className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg hover:bg-slate-50 dark:hover:bg-border-dark transition-colors disabled:opacity-50"
                    >
                        {t('Cancel')}
                    </button>
                    <button
                        type="submit"
                        form="admin-user-create-form"
                        disabled={loading}
                        className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-blue-600 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                    >
                        {loading && <Icon name="progress_activity" size={16} className="animate-spin" />}
                        {t('Create')}
                    </button>
                </div>
            </div>
        </div>
    );
}

function EditUserModal({
    user,
    groups,
    canAssignGroup,
    canChangePassword,
    onClose,
    onSave,
}: {
    user: User;
    groups: GroupOption[];
    canAssignGroup: boolean;
    canChangePassword: boolean;
    onClose: () => void;
    onSave: (updatedUser: User) => void;
}) {
    const { t } = useTranslation();
    const [formData, setFormData] = useState<EditFormData>({
        username: user.username,
        email: user.email,
        password: '',
        user_group_id: user.user_group_id ?? [],
        daily_max_usage: user.daily_max_usage.toString(),
        rate_limit: user.rate_limit.toString(),
        disabled: user.disabled,
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showPassword, setShowPassword] = useState(false);
    const [groupMenuOpen, setGroupMenuOpen] = useState(false);
    const [groupSearch, setGroupSearch] = useState('');
    const [groupBtnWidth, setGroupBtnWidth] = useState<number | undefined>(undefined);

    useEffect(() => {
        const allOptions = [t('No Group'), ...groups.map((g) => `${g.name} #${g.id}`)];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
            let maxWidth = 0;
            for (const opt of allOptions) {
                const width = ctx.measureText(opt).width;
                if (width > maxWidth) maxWidth = width;
            }
            setGroupBtnWidth(Math.ceil(maxWidth) + 76);
        }
    }, [groups, t]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value, type, checked } = e.target;
        setFormData((prev) => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value,
        }));
        setError(null);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const updateData: Record<string, unknown> = {
                username: formData.username.trim(),
                email: formData.email.trim(),
                daily_max_usage: parseFloat(formData.daily_max_usage) || 0,
                rate_limit: Number.parseInt(formData.rate_limit, 10) || 0,
                disabled: formData.disabled,
            };
            if (canAssignGroup) {
                updateData.user_group_id = formData.user_group_id;
            }

            await apiFetchAdmin(`/v0/admin/users/${user.id}`, {
                method: 'PUT',
                body: JSON.stringify(updateData),
            });

            if (canChangePassword && formData.password.trim()) {
                await apiFetchAdmin(`/v0/admin/users/${user.id}/password`, {
                    method: 'PUT',
                    body: JSON.stringify({ password: formData.password }),
                });
            }

            onSave({
                ...user,
                username: updateData.username as string,
                email: updateData.email as string,
                daily_max_usage: updateData.daily_max_usage as number,
                rate_limit: updateData.rate_limit as number,
                disabled: updateData.disabled as boolean,
                user_group_id: formData.user_group_id,
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Update failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={onClose} />
            <div className="relative bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-border-dark flex items-center justify-between shrink-0">
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                        Edit User
                    </h3>
                    <button
                        onClick={onClose}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-border-dark transition-colors"
                    >
                        <Icon name="close" size={20} />
                    </button>
                </div>

                <form id="admin-user-edit-form" onSubmit={handleSubmit} className="p-6 flex-1 overflow-y-auto">
                    {error && (
                        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-sm">
                            {error}
                        </div>
                    )}

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                {t('Username')}
                            </label>
                            <input
                                type="text"
                                name="username"
                                value={formData.username}
                                onChange={handleInputChange}
                                disabled={loading}
                                className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-border-dark rounded-lg bg-white dark:bg-background-dark text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                {t('Email')}
                            </label>
                            <input
                                type="email"
                                name="email"
                                value={formData.email}
                                onChange={handleInputChange}
                                disabled={loading}
                                className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-border-dark rounded-lg bg-white dark:bg-background-dark text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50"
                            />
                        </div>

                        {canChangePassword && (
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                    {t('New Password')}
                                    <span className="text-slate-400 font-normal ml-1">
                                        ({t('Leave empty to keep current')})
                                    </span>
                                </label>
                                <div className="relative">
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        name="password"
                                        value={formData.password}
                                        onChange={handleInputChange}
                                        disabled={loading}
                                        placeholder="••••••••"
                                        className="w-full px-4 py-2.5 pr-11 text-sm border border-gray-200 dark:border-border-dark rounded-lg bg-white dark:bg-background-dark text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors"
                                    >
                                        <Icon
                                            name={showPassword ? 'visibility_off' : 'visibility'}
                                            size={18}
                                        />
                                    </button>
                                </div>
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                {t('User Group')}
                            </label>
                            {canAssignGroup ? (
                                <div className="relative">
                                    <button
                                        type="button"
                                        id="user-group-dropdown-btn"
                                        onClick={() => setGroupMenuOpen(!groupMenuOpen)}
                                        className="flex items-center justify-between gap-2 w-full bg-white dark:bg-background-dark border border-gray-200 dark:border-border-dark text-slate-900 dark:text-white text-sm rounded-lg focus:ring-primary focus:border-primary px-4 py-2.5"
                                        style={groupBtnWidth ? { minWidth: groupBtnWidth } : undefined}
                                    >
                                        <span className="truncate">
                                            {formData.user_group_id.length === 0
                                                ? t('No Group')
                                                : t('Selected {{count}}', { count: formData.user_group_id.length })}
                                        </span>
                                        <Icon name={groupMenuOpen ? 'expand_less' : 'expand_more'} size={18} />
                                    </button>
                                    {groupMenuOpen && (
                                        <MultiGroupDropdownMenu
                                            anchorId="user-group-dropdown-btn"
                                            groups={groups}
                                            selectedIds={formData.user_group_id}
                                            search={groupSearch}
                                            emptyLabel={t('No Group')}
                                            menuWidth={groupBtnWidth}
                                            onSearchChange={setGroupSearch}
                                            onToggle={(value) => {
                                                setFormData((prev) => ({
                                                    ...prev,
                                                    user_group_id: toggleGroupId(prev.user_group_id, value),
                                                }));
                                            }}
                                            onClear={() => setFormData((prev) => ({ ...prev, user_group_id: [] }))}
                                            onClose={() => setGroupMenuOpen(false)}
                                        />
                                    )}
                                </div>
                            ) : (
                                <div className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-border-dark rounded-lg bg-gray-50 dark:bg-background-dark text-slate-500 dark:text-text-secondary">
                                    {formData.user_group_id.length === 0
                                        ? t('No Group')
                                        : t('Selected {{count}}', { count: formData.user_group_id.length })}
                                </div>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                {t('Bill User Groups')}
                            </label>
                            <div className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-border-dark rounded-lg bg-gray-50 dark:bg-background-dark text-slate-500 dark:text-text-secondary">
                                {user.bill_user_group_id.length === 0
                                    ? t('No Group')
                                    : user.bill_user_group_id
                                          .map((id) => groups.find((g) => g.id === id)?.name || `#${id}`)
                                          .join(', ')}
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                {t('Daily Max Usage ($)')}
                            </label>
                            <input
                                type="number"
                                name="daily_max_usage"
                                value={formData.daily_max_usage}
                                onChange={handleInputChange}
                                disabled={loading}
                                step="0.01"
                                className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-border-dark rounded-lg bg-white dark:bg-background-dark text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                {t('Rate limit')}
                            </label>
                            <input
                                type="number"
                                name="rate_limit"
                                value={formData.rate_limit}
                                onChange={handleInputChange}
                                disabled={loading}
                                step="1"
                                className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-border-dark rounded-lg bg-white dark:bg-background-dark text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50"
                            />
                        </div>

                        <div className="flex items-center gap-3 pt-2">
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    name="disabled"
                                    checked={formData.disabled}
                                    onChange={handleInputChange}
                                    disabled={loading}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/30 rounded-full peer dark:bg-border-dark peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-red-500"></div>
                            </label>
                            <span className="text-sm text-slate-700 dark:text-slate-300">
                                {t('Disabled')}
                            </span>
                        </div>
                    </div>
                </form>
                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-border-dark shrink-0">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={loading}
                        className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg hover:bg-slate-50 dark:hover:bg-border-dark transition-colors disabled:opacity-50"
                    >
                        {t('Cancel')}
                    </button>
                    <button
                        type="submit"
                        form="admin-user-edit-form"
                        disabled={loading}
                        className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-blue-600 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                    >
                        {loading && <Icon name="progress_activity" size={16} className="animate-spin" />}
                        {t('Save Changes')}
                    </button>
                </div>
            </div>
        </div>
    );
}

interface UserApiKey {
    id: number;
    name: string;
    key: string;
    key_prefix: string;
    active: boolean;
    expires_at: string | null;
    revoked_at: string | null;
    last_used_at: string | null;
    created_at: string;
}

interface UserApiKeysResponse {
    api_keys: UserApiKey[];
}

function UserApiKeysModal({
    user,
    canCreate,
    onClose,
}: {
    user: User;
    canCreate: boolean;
    onClose: () => void;
}) {
    const { t, i18n } = useTranslation();
    const locale = i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US';
    const [apiKeys, setApiKeys] = useState<UserApiKey[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [newKeyToken, setNewKeyToken] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [copiedKeyId, setCopiedKeyId] = useState<number | null>(null);
    const autoCreatedRef = useRef(false);

    const fetchApiKeys = useCallback(async () => {
        setLoading(true);
        try {
            const res = await apiFetchAdmin<UserApiKeysResponse>(`/v0/admin/users/${user.id}/api-keys`);
            const keys = res.api_keys || [];
            if (keys.length === 0 && canCreate && !autoCreatedRef.current) {
                autoCreatedRef.current = true;
                const createRes = await apiFetchAdmin<{ id: number; name: string; token: string }>(
                    `/v0/admin/users/${user.id}/api-keys`,
                    {
                        method: 'POST',
                        body: JSON.stringify({ name: `Auto-${Date.now()}` }),
                    }
                );
                setNewKeyToken(createRes.token);
                const refreshRes = await apiFetchAdmin<UserApiKeysResponse>(`/v0/admin/users/${user.id}/api-keys`);
                setApiKeys(refreshRes.api_keys || []);
            } else {
                setApiKeys(keys);
            }
        } catch (err) {
            console.error('Failed to fetch user api keys:', err);
        } finally {
            setLoading(false);
        }
    }, [user.id, canCreate]);

    useEffect(() => {
        fetchApiKeys();
    }, [fetchApiKeys]);

    const handleCreate = async () => {
        setCreating(true);
        try {
            const res = await apiFetchAdmin<{ id: number; name: string; token: string }>(
                `/v0/admin/users/${user.id}/api-keys`,
                {
                    method: 'POST',
                    body: JSON.stringify({ name: `Auto-${Date.now()}` }),
                }
            );
            setNewKeyToken(res.token);
            fetchApiKeys();
        } catch (err) {
            console.error('Failed to create api key:', err);
            alert(t('Failed to create API key'));
        } finally {
            setCreating(false);
        }
    };

    const handleCopy = async () => {
        if (newKeyToken) {
            await navigator.clipboard.writeText(newKeyToken);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const handleCopyKeyPrefix = async (keyId: number, key: string) => {
        await navigator.clipboard.writeText(key);
        setCopiedKeyId(keyId);
        setTimeout(() => setCopiedKeyId(null), 2000);
    };

    const formatDate = (dateStr: string) => new Date(dateStr).toLocaleString(locale);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={onClose} />
            <div className="relative bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-border-dark flex items-center justify-between shrink-0">
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                        {t('API Keys for {{username}}', { username: user.username })}
                    </h3>
                    <button
                        onClick={onClose}
                        className="inline-flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
                    >
                        <Icon name="close" />
                    </button>
                </div>

                {newKeyToken && (
                    <div className="px-6 py-4 bg-emerald-50 dark:bg-emerald-900/20 border-b border-emerald-200 dark:border-emerald-800">
                        <p className="text-sm text-emerald-700 dark:text-emerald-400 mb-2">
                            {t("API key created. Copy it now as you won't be able to see it again.")}
                        </p>
                        <div className="flex items-center gap-2 p-3 bg-white dark:bg-background-dark rounded-lg border border-emerald-200 dark:border-emerald-800">
                            <code className="flex-1 font-mono text-sm text-slate-900 dark:text-white break-all">
                                {newKeyToken}
                            </code>
                            <button
                                onClick={handleCopy}
                                className="p-2 text-gray-500 hover:text-primary transition-colors"
                            >
                                <Icon name={copied ? 'check' : 'content_copy'} size={18} />
                            </button>
                        </div>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto p-6">
                    {loading ? (
                        <div className="flex items-center justify-center py-8">
                            <Icon name="progress_activity" size={24} className="animate-spin text-primary" />
                        </div>
                    ) : apiKeys.length === 0 ? (
                        <div className="text-center py-8">
                            <Icon name="vpn_key" size={48} className="text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                            <p className="text-slate-500 dark:text-text-secondary">
                                {t('No API keys for this user')}
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {apiKeys.map((key) => (
                                <div
                                    key={key.id}
                                    className="p-4 bg-gray-50 dark:bg-background-dark rounded-lg border border-gray-200 dark:border-border-dark"
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="font-medium text-slate-900 dark:text-white">
                                            {key.name}
                                        </span>
                                        <span
                                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                                key.revoked_at
                                                    ? 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400'
                                                    : key.active
                                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
                                                    : 'bg-gray-100 text-gray-700 dark:bg-gray-500/10 dark:text-gray-400'
                                            }`}
                                        >
                                            {key.revoked_at ? t('Revoked') : key.active ? t('Active') : t('Inactive')}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-text-secondary font-mono">
                                        <span>{key.key_prefix}</span>
                                        <button
                                            onClick={() => handleCopyKeyPrefix(key.id, key.key)}
                                            className="p-1 text-gray-400 hover:text-primary transition-colors"
                                            title={t('Copy')}
                                        >
                                            <Icon name={copiedKeyId === key.id ? 'check' : 'content_copy'} size={14} />
                                        </button>
                                    </div>
                                    <div className="mt-2 text-xs text-slate-500 dark:text-text-secondary">
                                        {t('Created')}: {formatDate(key.created_at)}
                                        {key.last_used_at && (
                                            <span className="ml-4">
                                                {t('Last used')}: {formatDate(key.last_used_at)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {canCreate && (
                    <div className="px-6 py-4 border-t border-gray-200 dark:border-border-dark shrink-0">
                        <button
                            onClick={handleCreate}
                            disabled={creating}
                            className="w-full py-2.5 bg-primary hover:bg-blue-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {creating && <Icon name="progress_activity" size={16} className="animate-spin" />}
                            <Icon name="add" size={18} />
                            {t('Create API Key')}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export function AdminUsers() {
    const { t, i18n } = useTranslation();
    const { hasPermission } = useAdminPermissions();
    const canListUsers = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/users'));
    const canCreateUsers = hasPermission(buildAdminPermissionKey('POST', '/v0/admin/users'));
    const canUpdateUsers = hasPermission(buildAdminPermissionKey('PUT', '/v0/admin/users/:id'));
    const canDeleteUsers = hasPermission(buildAdminPermissionKey('DELETE', '/v0/admin/users/:id'));
    const canDisableUsers = hasPermission(buildAdminPermissionKey('POST', '/v0/admin/users/:id/disable'));
    const canEnableUsers = hasPermission(buildAdminPermissionKey('POST', '/v0/admin/users/:id/enable'));
    const canChangePassword = hasPermission(
        buildAdminPermissionKey('PUT', '/v0/admin/users/:id/password')
    );
    const canListUserGroups = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/user-groups'));
    const canListUserApiKeys = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/users/:id/api-keys'));
    const canCreateUserApiKeys = hasPermission(buildAdminPermissionKey('POST', '/v0/admin/users/:id/api-keys'));

    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [creatingUser, setCreatingUser] = useState(false);
    const [groups, setGroups] = useState<GroupOption[]>([]);
    const [groupFilterId, setGroupFilterId] = useState<number | null>(null);
    const [groupFilterOpen, setGroupFilterOpen] = useState(false);
    const [groupFilterSearch, setGroupFilterSearch] = useState('');
    const [groupFilterBtnWidth, setGroupFilterBtnWidth] = useState<number | undefined>(undefined);
    const [apiKeyModalUser, setApiKeyModalUser] = useState<User | null>(null);
    const locale = i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US';

    const fetchUsers = useCallback(
        async (search: string) => {
            if (!canListUsers) {
                return;
            }
            setLoading(true);
            try {
                const params = new URLSearchParams();
                if (search.trim()) {
                    params.set('search', search.trim());
                }
                const url = `/v0/admin/users${params.toString() ? '?' + params.toString() : ''}`;
                const res = await apiFetchAdmin<UsersResponse>(url);
                setUsers(res.users || []);
            } catch (err) {
                console.error('Failed to fetch users:', err);
            } finally {
                setLoading(false);
            }
        },
        [canListUsers]
    );

    const fetchGroups = useCallback(async () => {
        if (!canListUserGroups) {
            return;
        }
        try {
            const res = await apiFetchAdmin<GroupListResponse>('/v0/admin/user-groups');
            setGroups(res.user_groups || []);
        } catch (err) {
            console.error('Failed to fetch user groups:', err);
        }
    }, [canListUserGroups]);

    useEffect(() => {
        if (canListUsers) {
            fetchUsers(searchQuery);
        }
    }, [fetchUsers, searchQuery, canListUsers]);

    useEffect(() => {
        if (canListUserGroups) {
            fetchGroups();
        }
    }, [fetchGroups, canListUserGroups]);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (searchInput !== searchQuery) {
                setSearchQuery(searchInput);
                setCurrentPage(1);
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [searchInput, searchQuery]);

    const filteredUsers = useMemo(() => {
        if (!groupFilterId) return users;
        return users.filter((user) => user.user_group_id.includes(groupFilterId));
    }, [users, groupFilterId]);

    const totalPages = Math.ceil(filteredUsers.length / PAGE_SIZE);
    const paginatedUsers = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return filteredUsers.slice(start, start + PAGE_SIZE);
    }, [filteredUsers, currentPage]);

    const { tableScrollRef, handleTableScroll, showActionsDivider } = useStickyActionsDivider(
        paginatedUsers.length,
        loading
    );

    const formatDate = (dateString: string) => new Date(dateString).toLocaleString(locale);

    const handleEdit = (user: User) => {
        if (!canUpdateUsers) {
            return;
        }
        setEditingUser(user);
    };

    const handleCreateUser = (newUser: User) => {
        setCreatingUser(false);
        setUsers((prev) => [newUser, ...prev]);
    };

    const handleEditSave = (updatedUser: User) => {
        setEditingUser(null);
        setUsers((prev) =>
            prev.map((item) => (item.id === updatedUser.id ? updatedUser : item))
        );
    };

    const handleToggleDisable = async (user: User) => {
        if (user.disabled && !canEnableUsers) {
            return;
        }
        if (!user.disabled && !canDisableUsers) {
            return;
        }
        try {
            const endpoint = user.disabled
                ? `/v0/admin/users/${user.id}/enable`
                : `/v0/admin/users/${user.id}/disable`;
            await apiFetchAdmin(endpoint, { method: 'POST' });
            setUsers((prev) =>
                prev.map((item) =>
                    item.id === user.id
                        ? { ...item, disabled: !user.disabled }
                        : item
                )
            );
        } catch (err) {
            console.error('Toggle disable failed:', err);
        }
    };

    const handleDelete = async (user: User) => {
        if (!canDeleteUsers) {
            return;
        }
        if (
            !confirm(
                t('Are you sure you want to delete user "{{username}}"?', {
                    username: user.username,
                })
            )
        ) {
            return;
        }
        try {
            await apiFetchAdmin(`/v0/admin/users/${user.id}`, { method: 'DELETE' });
            fetchUsers(searchQuery);
        } catch (err) {
            console.error('Delete user failed:', err);
        }
    };

    useEffect(() => {
        const allOptions = [t('All Groups'), ...groups.map((g) => `${g.name} #${g.id}`)];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
            let maxWidth = 0;
            for (const opt of allOptions) {
                const width = ctx.measureText(opt).width;
                if (width > maxWidth) maxWidth = width;
            }
            setGroupFilterBtnWidth(Math.ceil(maxWidth) + 76);
        }
    }, [groups, t]);

    if (!canListUsers) {
        return (
            <AdminDashboardLayout title={t('Users')} subtitle={t('Manage system users')}>
                <AdminNoAccessCard />
            </AdminDashboardLayout>
        );
    }

    return (
        <AdminDashboardLayout title={t('Users')} subtitle={t('Manage system users')}>
            <div className="space-y-6">
                {canCreateUsers && (
                    <div className="flex justify-end">
                        <button
                            onClick={() => setCreatingUser(true)}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
                        >
                            <Icon name="add" size={18} />
                            {t('New User')}
                        </button>
                    </div>
                )}
                <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-white dark:bg-surface-dark p-3 rounded-xl border border-gray-200 dark:border-border-dark shadow-sm">
                    <div className="flex gap-3 w-full md:w-auto">
                        <div className="relative w-full md:w-96">
                            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                                <Icon name="search" className="text-gray-400" />
                            </div>
                            <input
                                className="block w-full p-2.5 pl-10 text-sm text-slate-900 dark:text-white bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark rounded-lg focus:ring-primary focus:border-primary placeholder-gray-400 dark:placeholder-gray-500"
                                placeholder={t('Search by ID, username or email...')}
                                type="text"
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                            />
                        </div>
                        {canListUserGroups && (
                            <div className="relative">
                                <button
                                    type="button"
                                    id="user-group-filter-btn"
                                    onClick={() => setGroupFilterOpen(!groupFilterOpen)}
                                    className="flex items-center justify-between gap-2 bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark text-slate-900 dark:text-white text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5 whitespace-nowrap"
                                    style={groupFilterBtnWidth ? { width: groupFilterBtnWidth } : undefined}
                                >
                                    <span>
                                        {groupFilterId
                                            ? groups.find((g) => g.id === groupFilterId)?.name || t('All Groups')
                                            : t('All Groups')}
                                    </span>
                                    <Icon name={groupFilterOpen ? 'expand_less' : 'expand_more'} size={18} />
                                </button>
                                {groupFilterOpen && (
                                    <SearchableDropdownMenu
                                        anchorId="user-group-filter-btn"
                                        options={[
                                            { id: 0, name: t('All Groups') },
                                            ...groups.filter((g) => {
                                                const query = groupFilterSearch.trim().toLowerCase();
                                                if (!query) return true;
                                                return (
                                                    g.name.toLowerCase().includes(query) ||
                                                    g.id.toString().includes(query)
                                                );
                                            }),
                                        ]}
                                        selectedId={groupFilterId ?? 0}
                                        search={groupFilterSearch}
                                        menuWidth={groupFilterBtnWidth}
                                        onSearchChange={setGroupFilterSearch}
                                        onSelect={(value) => {
                                            setGroupFilterId(value === 0 ? null : value);
                                            setCurrentPage(1);
                                            setGroupFilterOpen(false);
                                        }}
                                        onClose={() => setGroupFilterOpen(false)}
                                    />
                                )}
                            </div>
                        )}
                    </div>
                    <button
                        onClick={() => fetchUsers(searchQuery)}
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
                                    <th className="px-6 py-4">{t('Email')}</th>
                                    <th className="px-6 py-4">{t('Daily Max Usage')}</th>
                                    <th className="px-6 py-4">{t('Rate limit')}</th>
                                    <th className="px-6 py-4">{t('User Group')}</th>
                                    <th className="px-6 py-4">{t('Bill User Groups')}</th>
                                    <th className="px-6 py-4">{t('Status')}</th>
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
                                        <td colSpan={10} className="px-6 py-4">
                                            <div className="animate-pulse h-4 bg-slate-200 dark:bg-border-dark rounded"></div>
                                        </td>
                                    </tr>
                                ))
                            ) : paginatedUsers.length === 0 ? (
                                <tr>
                                    <td colSpan={10} className="px-6 py-8 text-center text-slate-500 dark:text-text-secondary">
                                        {searchQuery ? t('No users found') : t('No users yet')}
                                    </td>
                                </tr>
                            ) : (
                                paginatedUsers.map((user) => (
                                    <tr
                                        key={user.id}
                                        className="hover:bg-gray-50 dark:hover:bg-background-dark group"
                                    >
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary font-mono">
                                            {user.id}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-700 dark:text-white font-medium">
                                            {user.username}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary">
                                            {user.email}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary font-mono">
                                            ${user.daily_max_usage.toFixed(2)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary font-mono">
                                            {user.rate_limit.toLocaleString()}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary">
                                            <span
                                                className="truncate"
                                                title={
                                                    user.user_group_id.length === 0
                                                        ? t('No Group')
                                                        : user.user_group_id
                                                              .map((id) => groups.find((g) => g.id === id)?.name || `#${id}`)
                                                              .join(', ')
                                                }
                                            >
                                                {user.user_group_id.length === 0
                                                    ? t('No Group')
                                                    : (() => {
                                                          const names = user.user_group_id.map(
                                                              (id) => groups.find((g) => g.id === id)?.name || `#${id}`
                                                          );
                                                          return names.length > 1
                                                              ? `${names[0]}${t('And others')}`
                                                              : names[0];
                                                      })()}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary">
                                            <span
                                                className="truncate"
                                                title={
                                                    user.bill_user_group_id.length === 0
                                                        ? t('No Group')
                                                        : user.bill_user_group_id
                                                              .map((id) => groups.find((g) => g.id === id)?.name || `#${id}`)
                                                              .join(', ')
                                                }
                                            >
                                                {user.bill_user_group_id.length === 0
                                                    ? t('No Group')
                                                    : (() => {
                                                          const names = user.bill_user_group_id.map(
                                                              (id) => groups.find((g) => g.id === id)?.name || `#${id}`
                                                          );
                                                          return names.length > 1
                                                              ? `${names[0]}${t('And others')}`
                                                              : names[0];
                                                      })()}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {user.disabled ? (
                                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-red-100 text-red-800 dark:bg-red-500/10 dark:text-red-400 border-red-200 dark:border-red-500/20">
                                                    {t('Disabled')}
                                                </span>
                                            ) : user.active ? (
                                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20">
                                                    {t('Active')}
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-gray-100 text-gray-800 dark:bg-gray-500/10 dark:text-gray-400 border-gray-200 dark:border-gray-500/20">
                                                    {t('Inactive')}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary font-mono text-xs">
                                            {formatDate(user.created_at)}
                                        </td>
                                        <td
                                            className={`px-6 py-4 whitespace-nowrap text-center sticky right-0 z-10 bg-white dark:bg-surface-dark group-hover:bg-gray-50 dark:group-hover:bg-background-dark relative after:content-[''] after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-gray-200 dark:after:bg-border-dark after:pointer-events-none ${
                                                showActionsDivider ? 'after:opacity-100' : 'after:opacity-0'
                                            }`}
                                        >
                                            <div className="flex items-center justify-center gap-1">
                                                {canUpdateUsers && (
                                                    <button
                                                        onClick={() => handleEdit(user)}
                                                        className="p-2 text-gray-400 hover:text-primary hover:bg-gray-100 dark:hover:bg-background-dark rounded-lg transition-colors"
                                                        title={t('Edit')}
                                                    >
                                                        <Icon name="edit" size={18} />
                                                    </button>
                                                )}
                                                {(canListUserApiKeys || canCreateUserApiKeys) && (
                                                    <button
                                                        onClick={() => setApiKeyModalUser(user)}
                                                        className="p-2 text-gray-400 hover:text-primary hover:bg-gray-100 dark:hover:bg-background-dark rounded-lg transition-colors"
                                                        title={t('API Keys')}
                                                    >
                                                        <Icon name="vpn_key" size={18} />
                                                    </button>
                                                )}
                                                {(user.disabled ? canEnableUsers : canDisableUsers) && (
                                                    <button
                                                        onClick={() => handleToggleDisable(user)}
                                                        className={`p-2 rounded-lg transition-colors ${
                                                            user.disabled
                                                                ? 'text-gray-400 hover:text-emerald-500 hover:bg-gray-100 dark:hover:bg-background-dark'
                                                                : 'text-gray-400 hover:text-amber-500 hover:bg-gray-100 dark:hover:bg-background-dark'
                                                        }`}
                                                        title={user.disabled ? t('Enable') : t('Disable')}
                                                    >
                                                        <Icon
                                                            name={user.disabled ? 'toggle_on' : 'toggle_off'}
                                                            size={18}
                                                        />
                                                    </button>
                                                )}
                                                {canDeleteUsers && (
                                                    <button
                                                        onClick={() => handleDelete(user)}
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
                            {t('Showing {{from}} to {{to}} of {{total}} users', {
                                from: (currentPage - 1) * PAGE_SIZE + 1,
                                to: Math.min(currentPage * PAGE_SIZE, filteredUsers.length),
                                total: filteredUsers.length,
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

            {editingUser && (
                <EditUserModal
                    user={editingUser}
                    groups={groups}
                    canAssignGroup={canListUserGroups}
                    canChangePassword={canChangePassword}
                    onClose={() => setEditingUser(null)}
                    onSave={handleEditSave}
                />
            )}

            {creatingUser && (
                <CreateUserModal
                    groups={groups}
                    canAssignGroup={canListUserGroups}
                    onClose={() => setCreatingUser(false)}
                    onCreated={handleCreateUser}
                />
            )}

            {apiKeyModalUser && (
                <UserApiKeysModal
                    user={apiKeyModalUser}
                    canCreate={canCreateUserApiKeys}
                    onClose={() => setApiKeyModalUser(null)}
                />
            )}
        </AdminDashboardLayout>
    );
}
