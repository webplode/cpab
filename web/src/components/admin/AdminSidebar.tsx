import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Icon } from '../Icon';
import { buildAdminPermissionKey, useAdminPermissions } from '../../utils/adminPermissions';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../LanguageSwitcher';
import { useSiteName } from '../../utils/siteName';
import { VersionUpdateButton } from './VersionUpdateButton';

interface AdminSidebarProps {
    onChangePassword?: () => void;
    onMFA?: () => void;
    onLogout?: () => void;
}

interface NavItem {
    icon: string;
    label: string;
    href: string;
    permissions?: string[];
}

export function AdminSidebar({ onChangePassword, onMFA, onLogout }: AdminSidebarProps) {
    const { t } = useTranslation();
    const location = useLocation();
    const { hasAnyPermission } = useAdminPermissions();
    const siteName = useSiteName();

    const navItems = useMemo<NavItem[]>(
        () => [
            {
                icon: 'dashboard',
                label: t('Dashboard'),
                href: '/admin/dashboard',
                permissions: [
                    buildAdminPermissionKey('GET', '/v0/admin/dashboard/kpi'),
                    buildAdminPermissionKey('GET', '/v0/admin/dashboard/traffic'),
                    buildAdminPermissionKey('GET', '/v0/admin/dashboard/cost-distribution'),
                    buildAdminPermissionKey('GET', '/v0/admin/dashboard/model-health'),
                    buildAdminPermissionKey('GET', '/v0/admin/dashboard/transactions'),
                ],
            },
            {
                icon: 'group',
                label: t('Users'),
                href: '/admin/users',
                permissions: [buildAdminPermissionKey('GET', '/v0/admin/users')],
            },
            {
                icon: 'group_work',
                label: t('User Groups'),
                href: '/admin/user-groups',
                permissions: [buildAdminPermissionKey('GET', '/v0/admin/user-groups')],
            },
            {
                icon: 'folder_shared',
                label: t('Authentication Files'),
                href: '/admin/auth-files',
                permissions: [buildAdminPermissionKey('GET', '/v0/admin/auth-files')],
            },
            {
                icon: 'shield',
                label: t('Authentication Groups'),
                href: '/admin/auth-groups',
                permissions: [buildAdminPermissionKey('GET', '/v0/admin/auth-groups')],
            },
            {
                icon: 'analytics',
                label: t('Quota'),
                href: '/admin/quotas',
                permissions: [buildAdminPermissionKey('GET', '/v0/admin/quotas')],
            },
            {
                icon: 'model_training',
                label: t('Models'),
                href: '/admin/models',
                permissions: [buildAdminPermissionKey('GET', '/v0/admin/model-mappings')],
            },
            {
                icon: 'vpn_key',
                label: t('API Keys'),
                href: '/admin/api-keys',
                permissions: [buildAdminPermissionKey('GET', '/v0/admin/provider-api-keys')],
            },
            {
                icon: 'lan',
                label: t('Proxies'),
                href: '/admin/proxies',
                permissions: [buildAdminPermissionKey('GET', '/v0/admin/proxies')],
            },
            {
                icon: 'credit_card',
                label: t('Prepaid Cards'),
                href: '/admin/prepaid-cards',
                permissions: [buildAdminPermissionKey('GET', '/v0/admin/prepaid-cards')],
            },
            {
                icon: 'price_change',
                label: t('Plans'),
                href: '/admin/plans',
                permissions: [buildAdminPermissionKey('GET', '/v0/admin/plans')],
            },
            {
                icon: 'receipt_long',
                label: t('Bills'),
                href: '/admin/bills',
                permissions: [buildAdminPermissionKey('GET', '/v0/admin/bills')],
            },
            {
                icon: 'rule',
                label: t('Billing Rules'),
                href: '/admin/billing-rules',
                permissions: [buildAdminPermissionKey('GET', '/v0/admin/billing-rules')],
            },
            {
                icon: 'manage_accounts',
                label: t('Administrators'),
                href: '/admin/administrators',
                permissions: [buildAdminPermissionKey('GET', '/v0/admin/admins')],
            },
            {
                icon: 'list_alt',
                label: t('Logs'),
                href: '/admin/logs',
                permissions: [buildAdminPermissionKey('GET', '/v0/admin/logs')],
            },
            {
                icon: 'settings',
                label: t('Settings'),
                href: '/admin/settings',
                permissions: [buildAdminPermissionKey('GET', '/v0/admin/settings')],
            },
        ],
        [t]
    );

    const visibleItems = useMemo(() => {
        return navItems.filter((item) => {
            if (!item.permissions || item.permissions.length === 0) {
                return true;
            }
            return hasAnyPermission(item.permissions);
        });
    }, [hasAnyPermission, navItems]);

    return (
        <aside className="w-72 flex flex-col h-screen border-r border-gray-200 dark:border-border-dark bg-white dark:bg-background-dark shrink-0 overflow-hidden">
            <div className="p-6 pb-2 shrink-0">
                <div className="flex gap-3 items-center mb-8">
                    <div className="bg-linear-to-br from-orange-500 to-red-500 rounded-lg h-10 w-10 flex items-center justify-center shadow-lg shadow-orange-900/20">
                        <Icon name="admin_panel_settings" size={24} className="text-white" />
                    </div>
                    <div className="flex flex-col">
                        <h1 className="text-slate-900 dark:text-white text-base font-bold leading-tight tracking-tight">
                            {siteName}
                        </h1>
                        <p className="text-orange-500 dark:text-orange-400 text-xs font-medium">
                            {t('Admin Panel')}
                        </p>
                    </div>
                </div>
            </div>

            <nav className="flex-1 min-h-0 overflow-y-auto px-6 pb-6 flex flex-col gap-1.5">
                {visibleItems.map((item) => {
                    const isActive = location.pathname === item.href;
                    return (
                        <Link
                            key={item.label}
                            to={item.href}
                            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors group ${
                                isActive
                                    ? 'bg-orange-500 text-white'
                                    : 'text-slate-600 dark:text-text-secondary hover:bg-slate-100 dark:hover:bg-surface-dark hover:text-slate-900 dark:hover:text-white'
                            }`}
                        >
                            <Icon
                                name={item.icon}
                                className={
                                    isActive
                                        ? ''
                                        : 'group-hover:text-orange-500 transition-colors'
                                }
                            />
                            <span className="text-sm font-medium">{item.label}</span>
                        </Link>
                    );
                })}
            </nav>

            <div className="mt-auto p-6 border-t border-gray-200 dark:border-border-dark">
                <div className="flex items-center justify-center gap-2">
                    <VersionUpdateButton />
                    <LanguageSwitcher size="sm" menuDirection="up" menuAlign="left" />
                    {onChangePassword ? (
                        <button
                            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 dark:border-border-dark text-slate-600 dark:text-text-secondary transition-colors hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-surface-dark dark:hover:text-white"
                            onClick={onChangePassword}
                            type="button"
                            aria-label={t('Change Password')}
                            title={t('Change Password')}
                        >
                            <Icon name="key" size={18} />
                        </button>
                    ) : null}
                    {onMFA ? (
                        <button
                            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 dark:border-border-dark text-slate-600 dark:text-text-secondary transition-colors hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-surface-dark dark:hover:text-white"
                            onClick={onMFA}
                            type="button"
                            aria-label={t('MFA')}
                            title={t('MFA')}
                        >
                            <Icon name="verified_user" size={18} />
                        </button>
                    ) : null}
                    {onLogout ? (
                        <button
                            className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-primary text-white shadow-sm transition-colors hover:bg-primary-dark"
                            onClick={onLogout}
                            type="button"
                            aria-label={t('Logout')}
                            title={t('Logout')}
                        >
                            <Icon name="logout" size={18} />
                        </button>
                    ) : null}
                </div>
            </div>
        </aside>
    );
}
