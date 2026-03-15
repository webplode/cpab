import { useEffect, useState, useRef } from 'react';
import { API_BASE_URL } from '../api/config';

interface VersionInfo {
    currentVersion: string;
    latestVersion: string;
    hasUpdate: boolean;
    releaseUrl: string;
    commit: string;
    buildDate: string;
    checkError?: string;
}

interface VersionState {
    loading: boolean;
    error: string | null;
    data: VersionInfo | null;
}

interface CachedVersionData {
    data: VersionInfo;
    timestamp: number;
    cachedCurrentVersion: string;
}

const CACHE_KEY = 'version_check_cache';
const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour

function getCachedData(): CachedVersionData | null {
    try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (!cached) return null;
        return JSON.parse(cached) as CachedVersionData;
    } catch {
        return null;
    }
}

function setCachedData(data: VersionInfo): void {
    const cacheData: CachedVersionData = {
        data,
        timestamp: Date.now(),
        cachedCurrentVersion: data.currentVersion,
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
}

function clearCache(): void {
    localStorage.removeItem(CACHE_KEY);
}

function isCacheValid(cached: CachedVersionData): boolean {
    if (cached.data.hasUpdate) {
        return true;
    }
    return Date.now() - cached.timestamp < CACHE_DURATION_MS;
}

async function fetchCurrentVersion(): Promise<string | null> {
    try {
        const response = await fetch(`${API_BASE_URL}/v0/version`);
        if (!response.ok) return null;
        const json = await response.json();
        return json.current_version || null;
    } catch {
        return null;
    }
}

async function fetchVersionInfo(): Promise<VersionInfo> {
    const response = await fetch(`${API_BASE_URL}/v0/version`);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    const json = await response.json();
    return {
        currentVersion: json.current_version,
        latestVersion: json.latest_version || '',
        hasUpdate: json.has_update,
        releaseUrl: json.release_url || '',
        commit: json.commit || '',
        buildDate: json.build_date || '',
        checkError: json.check_error,
    };
}

export function useVersionCheck(): VersionState {
    const [state, setState] = useState<VersionState>(() => {
        const cached = getCachedData();
        if (cached && isCacheValid(cached)) {
            return {
                loading: false,
                error: null,
                data: cached.data,
            };
        }
        return {
            loading: true,
            error: null,
            data: null,
        };
    });

    const verificationDone = useRef(false);

    useEffect(() => {
        const cached = getCachedData();

        if (cached && cached.data.hasUpdate && !verificationDone.current) {
            verificationDone.current = true;
            fetchCurrentVersion().then((currentVersion) => {
                if (currentVersion && currentVersion !== cached.cachedCurrentVersion) {
                    clearCache();
                    fetchVersionInfo()
                        .then((data) => {
                            setCachedData(data);
                            setState({ loading: false, error: null, data });
                        })
                        .catch((err) => {
                            setState({
                                loading: false,
                                error: err instanceof Error ? err.message : 'Unknown error',
                                data: null,
                            });
                        });
                }
            });
            return;
        }

        if (cached && isCacheValid(cached)) {
            return;
        }

        fetchVersionInfo()
            .then((data) => {
                setCachedData(data);
                setState({ loading: false, error: null, data });
            })
            .catch((err) => {
                setState({
                    loading: false,
                    error: err instanceof Error ? err.message : 'Unknown error',
                    data: null,
                });
            });
    }, []);

    return state;
}
