import { useTranslation } from 'react-i18next';
import { useVersionCheck } from '../../hooks/useVersionCheck';
import { Icon } from '../Icon';

export function VersionUpdateButton() {
    const { t } = useTranslation();
    const { loading, data } = useVersionCheck();

    if (loading || !data?.hasUpdate) {
        return null;
    }

    const handleClick = () => {
        if (data.releaseUrl) {
            window.open(data.releaseUrl, '_blank', 'noopener,noreferrer');
        }
    };

    return (
        <button
            type="button"
            onClick={handleClick}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-green-500 bg-green-500/10 text-green-600 dark:text-green-400 transition-colors hover:bg-green-500/20"
            aria-label={t('New version available')}
            title={`${t('New version available')}: ${data.latestVersion}`}
        >
            <Icon name="system_update" size={18} />
        </button>
    );
}
