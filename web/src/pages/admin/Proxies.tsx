import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AdminDashboardLayout } from '../../components/admin/AdminDashboardLayout';
import { AdminNoAccessCard } from '../../components/admin/AdminNoAccessCard';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Icon } from '../../components/Icon';
import { apiFetchAdmin } from '../../api/config';
import { buildAdminPermissionKey, useAdminPermissions } from '../../utils/adminPermissions';
import { useStickyActionsDivider } from '../../utils/stickyActionsDivider';
import { useTranslation } from 'react-i18next';

interface ProxyItem {
    id: number;
    proxy_url: string;
    is_active?: boolean;
    test_status?: string;
    last_tested_at?: string | null;
    last_error?: string;
    last_checked_ip?: string;
    created_at: string;
    updated_at: string;
}

interface ListResponse {
    proxies: ProxyItem[];
}

interface BatchDeleteResponse {
    deleted: number;
    missing_ids?: number[];
}

interface ProxyCheckResponse {
    live: boolean;
    ip: string;
    service: string;
    target_url: string;
    latency_ms: number;
    checked_at: string;
    status_code?: number;
    error?: string;
    failure_stage?: string;
    diagnosis?: string;
    hint?: string;
    suggested_proxy_url?: string;
}

type ProxyCheckState = ProxyCheckResponse & {
    status: 'checking' | 'live' | 'dead';
};

interface ProxyFormData {
    protocol: string;
    host: string;
    port: string;
    username: string;
    password: string;
}

interface ConfirmDialogState {
    title: string;
    message: string;
    confirmText?: string;
    danger?: boolean;
    onConfirm: () => void;
}

interface ProtocolDropdownMenuProps {
    options: string[];
    selected: string;
    menuWidth?: number;
    onSelect: (value: string) => void;
    onClose: () => void;
}

interface ProxyModalProps {
    title: string;
    initialData: ProxyFormData;
    submitting: boolean;
    onClose: () => void;
    onSubmit: (payload: ProxyFormData) => void;
}

interface BulkAddModalProps {
    submitting: boolean;
    onClose: () => void;
    onSubmit: (lines: string[]) => void;
}

const PROTOCOL_OPTIONS = ['http', 'https', 'socks5'];
const PAGE_SIZE = 10;

const inputClassName =
    'w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent';

function ProtocolDropdownMenu({ options, selected, menuWidth, onSelect, onClose }: ProtocolDropdownMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);
    const btn = document.getElementById('proxy-protocol-dropdown-btn');
    const rect = btn ? btn.getBoundingClientRect() : null;
    const position = rect
        ? { top: rect.bottom + 4, left: rect.left, width: rect.width }
        : { top: 0, left: 0, width: 0 };

    return createPortal(
        <>
            <div className="fixed inset-0 z-40" onClick={onClose} />
            <div
                ref={menuRef}
                className="fixed z-50 bg-white dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg shadow-lg overflow-hidden"
                style={{ top: position.top, left: position.left, width: position.width || menuWidth }}
            >
                {options.map((opt) => (
                    <button
                        key={opt}
                        type="button"
                        onClick={() => onSelect(opt)}
                        className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-100 dark:hover:bg-background-dark transition-colors ${
                            selected === opt
                                ? 'bg-gray-100 dark:bg-background-dark text-primary font-medium'
                                : 'text-slate-900 dark:text-white'
                        }`}
                    >
                        {opt}
                    </button>
                ))}
            </div>
        </>,
        document.body
    );
}

function ProxyModal({ title, initialData, submitting, onClose, onSubmit }: ProxyModalProps) {
    const { t } = useTranslation();
    const [formData, setFormData] = useState<ProxyFormData>(initialData);
    const [error, setError] = useState('');
    const [menuOpen, setMenuOpen] = useState(false);
    const menuWidth = useMemo(() => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return undefined;
        }
        ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
        let maxWidth = 0;
        for (const opt of PROTOCOL_OPTIONS) {
            const width = ctx.measureText(opt).width;
            if (width > maxWidth) maxWidth = width;
        }
        return Math.ceil(maxWidth) + 72;
    }, []);

    const handleSubmit = () => {
        const protocol = formData.protocol.trim();
        const host = formData.host.trim();
        const port = formData.port.trim();

        if (!protocol) {
            setError('Protocol is required.');
            return;
        }
        if (!host) {
            setError('Host is required.');
            return;
        }
        if (!port) {
            setError('Port is required.');
            return;
        }
        const portValue = Number(port);
        if (!Number.isInteger(portValue) || portValue <= 0) {
            setError('Port must be a number.');
            return;
        }

        setError('');
        onSubmit({
            protocol,
            host,
            port,
            username: formData.username.trim(),
            password: formData.password,
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white dark:bg-surface-dark rounded-xl shadow-xl w-full max-w-lg mx-4 border border-gray-200 dark:border-border-dark max-h-[90vh] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-border-dark shrink-0">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                        {title}
                    </h2>
                    <button
                        onClick={onClose}
                        className="inline-flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
                    >
                        <Icon name="close" />
                    </button>
                </div>
                <div className="p-6 space-y-4 flex-1 overflow-y-auto">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Protocol')}
                        </label>
                        <div className="relative">
                            <button
                                type="button"
                                id="proxy-protocol-dropdown-btn"
                                onClick={() => setMenuOpen(!menuOpen)}
                                className="flex items-center justify-between gap-2 bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark text-slate-900 dark:text-white text-sm rounded-lg focus:ring-primary focus:border-primary px-4 py-2.5"
                                style={menuWidth ? { width: menuWidth } : undefined}
                            >
                                <span>{formData.protocol || t('Select Protocol')}</span>
                                <Icon name={menuOpen ? 'expand_less' : 'expand_more'} size={18} />
                            </button>
                            {menuOpen && (
                                <ProtocolDropdownMenu
                                    options={PROTOCOL_OPTIONS}
                                    selected={formData.protocol}
                                    menuWidth={menuWidth}
                                    onSelect={(value) => {
                                        setFormData({ ...formData, protocol: value });
                                        setMenuOpen(false);
                                    }}
                                    onClose={() => setMenuOpen(false)}
                                />
                            )}
                          </div>
                          <p className="mt-1.5 text-xs text-slate-500 dark:text-text-secondary">
                              {t('Use http for most proxies labeled HTTPS; choose https only when the proxy server itself requires TLS.')}
                          </p>
                      </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Host')}
                        </label>
                        <input
                            type="text"
                            value={formData.host}
                            onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                            placeholder={t('Enter host')}
                            className={inputClassName}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Port')}
                        </label>
                        <input
                            type="text"
                            inputMode="numeric"
                            value={formData.port}
                            onChange={(e) => setFormData({ ...formData, port: e.target.value })}
                            placeholder={t('Enter port')}
                            className={inputClassName}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Username')}
                        </label>
                        <input
                            type="text"
                            value={formData.username}
                            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                            placeholder={t('Enter username')}
                            className={inputClassName}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Password')}
                        </label>
                        <input
                            type="password"
                            value={formData.password}
                            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                            placeholder={t('Enter password')}
                            className={inputClassName}
                        />
                    </div>
                    {error && (
                        <div className="text-sm text-red-600 dark:text-red-400">
                            {t(error)}
                        </div>
                    )}
                </div>
                <div className="flex gap-3 px-6 py-4 border-t border-gray-200 dark:border-border-dark shrink-0">
                    <button
                        onClick={onClose}
                        className="flex-1 py-2.5 bg-gray-100 dark:bg-background-dark hover:bg-gray-200 dark:hover:bg-gray-700 text-slate-900 dark:text-white rounded-lg font-medium transition-colors border border-gray-200 dark:border-border-dark"
                        disabled={submitting}
                    >
                        {t('Cancel')}
                    </button>
                    <button
                        onClick={handleSubmit}
                        className="flex-1 py-2.5 bg-primary hover:bg-blue-600 text-white rounded-lg font-medium transition-colors disabled:opacity-60"
                        disabled={submitting}
                    >
                        {t('Save')}
                    </button>
                </div>
            </div>
        </div>
    );
}

function BulkAddModal({ submitting, onClose, onSubmit }: BulkAddModalProps) {
    const { t } = useTranslation();
    const [value, setValue] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = () => {
        const lines = value
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

        if (lines.length === 0) {
            setError('Proxy URLs are required.');
            return;
        }

        setError('');
        onSubmit(lines);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white dark:bg-surface-dark rounded-xl shadow-xl w-full max-w-2xl mx-4 border border-gray-200 dark:border-border-dark max-h-[90vh] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-border-dark shrink-0">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                        {t('Batch Add Proxies')}
                    </h2>
                    <button
                        onClick={onClose}
                        className="inline-flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
                    >
                        <Icon name="close" />
                    </button>
                </div>
                <div className="p-6 space-y-3 flex-1 overflow-y-auto">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                        {t('Proxy URLs')}
                    </label>
                    <textarea
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        rows={8}
                        placeholder="protocol://user:pass@host:port/"
                        className="w-full px-4 py-3 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                    <p className="text-xs text-slate-500 dark:text-text-secondary">
                        {t('One proxy URL per line, format: protocol://user:pass@host:port/')}
                    </p>
                    {error && (
                        <div className="text-sm text-red-600 dark:text-red-400">
                            {t(error)}
                        </div>
                    )}
                </div>
                <div className="flex gap-3 px-6 py-4 border-t border-gray-200 dark:border-border-dark shrink-0">
                    <button
                        onClick={onClose}
                        className="flex-1 py-2.5 bg-gray-100 dark:bg-background-dark hover:bg-gray-200 dark:hover:bg-gray-700 text-slate-900 dark:text-white rounded-lg font-medium transition-colors border border-gray-200 dark:border-border-dark"
                        disabled={submitting}
                    >
                        {t('Cancel')}
                    </button>
                    <button
                        onClick={handleSubmit}
                        className="flex-1 py-2.5 bg-primary hover:bg-blue-600 text-white rounded-lg font-medium transition-colors disabled:opacity-60"
                        disabled={submitting}
                    >
                        {t('Save')}
                    </button>
                </div>
            </div>
        </div>
    );
}

function parseProxyUrl(raw: string): ProxyFormData {
    const fallback: ProxyFormData = {
        protocol: 'http',
        host: '',
        port: '',
        username: '',
        password: '',
    };

    if (!raw) {
        return fallback;
    }

    try {
        const parsed = new URL(raw);
        const protocol = parsed.protocol.replace(':', '');
        return {
            protocol: PROTOCOL_OPTIONS.includes(protocol) ? protocol : 'http',
            host: parsed.hostname,
            port: parsed.port,
            username: parsed.username,
            password: parsed.password,
        };
    } catch {
        return fallback;
    }
}

function buildProxyUrl(data: ProxyFormData): string {
    const protocol = data.protocol.trim();
    const host = data.host.trim();
    const port = data.port.trim();
    const username = data.username.trim();
    const password = data.password.trim();

    let authPart = '';
    if (username || password) {
        const encodedUser = encodeURIComponent(username);
        if (password) {
            authPart = `${encodedUser}:${encodeURIComponent(password)}@`;
        } else {
            authPart = `${encodedUser}@`;
        }
    }

    return `${protocol}://${authPart}${host}:${port}/`;
}

function proxyCheckStateFromRow(proxy: ProxyItem): ProxyCheckState | null {
    const status = proxy.test_status || 'new';
    const checkedAt = proxy.last_tested_at || proxy.updated_at;

    if (status === 'active') {
        return {
            status: 'live',
            live: true,
            ip: proxy.last_checked_ip || '',
            service: '',
            target_url: '',
            latency_ms: 0,
            checked_at: checkedAt,
        };
    }

    if (status === 'error' || proxy.is_active === false) {
        return {
            status: 'dead',
            live: false,
            ip: '',
            service: '',
            target_url: '',
            latency_ms: 0,
            checked_at: checkedAt,
            error: proxy.last_error || '',
        };
    }

    return null;
}

function getErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : 'Proxy check failed';
}

export function AdminProxies() {
    const { t, i18n } = useTranslation();
    const { hasPermission } = useAdminPermissions();
    const locale = i18n.language === 'zh-CN' ? 'zh-CN' : undefined;

    const canListProxies = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/proxies'));
    const canCreateProxies = hasPermission(buildAdminPermissionKey('POST', '/v0/admin/proxies'));
    const canBatchCreateProxies = hasPermission(buildAdminPermissionKey('POST', '/v0/admin/proxies/batch'));
    const canBatchDeleteProxies = hasPermission(buildAdminPermissionKey('POST', '/v0/admin/proxies/batch-delete'));
    const canCheckProxies = hasPermission(buildAdminPermissionKey('POST', '/v0/admin/proxies/:id/check'));
    const canUpdateProxies = hasPermission(buildAdminPermissionKey('PUT', '/v0/admin/proxies/:id'));
    const canDeleteProxies = hasPermission(buildAdminPermissionKey('DELETE', '/v0/admin/proxies/:id'));

    const [proxies, setProxies] = useState<ProxyItem[]>([]);
    const [proxyChecks, setProxyChecks] = useState<Record<number, ProxyCheckState>>({});
    const [selectedProxyIds, setSelectedProxyIds] = useState<number[]>([]);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [createOpen, setCreateOpen] = useState(false);
    const [editingProxy, setEditingProxy] = useState<ProxyItem | null>(null);
    const [bulkOpen, setBulkOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [bulkSubmitting, setBulkSubmitting] = useState(false);
    const [batchDeleteSubmitting, setBatchDeleteSubmitting] = useState(false);
    const [toast, setToast] = useState<{ show: boolean; message: string }>({ show: false, message: '' });
    const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
    const selectPageCheckboxRef = useRef<HTMLInputElement>(null);
    const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const fetchProxies = useCallback(async () => {
        if (!canListProxies) {
            setProxies([]);
            return;
        }
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (search.trim()) {
                params.set('keyword', search.trim());
            }
            const url = params.toString() ? `/v0/admin/proxies?${params.toString()}` : '/v0/admin/proxies';
            const res = await apiFetchAdmin<ListResponse>(url);
            setProxies(res.proxies || []);
            setCurrentPage(1);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [canListProxies, search]);

    useEffect(() => {
        if (canListProxies) {
            fetchProxies();
        }
    }, [fetchProxies, canListProxies]);

    const totalPages = Math.ceil(proxies.length / PAGE_SIZE);
    const paginatedProxies = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return proxies.slice(start, start + PAGE_SIZE);
    }, [proxies, currentPage]);
    const selectedProxySet = useMemo(() => new Set(selectedProxyIds), [selectedProxyIds]);
    const selectedProxies = useMemo(
        () => proxies.filter((proxy) => selectedProxySet.has(proxy.id)),
        [proxies, selectedProxySet]
    );
    const pageProxyIds = useMemo(
        () => paginatedProxies.map((proxy) => proxy.id),
        [paginatedProxies]
    );
    const selectedPageCount = pageProxyIds.filter((id) => selectedProxySet.has(id)).length;
    const allPageSelected = pageProxyIds.length > 0 && selectedPageCount === pageProxyIds.length;
    const somePageSelected = selectedPageCount > 0 && !allPageSelected;
    const canSelectProxies = canCheckProxies || canBatchDeleteProxies;

    const { tableScrollRef, handleTableScroll, showActionsDivider } = useStickyActionsDivider(
        paginatedProxies.length,
        loading
    );

    useEffect(() => {
        const availableIds = new Set(proxies.map((proxy) => proxy.id));
        setSelectedProxyIds((prev) => prev.filter((id) => availableIds.has(id)));
    }, [proxies]);

    useEffect(() => {
        if (selectPageCheckboxRef.current) {
            selectPageCheckboxRef.current.indeterminate = somePageSelected;
        }
    }, [somePageSelected]);

    const formatDate = (value: string) => new Date(value).toLocaleString(locale);

    const showToast = useCallback((message: string) => {
        if (toastTimeoutRef.current) {
            clearTimeout(toastTimeoutRef.current);
        }
        setToast({ show: true, message });
        toastTimeoutRef.current = setTimeout(() => {
            setToast({ show: false, message: '' });
        }, 10000);
    }, []);

    useEffect(() => {
        return () => {
            if (toastTimeoutRef.current) {
                clearTimeout(toastTimeoutRef.current);
            }
        };
    }, []);

    const handleSave = async (payload: ProxyFormData) => {
        if (!canCreateProxies && !canUpdateProxies) {
            return;
        }
        setSubmitting(true);
        try {
            const proxyUrl = buildProxyUrl(payload);
            if (editingProxy) {
                await apiFetchAdmin(`/v0/admin/proxies/${editingProxy.id}`, {
                    method: 'PUT',
                    body: JSON.stringify({ proxy_url: proxyUrl }),
                });
                setEditingProxy(null);
            } else {
                await apiFetchAdmin('/v0/admin/proxies', {
                    method: 'POST',
                    body: JSON.stringify({ proxy_url: proxyUrl }),
                });
                setCreateOpen(false);
            }
            fetchProxies();
        } catch (err) {
            console.error(err);
        } finally {
            setSubmitting(false);
        }
    };

    const handleBatchCreate = async (lines: string[]) => {
        if (!canBatchCreateProxies) {
            return;
        }
        setBulkSubmitting(true);
        try {
            await apiFetchAdmin('/v0/admin/proxies/batch', {
                method: 'POST',
                body: JSON.stringify({ proxy_urls: lines }),
            });
            setBulkOpen(false);
            fetchProxies();
        } catch (err) {
            console.error(err);
        } finally {
            setBulkSubmitting(false);
        }
    };

    const handleToggleProxySelection = (proxyId: number, checked: boolean) => {
        setSelectedProxyIds((prev) => {
            if (checked) {
                if (prev.includes(proxyId)) {
                    return prev;
                }
                return [...prev, proxyId];
            }
            return prev.filter((id) => id !== proxyId);
        });
    };

    const handleTogglePageSelection = (checked: boolean) => {
        setSelectedProxyIds((prev) => {
            if (checked) {
                const next = new Set(prev);
                for (const id of pageProxyIds) {
                    next.add(id);
                }
                return Array.from(next);
            }
            const pageIds = new Set(pageProxyIds);
            return prev.filter((id) => !pageIds.has(id));
        });
    };

    const handleClearSelection = () => {
        setSelectedProxyIds([]);
    };

    const handleCheckProxy = async (proxy: ProxyItem) => {
        if (!canCheckProxies) {
            return;
        }

        setProxyChecks((prev) => ({
            ...prev,
            [proxy.id]: {
                status: 'checking',
                live: false,
                ip: '',
                service: '4.ident.me',
                target_url: 'https://4.ident.me/',
                latency_ms: 0,
                checked_at: new Date().toISOString(),
            },
        }));

        try {
            const result = await apiFetchAdmin<ProxyCheckResponse>(`/v0/admin/proxies/${proxy.id}/check`, {
                method: 'POST',
            });
            setProxyChecks((prev) => ({
                ...prev,
                [proxy.id]: {
                    ...result,
                    status: result.live ? 'live' : 'dead',
                },
            }));
            setProxies((prev) =>
                prev.map((item) =>
                    item.id === proxy.id
                        ? {
                              ...item,
                              is_active: result.live,
                              test_status: result.live ? 'active' : 'error',
                              last_tested_at: result.checked_at,
                              last_error: result.error || '',
                              last_checked_ip: result.ip || '',
                          }
                        : item
                )
            );
        } catch (err) {
            setProxyChecks((prev) => ({
                ...prev,
                [proxy.id]: {
                    status: 'dead',
                    live: false,
                    ip: '',
                    service: '4.ident.me',
                    target_url: 'https://4.ident.me/',
                    latency_ms: 0,
                    checked_at: new Date().toISOString(),
                    error: getErrorMessage(err),
                },
            }));
        }
    };

    const handleCheckSelectedProxies = async () => {
        if (!canCheckProxies || selectedProxies.length === 0) {
            return;
        }
        const concurrency = 10;
        for (let index = 0; index < selectedProxies.length; index += concurrency) {
            const batch = selectedProxies.slice(index, index + concurrency);
            await Promise.all(batch.map((proxy) => handleCheckProxy(proxy)));
        }
    };

    const handleBatchDelete = () => {
        if (!canBatchDeleteProxies || selectedProxies.length === 0 || batchDeleteSubmitting) {
            return;
        }
        const ids = selectedProxies.map((proxy) => proxy.id);
        setConfirmDialog({
            title: t('Delete Selected Proxies'),
            message: t('Are you sure you want to delete {{count}} selected proxies? This action cannot be undone.', {
                count: ids.length,
            }),
            confirmText: t('Delete'),
            danger: true,
            onConfirm: async () => {
                setBatchDeleteSubmitting(true);
                try {
                    const result = await apiFetchAdmin<BatchDeleteResponse>('/v0/admin/proxies/batch-delete', {
                        method: 'POST',
                        body: JSON.stringify({ ids }),
                    });
                    setSelectedProxyIds((prev) => prev.filter((id) => !ids.includes(id)));
                    await fetchProxies();
                    const missingCount = result.missing_ids?.length || 0;
                    if (missingCount > 0) {
                        showToast(
                            t('Deleted {{deleted}} proxies. {{missing}} selected proxies were already missing.', {
                                deleted: result.deleted,
                                missing: missingCount,
                            })
                        );
                    } else {
                        showToast(t('Deleted {{count}} proxies', { count: result.deleted }));
                    }
                } catch (err) {
                    console.error('Failed to delete selected proxies:', err);
                    showToast(err instanceof Error ? err.message : t('Failed to delete selected proxies.'));
                } finally {
                    setBatchDeleteSubmitting(false);
                    setConfirmDialog(null);
                }
            },
        });
    };

    const handleDelete = (proxy: ProxyItem) => {
        if (!canDeleteProxies) {
            return;
        }
        setConfirmDialog({
            title: t('Delete Proxy'),
            message: t('Are you sure you want to delete this proxy?'),
            confirmText: t('Delete'),
            danger: true,
            onConfirm: async () => {
                try {
                    await apiFetchAdmin(`/v0/admin/proxies/${proxy.id}`, { method: 'DELETE' });
                    fetchProxies();
                } catch (err) {
                    console.error(err);
                } finally {
                    setConfirmDialog(null);
                }
            },
        });
    };

    const renderCheckStatus = (proxy: ProxyItem) => {
        if (!canCheckProxies) {
            return (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 dark:border-border-dark px-2.5 py-1 text-xs font-medium text-slate-500 dark:text-text-secondary whitespace-nowrap">
                    <Icon name="lock" size={16} />
                    {t('No check access')}
                </span>
            );
        }

        const check = proxyChecks[proxy.id] || proxyCheckStateFromRow(proxy);
        if (!check) {
            return (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 dark:border-border-dark px-2.5 py-1 text-xs font-medium text-slate-500 dark:text-text-secondary whitespace-nowrap">
                    <Icon name="help" size={16} />
                    {t('Not checked')}
                </span>
            );
        }

        if (check.status === 'checking') {
            return (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-900/20 px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-300 whitespace-nowrap">
                    <Icon name="sync" size={16} className="animate-spin" />
                    {t('Checking...')}
                </span>
            );
        }

        if (check.status === 'live') {
            return (
                <div className="space-y-1">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-900/20 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300 whitespace-nowrap">
                        <Icon name="check_circle" size={16} />
                        {t('LIVE')}
                    </span>
                    {check.ip ? (
                        <div className="font-mono text-xs text-slate-700 dark:text-gray-300">
                            {check.ip}
                        </div>
                    ) : null}
                    {check.service ? (
                        <div className="text-xs text-slate-500 dark:text-text-secondary whitespace-nowrap">
                            {t('{{ms}} ms via {{service}}', {
                                ms: check.latency_ms,
                                service: check.service,
                            })}
                        </div>
                    ) : null}
                </div>
            );
        }

        const detailTitle = [check.diagnosis, check.error, check.hint, check.suggested_proxy_url]
            .filter(Boolean)
            .join('\n');

        return (
            <div className="space-y-1">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 px-2.5 py-1 text-xs font-semibold text-red-700 dark:text-red-300 whitespace-nowrap">
                    <Icon name="error" size={16} />
                    {t('OFFLINE')}
                </span>
                {check.diagnosis && (
                    <div className="max-w-80 text-xs font-medium text-slate-700 dark:text-gray-300" title={detailTitle}>
                        {check.diagnosis}
                    </div>
                )}
                {check.error && (
                    <div className="max-w-80 truncate text-xs text-slate-500 dark:text-text-secondary" title={detailTitle || check.error}>
                        {check.error}
                    </div>
                )}
                {check.hint && (
                    <div className="max-w-80 text-xs text-amber-700 dark:text-amber-300" title={detailTitle}>
                        {check.hint}
                    </div>
                )}
                {check.suggested_proxy_url && (
                    <div className="max-w-80 truncate font-mono text-xs text-slate-600 dark:text-gray-300" title={check.suggested_proxy_url}>
                        {t('Suggested URL: {{url}}', { url: check.suggested_proxy_url })}
                    </div>
                )}
            </div>
        );
      };

    const selectedCheckInProgress = selectedProxies.some(
        (proxy) => proxyChecks[proxy.id]?.status === 'checking'
    );

    if (!canListProxies) {
        return (
            <AdminDashboardLayout title={t('Proxies')} subtitle={t('Manage proxy endpoints for upstream requests.')}>
                <AdminNoAccessCard />
            </AdminDashboardLayout>
        );
    }

    return (
        <AdminDashboardLayout title={t('Proxies')} subtitle={t('Manage proxy endpoints for upstream requests.')}>
            <div className="space-y-6">
                {(canCheckProxies || canBatchDeleteProxies || canCreateProxies || canBatchCreateProxies) && (
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                            {canCheckProxies && (
                                <button
                                    onClick={handleCheckSelectedProxies}
                                    disabled={selectedProxies.length === 0 || selectedCheckInProgress}
                                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <Icon name="network_check" size={18} />
                                    {t('Check Selected ({{count}})', { count: selectedProxies.length })}
                                </button>
                            )}
                            {canBatchDeleteProxies && (
                                <button
                                    onClick={handleBatchDelete}
                                    disabled={selectedProxies.length === 0 || batchDeleteSubmitting}
                                    className="flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors font-medium border border-red-200 dark:border-red-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <Icon name="delete" size={18} />
                                    {batchDeleteSubmitting ? t('Deleting...') : t('Delete Selected')}
                                </button>
                            )}
                            {selectedProxies.length > 0 && (
                                <button
                                    onClick={handleClearSelection}
                                    className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-background-dark text-slate-900 dark:text-white rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-medium border border-gray-200 dark:border-border-dark"
                                >
                                    <Icon name="close" size={18} />
                                    {t('Clear Selection')}
                                </button>
                            )}
                        </div>
                        <div className="flex justify-end gap-2">
                            {canBatchCreateProxies && (
                                <button
                                    onClick={() => setBulkOpen(true)}
                                    className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-background-dark text-slate-900 dark:text-white rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-medium border border-gray-200 dark:border-border-dark"
                                >
                                    <Icon name="library_add" size={18} />
                                    {t('Batch Add')}
                                </button>
                            )}
                            {canCreateProxies && (
                                <button
                                    onClick={() => setCreateOpen(true)}
                                    className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
                                >
                                    <Icon name="add" size={18} />
                                    {t('New Proxy')}
                                </button>
                            )}
                        </div>
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
                                placeholder={t('Search by proxy URL...')}
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>
                    </div>
                    <button
                        onClick={fetchProxies}
                        className="h-10 w-10 inline-flex items-center justify-center text-gray-500 dark:text-text-secondary hover:bg-gray-100 dark:hover:bg-background-dark rounded-lg border border-gray-200 dark:border-border-dark transition-colors"
                        title={t('Refresh Data')}
                    >
                        <Icon name="refresh" />
                    </button>
                </div>

                <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-sm overflow-hidden">
                    <div ref={tableScrollRef} className="relative overflow-x-auto" onScroll={handleTableScroll}>
                        <table className="w-full text-sm text-left text-gray-500 dark:text-gray-400">
                            <thead className="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-surface-dark dark:text-gray-400 border-b border-gray-200 dark:border-border-dark">
                                <tr>
                                    <th className="px-6 py-4 font-semibold tracking-wider">
                                            <input
                                                ref={selectPageCheckboxRef}
                                                type="checkbox"
                                                checked={allPageSelected}
                                                disabled={!canSelectProxies || pageProxyIds.length === 0}
                                            onChange={(e) => handleTogglePageSelection(e.target.checked)}
                                            aria-label={t('Select visible proxies')}
                                            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50 dark:border-border-dark dark:bg-background-dark"
                                        />
                                    </th>
                                    <th className="px-6 py-4 font-semibold tracking-wider">{t('ID')}</th>
                                    <th className="px-6 py-4 font-semibold tracking-wider">{t('Proxy URL')}</th>
                                    <th className="px-6 py-4 font-semibold tracking-wider">{t('Live Check')}</th>
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
                                        <td colSpan={7} className="px-6 py-12 text-center">
                                            {t('Loading...')}
                                        </td>
                                    </tr>
                                ) : paginatedProxies.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="px-6 py-12 text-center">
                                            {t('No proxies found')}
                                        </td>
                                    </tr>
                                ) : (
                                    paginatedProxies.map((proxy) => (
                                        <tr
                                            key={proxy.id}
                                            className="hover:bg-gray-50 dark:hover:bg-background-dark group"
                                        >
                                            <td className="px-6 py-4">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedProxySet.has(proxy.id)}
                                                    disabled={!canSelectProxies}
                                                    onChange={(e) => handleToggleProxySelection(proxy.id, e.target.checked)}
                                                    aria-label={t('Select proxy {{id}}', { id: proxy.id })}
                                                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50 dark:border-border-dark dark:bg-background-dark"
                                                />
                                            </td>
                                            <td className="px-6 py-4 text-slate-900 dark:text-white font-medium">
                                                {proxy.id}
                                            </td>
                                            <td className="px-6 py-4 text-slate-700 dark:text-gray-300 font-mono text-xs">
                                                {proxy.proxy_url}
                                            </td>
                                            <td className="px-6 py-4 min-w-48">
                                                {renderCheckStatus(proxy)}
                                            </td>
                                            <td className="px-6 py-4 font-mono text-xs">
                                                {formatDate(proxy.created_at)}
                                            </td>
                                            <td className="px-6 py-4 font-mono text-xs">
                                                {formatDate(proxy.updated_at)}
                                            </td>
                                            <td
                                                className={`px-6 py-4 text-center sticky right-0 z-10 bg-white dark:bg-surface-dark group-hover:bg-gray-50 dark:group-hover:bg-background-dark relative after:content-[''] after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-gray-200 dark:after:bg-border-dark after:pointer-events-none ${
                                                    showActionsDivider ? 'after:opacity-100' : 'after:opacity-0'
                                                }`}
                                            >
                                                <div className="flex items-center justify-center gap-1">
                                                    {canCheckProxies && (
                                                        <button
                                                            onClick={() => handleCheckProxy(proxy)}
                                                            disabled={proxyChecks[proxy.id]?.status === 'checking'}
                                                            className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-gray-100 dark:hover:bg-background-dark rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                            title={t('Check Proxy')}
                                                        >
                                                            <Icon name="network_check" size={18} />
                                                        </button>
                                                    )}
                                                    {canUpdateProxies && (
                                                        <button
                                                            onClick={() => setEditingProxy(proxy)}
                                                            className="p-2 text-gray-400 hover:text-primary hover:bg-gray-100 dark:hover:bg-background-dark rounded-lg transition-colors"
                                                            title={t('Edit')}
                                                        >
                                                            <Icon name="edit" size={18} />
                                                        </button>
                                                    )}
                                                    {canDeleteProxies && (
                                                        <button
                                                            onClick={() => handleDelete(proxy)}
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
                    {totalPages > 1 && (
                        <div className="px-6 py-4 border-t border-gray-200 dark:border-border-dark flex items-center justify-between">
                            <div className="text-sm text-slate-500 dark:text-text-secondary">
                                {t('Showing {{from}} to {{to}} of {{total}} proxies', {
                                    from: (currentPage - 1) * PAGE_SIZE + 1,
                                    to: Math.min(currentPage * PAGE_SIZE, proxies.length),
                                    total: proxies.length,
                                })}
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                    disabled={currentPage === 1}
                                    className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 dark:border-border-dark bg-white dark:bg-surface-dark text-slate-700 dark:text-white hover:bg-slate-50 dark:hover:bg-border-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    {t('Previous')}
                                </button>
                                <span className="text-sm text-slate-500 dark:text-text-secondary">
                                    {t('Page {{current}} of {{total}}', { current: currentPage, total: totalPages })}
                                </span>
                                <button
                                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                    disabled={currentPage === totalPages}
                                    className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 dark:border-border-dark bg-white dark:bg-surface-dark text-slate-700 dark:text-white hover:bg-slate-50 dark:hover:bg-border-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    {t('Next')}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {(createOpen || editingProxy) && (
                <ProxyModal
                    key={editingProxy ? editingProxy.id : 'new'}
                    title={editingProxy ? t('Edit Proxy') : t('New Proxy')}
                    initialData={editingProxy ? parseProxyUrl(editingProxy.proxy_url) : parseProxyUrl('')}
                    submitting={submitting}
                    onClose={() => {
                        setCreateOpen(false);
                        setEditingProxy(null);
                    }}
                    onSubmit={handleSave}
                />
            )}

            {bulkOpen && (
                <BulkAddModal
                    submitting={bulkSubmitting}
                    onClose={() => setBulkOpen(false)}
                    onSubmit={handleBatchCreate}
                />
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
        </AdminDashboardLayout>
    );
}
