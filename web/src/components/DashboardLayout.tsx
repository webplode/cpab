import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { Icon } from './Icon';
import { LanguageSwitcher } from './LanguageSwitcher';
import { TOKEN_KEY_FRONT, USER_KEY_FRONT } from '../api/config';
import { useTranslation } from 'react-i18next';

interface DashboardLayoutProps {
    children: ReactNode;
    title?: string;
    subtitle?: string;
}

export function DashboardLayout({ children, title, subtitle }: DashboardLayoutProps) {
    const navigate = useNavigate();
    const { t } = useTranslation();

    const handleLogout = () => {
        localStorage.removeItem(TOKEN_KEY_FRONT);
        localStorage.removeItem(USER_KEY_FRONT);
        navigate('/login');
    };

    return (
        <div className="flex h-screen w-full">
            <Sidebar />
            <main className="flex-1 flex flex-col h-full overflow-y-auto bg-slate-50 dark:bg-background-dark">
                <Header
                    title={title}
                    subtitle={subtitle}
                    actions={
                        <>
                            <LanguageSwitcher />
                            <button
                                type="button"
                                onClick={handleLogout}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-white shadow-sm hover:bg-blue-600 transition-colors"
                                title={t('Logout')}
                                aria-label={t('Logout')}
                            >
                                <Icon name="logout" size={18} />
                            </button>
                        </>
                    }
                />
                <div className="p-8 max-w-[1600px] w-full mx-auto flex flex-col gap-8">
                    {children}
                </div>
            </main>
        </div>
    );
}
