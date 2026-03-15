import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface HeaderProps {
    title?: string;
    subtitle?: string;
    actions?: ReactNode;
}

export function Header({ title, subtitle, actions }: HeaderProps) {
    const { t } = useTranslation();
    const resolvedTitle = title ?? t('Dashboard Overview');
    const resolvedSubtitle = subtitle ?? t('Real-time insights into your API infrastructure.');

    return (
        <header className="sticky top-0 z-30 bg-white dark:bg-background-dark backdrop-blur-md border-b border-gray-200 dark:border-border-dark px-8 py-5">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                        {resolvedTitle}
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-text-secondary mt-1">
                        {resolvedSubtitle}
                    </p>
                </div>
                {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
            </div>
        </header>
    );
}
