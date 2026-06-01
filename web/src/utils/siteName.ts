import { useEffect, useState } from 'react';
import { apiFetchFront } from '../api/config';

const DEFAULT_SITE_NAME = 'CLIProxyAPI';

interface PublicConfigResponse {
    site_name?: unknown;
    portal_registration_enabled?: unknown;
}

interface PublicConfig {
    siteName: string;
    portalRegistrationEnabled: boolean;
    loading: boolean;
}

function normalizeSiteName(value: unknown, fallback: string): string {
    if (typeof value !== 'string') {
        return fallback;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'on', 'enabled'].includes(normalized)) {
            return true;
        }
        if (['false', '0', 'no', 'off', 'disabled'].includes(normalized)) {
            return false;
        }
    }
    return fallback;
}

export function usePublicConfig(fallback = DEFAULT_SITE_NAME): PublicConfig {
    const [config, setConfig] = useState<PublicConfig>({
        siteName: fallback,
        portalRegistrationEnabled: true,
        loading: true,
    });

    useEffect(() => {
        let mounted = true;
        apiFetchFront<PublicConfigResponse>('/v0/front/config')
            .then((res) => {
                if (!mounted) return;
                setConfig({
                    siteName: normalizeSiteName(res.site_name, fallback),
                    portalRegistrationEnabled: normalizeBoolean(
                        res.portal_registration_enabled,
                        true
                    ),
                    loading: false,
                });
            })
            .catch(() => {
                if (!mounted) return;
                setConfig({
                    siteName: fallback,
                    portalRegistrationEnabled: true,
                    loading: false,
                });
            });
        return () => {
            mounted = false;
        };
    }, [fallback]);

    return config;
}

export function useSiteName(fallback = DEFAULT_SITE_NAME): string {
    return usePublicConfig(fallback).siteName;
}
