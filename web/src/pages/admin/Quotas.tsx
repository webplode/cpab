import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AdminDashboardLayout } from '../../components/admin/AdminDashboardLayout';
import { AdminNoAccessCard } from '../../components/admin/AdminNoAccessCard';
import { apiFetchAdmin } from '../../api/config';
import { Icon } from '../../components/Icon';
import { buildAdminPermissionKey, useAdminPermissions } from '../../utils/adminPermissions';
import { useTranslation } from 'react-i18next';

interface QuotaRecord {
    id: number;
    auth_id: number;
    auth_key: string;
    type: string;
    data: unknown;
    updated_at: string;
}

interface QuotaListResponse {
    quotas: QuotaRecord[];
    types: string[];
    total: number;
    page: number;
    limit: number;
}

interface AuthGroup {
    id: number;
    name: string;
}

interface AuthGroupListResponse {
    auth_groups: AuthGroup[];
}

interface QuotaItem {
    name: string;
    percent: number | null;
    percentDisplay?: string;
    updatedAt: string | null;
}

interface TypeDropdownMenuProps {
    options: { value: string; label: string }[];
    selectedValue: string;
    menuWidth?: number;
    anchorId: string;
    onSelect: (value: string) => void;
    onClose: () => void;
}

function useAutoScroll(ref: RefObject<HTMLDivElement | null>, enabled: boolean) {
    const directionRef = useRef(1);
    const rafRef = useRef<number | null>(null);
    const pauseUntilRef = useRef(0);

    useEffect(() => {
        if (!enabled) {
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
            pauseUntilRef.current = 0;
            return;
        }

        const speedPxPerFrame = 0.5;
        const pauseMs = 3000;

        const step = (ts: number) => {
            const el = ref.current;
            if (!el) {
                rafRef.current = requestAnimationFrame(step);
                return;
            }
            if (pauseUntilRef.current && ts < pauseUntilRef.current) {
                rafRef.current = requestAnimationFrame(step);
                return;
            }
            if (pauseUntilRef.current && ts >= pauseUntilRef.current) {
                pauseUntilRef.current = 0;
            }
            const max = Math.max(0, el.scrollHeight - el.clientHeight);
            if (max <= 0) {
                rafRef.current = requestAnimationFrame(step);
                return;
            }

            el.scrollTop += directionRef.current * speedPxPerFrame;
            if (el.scrollTop <= 0) {
                el.scrollTop = 0;
                directionRef.current = 1;
                pauseUntilRef.current = ts + pauseMs;
            } else if (el.scrollTop >= max) {
                el.scrollTop = max;
                directionRef.current = -1;
                pauseUntilRef.current = ts + pauseMs;
            }

            rafRef.current = requestAnimationFrame(step);
        };

        pauseUntilRef.current = performance.now() + pauseMs;
        rafRef.current = requestAnimationFrame(step);
        return () => {
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
            pauseUntilRef.current = 0;
        };
    }, [enabled, ref]);
}

function AutoScrollList({
    className,
    children,
}: {
    className?: string;
    children: ReactNode;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [hovered, setHovered] = useState(false);
    useAutoScroll(containerRef, !hovered);

    return (
        <div
            ref={containerRef}
            className={className}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            {children}
        </div>
    );
}

const percentKeys = [
    'usage_percent',
    'usagePercent',
    'percent',
    'percentage',
    'quota_percent',
    'quotaPercent',
    'utilization',
    'usage_rate',
    'usageRate',
    'remaining_percent',
    'remainingPercent',
    'available_percent',
    'availablePercent',
];

const usedKeys = [
    'used',
    'usage',
    'consumed',
    'used_quota',
    'usedQuota',
    'used_tokens',
    'usedTokens',
    'used_requests',
    'usedRequests',
];

const remainingKeys = [
    'remaining',
    'left',
    'left_quota',
    'leftQuota',
    'remaining_quota',
    'remainingQuota',
    'available',
    'available_quota',
    'availableQuota',
];

const limitKeys = [
    'limit',
    'quota',
    'total',
    'total_quota',
    'totalQuota',
    'max',
    'capacity',
    'max_quota',
    'maxQuota',
    'allocated',
    'allocated_quota',
    'allocatedQuota',
];

const modelKeys = [
    'display_name',
    'displayName',
    'model_display_name',
    'modelDisplayName',
    'model_name',
    'modelName',
    'model',
    'name',
    'id',
];

function TypeDropdownMenu({ options, selectedValue, menuWidth, anchorId, onSelect, onClose }: TypeDropdownMenuProps) {
    const btn = document.getElementById(anchorId);
    const rect = btn ? btn.getBoundingClientRect() : null;
    const position = rect
        ? { top: rect.bottom + 4, left: rect.left, width: rect.width }
        : { top: 0, left: 0, width: 0 };

    return createPortal(
        <>
            <div className="fixed inset-0 z-40" onClick={onClose} />
            <div
                className="fixed z-50 bg-white dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto"
                style={{ top: position.top, left: position.left, width: position.width || menuWidth }}
            >
                {options.map((opt) => (
                    <button
                        key={opt.value || 'all'}
                        type="button"
                        onClick={() => onSelect(opt.value)}
                        className={`w-full text-left px-4 py-2.5 text-sm truncate hover:bg-gray-100 dark:hover:bg-background-dark transition-colors ${
                            selectedValue === opt.value
                                ? 'bg-gray-100 dark:bg-background-dark text-primary font-medium'
                                : 'text-slate-900 dark:text-white'
                        }`}
                        title={opt.label}
                    >
                        {opt.label}
                    </button>
                ))}
            </div>
        </>,
        document.body
    );
}

function normalizePayload(data: unknown): unknown {
    if (typeof data !== 'string') {
        return data;
    }
    const trimmed = data.trim();
    if (!trimmed) {
        return data;
    }
    const startsJSON = trimmed.startsWith('{') && trimmed.endsWith('}');
    const startsArray = trimmed.startsWith('[') && trimmed.endsWith(']');
    if (!startsJSON && !startsArray) {
        return data;
    }
    try {
        return JSON.parse(trimmed);
    } catch {
        return data;
    }
}

function toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function toStringValue(value: unknown): string {
    if (typeof value === 'string') {
        return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    return '';
}

function getNumberFromKeys(item: Record<string, unknown>, keys: string[]): number | null {
    for (const key of keys) {
        const num = toNumber(item[key]);
        if (num !== null) {
            return num;
        }
    }
    return null;
}

function normalizePercent(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    const normalized = value <= 1 ? value * 100 : value;
    return Math.min(100, Math.max(0, normalized));
}

function extractModelName(item: Record<string, unknown>): string {
    for (const key of modelKeys) {
        const name = toStringValue(item[key]);
        if (name) {
            return name;
        }
    }
    const nested = item.model;
    if (nested && typeof nested === 'object') {
        const nestedRecord = nested as Record<string, unknown>;
        for (const key of modelKeys) {
            const name = toStringValue(nestedRecord[key]);
            if (name) {
                return name;
            }
        }
    }
    return '';
}

function extractPercent(item: Record<string, unknown>): number | null {
    const direct = getNumberFromKeys(item, percentKeys);
    if (direct !== null) {
        return normalizePercent(direct);
    }

    const remaining = getNumberFromKeys(item, remainingKeys);
    const limit = getNumberFromKeys(item, limitKeys);
    if (remaining !== null && limit !== null && limit > 0) {
        return normalizePercent((remaining / limit) * 100);
    }

    const used = getNumberFromKeys(item, usedKeys);
    if (used !== null && limit !== null && limit > 0) {
        return normalizePercent(((limit - used) / limit) * 100);
    }

    if (used !== null && remaining !== null && used + remaining > 0) {
        return normalizePercent((remaining / (used + remaining)) * 100);
    }

    return null;
}

function collectArrays(value: unknown, depth: number): unknown[][] {
    if (depth > 3) {
        return [];
    }
    if (Array.isArray(value)) {
        return [value];
    }
    if (value && typeof value === 'object') {
        const entries = Object.values(value as Record<string, unknown>);
        return entries.flatMap((child) => collectArrays(child, depth + 1));
    }
    return [];
}

function scoreArray(value: unknown[]): number {
    let score = 0;
    for (const item of value) {
        if (!item || typeof item !== 'object') {
            continue;
        }
        const record = item as Record<string, unknown>;
        if (extractModelName(record)) {
            score += 2;
        }
        if (extractPercent(record) !== null) {
            score += 1;
        }
    }
    return score;
}

function selectBestArray(payload: unknown): unknown[] | null {
    const arrays = collectArrays(payload, 0);
    let best: unknown[] | null = null;
    let bestScore = 0;
    for (const arr of arrays) {
        const score = scoreArray(arr);
        if (score > bestScore) {
            best = arr;
            bestScore = score;
        }
    }
    return bestScore > 0 ? best : null;
}

function extractAntigravityItems(payload: unknown, fallbackTime: string, locale: string): QuotaItem[] | null {
    const normalized = normalizePayload(payload);
    if (!normalized || typeof normalized !== 'object') {
        return null;
    }
    const models = (normalized as Record<string, unknown>).models;
    if (!models || typeof models !== 'object') {
        return null;
    }
    const items: QuotaItem[] = [];
    for (const [key, value] of Object.entries(models as Record<string, unknown>)) {
        if (!value || typeof value !== 'object') {
            continue;
        }
        const record = value as Record<string, unknown>;
        if (!('modelProvider' in record)) {
            continue;
        }
        const displayName = toStringValue(record.displayName);
        const modelName = toStringValue(record.model);
        const name = displayName || modelName || key;
        if (!name) {
            continue;
        }
        const quotaInfo = record.quotaInfo;
        const quotaRecord =
            quotaInfo && typeof quotaInfo === 'object' ? (quotaInfo as Record<string, unknown>) : null;
        const remainingFraction = quotaRecord ? toNumber(quotaRecord.remainingFraction) : null;
        let percent: number | null = null;
        let percentDisplay: string | undefined;
        if (remainingFraction !== null) {
            const clamped = Math.max(0, Math.min(1, remainingFraction));
            percent = clamped * 100;
            if (clamped >= 1) {
                percentDisplay = '100%';
            } else {
                percentDisplay = `${(clamped * 100).toFixed(2)}%`;
            }
        }
        const resetTime = quotaRecord ? toStringValue(quotaRecord.resetTime) : '';
        const timeValue = formatQuotaTime(resetTime || fallbackTime, locale);
        items.push({
            name,
            percent,
            percentDisplay,
            updatedAt: timeValue ? resetTime || fallbackTime : null,
        });
    }
    return items;
}

function extractGeminiItems(payload: unknown, locale: string): QuotaItem[] | null {
    const normalized = normalizePayload(payload);
    if (!normalized || typeof normalized !== 'object') {
        return null;
    }
    const buckets = (normalized as Record<string, unknown>).buckets;
    if (!Array.isArray(buckets)) {
        return null;
    }
    const items: QuotaItem[] = [];
    for (const bucket of buckets) {
        if (!bucket || typeof bucket !== 'object') {
            continue;
        }
        const record = bucket as Record<string, unknown>;
        const name = toStringValue(record.modelId);
        if (!name) {
            continue;
        }
        const remainingFraction = toNumber(record.remainingFraction);
        let percent: number | null = null;
        let percentDisplay: string | undefined;
        if (remainingFraction !== null) {
            const clamped = Math.max(0, Math.min(1, remainingFraction));
            percent = clamped * 100;
            if (clamped >= 1) {
                percentDisplay = '100%';
            } else {
                percentDisplay = `${(clamped * 100).toFixed(2)}%`;
            }
        }
        const resetTime = toStringValue(record.resetTime);
        const timeValue = formatQuotaTime(resetTime, locale);
        items.push({
            name,
            percent,
            percentDisplay,
            updatedAt: timeValue ? resetTime : null,
        });
    }
    return items;
}

function extractCodexItems(payload: unknown, locale: string): QuotaItem[] | null {
    const normalized = normalizePayload(payload);
    if (!normalized || typeof normalized !== 'object') {
        return null;
    }
    const record = normalized as Record<string, unknown>;
    const rateLimit = toRecord(record.rate_limit ?? record.rateLimit);
    const reviewLimit = toRecord(record.code_review_rate_limit ?? record.codeReviewRateLimit);
    const items: QuotaItem[] = [];

    if (rateLimit) {
        items.push(...buildCodexItems(rateLimit, 'Usage', locale));
    }
    if (reviewLimit) {
        items.push(...buildCodexItems(reviewLimit, 'Review', locale));
    }

    return items.length > 0 ? items : null;
}

function extractQuotaItems(payload: unknown, fallbackTime: string, locale: string): QuotaItem[] {
    const geminiItems = extractGeminiItems(payload, locale);
    if (geminiItems) {
        return geminiItems;
    }
    const codexItems = extractCodexItems(payload, locale);
    if (codexItems) {
        return codexItems;
    }
    const antigravityItems = extractAntigravityItems(payload, fallbackTime, locale);
    if (antigravityItems) {
        return antigravityItems;
    }
    const normalized = normalizePayload(payload);
    const list = selectBestArray(normalized);
    if (!list) {
        return [];
    }
    const items: QuotaItem[] = [];
    for (const entry of list) {
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        const record = entry as Record<string, unknown>;
        const name = extractModelName(record);
        if (!name) {
            continue;
        }
        items.push({
            name,
            percent: extractPercent(record),
            updatedAt: fallbackTime || null,
        });
    }
    return items;
}

function buildCodexItems(
    limit: Record<string, unknown>,
    labelPrefix: string,
    locale: string
): QuotaItem[] {
    const items: QuotaItem[] = [];
    const primary = toRecord(limit.primary_window ?? limit.primaryWindow);
    const secondary = toRecord(limit.secondary_window ?? limit.secondaryWindow);
    const allowed = normalizeBoolean(limit.allowed);
    const limitReached = normalizeBoolean(limit.limit_reached ?? limit.limitReached);

    if (primary) {
        const label = buildCodexLabel(labelPrefix, 'primary', primary);
        const item = buildCodexItem(label, primary, allowed, limitReached, locale);
        if (item) {
            items.push(item);
        }
    }
    if (secondary) {
        const label = buildCodexLabel(labelPrefix, 'secondary', secondary);
        const item = buildCodexItem(label, secondary, allowed, limitReached, locale);
        if (item) {
            items.push(item);
        }
    }

    return items;
}

function buildCodexItem(
    name: string,
    window: Record<string, unknown>,
    allowed: boolean | null,
    limitReached: boolean | null,
    locale: string
): QuotaItem | null {
    const usedPercentRaw = toNumber(window.used_percent ?? window.usedPercent);
    let percent: number | null = null;
    if (limitReached || allowed === false) {
        percent = 0;
    } else if (usedPercentRaw !== null) {
        const used = normalizePercent(usedPercentRaw);
        percent = Math.max(0, 100 - used);
    }
    const resetTime = resolveCodexResetTime(window, locale);
    return {
        name,
        percent,
        updatedAt: resetTime,
    };
}

function resolveCodexResetTime(window: Record<string, unknown>, locale: string): string | null {
    const resetAt = toNumber(window.reset_at ?? window.resetAt);
    if (resetAt !== null && resetAt > 0) {
        const ms = resetAt > 1e12 ? resetAt : resetAt * 1000;
        const iso = new Date(ms).toISOString();
        return formatQuotaTime(iso, locale) ? iso : null;
    }
    const resetAfter = toNumber(window.reset_after_seconds ?? window.resetAfterSeconds);
    if (resetAfter !== null && resetAfter > 0) {
        const ms = Date.now() + resetAfter * 1000;
        const iso = new Date(ms).toISOString();
        return formatQuotaTime(iso, locale) ? iso : null;
    }
    return null;
}

function buildCodexLabel(prefix: string, windowKey: string, window: Record<string, unknown>): string {
    const seconds = toNumber(window.limit_window_seconds ?? window.limitWindowSeconds);
    let suffix = '';
    if (seconds !== null && seconds > 0) {
        if (seconds >= 7 * 24 * 3600 - 60) {
            suffix = 'Weekly';
        } else if (seconds >= 24 * 3600 - 60) {
            suffix = 'Daily';
        } else if (seconds >= 3600) {
            suffix = `${Math.round(seconds / 3600)}h`;
        } else if (seconds >= 60) {
            suffix = `${Math.round(seconds / 60)}m`;
        } else {
            suffix = `${Math.round(seconds)}s`;
        }
    } else if (windowKey === 'primary') {
        suffix = '5h';
    } else if (windowKey === 'secondary') {
        suffix = 'Weekly';
    } else {
        suffix = windowKey;
    }
    return `${prefix} (${suffix})`;
}

function normalizeBoolean(value: unknown): boolean | null {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim().toLowerCase();
        if (trimmed === 'true' || trimmed === '1') {
            return true;
        }
        if (trimmed === 'false' || trimmed === '0') {
            return false;
        }
    }
    return null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function formatQuotaTime(value: string | null, locale: string): string {
    if (!value) {
        return '';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    const formatter = new Intl.DateTimeFormat(locale || undefined, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
    return formatter.format(date);
}

function formatTypeLabel(value: string, fallback: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
        return fallback;
    }
    const words = trimmed.replace(/[_-]+/g, ' ').split(' ').filter(Boolean);
    return words
        .map((word) => {
            const lower = word.toLowerCase();
            if (['api', 'cli', 'gpt', 'ai'].includes(lower)) {
                return lower.toUpperCase();
            }
            return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join(' ');
}

function getProgressColor(percent: number | null): string {
    if (percent === null) {
        return 'bg-gray-300 dark:bg-border-dark';
    }
    if (percent >= 90) {
        return 'bg-emerald-500';
    }
    if (percent >= 70) {
        return 'bg-lime-500';
    }
    if (percent >= 50) {
        return 'bg-amber-500';
    }
    return 'bg-orange-500';
}

export function AdminQuotas() {
    const { t, i18n } = useTranslation();
    const { hasPermission } = useAdminPermissions();
    const canListQuotas = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/quotas'));
    const canListAuthGroups = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/auth-groups'));
    const pageSize = 12;

    const [quotas, setQuotas] = useState<QuotaRecord[]>([]);
    const [types, setTypes] = useState<string[]>([]);
    const [search, setSearch] = useState('');
    const [typeFilter, setTypeFilter] = useState('');
    const [authGroups, setAuthGroups] = useState<AuthGroup[]>([]);
    const [authGroupFilter, setAuthGroupFilter] = useState<number | null>(null);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [typeMenuOpen, setTypeMenuOpen] = useState(false);
    const [typeBtnWidth, setTypeBtnWidth] = useState<number | undefined>(undefined);
    const [authGroupMenuOpen, setAuthGroupMenuOpen] = useState(false);
    const [authGroupBtnWidth, setAuthGroupBtnWidth] = useState<number | undefined>(undefined);

    const typeOptions = useMemo(() => {
        const fallback = t('Unknown');
        const availableTypes = types.filter((type) => type.trim() !== '');
        return [
            { value: '', label: t('All Types') },
            ...availableTypes.map((type) => ({
                value: type,
                label: formatTypeLabel(type, fallback),
            })),
        ];
    }, [types, t]);

    const authGroupOptions = useMemo(() => {
        return [
            { value: '', label: t('All Auth Groups') },
            ...authGroups.map((group) => ({
                value: group.id.toString(),
                label: group.name || group.id.toString(),
            })),
        ];
    }, [authGroups, t]);

    const totalPages = useMemo(() => {
        const pages = Math.ceil(total / pageSize);
        return pages > 0 ? pages : 1;
    }, [pageSize, total]);

    const quotaCards = useMemo(() => {
        const fallback = t('Unknown');
        return quotas.map((quota) => ({
            ...quota,
            typeLabel: formatTypeLabel(quota.type || '', fallback),
            items: extractQuotaItems(quota.data, quota.updated_at, i18n.language),
        }));
    }, [i18n.language, quotas, t]);

    const fetchQuotas = useCallback(async () => {
        if (!canListQuotas) {
            return;
        }
        setIsLoading(true);
        try {
            const params = new URLSearchParams();
            params.set('page', page.toString());
            params.set('limit', pageSize.toString());
            if (search.trim()) {
                params.set('key', search.trim());
            }
            if (typeFilter) {
                params.set('type', typeFilter);
            }
            if (authGroupFilter) {
                params.set('auth_group_id', authGroupFilter.toString());
            }
            const res = await apiFetchAdmin<QuotaListResponse>(`/v0/admin/quotas?${params.toString()}`);
            setQuotas(res.quotas || []);
            setTypes(res.types || []);
            setTotal(res.total || 0);
        } catch (err) {
            console.error('Failed to fetch quotas:', err);
        } finally {
            setIsLoading(false);
        }
    }, [canListQuotas, page, pageSize, search, typeFilter, authGroupFilter]);

    useEffect(() => {
        fetchQuotas();
    }, [fetchQuotas]);

    useEffect(() => {
        if (!canListAuthGroups) {
            setAuthGroups([]);
            return;
        }
        let mounted = true;
        apiFetchAdmin<AuthGroupListResponse>('/v0/admin/auth-groups')
            .then((res) => {
                if (!mounted) return;
                setAuthGroups(res.auth_groups || []);
            })
            .catch((err) => {
                console.error('Failed to fetch auth groups:', err);
            });
        return () => {
            mounted = false;
        };
    }, [canListAuthGroups]);

    useEffect(() => {
        const allOptions = typeOptions.map((opt) => opt.label);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
            let maxWidth = 0;
            for (const opt of allOptions) {
                const width = ctx.measureText(opt).width;
                if (width > maxWidth) maxWidth = width;
            }
            setTypeBtnWidth(Math.ceil(maxWidth) + 76);
        }
    }, [typeOptions]);

    useEffect(() => {
        const labels = authGroupOptions.map((opt) => opt.label);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
            let maxWidth = 0;
            for (const label of labels) {
                const width = ctx.measureText(label).width;
                if (width > maxWidth) maxWidth = width;
            }
            setAuthGroupBtnWidth(Math.ceil(maxWidth) + 76);
        }
    }, [authGroupOptions]);

    useEffect(() => {
        if (page > totalPages) {
            setPage(totalPages);
        }
    }, [page, totalPages]);

    if (!canListQuotas) {
        return (
            <AdminDashboardLayout title={t('Quota')} subtitle={t('Monitor quota usage')}>
                <AdminNoAccessCard />
            </AdminDashboardLayout>
        );
    }

    const selectedTypeLabel = typeFilter
        ? typeOptions.find((opt) => opt.value === typeFilter)?.label || t('All Types')
        : t('All Types');
    const selectedAuthGroupLabel = authGroupFilter
        ? authGroupOptions.find((opt) => opt.value === authGroupFilter.toString())?.label || t('All Auth Groups')
        : t('All Auth Groups');

    const handleSearchChange = (value: string) => {
        setSearch(value);
        setPage(1);
    };

    const handleSelectType = (value: string) => {
        setTypeFilter(value);
        setTypeMenuOpen(false);
        setPage(1);
    };

    const handleSelectAuthGroup = (value: string) => {
        const parsed = value ? Number(value) : 0;
        setAuthGroupFilter(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
        setAuthGroupMenuOpen(false);
        setPage(1);
    };

    return (
        <AdminDashboardLayout title={t('Quota')} subtitle={t('Monitor quota usage')}>
            <div className="space-y-6">
                <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-white dark:bg-surface-dark p-3 rounded-xl border border-gray-200 dark:border-border-dark shadow-sm">
                    <div className="flex gap-3 w-full md:w-auto">
                        <div className="relative w-full md:w-96">
                            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                                <Icon name="search" className="text-gray-400" />
                            </div>
                            <input
                                className="block w-full p-2.5 pl-10 text-sm text-slate-900 dark:text-white bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark rounded-lg focus:ring-primary focus:border-primary placeholder-gray-400 dark:placeholder-gray-500"
                                placeholder={t('Search by key...')}
                                type="text"
                                value={search}
                                onChange={(e) => handleSearchChange(e.target.value)}
                            />
                        </div>
                        <div className="relative">
                            <button
                                type="button"
                                id="quota-type-dropdown-btn"
                                onClick={() => setTypeMenuOpen(!typeMenuOpen)}
                                className="flex items-center justify-between gap-2 bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark text-slate-900 dark:text-white text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5 whitespace-nowrap"
                                style={typeBtnWidth ? { width: typeBtnWidth } : undefined}
                            >
                                <span>{selectedTypeLabel}</span>
                                <Icon name={typeMenuOpen ? 'expand_less' : 'expand_more'} size={18} />
                            </button>
                            {typeMenuOpen && (
                                <TypeDropdownMenu
                                    options={typeOptions}
                                    selectedValue={typeFilter}
                                    menuWidth={typeBtnWidth}
                                    anchorId="quota-type-dropdown-btn"
                                    onSelect={handleSelectType}
                                    onClose={() => setTypeMenuOpen(false)}
                                />
                            )}
                        </div>
                        <div className="relative">
                            <button
                                type="button"
                                id="quota-auth-group-dropdown-btn"
                                onClick={() => setAuthGroupMenuOpen(!authGroupMenuOpen)}
                                className="flex items-center justify-between gap-2 bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark text-slate-900 dark:text-white text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5 whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
                                style={authGroupBtnWidth ? { width: authGroupBtnWidth } : undefined}
                                disabled={!canListAuthGroups}
                            >
                                <span>{selectedAuthGroupLabel}</span>
                                <Icon name={authGroupMenuOpen ? 'expand_less' : 'expand_more'} size={18} />
                            </button>
                            {authGroupMenuOpen && canListAuthGroups && (
                                <TypeDropdownMenu
                                    options={authGroupOptions}
                                    selectedValue={authGroupFilter ? authGroupFilter.toString() : ''}
                                    menuWidth={authGroupBtnWidth}
                                    anchorId="quota-auth-group-dropdown-btn"
                                    onSelect={handleSelectAuthGroup}
                                    onClose={() => setAuthGroupMenuOpen(false)}
                                />
                            )}
                        </div>
                    </div>
                    <button
                        onClick={fetchQuotas}
                        className="h-10 w-10 inline-flex items-center justify-center text-slate-500 hover:text-primary hover:bg-slate-50 dark:hover:bg-background-dark rounded-lg border border-gray-200 dark:border-border-dark transition-colors"
                        title={t('Refresh')}
                    >
                        <Icon name="refresh" size={18} />
                    </button>
                </div>

                {isLoading && quotas.length === 0 ? (
                    <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-sm p-8 text-center text-sm text-slate-500 dark:text-text-secondary">
                        {t('Loading...')}
                    </div>
                ) : quotas.length === 0 ? (
                    <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-sm p-8 text-center text-sm text-slate-500 dark:text-text-secondary">
                        {t('No quota data available')}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                        {quotaCards.map((quota) => (
                            <div
                                key={quota.id}
                                className="bg-white dark:bg-surface-dark rounded-2xl border border-gray-200 dark:border-border-dark shadow-sm p-5 flex flex-col gap-4"
                            >
                                <div className="flex items-start gap-3">
                                    <span className="px-3 py-1 rounded-full text-xs font-semibold tracking-wide bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200">
                                        {quota.typeLabel}
                                    </span>
                                    <div className="flex-1 text-base font-semibold text-slate-900 dark:text-white break-all">
                                        {quota.auth_key}
                                    </div>
                                </div>
                                <div className="border-t border-dashed border-gray-200 dark:border-border-dark" />
                                <AutoScrollList className="flex flex-col gap-4 max-h-72 overflow-y-auto scrollbar-hidden pr-1">
                                    {quota.items.length === 0 ? (
                                        <div className="min-h-[140px] flex items-center justify-center text-center text-sm text-slate-400 dark:text-text-secondary">
                                            {t('No quota data available')}
                                        </div>
                                    ) : (
                                        quota.items.map((item) => {
                                            const percentLabel =
                                                item.percent === null
                                                    ? '--'
                                                    : item.percentDisplay || `${Math.round(item.percent)}%`;
                                            const timeLabel = formatQuotaTime(item.updatedAt, i18n.language) || '--';
                                            const barWidth = item.percent === null ? '0%' : `${item.percent}%`;
                                            return (
                                                <div key={`${quota.id}-${item.name}`} className="space-y-2">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <div className="min-w-0 flex-1">
                                                            <span
                                                                className="block truncate text-xs font-semibold text-slate-800 dark:text-white"
                                                                title={item.name}
                                                            >
                                                                {item.name}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-text-secondary whitespace-nowrap">
                                                            <span className="font-semibold text-slate-900 dark:text-white">
                                                                {percentLabel}
                                                            </span>
                                                            <span className="text-xs">{timeLabel}</span>
                                                        </div>
                                                    </div>
                                                    <div className="h-2 rounded-full bg-gray-200 dark:bg-border-dark overflow-hidden">
                                                        <div
                                                            className={`h-full rounded-full ${getProgressColor(
                                                                item.percent
                                                            )}`}
                                                            style={{ width: barWidth }}
                                                        />
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </AutoScrollList>
                            </div>
                        ))}
                    </div>
                )}

                <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-sm px-6 py-4 flex items-center justify-between">
                    <div className="text-sm text-slate-500 dark:text-text-secondary">
                        {t('Page {{current}} of {{total}}', { current: page, total: totalPages })}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                            disabled={page === 1}
                            className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 dark:border-border-dark bg-white dark:bg-surface-dark text-slate-700 dark:text-white hover:bg-slate-50 dark:hover:bg-border-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {t('Previous')}
                        </button>
                        <button
                            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                            disabled={page === totalPages}
                            className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 dark:border-border-dark bg-white dark:bg-surface-dark text-slate-700 dark:text-white hover:bg-slate-50 dark:hover:bg-border-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {t('Next')}
                        </button>
                    </div>
                </div>
            </div>
        </AdminDashboardLayout>
    );
}
