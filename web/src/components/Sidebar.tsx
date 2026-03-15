import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Icon } from './Icon';
import { USER_KEY_FRONT } from '../api/config';
import { useTranslation } from 'react-i18next';
import { useSiteName } from '../utils/siteName';

interface NavItem {
    icon: string;
    label: string;
    href: string;
}

export function Sidebar() {
    const { t } = useTranslation();
    const location = useLocation();
    const siteName = useSiteName();
    const userInfo = useMemo(() => {
        const raw = localStorage.getItem(USER_KEY_FRONT);
        if (!raw) {
            return { username: '', email: '' };
        }
        try {
            const data = JSON.parse(raw) as { username?: unknown; email?: unknown };
            return {
                username: typeof data.username === 'string' ? data.username : '',
                email: typeof data.email === 'string' ? data.email : '',
            };
        } catch {
            return { username: '', email: '' };
        }
    }, []);

    const navItems: NavItem[] = [
        { icon: 'dashboard', label: t('Dashboard'), href: '/dashboard' },
        { icon: 'vpn_key', label: t('API Keys'), href: '/api-keys' },
        { icon: 'description', label: t('Logs'), href: '/logs' },
        { icon: 'view_list', label: t('Models'), href: '/models' },
        { icon: 'subscriptions', label: t('Plans'), href: '/plans' },
        { icon: 'payments', label: t('Billing'), href: '/billing' },
        { icon: 'settings', label: t('Settings'), href: '/settings' },
    ];

    return (
        <aside className="w-64 flex flex-col border-r border-gray-200 dark:border-border-dark bg-white dark:bg-background-dark shrink-0">
            <div className="p-6 pb-2">
                <div className="flex gap-3 items-center mb-8">
                    <div className="bg-linear-to-br from-primary to-blue-400 rounded-lg h-10 w-10 flex items-center justify-center shadow-lg shadow-blue-900/20">
                        <Icon name="dns" size={24} className="text-white" />
                    </div>
                    <div className="flex flex-col">
                        <h1 className="text-slate-900 dark:text-white text-base font-bold leading-tight tracking-tight">
                            {siteName}
                        </h1>
                        <p className="text-slate-500 dark:text-text-secondary text-xs font-normal">
                            {t('User Panel')}
                        </p>
                    </div>
                </div>

                <nav className="flex flex-col gap-1.5">
                    {navItems.map((item) => {
                        const isActive = location.pathname === item.href;
                        return (
                            <Link
                                key={item.label}
                                to={item.href}
                                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors group ${
                                    isActive
                                        ? 'bg-primary text-white'
                                        : 'text-slate-600 dark:text-text-secondary hover:bg-slate-100 dark:hover:bg-surface-dark hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                <Icon
                                    name={item.icon}
                                    className={
                                        isActive
                                            ? ''
                                            : 'group-hover:text-primary transition-colors'
                                    }
                                />
                                <span className="text-sm font-medium">{item.label}</span>
                            </Link>
                        );
                    })}
                </nav>
            </div>

            <div className="mt-auto p-6 border-t border-gray-200 dark:border-border-dark">
                <div className="flex items-center gap-3">
                    <div
                        className="h-9 w-9 rounded-full bg-slate-200 dark:bg-surface-dark bg-cover bg-center border border-slate-200 dark:border-border-dark"
                        style={{
                            backgroundImage:
                                "url('https://lh3.googleusercontent.com/aida-public/AB6AXuDO2Nm1iFlX0H8kERTDIdf1DNAhNab5YiOzc14-sRp8f7YCZZ9WH5rUvNqIC_jxPJ8rKqawSsvtBelT8YCljTj6K-sushpWrv0-0EB57egqVyF7Blsc7VrB1HKxyokXFylVJVIxzzKdE7UNxvFQNeLdjhztzVL2SnD1VhfiHU8yI5tiRALw_64vqtZH0e8Efm97Hn2lp0ZyytQ0vHgc_U_zoppV-98SkW9blTkSu-vgKLwGdZ-Z1p6j7r7WyUJOdHS6DL5IPY1lEpq7')",
                        }}
                    />
                    <div className="flex flex-col overflow-hidden">
                        <p className="text-slate-900 dark:text-white text-sm font-medium truncate">
                            {userInfo.username || t('User')}
                        </p>
                        <p className="text-slate-500 dark:text-text-secondary text-xs truncate">
                            {userInfo.email || '-'}
                        </p>
                    </div>
                </div>
            </div>
        </aside>
    );
}
