import { Icon } from './Icon';
import { useTranslation } from 'react-i18next';

export interface ConfirmDialogProps {
    title: string;
    message: string;
    confirmText?: string;
    danger?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export function ConfirmDialog({
    title,
    message,
    confirmText,
    danger,
    onConfirm,
    onCancel,
}: ConfirmDialogProps) {
    const { t } = useTranslation();
    const resolvedConfirmText = confirmText ?? t('Confirm');

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white dark:bg-surface-dark rounded-xl shadow-xl w-full max-w-sm mx-4 border border-gray-200 dark:border-border-dark max-h-[90vh] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-border-dark shrink-0">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                        {title}
                    </h2>
                    <button
                        onClick={onCancel}
                        className="inline-flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
                    >
                        <Icon name="close" />
                    </button>
                </div>
                <div className="p-6 flex-1 overflow-y-auto">
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                        {message}
                    </p>
                </div>
                <div className="flex gap-3 px-6 py-4 border-t border-gray-200 dark:border-border-dark shrink-0">
                    <button
                        onClick={onCancel}
                        className="flex-1 py-2.5 bg-gray-100 dark:bg-background-dark hover:bg-gray-200 dark:hover:bg-gray-700 text-slate-900 dark:text-white rounded-lg font-medium transition-colors border border-gray-200 dark:border-border-dark"
                    >
                        {t('Cancel')}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`flex-1 py-2.5 rounded-lg font-medium transition-colors ${
                            danger
                                ? 'bg-red-500 hover:bg-red-600 text-white'
                                : 'bg-primary hover:bg-blue-600 text-white'
                        }`}
                    >
                        {resolvedConfirmText}
                    </button>
                </div>
            </div>
        </div>
    );
}
