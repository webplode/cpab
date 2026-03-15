import { useState, useEffect, useCallback, useRef, useMemo, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { AdminDashboardLayout } from '../../components/admin/AdminDashboardLayout';
import { AdminNoAccessCard } from '../../components/admin/AdminNoAccessCard';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { apiFetchAdmin } from '../../api/config';
import { Icon } from '../../components/Icon';
import { buildAdminPermissionKey, useAdminPermissions } from '../../utils/adminPermissions';
import { useStickyActionsDivider } from '../../utils/stickyActionsDivider';
import { useTranslation } from 'react-i18next';

interface TypeDropdownMenuProps {
    types: string[];
    typeFilter: string;
    menuWidth?: number;
    onSelect: (value: string) => void;
    onClose: () => void;
}

function TypeDropdownMenu({ types, typeFilter, menuWidth, onSelect, onClose }: TypeDropdownMenuProps) {
    const { t } = useTranslation();
    const menuRef = useRef<HTMLDivElement>(null);
    const btn = document.getElementById('type-dropdown-btn');
    const rect = btn ? btn.getBoundingClientRect() : null;
    const position = rect
        ? { top: rect.bottom + 4, left: rect.left, width: rect.width }
        : { top: 0, left: 0, width: 0 };

    const options = [{ value: '', label: t('All Types') }, ...types.map((type) => ({ value: type, label: type }))];

    return createPortal(
        <>
            <div className="fixed inset-0 z-40" onClick={onClose} />
            <div
                ref={menuRef}
                className="fixed z-50 bg-white dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto"
                style={{ top: position.top, left: position.left, width: position.width || menuWidth }}
            >
                {options.map((opt) => (
                    <button
                        key={opt.value}
                        type="button"
                        onClick={() => onSelect(opt.value)}
                        className={`w-full text-left px-4 py-2.5 text-sm truncate hover:bg-gray-100 dark:hover:bg-background-dark transition-colors ${
                            typeFilter === opt.value
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

interface GroupDropdownMenuProps {
    anchorId: string;
    groups: { id: number; name: string }[];
    selectedId: number | null;
    search: string;
    menuWidth?: number;
    onSearchChange: (value: string) => void;
    onSelect: (value: number | null) => void;
    onClose: () => void;
}

function GroupDropdownMenu({
    anchorId,
    groups,
    selectedId,
    search,
    menuWidth,
    onSearchChange,
    onSelect,
    onClose,
}: GroupDropdownMenuProps) {
    const { t } = useTranslation();
    const menuRef = useRef<HTMLDivElement>(null);
    const btn = document.getElementById(anchorId);
    const rect = btn ? btn.getBoundingClientRect() : null;
    const position = rect
        ? { top: rect.bottom + 4, left: rect.left, width: rect.width }
        : { top: 0, left: 0, width: 0 };

    const filteredGroups = groups.filter((g) => {
        const query = search.trim().toLowerCase();
        if (!query) return true;
        return g.name.toLowerCase().includes(query) || g.id.toString().includes(query);
    });
    const options = [
        { value: null as number | null, label: t('No Group') },
        ...filteredGroups.map((g) => ({ value: g.id as number | null, label: g.name })),
    ];

    return createPortal(
        <>
            <div className="fixed inset-0 z-[60]" onClick={onClose} />
            <div
                ref={menuRef}
                className="fixed z-[70] bg-white dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto"
                style={{ top: position.top, left: position.left, width: position.width || menuWidth }}
            >
                <div className="p-3 border-b border-gray-200 dark:border-border-dark">
                    <div className="relative">
                        <Icon
                            name="search"
                            size={16}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                        />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => onSearchChange(e.target.value)}
                            placeholder={t('Search by name or ID...')}
                            className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                        />
                    </div>
                </div>
                {options.map((opt) => (
                    <button
                        key={opt.value ?? 'null'}
                        type="button"
                        onClick={() => onSelect(opt.value)}
                        className={`w-full text-left px-4 py-2.5 text-sm truncate hover:bg-gray-100 dark:hover:bg-background-dark transition-colors ${
                            selectedId === opt.value
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

interface MultiGroupDropdownMenuProps {
    anchorId: string;
    groups: { id: number; name: string }[];
    selectedIds: number[];
    search: string;
    menuWidth?: number;
    onSearchChange: (value: string) => void;
    onToggle: (value: number) => void;
    onClear: () => void;
    onClose: () => void;
}

function MultiGroupDropdownMenu({
    anchorId,
    groups,
    selectedIds,
    search,
    menuWidth,
    onSearchChange,
    onToggle,
    onClear,
    onClose,
}: MultiGroupDropdownMenuProps) {
    const { t } = useTranslation();
    const menuRef = useRef<HTMLDivElement>(null);
    const btn = document.getElementById(anchorId);
    const rect = btn ? btn.getBoundingClientRect() : null;
    const position = rect
        ? { top: rect.bottom + 4, left: rect.left, width: rect.width }
        : { top: 0, left: 0, width: 0 };

    const selectedSet = new Set(selectedIds);
    const filteredGroups = groups.filter((g) => {
        const query = search.trim().toLowerCase();
        if (!query) return true;
        return g.name.toLowerCase().includes(query) || g.id.toString().includes(query);
    });

    return createPortal(
        <>
            <div className="fixed inset-0 z-[60]" onClick={onClose} />
            <div
                ref={menuRef}
                className="fixed z-[70] bg-white dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto"
                style={{ top: position.top, left: position.left, width: position.width || menuWidth }}
            >
                <div className="p-3 border-b border-gray-200 dark:border-border-dark">
                    <div className="relative">
                        <Icon
                            name="search"
                            size={16}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                        />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => onSearchChange(e.target.value)}
                            placeholder={t('Search by name or ID...')}
                            className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                        />
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onClear}
                    className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-100 dark:hover:bg-background-dark transition-colors ${
                        selectedIds.length === 0
                            ? 'bg-gray-100 dark:bg-background-dark text-primary font-medium'
                            : 'text-slate-900 dark:text-white'
                    }`}
                >
                    <div className="flex items-center justify-between gap-2">
                        <span className="truncate">{t('No Group')}</span>
                        {selectedIds.length === 0 && <Icon name="check" size={16} className="text-primary" />}
                    </div>
                </button>
                {filteredGroups.map((group) => (
                    <button
                        key={group.id}
                        type="button"
                        onClick={() => onToggle(group.id)}
                        className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-100 dark:hover:bg-background-dark transition-colors ${
                            selectedSet.has(group.id)
                                ? 'bg-gray-100 dark:bg-background-dark text-primary font-medium'
                                : 'text-slate-900 dark:text-white'
                        }`}
                        title={group.name}
                    >
                        <div className="flex items-center gap-3 min-w-0">
                            <input
                                type="checkbox"
                                readOnly
                                checked={selectedSet.has(group.id)}
                                className="h-4 w-4 rounded border-gray-300 text-primary"
                            />
                            <span className="truncate">{group.name}</span>
                        </div>
                    </button>
                ))}
            </div>
        </>,
        document.body
    );
}

interface AuthFile {
    id: number;
    key: string;
    proxy_url?: string | null;
    priority: number;
    auth_group_id: number[];
    auth_group?: {
        id: number;
        name: string;
    }[];
    content: Record<string, unknown>;
    is_available: boolean;
    rate_limit: number;
    created_at: string;
    updated_at: string;
}

interface ListResponse {
    auth_files: AuthFile[];
}

interface TypesResponse {
    types: string[];
}

interface AuthGroup {
    id: number;
    name: string;
    is_default: boolean;
}

interface AuthGroupsResponse {
    auth_groups: AuthGroup[];
}

interface ProxyItem {
    id: number;
    proxy_url: string;
    created_at: string;
    updated_at: string;
}

interface ProxiesResponse {
    proxies: ProxyItem[];
}

interface TokenUrlResponse {
    url: string;
    state: string;
}

interface AuthStatusResponse {
    status: 'ok' | 'wait' | 'error';
    error?: string;
}

interface ImportFailure {
    file: string;
    error: string;
}

interface ImportResponse {
    imported: number;
    failed: ImportFailure[];
}

interface ConfirmDialogState {
    title: string;
    message: string;
    confirmText?: string;
    danger?: boolean;
    onConfirm: () => void;
}

interface AdminCheckboxProps {
    checked: boolean;
    indeterminate?: boolean;
    disabled?: boolean;
    onChange: (nextChecked: boolean) => void;
    title?: string;
}

function AdminCheckbox({ checked, indeterminate = false, disabled = false, onChange, title }: AdminCheckboxProps) {
    const isActive = checked || indeterminate;

    return (
        <button
            type="button"
            role="checkbox"
            aria-checked={indeterminate ? 'mixed' : checked}
            disabled={disabled}
            title={title}
            onClick={() => {
                if (disabled) return;
                onChange(!checked);
            }}
            onKeyDown={(e) => {
                if (disabled) return;
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onChange(!checked);
                }
            }}
            className={[
                'w-5 h-5 rounded-md border flex items-center justify-center transition-colors',
                'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-surface-dark',
                disabled
                    ? 'cursor-not-allowed opacity-60 border-gray-200 dark:border-border-dark bg-gray-100 dark:bg-background-dark'
                    : isActive
                        ? 'bg-primary border-primary text-white hover:bg-blue-600'
                        : 'bg-white dark:bg-background-dark border-gray-300 dark:border-border-dark text-transparent hover:border-primary',
            ].join(' ')}
        >
            {indeterminate ? <Icon name="remove" size={16} /> : checked ? <Icon name="check" size={16} /> : null}
        </button>
    );
}

function formatDate(dateStr: string, locale: string): string {
    return new Date(dateStr).toLocaleDateString(locale, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

interface ParsedOAuthCallback {
    code: string;
    state: string;
    error: string;
}

function parseOAuthCallbackUrl(input: string): ParsedOAuthCallback | null {
    const trimmed = input.trim();
    if (!trimmed) {
        return null;
    }

    let candidate = trimmed;
    if (!candidate.includes('://')) {
        if (candidate.startsWith('?')) {
            candidate = `http://localhost${candidate}`;
        } else if (
            candidate.includes('/') ||
            candidate.includes('?') ||
            candidate.includes('#') ||
            candidate.includes(':')
        ) {
            candidate = `http://${candidate}`;
        } else if (candidate.includes('=')) {
            candidate = `http://localhost/?${candidate}`;
        } else {
            return null;
        }
    }

    let url: URL;
    try {
        url = new URL(candidate);
    } catch {
        return null;
    }

    const query = url.searchParams;
    const fragmentParams = url.hash ? new URLSearchParams(url.hash.replace(/^#/, '')) : null;
    const readParam = (key: string) => {
        const value = query.get(key) || (fragmentParams ? fragmentParams.get(key) : null);
        return value ? value.trim() : '';
    };

    let code = readParam('code');
    let state = readParam('state');
    const errorDescription = readParam('error_description');
    let error = readParam('error');

    if (!error && errorDescription) {
        error = errorDescription;
    }

    if (!state && code && code.includes('#')) {
        const parts = code.split('#', 2);
        code = parts[0] || '';
        state = parts[1] || '';
    }

    return {
        code,
        state,
        error,
    };
}

const AUTH_TYPES = [
    { key: 'codex', label: 'Codex', endpoint: '/v0/admin/tokens/codex' },
    { key: 'anthropic', label: 'Anthropic', endpoint: '/v0/admin/tokens/anthropic' },
    { key: 'antigravity', label: 'Antigravity', endpoint: '/v0/admin/tokens/antigravity' },
    { key: 'gemini-cli', label: 'Gemini CLI', endpoint: '/v0/admin/tokens/gemini' },
    { key: 'iflow-cookie', label: 'iFlow', endpoint: '/v0/admin/tokens/iflow-cookie' },
    { key: 'qwen', label: 'Qwen', endpoint: '/v0/admin/tokens/qwen' },
];

const OAUTH_CALLBACK_PROVIDERS: Record<string, string> = {
    codex: 'codex',
    anthropic: 'anthropic',
    antigravity: 'antigravity',
    'gemini-cli': 'gemini',
};

export function AdminAuthFiles() {
    const { t, i18n } = useTranslation();
    const { hasPermission } = useAdminPermissions();
    const canListAuthFiles = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/auth-files'));
    const canCreateAuthFiles = hasPermission(buildAdminPermissionKey('POST', '/v0/admin/auth-files'));
    const canUpdateAuthFiles = hasPermission(buildAdminPermissionKey('PUT', '/v0/admin/auth-files/:id'));
    const canDeleteAuthFiles = hasPermission(buildAdminPermissionKey('DELETE', '/v0/admin/auth-files/:id'));
    const canSetAvailable = hasPermission(
        buildAdminPermissionKey('POST', '/v0/admin/auth-files/:id/available')
    );
    const canSetUnavailable = hasPermission(
        buildAdminPermissionKey('POST', '/v0/admin/auth-files/:id/unavailable')
    );
    const canListTypes = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/auth-files/types'));
    const canListGroups = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/auth-groups'));
    const canListProxies = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/proxies'));
    const canCheckAuthStatus = hasPermission(
        buildAdminPermissionKey('POST', '/v0/admin/tokens/get-auth-status')
    );
    const canImportAuthFiles = hasPermission(buildAdminPermissionKey('POST', '/v0/admin/auth-files/import'));

    const [authFiles, setAuthFiles] = useState<AuthFile[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [availableTypes, setAvailableTypes] = useState<string[]>([]);
    const [authGroups, setAuthGroups] = useState<AuthGroup[]>([]);
    const [proxies, setProxies] = useState<ProxyItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [proxiesLoading, setProxiesLoading] = useState(false);
    const [search, setSearch] = useState('');
    const [typeFilter, setTypeFilter] = useState('');
    const [typeMenuOpen, setTypeMenuOpen] = useState(false);
    const [typeBtnWidth, setTypeBtnWidth] = useState<number | undefined>(undefined);
    const [groupFilterId, setGroupFilterId] = useState<number | null>(null);
    const [groupFilterOpen, setGroupFilterOpen] = useState(false);
    const [groupFilterSearch, setGroupFilterSearch] = useState('');
    const [groupFilterBtnWidth, setGroupFilterBtnWidth] = useState<number | undefined>(undefined);
    const [newMenuOpen, setNewMenuOpen] = useState(false);
    const [newMenuWidth, setNewMenuWidth] = useState<number | undefined>(undefined);
    const [importModalOpen, setImportModalOpen] = useState(false);
    const [importFiles, setImportFiles] = useState<File[]>([]);
    const [importDragging, setImportDragging] = useState(false);
    const [importSubmitting, setImportSubmitting] = useState(false);
    const [importError, setImportError] = useState('');
    const [importResult, setImportResult] = useState<ImportResponse | null>(null);
    const [importGroupIds, setImportGroupIds] = useState<number[] | null>(null);
    const [importGroupMenuOpen, setImportGroupMenuOpen] = useState(false);
    const [importGroupSearch, setImportGroupSearch] = useState('');
    const [modalOpen, setModalOpen] = useState(false);
    const [modalUrl, setModalUrl] = useState('');
    const [modalLoading, setModalLoading] = useState(false);
    const [modalTitle, setModalTitle] = useState('');
    const [copied, setCopied] = useState(false);
    const [authTypeKey, setAuthTypeKey] = useState('');
    const [authState, setAuthState] = useState('');
    const [authStatus, setAuthStatus] = useState<'idle' | 'polling' | 'ok' | 'error'>('idle');
    const [authError, setAuthError] = useState('');
    const [pollCount, setPollCount] = useState(0);
    const [callbackUrl, setCallbackUrl] = useState('');
    const [callbackSubmitting, setCallbackSubmitting] = useState(false);
    const [callbackError, setCallbackError] = useState('');
    const [iflowCookie, setIflowCookie] = useState('');
    const [iflowSubmitting, setIflowSubmitting] = useState(false);
    const [iflowError, setIflowError] = useState('');
    const [toast, setToast] = useState<{ show: boolean; message: string }>({ show: false, message: '' });
    const [bindModalOpen, setBindModalOpen] = useState(false);
    const [bindSubmitting, setBindSubmitting] = useState(false);
    const [bindError, setBindError] = useState('');
    const [batchGroupModalOpen, setBatchGroupModalOpen] = useState(false);
    const [batchGroupSubmitting, setBatchGroupSubmitting] = useState(false);
    const [batchGroupError, setBatchGroupError] = useState('');
    const [batchGroupIds, setBatchGroupIds] = useState<number[] | null>(null);
    const [batchGroupMenuOpen, setBatchGroupMenuOpen] = useState(false);
    const [batchGroupSearch, setBatchGroupSearch] = useState('');
    const [selectedProxyIds, setSelectedProxyIds] = useState<Set<number>>(new Set());
    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const authSnapshotRef = useRef<Set<string>>(new Set());
    const authStartAtRef = useRef<Date | null>(null);
    const importInputRef = useRef<HTMLInputElement>(null);
    const { tableScrollRef, handleTableScroll, showActionsDivider } = useStickyActionsDivider(
        authFiles.length,
        loading
    );

    const [editModalOpen, setEditModalOpen] = useState(false);
    const [editingFile, setEditingFile] = useState<AuthFile | null>(null);
    const [editKey, setEditKey] = useState('');
    const [editGroupIds, setEditGroupIds] = useState<number[]>([]);
    const [editIsAvailable, setEditIsAvailable] = useState(true);
    const [editProxyUrl, setEditProxyUrl] = useState('');
    const [editRateLimit, setEditRateLimit] = useState('0');
    const [editPriority, setEditPriority] = useState('0');
    const [editSaving, setEditSaving] = useState(false);
    const [editGroupMenuOpen, setEditGroupMenuOpen] = useState(false);
    const [editGroupBtnWidth, setEditGroupBtnWidth] = useState<number | undefined>(undefined);
    const [editGroupSearch, setEditGroupSearch] = useState('');
    const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
    const [newAuthGroupIds, setNewAuthGroupIds] = useState<number[] | null>(null);
    const [newAuthGroupMenuOpen, setNewAuthGroupMenuOpen] = useState(false);
    const [newAuthGroupSearch, setNewAuthGroupSearch] = useState('');
    const locale = i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US';

    const availableAuthTypes = useMemo(() => {
        return AUTH_TYPES.filter((type) =>
            hasPermission(buildAdminPermissionKey('POST', type.endpoint))
        );
    }, [hasPermission]);

    const canRequestAuth = canCreateAuthFiles && canCheckAuthStatus && availableAuthTypes.length > 0;
    const canOpenNewMenu = canRequestAuth || canImportAuthFiles;
    const canBindProxies = canUpdateAuthFiles && canListProxies;
    const canBatchGroup = canUpdateAuthFiles && canListGroups;
    const visibleIds = authFiles.map((file) => file.id);
    const anyVisibleSelected = visibleIds.some((id) => selectedIds.has(id));
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    const selectedCount = selectedIds.size;
    const proxyIds = proxies.map((proxy) => proxy.id);
    const anyProxySelected = proxyIds.some((id) => selectedProxyIds.has(id));
    const allProxySelected = proxyIds.length > 0 && proxyIds.every((id) => selectedProxyIds.has(id));
    const selectedProxyCount = selectedProxyIds.size;
    const oauthProvider = authTypeKey ? OAUTH_CALLBACK_PROVIDERS[authTypeKey] : '';
    const isIFlowCookie = authTypeKey === 'iflow-cookie';

    useEffect(() => {
        const allOptions = [t('No Group'), ...authGroups.map((g) => g.name)];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
            let maxWidth = 0;
            for (const opt of allOptions) {
                const width = ctx.measureText(opt).width;
                if (width > maxWidth) maxWidth = width;
            }
            setEditGroupBtnWidth(Math.ceil(maxWidth) + 76);
        }
    }, [authGroups, t]);

    useEffect(() => {
        const allOptions = [t('All Groups'), t('No Group'), ...authGroups.map((g) => g.name)];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
            let maxWidth = 0;
            for (const opt of allOptions) {
                const width = ctx.measureText(opt).width;
                if (width > maxWidth) maxWidth = width;
            }
            setGroupFilterBtnWidth(Math.ceil(maxWidth) + 76);
        }
    }, [authGroups, t]);

    useEffect(() => {
        if (!canOpenNewMenu) {
            setNewMenuWidth(undefined);
            return;
        }
        const labels = availableAuthTypes.map((type) => type.label);
        if (canImportAuthFiles) {
            labels.push(t('Import From CLIProxyAPI'));
        }
        if (labels.length === 0) {
            setNewMenuWidth(undefined);
            return;
        }
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
            let maxWidth = 0;
            for (const label of labels) {
                const width = ctx.measureText(label).width;
                if (width > maxWidth) maxWidth = width;
            }
            setNewMenuWidth(Math.ceil(maxWidth) + 64);
        }
    }, [availableAuthTypes, canImportAuthFiles, canOpenNewMenu, t]);

    const fetchAuthGroups = useCallback(async () => {
        if (!canListGroups) {
            return;
        }
        try {
            const res = await apiFetchAdmin<AuthGroupsResponse>('/v0/admin/auth-groups');
            setAuthGroups(res.auth_groups);
        } catch (err) {
            console.error('Failed to fetch auth groups:', err);
        }
    }, [canListGroups]);

    const fetchTypes = useCallback(async () => {
        if (!canListTypes) {
            return;
        }
        try {
            const res = await apiFetchAdmin<TypesResponse>('/v0/admin/auth-files/types');
            setAvailableTypes(res.types);
        } catch (err) {
            console.error('Failed to fetch types:', err);
        }
    }, [canListTypes]);

    const fetchProxies = useCallback(async () => {
        if (!canListProxies) {
            setProxies([]);
            setProxiesLoading(false);
            return;
        }
        setProxiesLoading(true);
        try {
            const res = await apiFetchAdmin<ProxiesResponse>('/v0/admin/proxies');
            setProxies(res.proxies || []);
        } catch (err) {
            console.error('Failed to fetch proxies:', err);
        } finally {
            setProxiesLoading(false);
        }
    }, [canListProxies]);

    const fetchData = useCallback(async () => {
        if (!canListAuthFiles) {
            return;
        }
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (search) params.set('key', search);
            if (typeFilter) params.set('type', typeFilter);
            if (groupFilterId !== null) params.set('auth_group_id', groupFilterId.toString());
            const queryString = params.toString();
            const url = queryString ? `/v0/admin/auth-files?${queryString}` : '/v0/admin/auth-files';
            const res = await apiFetchAdmin<ListResponse>(url);
            setAuthFiles(res.auth_files);
        } catch (err) {
            console.error('Failed to fetch auth files:', err);
        } finally {
            setLoading(false);
        }
    }, [search, typeFilter, groupFilterId, canListAuthFiles]);

    useEffect(() => {
        fetchTypes();
        fetchAuthGroups();
    }, [fetchTypes, fetchAuthGroups]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    useEffect(() => {
        setSelectedIds((prev) => {
            if (prev.size === 0) return prev;
            const existingIds = new Set(authFiles.map((file) => file.id));
            const next = new Set<number>();
            prev.forEach((id) => {
                if (existingIds.has(id)) next.add(id);
            });
            return next;
        });
    }, [authFiles]);

    useEffect(() => {
        if (!bindModalOpen) {
            return;
        }
        fetchProxies();
    }, [bindModalOpen, fetchProxies]);

    useEffect(() => {
        setSelectedProxyIds((prev) => {
            const existingIds = new Set(proxies.map((proxy) => proxy.id));
            if (existingIds.size === 0) {
                return new Set();
            }
            if (prev.size === 0) {
                return new Set(existingIds);
            }
            const next = new Set<number>();
            prev.forEach((id) => {
                if (existingIds.has(id)) next.add(id);
            });
            return next;
        });
    }, [proxies]);

    const formatFileSize = (size: number) => {
        if (size < 1024) {
            return `${size} B`;
        }
        const kb = size / 1024;
        if (kb < 1024) {
            return `${kb.toFixed(1)} KB`;
        }
        const mb = kb / 1024;
        return `${mb.toFixed(1)} MB`;
    };

    const isJsonFile = (file: File) => {
        const lower = file.name.toLowerCase();
        return lower.endsWith('.json') || file.type === 'application/json';
    };

    const addImportFiles = (incoming: FileList | File[]) => {
        const list = Array.from(incoming);
        if (list.length === 0) {
            return;
        }
        const valid = list.filter((file) => isJsonFile(file));
        const invalid = list.filter((file) => !isJsonFile(file));
        if (invalid.length > 0) {
            setImportError(t('Only JSON files are supported.'));
        } else {
            setImportError('');
        }
        if (valid.length === 0) {
            return;
        }
        setImportResult(null);
        setImportFiles((prev) => {
            const existing = new Set(prev.map((file) => `${file.name}:${file.size}`));
            const next = [...prev];
            valid.forEach((file) => {
                const key = `${file.name}:${file.size}`;
                if (!existing.has(key)) {
                    existing.add(key);
                    next.push(file);
                }
            });
            return next;
        });
    };

    const getContentType = (file: AuthFile): string => {
        return (file.content?.type as string) || '';
    };

    const resolveDefaultAuthGroupIds = useCallback(() => {
        if (authGroups.length === 0) {
            return [];
        }
        const defaultGroup = authGroups.find((group) => group.is_default);
        const chosen = defaultGroup ? defaultGroup.id : authGroups[0].id;
        return chosen ? [chosen] : [];
    }, [authGroups]);
    const normalizeGroupIds = useCallback((ids: number[]) => {
        const unique = Array.from(new Set(ids.filter((id) => id > 0)));
        unique.sort((a, b) => a - b);
        return unique;
    }, []);
    const toggleGroupId = useCallback(
        (current: number[], value: number) => {
            const normalized = normalizeGroupIds(current);
            if (normalized.includes(value)) {
                return normalized.filter((id) => id !== value);
            }
            return normalizeGroupIds([...normalized, value]);
        },
        [normalizeGroupIds]
    );
    const areGroupIdsEqual = useCallback(
        (left: number[], right: number[]) => {
            const leftNormalized = normalizeGroupIds(left);
            const rightNormalized = normalizeGroupIds(right);
            if (leftNormalized.length !== rightNormalized.length) {
                return false;
            }
            return leftNormalized.every((value, index) => value === rightNormalized[index]);
        },
        [normalizeGroupIds]
    );
    const formatGroupNames = useCallback(
        (ids: number[], groups?: { id: number; name: string }[]) => {
            const normalizedIds = normalizeGroupIds(ids);
            if (groups && groups.length > 0) {
                const groupMap = new Map(groups.map((group) => [group.id, group.name]));
                return normalizedIds
                    .map((id) => groupMap.get(id) || `#${id}`)
                    .filter((name) => name.trim() !== '');
            }
            return normalizedIds
                .map((id) => authGroups.find((group) => group.id === id)?.name || `#${id}`)
                .filter((name) => name.trim() !== '');
        },
        [authGroups, normalizeGroupIds]
    );
    const formatGroupLabel = useCallback(
        (ids: number[], groups?: { id: number; name: string }[]) => {
            const names = formatGroupNames(ids, groups);
            return names.length > 0 ? names.join(', ') : t('No Group');
        },
        [formatGroupNames, t]
    );
    const newAuthGroupLabel =
        newAuthGroupIds === null ? t('Select Auth Group') : formatGroupLabel(newAuthGroupIds);
    const importGroupLabel =
        importGroupIds === null ? t('Select Auth Group') : formatGroupLabel(importGroupIds);
    const editGroupLabel = formatGroupLabel(editGroupIds, editingFile?.auth_group);
    const batchGroupLabel =
        batchGroupIds === null ? t('Select Auth Group') : formatGroupLabel(batchGroupIds);

    const getAuthTypeQueryValue = useCallback((typeKey: string) => {
        if (typeKey === 'gemini-cli') {
            return 'gemini';
        }
        if (typeKey === 'iflow-cookie') {
            return 'iflow';
        }
        return typeKey;
    }, []);

    const applyAuthGroupToNewAuthFiles = useCallback(async () => {
        if (!canUpdateAuthFiles || newAuthGroupIds === null) {
            return;
        }
        const selectedGroupIds = normalizeGroupIds(newAuthGroupIds);
        const snapshot = authSnapshotRef.current;
        const startedAt = authStartAtRef.current;
        const typeValue = authTypeKey ? getAuthTypeQueryValue(authTypeKey) : '';
        const typeQuery = typeValue ? `?type=${encodeURIComponent(typeValue)}` : '';
        try {
            const res = await apiFetchAdmin<ListResponse>(`/v0/admin/auth-files${typeQuery}`);
            let candidates = res.auth_files.filter((file) => !snapshot.has(file.key));
            if (startedAt) {
                candidates = candidates.filter((file) => {
                    const createdAt = new Date(file.created_at);
                    const updatedAt = new Date(file.updated_at);
                    return createdAt >= startedAt || updatedAt >= startedAt;
                });
            }
            if (candidates.length === 0) {
                return;
            }
            const updates = candidates.filter((file) =>
                !areGroupIdsEqual(file.auth_group_id || [], selectedGroupIds)
            );
            if (updates.length === 0) {
                return;
            }
            await Promise.allSettled(
                updates.map((file) =>
                    apiFetchAdmin(`/v0/admin/auth-files/${file.id}`, {
                        method: 'PUT',
                        body: JSON.stringify({ auth_group_id: selectedGroupIds }),
                    })
                )
            );
        } catch (err) {
            console.error('Failed to update auth group for new auth files:', err);
        }
    }, [
        authTypeKey,
        areGroupIdsEqual,
        canUpdateAuthFiles,
        getAuthTypeQueryValue,
        newAuthGroupIds,
        normalizeGroupIds,
    ]);

    useEffect(() => {
        const allOptions = [t('All Types'), ...availableTypes];
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
    }, [availableTypes, t]);

    const handleEdit = (file: AuthFile) => {
        if (!canUpdateAuthFiles) {
            return;
        }
        setEditingFile(file);
        setEditKey(file.key);
        setEditGroupIds(normalizeGroupIds(file.auth_group_id || []));
        setEditIsAvailable(file.is_available);
        setEditProxyUrl(file.proxy_url || '');
        setEditRateLimit(String(file.rate_limit ?? 0));
        setEditPriority(String(file.priority ?? 0));
        setEditModalOpen(true);
    };

    const handleEditSave = async () => {
        if (!editingFile || !canUpdateAuthFiles) return;
        setEditSaving(true);
        try {
            const proxyUrl = editProxyUrl.trim();
            const normalizedEditGroupIds = normalizeGroupIds(editGroupIds);
            const parsedRateLimit = Number.parseInt(editRateLimit, 10);
            const rateLimit = Number.isNaN(parsedRateLimit) ? 0 : Math.max(0, parsedRateLimit);
            const parsedPriority = Number.parseInt(editPriority, 10);
            const priority = Number.isNaN(parsedPriority) ? 0 : parsedPriority;
            const payload: Record<string, unknown> = {
                key: editKey,
                is_available: editIsAvailable,
                proxy_url: proxyUrl,
                rate_limit: rateLimit,
                priority,
            };
            if (canListGroups) {
                payload.auth_group_id = normalizedEditGroupIds;
            }
            await apiFetchAdmin(`/v0/admin/auth-files/${editingFile.id}`, {
                method: 'PUT',
                body: JSON.stringify(payload),
            });
            setEditModalOpen(false);
            const selectedGroups = authGroups.filter((group) => normalizedEditGroupIds.includes(group.id));
            setAuthFiles((prev) =>
                prev.map((item) =>
                    item.id === editingFile.id
                        ? {
                            ...item,
                            key: editKey,
                            auth_group_id: normalizedEditGroupIds,
                            auth_group: selectedGroups,
                            proxy_url: proxyUrl,
                            is_available: editIsAvailable,
                            rate_limit: rateLimit,
                            priority,
                            updated_at: new Date().toISOString(),
                        }
                        : item
                )
            );
            setEditingFile(null);
            setEditProxyUrl('');
            setEditRateLimit('0');
            setEditPriority('0');
            showToast(t('Auth file updated successfully'));
        } catch (err) {
            console.error('Failed to update auth file:', err);
        } finally {
            setEditSaving(false);
        }
    };

    const handleEditClose = () => {
        setEditModalOpen(false);
        setEditingFile(null);
        setEditProxyUrl('');
        setEditRateLimit('0');
        setEditPriority('0');
        setEditGroupIds([]);
        setEditGroupSearch('');
    };

    const handleOpenBindModal = () => {
        if (!canBindProxies) {
            return;
        }
        setBindError('');
        setBindModalOpen(true);
    };

    const handleCloseBindModal = () => {
        if (bindSubmitting) {
            return;
        }
        setBindModalOpen(false);
        setBindError('');
    };

    const handleBindProxies = async () => {
        if (!canBindProxies) {
            return;
        }
        const selectedFiles = authFiles.filter((file) => selectedIds.has(file.id));
        if (selectedFiles.length === 0) {
            setBindError(t('Please select at least one auth file.'));
            return;
        }
        const proxyPool = proxies.filter((proxy) => selectedProxyIds.has(proxy.id));
        if (proxyPool.length === 0) {
            setBindError(t('Please select at least one proxy server.'));
            return;
        }
        setBindSubmitting(true);
        setBindError('');
        try {
            const results = await Promise.allSettled(
                selectedFiles.map((file, index) => {
                    const proxy = proxyPool[index % proxyPool.length];
                    const payload: Record<string, unknown> = { proxy_url: proxy.proxy_url };
                    return apiFetchAdmin(`/v0/admin/auth-files/${file.id}`, {
                        method: 'PUT',
                        body: JSON.stringify(payload),
                    });
                })
            );
            const failed = results.filter((result) => result.status === 'rejected');
            if (failed.length > 0) {
                console.error('Failed to bind proxies:', failed);
                setBindError(t('Failed to bind some proxy servers. Please try again.'));
            } else {
                setBindModalOpen(false);
                setSelectedIds(new Set());
                showToast(t('Proxy servers bound successfully'));
            }
            fetchData();
        } catch (err) {
            console.error('Failed to bind proxies:', err);
            setBindError(t('Failed to bind some proxy servers. Please try again.'));
        } finally {
            setBindSubmitting(false);
        }
    };

    const handleOpenBatchGroupModal = () => {
        if (!canUpdateAuthFiles || !canListGroups) {
            return;
        }
        setBatchGroupError('');
        setBatchGroupIds(null);
        setBatchGroupMenuOpen(false);
        setBatchGroupSearch('');
        setBatchGroupModalOpen(true);
    };

    const handleCloseBatchGroupModal = () => {
        if (batchGroupSubmitting) {
            return;
        }
        setBatchGroupModalOpen(false);
        setBatchGroupError('');
        setBatchGroupIds(null);
        setBatchGroupMenuOpen(false);
        setBatchGroupSearch('');
    };

    const handleBatchGroupApply = async () => {
        if (!canUpdateAuthFiles || !canListGroups) {
            return;
        }
        const selectedFiles = authFiles.filter((file) => selectedIds.has(file.id));
        if (selectedFiles.length === 0) {
            setBatchGroupError(t('Please select at least one auth file.'));
            return;
        }
        if (batchGroupIds === null) {
            setBatchGroupError(t('Please select at least one auth group.'));
            return;
        }
        const normalizedBatchGroupIds = normalizeGroupIds(batchGroupIds);
        setBatchGroupSubmitting(true);
        setBatchGroupError('');
        try {
            const results = await Promise.allSettled(
                selectedFiles.map((file) =>
                    apiFetchAdmin(`/v0/admin/auth-files/${file.id}`, {
                        method: 'PUT',
                        body: JSON.stringify({ auth_group_id: normalizedBatchGroupIds }),
                    })
                )
            );
            const failed = results.filter((result) => result.status === 'rejected');
            if (failed.length > 0) {
                console.error('Failed to set auth groups:', failed);
                setBatchGroupError(t('Failed to set auth groups. Please try again.'));
            } else {
                setBatchGroupModalOpen(false);
                setSelectedIds(new Set());
                showToast(t('Auth groups updated successfully'));
            }
            fetchData();
        } catch (err) {
            console.error('Failed to set auth groups:', err);
            setBatchGroupError(t('Failed to set auth groups. Please try again.'));
        } finally {
            setBatchGroupSubmitting(false);
        }
    };

    const handleSetAvailable = async (id: number) => {
        if (!canSetAvailable) {
            return;
        }
        try {
            await apiFetchAdmin(`/v0/admin/auth-files/${id}/available`, { method: 'POST' });
            setAuthFiles((prev) =>
                prev.map((item) =>
                    item.id === id
                        ? { ...item, is_available: true }
                        : item
                )
            );
        } catch (err) {
            console.error('Failed to set available:', err);
        }
    };

    const handleSetUnavailable = async (id: number) => {
        if (!canSetUnavailable) {
            return;
        }
        try {
            await apiFetchAdmin(`/v0/admin/auth-files/${id}/unavailable`, { method: 'POST' });
            setAuthFiles((prev) =>
                prev.map((item) =>
                    item.id === id
                        ? { ...item, is_available: false }
                        : item
                )
            );
        } catch (err) {
            console.error('Failed to set unavailable:', err);
        }
    };

    const handleDelete = async (id: number) => {
        if (!canDeleteAuthFiles) {
            return;
        }
        setConfirmDialog({
            title: t('Delete Auth File'),
            message: t('Are you sure you want to delete this auth file? This action cannot be undone.'),
            confirmText: t('Delete'),
            danger: true,
            onConfirm: async () => {
                try {
                    await apiFetchAdmin(`/v0/admin/auth-files/${id}`, { method: 'DELETE' });
                    fetchData();
                } catch (err) {
                    console.error('Failed to delete auth file:', err);
                } finally {
                    setConfirmDialog(null);
                }
            },
        });
    };

    const stopPolling = useCallback(() => {
        if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
        }
    }, []);

    const showToast = useCallback((message: string) => {
        if (toastTimeoutRef.current) {
            clearTimeout(toastTimeoutRef.current);
        }
        setToast({ show: true, message });
        toastTimeoutRef.current = setTimeout(() => {
            setToast({ show: false, message: '' });
        }, 10000);
    }, []);

    const startPolling = useCallback((state: string) => {
        if (!canCheckAuthStatus) {
            setAuthStatus('error');
            setAuthError(t('Permission denied'));
            return;
        }
        stopPolling();
        setAuthStatus('polling');
        setPollCount(0);
        setAuthError('');

        const poll = async () => {
            try {
                const res = await apiFetchAdmin<AuthStatusResponse>(
                    `/v0/admin/tokens/get-auth-status?state=${encodeURIComponent(state)}`,
                    { method: 'POST' }
                );
                setPollCount((prev) => prev + 1);

                if (res.status === 'ok') {
                    setAuthStatus('ok');
                    stopPolling();
                    setModalOpen(false);
                    showToast(t('Authentication successful'));
                    await applyAuthGroupToNewAuthFiles();
                    fetchData();
                } else if (res.status === 'error') {
                    setAuthStatus('error');
                    setAuthError(res.error || t('Authentication failed'));
                    stopPolling();
                }
            } catch (err) {
                console.error('Failed to poll auth status:', err);
            }
        };

        poll();
        pollingRef.current = setInterval(poll, 2000);
    }, [stopPolling, fetchData, showToast, canCheckAuthStatus, t, applyAuthGroupToNewAuthFiles]);

    useEffect(() => {
        return () => {
            stopPolling();
        };
    }, [stopPolling]);

    useEffect(() => {
        if (!modalOpen || newAuthGroupIds !== null || !canListGroups) {
            return;
        }
        const defaultIds = resolveDefaultAuthGroupIds();
        if (defaultIds.length === 0) {
            return;
        }
        setNewAuthGroupIds(defaultIds);
    }, [canListGroups, modalOpen, newAuthGroupIds, resolveDefaultAuthGroupIds]);

    useEffect(() => {
        if (!importModalOpen || importGroupIds !== null || !canListGroups) {
            return;
        }
        const defaultIds = resolveDefaultAuthGroupIds();
        if (defaultIds.length === 0) {
            return;
        }
        setImportGroupIds(defaultIds);
    }, [canListGroups, importGroupIds, importModalOpen, resolveDefaultAuthGroupIds]);

    useEffect(() => {
        if (modalOpen) {
            return;
        }
        setAuthTypeKey('');
        setCallbackUrl('');
        setCallbackSubmitting(false);
        setCallbackError('');
        setIflowCookie('');
        setIflowSubmitting(false);
        setIflowError('');
        setNewAuthGroupMenuOpen(false);
        setNewAuthGroupSearch('');
        setNewAuthGroupIds(null);
    }, [modalOpen]);

    const handleOpenImportModal = () => {
        if (!canImportAuthFiles) {
            return;
        }
        setNewMenuOpen(false);
        setImportModalOpen(true);
        setImportFiles([]);
        setImportError('');
        setImportResult(null);
        setImportDragging(false);
        setImportGroupMenuOpen(false);
        setImportGroupSearch('');
        if (canListGroups && importGroupIds === null && authGroups.length > 0) {
            const defaultIds = resolveDefaultAuthGroupIds();
            setImportGroupIds(defaultIds.length > 0 ? defaultIds : null);
        }
    };

    const handleCloseImportModal = () => {
        if (importSubmitting) {
            return;
        }
        setImportModalOpen(false);
        setImportFiles([]);
        setImportError('');
        setImportResult(null);
        setImportDragging(false);
        setImportGroupIds(null);
        setImportGroupMenuOpen(false);
        setImportGroupSearch('');
    };

    const handleRemoveImportFile = (name: string, size: number) => {
        setImportFiles((prev) => prev.filter((file) => !(file.name === name && file.size === size)));
    };

    const handleImportUpload = async () => {
        if (!canImportAuthFiles || importSubmitting) {
            return;
        }
        if (importFiles.length === 0) {
            setImportError(t('Please select at least one JSON file.'));
            return;
        }

        setImportSubmitting(true);
        setImportError('');
        setImportResult(null);
        try {
            const formData = new FormData();
            importFiles.forEach((file) => {
                formData.append('files', file);
            });
            if (importGroupIds !== null) {
                const normalizedImportGroupIds = normalizeGroupIds(importGroupIds);
                formData.append('auth_group_id', JSON.stringify(normalizedImportGroupIds));
            }
            const res = await apiFetchAdmin<ImportResponse>('/v0/admin/auth-files/import', {
                method: 'POST',
                body: formData,
            });
            setImportResult(res);
            if (res.failed && res.failed.length > 0) {
                setImportError(t('Some files failed to import.'));
            } else {
                showToast(t('Imported {{count}} auth files', { count: res.imported }));
                setImportModalOpen(false);
                setImportFiles([]);
            }
            fetchData();
            fetchTypes();
        } catch (err) {
            console.error('Failed to import auth files:', err);
            setImportError(err instanceof Error ? err.message : t('Failed to import auth files.'));
        } finally {
            setImportSubmitting(false);
        }
    };

    const handleNewAuthType = async (typeKey: string) => {
        setNewMenuOpen(false);
        const authType = availableAuthTypes.find((t) => t.key === typeKey);
        if (!authType) {
            console.log('Unknown auth type:', typeKey);
            return;
        }

        authSnapshotRef.current = new Set(authFiles.map((file) => file.key));
        authStartAtRef.current = new Date();

        setModalLoading(true);
        setModalOpen(true);
        setModalUrl('');
        setAuthTypeKey(typeKey);
        if (typeKey === 'iflow-cookie') {
            setModalTitle(t('iFlow Cookie'));
        } else {
            setModalTitle(
                t('Authentication URL for {{label}}', {
                    label: authType.label,
                })
            );
        }
        setCopied(false);
        setAuthState('');
        setAuthStatus('idle');
        setAuthError('');
        setPollCount(0);
        setCallbackUrl('');
        setCallbackSubmitting(false);
        setCallbackError('');
        setIflowCookie('');
        setIflowSubmitting(false);
        setIflowError('');
        setNewAuthGroupSearch('');
        setNewAuthGroupMenuOpen(false);
        if (canListGroups) {
            const defaultIds = resolveDefaultAuthGroupIds();
            setNewAuthGroupIds(defaultIds.length > 0 ? defaultIds : null);
        } else {
            setNewAuthGroupIds(null);
        }
        if (typeKey === 'iflow-cookie') {
            setModalLoading(false);
            return;
        }
        try {
            const res = await apiFetchAdmin<TokenUrlResponse>(authType.endpoint, { method: 'POST' });
            setModalUrl(res.url);
            setAuthState(res.state);
        } catch (err) {
            console.error(`Failed to fetch ${authType.label} token url:`, err);
            setModalUrl('');
        } finally {
            setModalLoading(false);
        }
    };

    const handleCopyUrl = () => {
        navigator.clipboard.writeText(modalUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        if (authState && authStatus === 'idle') {
            startPolling(authState);
        }
    };

    const handleOpenUrl = () => {
        window.open(modalUrl, '_blank');
        if (authState && authStatus === 'idle') {
            startPolling(authState);
        }
    };

    const handleSubmitCallback = useCallback(
        async (event?: FormEvent) => {
            if (event) {
                event.preventDefault();
            }
            if (callbackSubmitting) {
                return;
            }
            if (!oauthProvider) {
                return;
            }
            const trimmed = callbackUrl.trim();
            if (!trimmed) {
                setCallbackError(t('Callback URL is required.'));
                return;
            }
            const parsed = parseOAuthCallbackUrl(trimmed);
            if (!parsed) {
                setCallbackError(t('Invalid callback URL.'));
                return;
            }
            const state = parsed.state || authState;
            if (!state) {
                setCallbackError(t('Callback URL must include a state.'));
                return;
            }
            if (!parsed.code && !parsed.error) {
                setCallbackError(t('Callback URL must include a code or error.'));
                return;
            }

            setCallbackSubmitting(true);
            setCallbackError('');
            try {
                await apiFetchAdmin('/v0/admin/tokens/oauth-callback', {
                    method: 'POST',
                    body: JSON.stringify({
                        provider: oauthProvider,
                        redirect_url: trimmed,
                        code: parsed.code,
                        state,
                        error: parsed.error,
                    }),
                });
                setCallbackUrl('');
                if (authStatus === 'idle') {
                    startPolling(state);
                }
            } catch (err) {
                console.error('Failed to submit oauth callback:', err);
                setCallbackError(err instanceof Error ? err.message : t('Failed to submit callback URL.'));
            } finally {
                setCallbackSubmitting(false);
            }
        },
        [oauthProvider, callbackUrl, authState, authStatus, callbackSubmitting, startPolling, t]
    );

    const handleSubmitIFlowCookie = useCallback(
        async (event?: FormEvent) => {
            if (event) {
                event.preventDefault();
            }
            if (iflowSubmitting) {
                return;
            }
            const trimmed = iflowCookie.trim();
            if (!trimmed) {
                setIflowError(t('iFlow cookie is required.'));
                return;
            }

            let cookieValue = trimmed;
            if (!cookieValue.includes('BXAuth=')) {
                if (cookieValue.startsWith('eyJra')) {
                    cookieValue = `BXAuth=${cookieValue}`;
                } else {
                    setIflowError(t('Cookie must include BXAuth.'));
                    return;
                }
            }

            setIflowSubmitting(true);
            setIflowError('');
            setAuthStatus('polling');
            setAuthError('');
            try {
                await apiFetchAdmin('/v0/admin/tokens/iflow-cookie', {
                    method: 'POST',
                    body: JSON.stringify({ cookie: cookieValue }),
                });
                setAuthStatus('ok');
                showToast(t('Authentication successful'));
                await applyAuthGroupToNewAuthFiles();
                fetchData();
                setModalOpen(false);
            } catch (err) {
                console.error('Failed to submit iFlow cookie:', err);
                setAuthStatus('error');
                setAuthError(err instanceof Error ? err.message : t('Authentication failed'));
            } finally {
                setIflowSubmitting(false);
            }
        },
        [
            iflowSubmitting,
            iflowCookie,
            showToast,
            applyAuthGroupToNewAuthFiles,
            fetchData,
            t,
        ]
    );

    const handleCloseModal = () => {
        stopPolling();
        setModalOpen(false);
        if (authStatus === 'ok') {
            fetchData();
        }
        setAuthTypeKey('');
        setCallbackUrl('');
        setCallbackSubmitting(false);
        setCallbackError('');
        setIflowCookie('');
        setIflowSubmitting(false);
        setIflowError('');
        setNewAuthGroupMenuOpen(false);
        setNewAuthGroupSearch('');
    };

    if (!canListAuthFiles) {
        return (
            <AdminDashboardLayout
                title={t('Authentication Files')}
                subtitle={t('Manage authentication groups and their configurations.')}
            >
                <AdminNoAccessCard />
            </AdminDashboardLayout>
        );
    }

    return (
        <AdminDashboardLayout
            title={t('Authentication Files')}
            subtitle={t('Manage authentication groups and their configurations.')}
        >
            <div className="space-y-6">
                {(canOpenNewMenu || canBindProxies || canBatchGroup) && (
                    <div className="flex justify-end gap-2">
                        {canBatchGroup && (
                            <button
                                onClick={handleOpenBatchGroupModal}
                                disabled={selectedCount === 0}
                                title={
                                    selectedCount === 0
                                        ? t('Please select at least one auth file.')
                                        : t('Batch Set Auth Groups')
                                }
                                className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-background-dark text-slate-900 dark:text-white rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-medium border border-gray-200 dark:border-border-dark disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Icon name="group" size={18} />
                                {t('Batch Set Auth Groups')}
                            </button>
                        )}
                        {canBindProxies && (
                            <button
                                onClick={handleOpenBindModal}
                                disabled={selectedCount === 0}
                                title={selectedCount === 0 ? t('Please select at least one auth file.') : t('Bind Proxy Servers')}
                                className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-background-dark text-slate-900 dark:text-white rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-medium border border-gray-200 dark:border-border-dark disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Icon name="link" size={18} />
                                {t('Bind Proxy Servers')}
                            </button>
                        )}
                        {canOpenNewMenu && (
                            <div className="relative">
                                <button
                                    onClick={() => setNewMenuOpen(!newMenuOpen)}
                                    onBlur={() => setTimeout(() => setNewMenuOpen(false), 150)}
                                    className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors font-medium"
                                >
                                    <Icon name="add" size={18} />
                                    {t('New')}
                                    <Icon name="expand_more" size={18} />
                                </button>
                                {newMenuOpen && (
                                    <div
                                        className="absolute right-0 mt-2 bg-white dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg shadow-lg z-50"
                                        style={newMenuWidth ? { width: newMenuWidth } : undefined}
                                    >
                                        {availableAuthTypes.map((type) => (
                                            <button
                                                key={type.key}
                                                onClick={() => handleNewAuthType(type.key)}
                                                className="w-full text-left px-4 py-2.5 text-sm whitespace-nowrap text-slate-900 dark:text-white hover:bg-gray-100 dark:hover:bg-background-dark first:rounded-t-lg last:rounded-b-lg transition-colors"
                                            >
                                                {type.label}
                                            </button>
                                        ))}
                                        {canImportAuthFiles && (
                                            <>
                                                {availableAuthTypes.length > 0 && (
                                                    <div className="border-t border-gray-200 dark:border-border-dark" />
                                                )}
                                                <button
                                                    onClick={handleOpenImportModal}
                                                    className="w-full text-left px-4 py-2.5 text-sm whitespace-nowrap text-slate-900 dark:text-white hover:bg-gray-100 dark:hover:bg-background-dark first:rounded-t-lg last:rounded-b-lg transition-colors"
                                                >
                                                    {t('Import From CLIProxyAPI')}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

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
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>
                        {canListGroups && (
                            <div className="relative">
                                <button
                                    type="button"
                                    id="group-filter-dropdown-btn"
                                    onClick={() => setGroupFilterOpen(!groupFilterOpen)}
                                    className="flex items-center justify-between gap-2 bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark text-slate-900 dark:text-white text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5 whitespace-nowrap"
                                    style={groupFilterBtnWidth ? { width: groupFilterBtnWidth } : undefined}
                                >
                                    <span>
                                        {groupFilterId === null
                                            ? t('All Groups')
                                            : groupFilterId === 0
                                                ? t('No Group')
                                                : authGroups.find((g) => g.id === groupFilterId)?.name || t('No Group')}
                                    </span>
                                    <Icon name={groupFilterOpen ? 'expand_less' : 'expand_more'} size={18} />
                                </button>
                                {groupFilterOpen && (
                                    <GroupDropdownMenu
                                        anchorId="group-filter-dropdown-btn"
                                        groups={authGroups}
                                        selectedId={groupFilterId === null ? null : groupFilterId}
                                        search={groupFilterSearch}
                                        menuWidth={groupFilterBtnWidth}
                                        onSearchChange={setGroupFilterSearch}
                                        onSelect={(value) => {
                                            if (value === null) {
                                                setGroupFilterId(null);
                                            } else {
                                                setGroupFilterId(value);
                                            }
                                            setGroupFilterOpen(false);
                                        }}
                                        onClose={() => setGroupFilterOpen(false)}
                                    />
                                )}
                            </div>
                        )}
                        {canListTypes && (
                            <div className="relative">
                                <button
                                    type="button"
                                    id="type-dropdown-btn"
                                    onClick={() => setTypeMenuOpen(!typeMenuOpen)}
                                    className="flex items-center justify-between gap-2 bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark text-slate-900 dark:text-white text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5 whitespace-nowrap"
                                    style={typeBtnWidth ? { width: typeBtnWidth } : undefined}
                                >
                                    <span>
                                        {typeFilter || t('All Types')}
                                    </span>
                                    <Icon name={typeMenuOpen ? 'expand_less' : 'expand_more'} size={18} />
                                </button>
                                {typeMenuOpen && (
                                    <TypeDropdownMenu
                                        types={availableTypes}
                                        typeFilter={typeFilter}
                                        menuWidth={typeBtnWidth}
                                        onSelect={(value) => {
                                            setTypeFilter(value);
                                            setTypeMenuOpen(false);
                                        }}
                                        onClose={() => setTypeMenuOpen(false)}
                                    />
                                )}
                            </div>
                        )}
                    </div>
                    <button
                        onClick={fetchData}
                        className="h-10 w-10 inline-flex items-center justify-center text-gray-500 dark:text-text-secondary hover:bg-gray-100 dark:hover:bg-background-dark rounded-lg border border-gray-200 dark:border-border-dark transition-colors"
                        title={t('Refresh Data')}
                    >
                        <Icon name="refresh" />
                    </button>
                </div>

                <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-sm overflow-hidden">
                    <div ref={tableScrollRef} className="relative overflow-x-auto" onScroll={handleTableScroll}>
                        <table className="min-w-full whitespace-nowrap text-sm text-left text-gray-500 dark:text-gray-400">
                            <thead className="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-surface-dark dark:text-gray-400 border-b border-gray-200 dark:border-border-dark">
                                <tr>
                                    <th className="px-6 py-4">
                                        <AdminCheckbox
                                            checked={allVisibleSelected}
                                            indeterminate={anyVisibleSelected && !allVisibleSelected}
                                            disabled={loading || !canUpdateAuthFiles || authFiles.length === 0}
                                            onChange={(nextChecked) => {
                                                setSelectedIds((prev) => {
                                                    const next = new Set(prev);
                                                    if (nextChecked) {
                                                        visibleIds.forEach((id) => next.add(id));
                                                    } else {
                                                        visibleIds.forEach((id) => next.delete(id));
                                                    }
                                                    return next;
                                                });
                                            }}
                                            title={t('Select all')}
                                        />
                                    </th>
                                    <th className="px-6 py-4 font-semibold tracking-wider">{t('Key')}</th>
                                    <th className="px-6 py-4 font-semibold tracking-wider">{t('Type')}</th>
                                    <th className="px-6 py-4 font-semibold tracking-wider">{t('Auth Group')}</th>
                                    <th className="px-6 py-4 font-semibold tracking-wider">{t('Priority')}</th>
                                    <th className="px-6 py-4 font-semibold tracking-wider">{t('Rate limit')}</th>
                                    <th className="px-6 py-4 font-semibold tracking-wider">{t('Status')}</th>
                                    <th className="px-6 py-4 font-semibold tracking-wider">{t('Created At')}</th>
                                    <th className="px-6 py-4 font-semibold tracking-wider">{t('Updated At')}</th>
                                    <th
                                        className={`px-6 py-4 font-semibold tracking-wider text-center sticky right-0 z-20 bg-gray-50 dark:bg-surface-dark relative after:content-[''] after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-gray-200 dark:after:bg-border-dark after:pointer-events-none ${
                                            showActionsDivider ? 'after:opacity-100' : 'after:opacity-0'
                                        }`}
                                    >
                                        {t('Actions')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-border-dark">
                                {loading ? (
                                    <tr>
                                        <td colSpan={10} className="px-6 py-12 text-center">
                                            {t('Loading...')}
                                        </td>
                                    </tr>
                                ) : authFiles.length === 0 ? (
                                    <tr>
                                        <td colSpan={10} className="px-6 py-12 text-center">
                                            {t('No auth files found')}
                                        </td>
                                    </tr>
                                ) : (
                                    authFiles.map((file) => (
                                        <tr
                                            key={file.id}
                                            className="hover:bg-gray-50 dark:hover:bg-background-dark group"
                                        >
                                            <td className="px-6 py-4">
                                                <AdminCheckbox
                                                    checked={selectedIds.has(file.id)}
                                                    disabled={!canUpdateAuthFiles}
                                                    onChange={(nextChecked) => {
                                                        setSelectedIds((prev) => {
                                                            const next = new Set(prev);
                                                            if (nextChecked) {
                                                                next.add(file.id);
                                                            } else {
                                                                next.delete(file.id);
                                                            }
                                                            return next;
                                                        });
                                                    }}
                                                    title={t('Select row')}
                                                />
                                            </td>
                                            <td className="px-6 py-4 text-slate-900 dark:text-white font-medium">
                                                {file.key}
                                            </td>
                                            <td className="px-6 py-4">
                                                {getContentType(file) ? (
                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border border-blue-100 dark:border-blue-800">
                                                        {getContentType(file)}
                                                    </span>
                                                ) : (
                                                    <span className="text-gray-400 dark:text-gray-500">—</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                {(file.auth_group && file.auth_group.length > 0) ||
                                                (file.auth_group_id && file.auth_group_id.length > 0) ? (
                                                    <span
                                                        className="text-slate-700 dark:text-gray-300"
                                                        title={formatGroupLabel(file.auth_group_id, file.auth_group)}
                                                    >
                                                        {formatGroupLabel(file.auth_group_id, file.auth_group)}
                                                    </span>
                                                ) : (
                                                    <span className="text-gray-400 dark:text-gray-500">—</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 font-mono text-slate-700 dark:text-gray-300">
                                                {file.priority}
                                            </td>
                                            <td className="px-6 py-4 font-mono text-slate-700 dark:text-gray-300">
                                                {file.rate_limit.toLocaleString()}
                                            </td>
                                            <td className="px-6 py-4">
                                                {file.is_available ? (
                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800">
                                                        {t('Available')}
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400 border border-red-100 dark:border-red-800">
                                                        {t('Unavailable')}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 font-mono text-xs">
                                                {formatDate(file.created_at, locale)}
                                            </td>
                                            <td className="px-6 py-4 font-mono text-xs">
                                                {formatDate(file.updated_at, locale)}
                                            </td>
                                            <td
                                                className={`px-6 py-4 text-center sticky right-0 z-10 bg-white dark:bg-surface-dark group-hover:bg-gray-50 dark:group-hover:bg-background-dark relative after:content-[''] after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-gray-200 dark:after:bg-border-dark after:pointer-events-none ${
                                                    showActionsDivider ? 'after:opacity-100' : 'after:opacity-0'
                                                }`}
                                            >
                                                <div className="flex items-center justify-center gap-1">
                                                    {canUpdateAuthFiles && (
                                                        <button
                                                            onClick={() => handleEdit(file)}
                                                            className="p-2 text-gray-400 hover:text-primary hover:bg-gray-100 dark:hover:bg-background-dark rounded-lg transition-colors"
                                                            title={t('Edit')}
                                                        >
                                                            <Icon name="edit" size={18} />
                                                        </button>
                                                    )}
                                                    {(file.is_available ? canSetUnavailable : canSetAvailable) && (
                                                        <button
                                                            onClick={() =>
                                                                file.is_available
                                                                    ? handleSetUnavailable(file.id)
                                                                    : handleSetAvailable(file.id)
                                                            }
                                                            className={`p-2 rounded-lg transition-colors ${
                                                                file.is_available
                                                                    ? 'text-gray-400 hover:text-amber-500 hover:bg-gray-100 dark:hover:bg-background-dark'
                                                                    : 'text-gray-400 hover:text-emerald-500 hover:bg-gray-100 dark:hover:bg-background-dark'
                                                            }`}
                                                            title={file.is_available ? t('Set Unavailable') : t('Set Available')}
                                                        >
                                                            <Icon
                                                                name={file.is_available ? 'toggle_off' : 'toggle_on'}
                                                                size={18}
                                                            />
                                                        </button>
                                                    )}
                                                    {canDeleteAuthFiles && (
                                                        <button
                                                            onClick={() => handleDelete(file.id)}
                                                            className="p-2 text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-background-dark rounded-lg transition-colors"
                                                            title={t('Delete')}
                                                        >
                                                            <Icon name="delete" size={18} />
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {bindModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col overflow-hidden">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-border-dark shrink-0">
                            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                                {t('Bind Proxy Servers')}
                            </h2>
                            <button
                                onClick={handleCloseBindModal}
                                className="inline-flex h-8 w-8 items-center justify-center text-gray-500 hover:text-slate-900 dark:hover:text-white rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            >
                                <Icon name="close" size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-4 flex-1 overflow-y-auto">
                            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600 dark:text-text-secondary">
                                <span>{t('Selected {{count}} auth files', { count: selectedCount })}</span>
                                <span>{t('Selected {{count}} proxy servers', { count: selectedProxyCount })}</span>
                            </div>
                            {proxiesLoading ? (
                                <div className="text-center py-6 text-gray-500 dark:text-text-secondary">
                                    {t('Loading...')}
                                </div>
                            ) : proxies.length === 0 ? (
                                <div className="text-center py-6 text-gray-500 dark:text-text-secondary">
                                    {t('No proxies found. Please add proxies first.')}
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="border border-gray-200 dark:border-border-dark rounded-lg overflow-hidden">
                                        <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 dark:bg-background-dark border-b border-gray-200 dark:border-border-dark">
                                            <AdminCheckbox
                                                checked={allProxySelected}
                                                indeterminate={anyProxySelected && !allProxySelected}
                                                disabled={bindSubmitting}
                                                onChange={(nextChecked) => {
                                                    setSelectedProxyIds((prev) => {
                                                        const next = new Set(prev);
                                                        if (nextChecked) {
                                                            proxyIds.forEach((id) => next.add(id));
                                                        } else {
                                                            proxyIds.forEach((id) => next.delete(id));
                                                        }
                                                        return next;
                                                    });
                                                }}
                                                title={t('Select all')}
                                            />
                                            <span className="text-sm text-slate-700 dark:text-gray-300">{t('Select all')}</span>
                                        </div>
                                        <div className="max-h-64 overflow-y-auto divide-y divide-gray-200 dark:divide-border-dark">
                                            {proxies.map((proxy) => (
                                                <div key={proxy.id} className="flex items-center gap-3 px-4 py-3">
                                                    <AdminCheckbox
                                                        checked={selectedProxyIds.has(proxy.id)}
                                                        disabled={bindSubmitting}
                                                        onChange={(nextChecked) => {
                                                            setSelectedProxyIds((prev) => {
                                                                const next = new Set(prev);
                                                                if (nextChecked) {
                                                                    next.add(proxy.id);
                                                                } else {
                                                                    next.delete(proxy.id);
                                                                }
                                                                return next;
                                                            });
                                                        }}
                                                        title={t('Select row')}
                                                    />
                                                    <div className="min-w-0 flex-1">
                                                        <div
                                                            className="text-sm text-slate-900 dark:text-white font-mono truncate"
                                                            title={proxy.proxy_url}
                                                        >
                                                            {proxy.proxy_url}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                            <p className="text-xs text-slate-500 dark:text-text-secondary">
                                {t('Round-robin assignment rotates selected proxy servers in order.')}
                            </p>
                            {bindError && (
                                <div className="text-sm text-red-600 dark:text-red-400">
                                    {bindError}
                                </div>
                            )}
                        </div>
                        <div className="flex gap-3 px-6 py-4 border-t border-gray-200 dark:border-border-dark shrink-0">
                            <button
                                onClick={handleBindProxies}
                                disabled={bindSubmitting || selectedCount === 0 || selectedProxyCount === 0}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {bindSubmitting ? t('Binding...') : t('Bind Proxy Servers')}
                            </button>
                            <button
                                onClick={handleCloseBindModal}
                                disabled={bindSubmitting}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-100 dark:bg-background-dark text-slate-900 dark:text-white border border-gray-300 dark:border-border-dark rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-medium disabled:opacity-50"
                            >
                                {t('Cancel')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {batchGroupModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col overflow-hidden">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-border-dark shrink-0">
                            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                                {t('Batch Set Auth Groups')}
                            </h2>
                            <button
                                onClick={handleCloseBatchGroupModal}
                                className="inline-flex h-8 w-8 items-center justify-center text-gray-500 hover:text-slate-900 dark:hover:text-white rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            >
                                <Icon name="close" size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-4 flex-1 overflow-y-auto">
                            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600 dark:text-text-secondary">
                                <span>{t('Selected {{count}} auth files', { count: selectedCount })}</span>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    {t('Auth Group')}
                                </label>
                                <div className="relative">
                                    <button
                                        type="button"
                                        id="batch-auth-group-dropdown-btn"
                                        onClick={() => setBatchGroupMenuOpen(!batchGroupMenuOpen)}
                                        className="flex items-center justify-between gap-2 w-full bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark text-slate-900 dark:text-white text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5"
                                    >
                                        <span className="truncate" title={batchGroupLabel}>
                                            {batchGroupLabel}
                                        </span>
                                        <Icon name={batchGroupMenuOpen ? 'expand_less' : 'expand_more'} size={18} />
                                    </button>
                                    {batchGroupMenuOpen && (
                                        <MultiGroupDropdownMenu
                                            anchorId="batch-auth-group-dropdown-btn"
                                            groups={authGroups}
                                            selectedIds={batchGroupIds ?? []}
                                            search={batchGroupSearch}
                                            onSearchChange={setBatchGroupSearch}
                                            onToggle={(value) => {
                                                setBatchGroupIds((prev) => toggleGroupId(prev ?? [], value));
                                            }}
                                            onClear={() => setBatchGroupIds([])}
                                            onClose={() => setBatchGroupMenuOpen(false)}
                                        />
                                    )}
                                </div>
                            </div>
                            {batchGroupError && (
                                <div className="text-sm text-red-600 dark:text-red-400">
                                    {batchGroupError}
                                </div>
                            )}
                        </div>
                        <div className="flex gap-3 px-6 py-4 border-t border-gray-200 dark:border-border-dark shrink-0">
                            <button
                                onClick={handleBatchGroupApply}
                                disabled={batchGroupSubmitting || selectedCount === 0 || batchGroupIds === null}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {batchGroupSubmitting ? t('Saving...') : t('Save')}
                            </button>
                            <button
                                onClick={handleCloseBatchGroupModal}
                                disabled={batchGroupSubmitting}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-100 dark:bg-background-dark text-slate-900 dark:text-white border border-gray-300 dark:border-border-dark rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-medium disabled:opacity-50"
                            >
                                {t('Cancel')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {importModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col overflow-hidden">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-border-dark shrink-0">
                            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                                {t('Import From CLIProxyAPI')}
                            </h2>
                            <button
                                onClick={handleCloseImportModal}
                                className="inline-flex h-8 w-8 items-center justify-center text-gray-500 hover:text-slate-900 dark:hover:text-white rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            >
                                <Icon name="close" size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-4 flex-1 overflow-y-auto">
                            {canListGroups && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        {t('Auth Group')}
                                    </label>
                                    <div className="relative">
                                        <button
                                            type="button"
                                            id="import-auth-group-dropdown-btn"
                                            onClick={() => setImportGroupMenuOpen(!importGroupMenuOpen)}
                                            className="flex items-center justify-between gap-2 w-full bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark text-slate-900 dark:text-white text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5"
                                        >
                                            <span className="truncate" title={importGroupLabel}>
                                                {importGroupLabel}
                                            </span>
                                            <Icon name={importGroupMenuOpen ? 'expand_less' : 'expand_more'} size={18} />
                                        </button>
                                        {importGroupMenuOpen && (
                                            <MultiGroupDropdownMenu
                                                anchorId="import-auth-group-dropdown-btn"
                                                groups={authGroups}
                                                selectedIds={importGroupIds ?? []}
                                                search={importGroupSearch}
                                                onSearchChange={setImportGroupSearch}
                                                onToggle={(value) => {
                                                    setImportGroupIds((prev) => toggleGroupId(prev ?? [], value));
                                                }}
                                                onClear={() => setImportGroupIds([])}
                                                onClose={() => setImportGroupMenuOpen(false)}
                                            />
                                        )}
                                    </div>
                                </div>
                            )}
                            <div
                                onDragOver={(event) => {
                                    event.preventDefault();
                                    setImportDragging(true);
                                }}
                                onDragLeave={() => setImportDragging(false)}
                                onDrop={(event) => {
                                    event.preventDefault();
                                    setImportDragging(false);
                                    if (event.dataTransfer?.files) {
                                        addImportFiles(event.dataTransfer.files);
                                    }
                                }}
                                className={`border-2 border-dashed rounded-xl p-6 transition-colors ${
                                    importDragging
                                        ? 'border-primary bg-primary/5'
                                        : 'border-gray-200 dark:border-border-dark bg-gray-50 dark:bg-background-dark'
                                }`}
                            >
                                <div className="flex flex-col items-center gap-2 text-center">
                                    <Icon name="file_upload" size={28} className="text-gray-400" />
                                    <p className="text-sm text-slate-700 dark:text-gray-300">
                                        {t('Drag and drop JSON files here')}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-text-secondary">
                                        {t('Only JSON files are supported.')}
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => importInputRef.current?.click()}
                                        className="mt-2 inline-flex items-center justify-center px-3 py-1.5 text-sm font-medium text-primary border border-primary/30 rounded-lg hover:bg-primary/10 transition-colors"
                                    >
                                        {t('Browse files')}
                                    </button>
                                    <input
                                        ref={importInputRef}
                                        type="file"
                                        multiple
                                        accept=".json,application/json"
                                        className="hidden"
                                        onChange={(event) => {
                                            if (event.target.files) {
                                                addImportFiles(event.target.files);
                                            }
                                            event.target.value = '';
                                        }}
                                    />
                                </div>
                            </div>

                            {importFiles.length > 0 ? (
                                <div className="space-y-2">
                                    <div className="text-sm font-medium text-slate-700 dark:text-gray-300">
                                        {t('Selected files')}
                                    </div>
                                    <div className="max-h-40 overflow-y-auto divide-y divide-gray-200 dark:divide-border-dark border border-gray-200 dark:border-border-dark rounded-lg">
                                        {importFiles.map((file) => (
                                            <div key={`${file.name}-${file.size}`} className="flex items-center justify-between px-3 py-2">
                                                <div className="min-w-0">
                                                    <div className="text-sm text-slate-900 dark:text-white truncate" title={file.name}>
                                                        {file.name}
                                                    </div>
                                                    <div className="text-xs text-gray-500 dark:text-text-secondary">
                                                        {formatFileSize(file.size)}
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveImportFile(file.name, file.size)}
                                                    className="inline-flex h-8 w-8 items-center justify-center text-gray-400 hover:text-red-500 rounded-lg hover:bg-gray-100 dark:hover:bg-background-dark transition-colors"
                                                    title={t('Remove')}
                                                >
                                                    <Icon name="close" size={18} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="text-sm text-gray-500 dark:text-text-secondary">
                                    {t('No files selected yet.')}
                                </div>
                            )}

                            {importError && (
                                <div className="text-sm text-red-600 dark:text-red-400">
                                    {importError}
                                </div>
                            )}

                            {importResult && (
                                <div className="space-y-2 text-sm text-slate-700 dark:text-gray-300">
                                    <div>
                                        {t('Imported {{count}} auth files', { count: importResult.imported })}
                                    </div>
                                    {importResult.failed && importResult.failed.length > 0 && (
                                        <div className="border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
                                            <div className="text-xs font-medium text-red-600 dark:text-red-400">
                                                {t('Some files failed to import.')}
                                            </div>
                                            <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                                                {importResult.failed.map((item) => (
                                                    <div key={`${item.file}-${item.error}`} className="text-xs text-red-600 dark:text-red-400">
                                                        <span className="font-medium">{item.file}</span>: {item.error}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="flex gap-3 px-6 py-4 border-t border-gray-200 dark:border-border-dark shrink-0">
                            <button
                                onClick={handleCloseImportModal}
                                disabled={importSubmitting}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-100 dark:bg-background-dark text-slate-900 dark:text-white border border-gray-300 dark:border-border-dark rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-medium disabled:opacity-50"
                            >
                                {t('Cancel')}
                            </button>
                            <button
                                onClick={handleImportUpload}
                                disabled={importSubmitting || importFiles.length === 0}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {importSubmitting ? t('Uploading...') : t('Upload')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {modalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col overflow-hidden">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-border-dark shrink-0">
                            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                                {modalTitle}
                            </h2>
                            <button
                                onClick={handleCloseModal}
                                className="inline-flex h-8 w-8 items-center justify-center text-gray-500 hover:text-slate-900 dark:hover:text-white rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            >
                                <Icon name="close" size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-4 flex-1 overflow-y-auto">
                            {modalLoading ? (
                                <div className="text-center py-4 text-gray-500 dark:text-text-secondary">
                                    {t('Loading...')}
                                </div>
                            ) : (
                                <>
                                    {canListGroups && (
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                {t('Auth Group')}
                                            </label>
                                            <div className="relative">
                                                <button
                                                    type="button"
                                                    id="new-auth-group-dropdown-btn"
                                                    onClick={() => setNewAuthGroupMenuOpen(!newAuthGroupMenuOpen)}
                                                    className="flex items-center justify-between gap-2 bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark text-slate-900 dark:text-white text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5 whitespace-nowrap w-full"
                                                >
                                                    <span className="truncate" title={newAuthGroupLabel}>
                                                        {newAuthGroupLabel}
                                                    </span>
                                                    <Icon name={newAuthGroupMenuOpen ? 'expand_less' : 'expand_more'} size={18} />
                                                </button>
                                                {newAuthGroupMenuOpen && (
                                                    <MultiGroupDropdownMenu
                                                        anchorId="new-auth-group-dropdown-btn"
                                                        groups={authGroups}
                                                        selectedIds={newAuthGroupIds ?? []}
                                                        search={newAuthGroupSearch}
                                                        onSearchChange={setNewAuthGroupSearch}
                                                        onToggle={(value) => {
                                                            setNewAuthGroupIds((prev) =>
                                                                toggleGroupId(prev ?? [], value)
                                                            );
                                                        }}
                                                        onClear={() => setNewAuthGroupIds([])}
                                                        onClose={() => setNewAuthGroupMenuOpen(false)}
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    )}
                                    {isIFlowCookie ? (
                                        <form onSubmit={handleSubmitIFlowCookie} className="space-y-4">
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                    {t('iFlow Cookie')}
                                                </label>
                                                <input
                                                    type="text"
                                                    value={iflowCookie}
                                                    onChange={(e) => {
                                                        setIflowCookie(e.target.value);
                                                        if (iflowError) {
                                                            setIflowError('');
                                                        }
                                                    }}
                                                    placeholder="BXAuth=eyJra..."
                                                    className="block w-full p-2.5 text-sm text-slate-900 dark:text-white bg-white dark:bg-background-dark border border-gray-300 dark:border-border-dark rounded-lg focus:ring-primary focus:border-primary"
                                                />
                                            </div>
                                            {iflowError && (
                                                <div className="text-sm text-red-600 dark:text-red-400">
                                                    {iflowError}
                                                </div>
                                            )}
                                            <div className="flex gap-3">
                                                <button
                                                    type="button"
                                                    onClick={handleCloseModal}
                                                    disabled={iflowSubmitting}
                                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-100 dark:bg-background-dark text-slate-900 dark:text-white border border-gray-300 dark:border-border-dark rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-medium disabled:opacity-50"
                                                >
                                                    {t('Cancel')}
                                                </button>
                                                <button
                                                    type="submit"
                                                    disabled={iflowSubmitting || iflowCookie.trim() === ''}
                                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {t('Submit')}
                                                </button>
                                            </div>
                                        </form>
                                    ) : (
                                        <>
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                    {t('URL')}
                                                </label>
                                                <input
                                                    type="text"
                                                    readOnly
                                                    value={modalUrl}
                                                    className="block w-full p-2.5 text-sm text-slate-900 dark:text-white bg-gray-100 dark:bg-background-dark border border-gray-300 dark:border-border-dark rounded-lg cursor-default"
                                                />
                                            </div>
                                            <div className="flex gap-3">
                                                <button
                                                    onClick={handleOpenUrl}
                                                    disabled={!modalUrl || authStatus === 'ok'}
                                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    <Icon name="open_in_new" size={18} />
                                                    {t('Open URL')}
                                                </button>
                                                <button
                                                    onClick={handleCopyUrl}
                                                    disabled={!modalUrl || authStatus === 'ok'}
                                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-100 dark:bg-background-dark text-slate-900 dark:text-white border border-gray-300 dark:border-border-dark rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    <Icon name={copied ? 'check' : 'content_copy'} size={18} />
                                                    {copied ? t('Copied') : t('Copy URL')}
                                                </button>
                                            </div>
                                        </>
                                    )}

                                    {authStatus !== 'idle' && (
                                        <div className="mt-4 p-4 rounded-lg border border-gray-200 dark:border-border-dark bg-gray-50 dark:bg-background-dark space-y-3">
                                            {authStatus === 'polling' && oauthProvider && (
                                                <form onSubmit={handleSubmitCallback} className="space-y-2">
                                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                                        {t('Callback URL')}
                                                    </label>
                                                    <div className="flex items-stretch">
                                                        <input
                                                            type="text"
                                                            value={callbackUrl}
                                                            onChange={(e) => {
                                                                setCallbackUrl(e.target.value);
                                                                if (callbackError) {
                                                                    setCallbackError('');
                                                                }
                                                            }}
                                                            className="flex-1 p-2.5 text-sm text-slate-900 dark:text-white bg-white dark:bg-background-dark border border-gray-300 dark:border-border-dark rounded-l-lg rounded-r-none focus:ring-primary focus:border-primary"
                                                        />
                                                        <button
                                                            type="submit"
                                                            title={t('Submit Callback URL')}
                                                            disabled={callbackSubmitting || callbackUrl.trim() === ''}
                                                            className="inline-flex items-center justify-center px-3 bg-primary text-white rounded-r-lg hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                        >
                                                            <Icon name="send" size={18} />
                                                        </button>
                                                    </div>
                                                    {callbackError && (
                                                        <div className="text-xs text-red-600 dark:text-red-400">
                                                            {callbackError}
                                                        </div>
                                                    )}
                                                </form>
                                            )}
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    {authStatus === 'polling' && (
                                                        <>
                                                            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                                            <span className="text-sm text-gray-600 dark:text-gray-400">
                                                                {t('Waiting for authentication...')}
                                                            </span>
                                                        </>
                                                    )}
                                                    {authStatus === 'ok' && (
                                                        <>
                                                            <Icon name="check_circle" size={18} className="text-emerald-500" />
                                                            <span className="text-sm text-emerald-600 dark:text-emerald-400">
                                                                {t('Authentication successful')}
                                                            </span>
                                                        </>
                                                    )}
                                                    {authStatus === 'error' && (
                                                        <>
                                                            <Icon name="error" size={18} className="text-red-500" />
                                                            <span className="text-sm text-red-600 dark:text-red-400">
                                                                {authError || t('Authentication failed')}
                                                            </span>
                                                        </>
                                                    )}
                                                </div>
                                                {authStatus === 'polling' && !isIFlowCookie && (
                                                    <span className="text-xs text-gray-500 dark:text-gray-500">
                                                        {t('Poll count: {{count}}', { count: pollCount })}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
            {editModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col overflow-hidden">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-border-dark shrink-0">
                            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                                {t('Edit Auth File')}
                            </h2>
                            <button
                                onClick={handleEditClose}
                                className="inline-flex h-8 w-8 items-center justify-center text-gray-500 hover:text-slate-900 dark:hover:text-white rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            >
                                <Icon name="close" size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-4 flex-1 overflow-y-auto">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    {t('Key')}
                                </label>
                                <input
                                    type="text"
                                    value={editKey}
                                    onChange={(e) => setEditKey(e.target.value)}
                                    className="block w-full p-2.5 text-sm text-slate-900 dark:text-white bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark rounded-lg focus:ring-primary focus:border-primary"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    {t('Proxy URL')}
                                </label>
                                <input
                                    type="text"
                                    value={editProxyUrl}
                                    placeholder="socks5://user:password@host:port/"
                                    onChange={(e) => setEditProxyUrl(e.target.value)}
                                    className="block w-full p-2.5 text-sm text-slate-900 dark:text-white bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark rounded-lg focus:ring-primary focus:border-primary"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    {t('Rate limit')}
                                </label>
                                <input
                                    type="number"
                                    step="1"
                                    value={editRateLimit}
                                    onChange={(e) => setEditRateLimit(e.target.value)}
                                    placeholder="0"
                                    className="block w-full p-2.5 text-sm text-slate-900 dark:text-white bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark rounded-lg focus:ring-primary focus:border-primary"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    {t('Priority')}
                                </label>
                                <input
                                    type="number"
                                    step="1"
                                    value={editPriority}
                                    onChange={(e) => setEditPriority(e.target.value)}
                                    placeholder="0"
                                    className="block w-full p-2.5 text-sm text-slate-900 dark:text-white bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark rounded-lg focus:ring-primary focus:border-primary"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    {t('Auth Group')}
                                </label>
                                {canListGroups ? (
                                    <div className="relative">
                                        <button
                                            type="button"
                                            id="group-dropdown-btn"
                                            onClick={() => setEditGroupMenuOpen(!editGroupMenuOpen)}
                                            className="flex items-center justify-between gap-2 w-full bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark text-slate-900 dark:text-white text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5"
                                            style={editGroupBtnWidth ? { minWidth: editGroupBtnWidth } : undefined}
                                        >
                                            <span className="truncate" title={editGroupLabel}>
                                                {editGroupLabel}
                                            </span>
                                            <Icon name={editGroupMenuOpen ? 'expand_less' : 'expand_more'} size={18} />
                                        </button>
                                        {editGroupMenuOpen && (
                                            <MultiGroupDropdownMenu
                                                anchorId="group-dropdown-btn"
                                                groups={authGroups}
                                                selectedIds={editGroupIds}
                                                search={editGroupSearch}
                                                menuWidth={editGroupBtnWidth}
                                                onSearchChange={setEditGroupSearch}
                                                onToggle={(value) => {
                                                    setEditGroupIds((prev) => toggleGroupId(prev, value));
                                                }}
                                                onClear={() => setEditGroupIds([])}
                                                onClose={() => setEditGroupMenuOpen(false)}
                                            />
                                        )}
                                    </div>
                                ) : (
                                    <div className="block w-full p-2.5 text-sm text-slate-500 dark:text-text-secondary bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark rounded-lg">
                                        {editGroupLabel}
                                    </div>
                                )}
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    {t('Status')}
                                </label>
                                <div className="flex items-center gap-4">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="editStatus"
                                            checked={editIsAvailable}
                                            onChange={() => setEditIsAvailable(true)}
                                            className="w-4 h-4 text-primary focus:ring-primary"
                                        />
                                        <span className="text-sm text-slate-900 dark:text-white">{t('Available')}</span>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="editStatus"
                                            checked={!editIsAvailable}
                                            onChange={() => setEditIsAvailable(false)}
                                            className="w-4 h-4 text-primary focus:ring-primary"
                                        />
                                        <span className="text-sm text-slate-900 dark:text-white">{t('Unavailable')}</span>
                                    </label>
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-3 px-6 py-4 border-t border-gray-200 dark:border-border-dark shrink-0">
                            <button
                                onClick={handleEditSave}
                                disabled={editSaving || !editKey.trim()}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {editSaving ? t('Saving...') : t('Save')}
                            </button>
                            <button
                                onClick={handleEditClose}
                                disabled={editSaving}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-100 dark:bg-background-dark text-slate-900 dark:text-white border border-gray-300 dark:border-border-dark rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-medium disabled:opacity-50"
                            >
                                {t('Cancel')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {toast.show && (
                <div className="fixed top-4 right-4 z-[9999] animate-slide-in-right">
                    <div className="flex items-center gap-3 px-4 py-3 bg-emerald-50 dark:bg-emerald-900 border border-emerald-200 dark:border-emerald-800 rounded-lg shadow-lg">
                        <Icon name="check_circle" size={20} className="text-emerald-500" />
                        <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                            {toast.message}
                        </span>
                        <button
                            onClick={() => setToast({ show: false, message: '' })}
                            className="inline-flex h-7 w-7 items-center justify-center text-emerald-500 hover:text-emerald-700 dark:hover:text-emerald-300 rounded transition-colors"
                        >
                            <Icon name="close" size={16} />
                        </button>
                    </div>
                </div>
            )}
            {confirmDialog && (
                <ConfirmDialog
                    title={confirmDialog.title}
                    message={confirmDialog.message}
                    confirmText={confirmDialog.confirmText}
                    danger={confirmDialog.danger}
                    onConfirm={confirmDialog.onConfirm}
                    onCancel={() => setConfirmDialog(null)}
                />
            )}
        </AdminDashboardLayout>
    );
}
