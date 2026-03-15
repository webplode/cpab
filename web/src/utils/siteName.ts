import { useEffect, useState } from 'react';
import { apiFetchFront } from '../api/config';

const DEFAULT_SITE_NAME = 'CLIProxyAPI';

interface SiteConfigResponse {
    site_name?: unknown;
}

function normalizeSiteName(value: unknown, fallback: string): string {
    if (typeof value !== 'string') {
        return fallback;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : fallback;
}

export function useSiteName(fallback = DEFAULT_SITE_NAME): string {
    const [siteName, setSiteName] = useState(fallback);

    useEffect(() => {
        let mounted = true;
        apiFetchFront<SiteConfigResponse>('/v0/front/config')
            .then((res) => {
                if (!mounted) return;
                setSiteName(normalizeSiteName(res.site_name, fallback));
            })
            .catch(() => {
                if (!mounted) return;
                setSiteName(fallback);
            });
        return () => {
            mounted = false;
        };
    }, [fallback]);

    return siteName;
}
