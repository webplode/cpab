import { Icon } from '../Icon';
import { useTranslation } from 'react-i18next';

interface AdminNoAccessCardProps {
    title?: string;
    description?: string;
}

export function AdminNoAccessCard({
    title,
    description,
}: AdminNoAccessCardProps) {
    const { t } = useTranslation();
    const resolvedTitle = title ?? t('No Access');
    const resolvedDescription = description ?? t('You do not have permission to view this page.');

    return (
        <div className="bg-white dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-xl p-6 shadow-sm flex items-start gap-4">
            <div className="h-10 w-10 rounded-lg bg-red-100 text-red-500 flex items-center justify-center">
                <Icon name="lock" size={20} />
            </div>
            <div className="space-y-1">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                    {resolvedTitle}
                </h2>
                <p className="text-sm text-slate-600 dark:text-text-secondary">
                    {resolvedDescription}
                </p>
            </div>
        </div>
    );
}
