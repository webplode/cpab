import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AdminDashboardLayout } from '../../components/admin/AdminDashboardLayout';
import { AdminNoAccessCard } from '../../components/admin/AdminNoAccessCard';
import { apiFetchAdmin } from '../../api/config';
import { Icon } from '../../components/Icon';
import { buildAdminPermissionKey, useAdminPermissions } from '../../utils/adminPermissions';
import { useStickyActionsDivider } from '../../utils/stickyActionsDivider';
import { useTranslation } from 'react-i18next';

interface PrepaidCard {
    id: number;
    name: string;
    card_sn: string;
    password: string;
    amount: number;
    balance: number;
    user_group_id: number | null;
    valid_days: number;
    expires_at: string | null;
    created_at: string;
    redeemed_at: string | null;
    is_enabled: boolean;
    redeemed_user_id: number | null;
    redeemed_user?: {
        id: number;
        username: string;
    };
}

interface ListResponse {
    prepaid_cards: PrepaidCard[];
}

interface PrepaidCardFormData {
    name: string;
    card_sn: string;
    password: string;
    amount: string;
    user_group_id: string;
    valid_days: string;
    is_enabled: boolean;
}

interface PrepaidCardModalProps {
    title: string;
    initialData: PrepaidCardFormData;
    userGroups: UserGroup[];
    submitting: boolean;
    onClose: () => void;
    onSubmit: (payload: Record<string, unknown>) => void;
}

interface BatchFormData {
    name: string;
    amount: string;
    count: string;
    card_sn_prefix: string;
    password_length: string;
    user_group_id: string;
    valid_days: string;
}

const PAGE_SIZE = 10;

const inputClassName =
    'w-full px-4 py-2.5 text-sm bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-lg text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent';

const STATUS_OPTIONS = [
    { value: '', label: 'All Status' },
    { value: 'unused', label: 'Unused' },
    { value: 'redeemed', label: 'Redeemed' },
];

interface UserGroup {
    id: number;
    name: string;
}

interface UserGroupsResponse {
    user_groups: UserGroup[];
}

interface StatusDropdownMenuProps {
    status: string;
    menuWidth?: number;
    onSelect: (value: string) => void;
    onClose: () => void;
}

function StatusDropdownMenu({ status, menuWidth, onSelect, onClose }: StatusDropdownMenuProps) {
    const { t } = useTranslation();
    const btn = document.getElementById('prepaid-status-dropdown-btn');
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
                {STATUS_OPTIONS.map((opt) => (
                    <button
                        key={opt.value || 'all'}
                        type="button"
                        onClick={() => onSelect(opt.value)}
                        className={`w-full text-left px-4 py-2.5 text-sm truncate hover:bg-gray-100 dark:hover:bg-background-dark transition-colors ${
                            status === opt.value
                                ? 'bg-gray-100 dark:bg-background-dark text-primary font-medium'
                                : 'text-slate-900 dark:text-white'
                        }`}
                        title={t(opt.label)}
                    >
                        {t(opt.label)}
                    </button>
                ))}
            </div>
        </>,
        document.body
    );
}

interface SearchableDropdownMenuProps {
    anchorId: string;
    options: { id: number; name: string }[];
    selectedId: number | null;
    search: string;
    menuWidth?: number;
    onSearchChange: (value: string) => void;
    onSelect: (value: number) => void;
    onClose: () => void;
}

function SearchableDropdownMenu({
    anchorId,
    options,
    selectedId,
    search,
    menuWidth,
    onSearchChange,
    onSelect,
    onClose,
}: SearchableDropdownMenuProps) {
    const { t } = useTranslation();
    const btn = document.getElementById(anchorId);
    const rect = btn ? btn.getBoundingClientRect() : null;
    const position = rect
        ? { top: rect.bottom + 4, left: rect.left, width: rect.width }
        : { top: 0, left: 0, width: 0 };

    return createPortal(
        <>
            <div className="fixed inset-0 z-40" onClick={onClose} />
            <div
                className="fixed z-50 bg-white dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg shadow-lg overflow-hidden max-h-72"
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
                <div className="max-h-56 overflow-y-auto">
                    {options.length === 0 ? (
                        <div className="px-4 py-3 text-sm text-slate-500 dark:text-text-secondary">
                            {t('No groups found')}
                        </div>
                    ) : (
                        options.map((opt) => (
                            <button
                                key={opt.id}
                                type="button"
                                onClick={() => onSelect(opt.id)}
                                className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-100 dark:hover:bg-background-dark transition-colors ${
                                    selectedId === opt.id
                                        ? 'bg-gray-100 dark:bg-background-dark text-primary font-medium'
                                        : 'text-slate-900 dark:text-white'
                                }`}
                            >
                                {opt.id === 0 ? (
                                    opt.name
                                ) : (
                                    <>
                                        <span className="font-mono text-xs text-slate-500 dark:text-text-secondary mr-2">
                                            #{opt.id}
                                        </span>
                                        {opt.name}
                                    </>
                                )}
                            </button>
                        ))
                    )}
                </div>
            </div>
        </>,
        document.body
    );
}

function PrepaidCardModal({ title, initialData, userGroups, submitting, onClose, onSubmit }: PrepaidCardModalProps) {
    const { t } = useTranslation();
    const [formData, setFormData] = useState<PrepaidCardFormData>(initialData);
    const [error, setError] = useState('');
    const [groupMenuOpen, setGroupMenuOpen] = useState(false);
    const [groupSearch, setGroupSearch] = useState('');
    const groupBtnWidth = useMemo(() => {
        const allOptions = [t('No Group'), ...userGroups.map((g) => `${g.name} #${g.id}`)];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return null;
        }
        ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
        let maxWidth = 0;
        for (const opt of allOptions) {
            const width = ctx.measureText(opt).width;
            if (width > maxWidth) maxWidth = width;
        }
        return Math.ceil(maxWidth) + 76;
    }, [userGroups, t]);

    const handleSubmit = () => {
        const name = formData.name.trim();
        const cardSN = formData.card_sn.trim();
        const password = formData.password.trim();
        const amount = Number(formData.amount);
        const validDays = Number(formData.valid_days || 0);

        if (!name) {
            setError(t('Name is required.'));
            return;
        }
        if (!cardSN) {
            setError(t('Card SN is required.'));
            return;
        }
        if (!password) {
            setError(t('Password is required.'));
            return;
        }
        if (!amount || amount <= 0) {
            setError(t('Amount must be positive.'));
            return;
        }
        if (Number.isNaN(validDays) || validDays < 0) {
            setError(t('Validity days cannot be negative.'));
            return;
        }

        setError('');
        onSubmit({
            name,
            card_sn: cardSN,
            password,
            amount,
            user_group_id: formData.user_group_id ? Number(formData.user_group_id) : 0,
            valid_days: validDays,
            is_enabled: formData.is_enabled,
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
                <div className="p-6 space-y-4 overflow-y-auto flex-1">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Name')}
                        </label>
                        <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            placeholder={t('Enter card name')}
                            className={inputClassName}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Card SN')}
                        </label>
                        <input
                            type="text"
                            value={formData.card_sn}
                            onChange={(e) => setFormData({ ...formData, card_sn: e.target.value })}
                            placeholder={t('Enter card serial number')}
                            className={inputClassName}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Password')}
                        </label>
                        <input
                            type="text"
                            value={formData.password}
                            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                            placeholder={t('Enter card password')}
                            className={inputClassName}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Amount')}
                        </label>
                        <input
                            type="number"
                            step="0.01"
                            value={formData.amount}
                            onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                            placeholder={t('Enter amount')}
                            className={inputClassName}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('User Group')}
                        </label>
                        <div className="relative">
                            <button
                                type="button"
                                id="prepaid-card-user-group-btn"
                                onClick={() => setGroupMenuOpen(!groupMenuOpen)}
                                className="flex items-center justify-between gap-2 w-full bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark text-slate-900 dark:text-white text-sm rounded-lg focus:ring-primary focus:border-primary px-4 py-2.5"
                                style={groupBtnWidth ? { minWidth: groupBtnWidth } : undefined}
                            >
                                <span className="truncate">
                                    {formData.user_group_id
                                        ? userGroups.find((g) => g.id === Number(formData.user_group_id))?.name ||
                                          `#${formData.user_group_id}`
                                        : t('No Group')}
                                </span>
                                <Icon name={groupMenuOpen ? 'expand_less' : 'expand_more'} size={18} />
                            </button>
                            {groupMenuOpen && (
                                <SearchableDropdownMenu
                                    anchorId="prepaid-card-user-group-btn"
                                    options={[
                                        { id: 0, name: t('No Group') },
                                        ...userGroups.filter((g) => {
                                            const query = groupSearch.trim().toLowerCase();
                                            if (!query) return true;
                                            return g.name.toLowerCase().includes(query) || g.id.toString().includes(query);
                                        }),
                                    ]}
                                    selectedId={formData.user_group_id ? Number(formData.user_group_id) : 0}
                                    search={groupSearch}
                                    menuWidth={groupBtnWidth ?? undefined}
                                    onSearchChange={setGroupSearch}
                                    onSelect={(value) => {
                                        setFormData((prev) => ({
                                            ...prev,
                                            user_group_id: value === 0 ? '' : value.toString(),
                                        }));
                                        setGroupMenuOpen(false);
                                    }}
                                    onClose={() => setGroupMenuOpen(false)}
                                />
                            )}
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Validity Days (0 = Never expires)')}
                        </label>
                        <input
                            type="number"
                            min="0"
                            step="1"
                            value={formData.valid_days}
                            onChange={(e) => setFormData({ ...formData, valid_days: e.target.value })}
                            placeholder={t('Enter validity days')}
                            className={inputClassName}
                        />
                    </div>
                    <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            {t('Enabled')}
                        </label>
                        <button
                            type="button"
                            onClick={() => setFormData({ ...formData, is_enabled: !formData.is_enabled })}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                formData.is_enabled ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
                            }`}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                    formData.is_enabled ? 'translate-x-6' : 'translate-x-1'
                                }`}
                            />
                        </button>
                    </div>
                    {error && (
                        <div className="text-sm text-red-600 dark:text-red-400">
                            {error}
                        </div>
                    )}
                </div>
                <div className="flex gap-3 px-6 py-4 border-t border-gray-200 dark:border-border-dark shrink-0">
                    <button
                        onClick={onClose}
                        className="flex-1 py-2.5 bg-gray-100 dark:bg-background-dark hover:bg-gray-200 dark:hover:bg-gray-700 text-slate-900 dark:text-white rounded-lg font-medium transition-colors border border-gray-200 dark:border-border-dark"
                    >
                        {t('Cancel')}
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={submitting}
                        className="flex-1 py-2.5 bg-primary hover:bg-blue-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {submitting ? t('Saving...') : t('Save')}
                    </button>
                </div>
            </div>
        </div>
    );
}

function BatchCreateModal({
    submitting,
    userGroups,
    onClose,
    onSubmit,
}: {
    submitting: boolean;
    userGroups: UserGroup[];
    onClose: () => void;
    onSubmit: (payload: Record<string, unknown>) => void;
}) {
    const { t } = useTranslation();
    const [formData, setFormData] = useState<BatchFormData>({
        name: '',
        amount: '',
        count: '10',
        card_sn_prefix: '',
        password_length: '10',
        user_group_id: '',
        valid_days: '',
    });
    const [error, setError] = useState('');
    const [groupMenuOpen, setGroupMenuOpen] = useState(false);
    const [groupSearch, setGroupSearch] = useState('');
    const groupBtnWidth = useMemo(() => {
        const allOptions = [t('No Group'), ...userGroups.map((g) => `${g.name} #${g.id}`)];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return null;
        }
        ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
        let maxWidth = 0;
        for (const opt of allOptions) {
            const width = ctx.measureText(opt).width;
            if (width > maxWidth) maxWidth = width;
        }
        return Math.ceil(maxWidth) + 76;
    }, [userGroups, t]);

    const handleSubmit = () => {
        const name = formData.name.trim();
        const amount = Number(formData.amount);
        const count = Number(formData.count);
        const passwordLength = Number(formData.password_length);
        const validDays = Number(formData.valid_days || 0);

        if (!name) {
            setError(t('Name is required.'));
            return;
        }
        if (!amount || amount <= 0) {
            setError(t('Amount must be positive.'));
            return;
        }
        if (!count || count <= 0) {
            setError(t('Count must be positive.'));
            return;
        }
        if (!passwordLength || passwordLength < 6) {
            setError(t('Password length must be at least 6.'));
            return;
        }
        if (Number.isNaN(validDays) || validDays < 0) {
            setError(t('Validity days cannot be negative.'));
            return;
        }

        setError('');
        onSubmit({
            name,
            amount,
            count,
            card_sn_prefix: formData.card_sn_prefix.trim(),
            password_length: passwordLength,
            user_group_id: formData.user_group_id ? Number(formData.user_group_id) : 0,
            valid_days: validDays,
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white dark:bg-surface-dark rounded-xl shadow-xl w-full max-w-2xl mx-4 border border-gray-200 dark:border-border-dark max-h-[90vh] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-border-dark shrink-0">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                        {t('Batch Create Prepaid Cards')}
                    </h2>
                    <button
                        onClick={onClose}
                        className="inline-flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
                    >
                        <Icon name="close" />
                    </button>
                </div>
                <div className="p-6 space-y-4 overflow-y-auto flex-1">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Name')}
                        </label>
                        <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            placeholder={t('Enter card name')}
                            className={inputClassName}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Amount')}
                        </label>
                        <input
                            type="number"
                            step="0.01"
                            value={formData.amount}
                            onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                            placeholder={t('Enter amount')}
                            className={inputClassName}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('User Group')}
                        </label>
                        <div className="relative">
                            <button
                                type="button"
                                id="batch-prepaid-user-group-btn"
                                onClick={() => setGroupMenuOpen(!groupMenuOpen)}
                                className="flex items-center justify-between gap-2 w-full bg-gray-50 dark:bg-background-dark border border-gray-200 dark:border-border-dark text-slate-900 dark:text-white text-sm rounded-lg focus:ring-primary focus:border-primary px-4 py-2.5"
                                style={groupBtnWidth ? { minWidth: groupBtnWidth } : undefined}
                            >
                                <span className="truncate">
                                    {formData.user_group_id
                                        ? userGroups.find((g) => g.id === Number(formData.user_group_id))?.name ||
                                          `#${formData.user_group_id}`
                                        : t('No Group')}
                                </span>
                                <Icon name={groupMenuOpen ? 'expand_less' : 'expand_more'} size={18} />
                            </button>
                            {groupMenuOpen && (
                                <SearchableDropdownMenu
                                    anchorId="batch-prepaid-user-group-btn"
                                    options={[
                                        { id: 0, name: t('No Group') },
                                        ...userGroups.filter((g) => {
                                            const query = groupSearch.trim().toLowerCase();
                                            if (!query) return true;
                                            return g.name.toLowerCase().includes(query) || g.id.toString().includes(query);
                                        }),
                                    ]}
                                    selectedId={formData.user_group_id ? Number(formData.user_group_id) : 0}
                                    search={groupSearch}
                                    menuWidth={groupBtnWidth ?? undefined}
                                    onSearchChange={setGroupSearch}
                                    onSelect={(value) => {
                                        setFormData((prev) => ({
                                            ...prev,
                                            user_group_id: value === 0 ? '' : value.toString(),
                                        }));
                                        setGroupMenuOpen(false);
                                    }}
                                    onClose={() => setGroupMenuOpen(false)}
                                />
                            )}
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Count')}
                        </label>
                        <input
                            type="number"
                            value={formData.count}
                            onChange={(e) => setFormData({ ...formData, count: e.target.value })}
                            placeholder={t('Enter count')}
                            className={inputClassName}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Card SN Prefix (optional)')}
                        </label>
                        <input
                            type="text"
                            value={formData.card_sn_prefix}
                            onChange={(e) => setFormData({ ...formData, card_sn_prefix: e.target.value })}
                            placeholder={t('Enter prefix')}
                            className={inputClassName}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Password Length')}
                        </label>
                        <input
                            type="number"
                            value={formData.password_length}
                            onChange={(e) => setFormData({ ...formData, password_length: e.target.value })}
                            placeholder={t('Enter password length')}
                            className={inputClassName}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            {t('Validity Days (0 = Never expires)')}
                        </label>
                        <input
                            type="number"
                            min="0"
                            step="1"
                            value={formData.valid_days}
                            onChange={(e) => setFormData({ ...formData, valid_days: e.target.value })}
                            placeholder={t('Enter validity days')}
                            className={inputClassName}
                        />
                    </div>
                    {error && (
                        <div className="text-sm text-red-600 dark:text-red-400">
                            {error}
                        </div>
                    )}
                </div>
                <div className="flex gap-3 px-6 py-4 border-t border-gray-200 dark:border-border-dark shrink-0">
                    <button
                        onClick={onClose}
                        className="flex-1 py-2.5 bg-gray-100 dark:bg-background-dark hover:bg-gray-200 dark:hover:bg-gray-700 text-slate-900 dark:text-white rounded-lg font-medium transition-colors border border-gray-200 dark:border-border-dark"
                    >
                        {t('Close')}
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={submitting}
                        className="flex-1 py-2.5 bg-primary hover:bg-blue-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {submitting ? t('Creating...') : t('Create')}
                    </button>
                </div>
            </div>
        </div>
    );
}

function BatchResultModal({
    cards,
    onClose,
    onCopy,
}: {
    cards: PrepaidCard[];
    onClose: () => void;
    onCopy: () => void;
}) {
    const { t } = useTranslation();
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white dark:bg-surface-dark rounded-xl shadow-xl w-full max-w-2xl mx-4 border border-gray-200 dark:border-border-dark max-h-[90vh] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-border-dark shrink-0">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                        {t('Prepaid Cards Created')}
                    </h2>
                    <button
                        onClick={onClose}
                        className="inline-flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
                    >
                        <Icon name="close" />
                    </button>
                </div>
                <div className="p-6 space-y-4 overflow-y-auto flex-1">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                            {t('Copy card_sn,password,amount')}
                        </span>
                        <button
                            onClick={onCopy}
                            className="text-sm font-medium text-primary hover:text-blue-600"
                        >
                            {t('Copy')}
                        </button>
                    </div>
                    <div className="border border-gray-200 dark:border-border-dark rounded-lg overflow-hidden">
                        <div className="max-h-80 overflow-y-auto">
                            {cards.map((card) => (
                                <div
                                    key={card.id}
                                    className="px-4 py-2 text-xs font-mono text-slate-600 dark:text-text-secondary border-b border-gray-200 dark:border-border-dark last:border-b-0"
                                >
                                    {card.card_sn},{card.password},{card.amount}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
                <div className="flex gap-3 px-6 py-4 border-t border-gray-200 dark:border-border-dark shrink-0">
                    <button
                        onClick={onClose}
                        className="flex-1 py-2.5 bg-gray-100 dark:bg-background-dark hover:bg-gray-200 dark:hover:bg-gray-700 text-slate-900 dark:text-white rounded-lg font-medium transition-colors border border-gray-200 dark:border-border-dark"
                    >
                        {t('Close')}
                    </button>
                </div>
            </div>
        </div>
    );
}

function buildFormData(card?: PrepaidCard): PrepaidCardFormData {
    if (!card) {
        return {
            name: '',
            card_sn: '',
            password: '',
            amount: '',
            user_group_id: '',
            valid_days: '',
            is_enabled: true,
        };
    }
    return {
        name: card.name,
        card_sn: card.card_sn,
        password: card.password,
        amount: card.amount.toString(),
        user_group_id: card.user_group_id ? card.user_group_id.toString() : '',
        valid_days: card.valid_days ? card.valid_days.toString() : '',
        is_enabled: card.is_enabled,
    };
}

export function AdminPrepaidCards() {
    const { t, i18n } = useTranslation();
    const { hasPermission } = useAdminPermissions();
    const canListCards = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/prepaid-cards'));
    const canCreateCard = hasPermission(buildAdminPermissionKey('POST', '/v0/admin/prepaid-cards'));
    const canBatchCreate = hasPermission(buildAdminPermissionKey('POST', '/v0/admin/prepaid-cards/batch'));
    const canUpdateCard = hasPermission(buildAdminPermissionKey('PUT', '/v0/admin/prepaid-cards/:id'));
    const canDeleteCard = hasPermission(buildAdminPermissionKey('DELETE', '/v0/admin/prepaid-cards/:id'));
    const canListUserGroups = hasPermission(buildAdminPermissionKey('GET', '/v0/admin/user-groups'));

    const [cards, setCards] = useState<PrepaidCard[]>([]);
    const [loading, setLoading] = useState(true);
    const [userGroups, setUserGroups] = useState<UserGroup[]>([]);
    const [currentPage, setCurrentPage] = useState(1);
    const [createOpen, setCreateOpen] = useState(false);
    const [editCard, setEditCard] = useState<PrepaidCard | null>(null);
    const [batchOpen, setBatchOpen] = useState(false);
    const [batchResultOpen, setBatchResultOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [batchSubmitting, setBatchSubmitting] = useState(false);
    const [batchResult, setBatchResult] = useState<PrepaidCard[]>([]);
    const [toast, setToast] = useState<{ show: boolean; message: string }>({ show: false, message: '' });
    const [searchInput, setSearchInput] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [statusMenuOpen, setStatusMenuOpen] = useState(false);
    const [statusBtnWidth, setStatusBtnWidth] = useState<number | undefined>(undefined);
    const locale = i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US';

    const showToast = useCallback((message: string) => {
        setToast({ show: true, message });
        setTimeout(() => {
            setToast({ show: false, message: '' });
        }, 6000);
    }, []);

    const fetchCards = useCallback(() => {
        if (!canListCards) {
            return;
        }
        setLoading(true);
        const params = new URLSearchParams();
        if (searchQuery.trim()) {
            params.set('redeemed_user', searchQuery.trim());
        }
        if (statusFilter === 'redeemed') {
            params.set('redeemed', 'true');
        } else if (statusFilter === 'unused') {
            params.set('redeemed', 'false');
        }
        const url = params.toString() ? `/v0/admin/prepaid-cards?${params.toString()}` : '/v0/admin/prepaid-cards';
        apiFetchAdmin<ListResponse>(url)
            .then((res) => setCards(res.prepaid_cards || []))
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [searchQuery, statusFilter, canListCards]);

    useEffect(() => {
        if (canListCards) {
            fetchCards();
        }
    }, [fetchCards, canListCards]);

    useEffect(() => {
        if (!canListUserGroups) {
            return;
        }
        apiFetchAdmin<UserGroupsResponse>('/v0/admin/user-groups')
            .then((res) => setUserGroups(res.user_groups || []))
            .catch(console.error);
    }, [canListUserGroups]);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (searchInput !== searchQuery) {
                setSearchQuery(searchInput);
                setCurrentPage(1);
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [searchInput, searchQuery]);

    useEffect(() => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
            let maxWidth = 0;
            for (const opt of STATUS_OPTIONS) {
                const width = ctx.measureText(t(opt.label)).width;
                if (width > maxWidth) maxWidth = width;
            }
            setStatusBtnWidth(Math.ceil(maxWidth) + 64);
        }
    }, [t]);

    const totalPages = Math.ceil(cards.length / PAGE_SIZE);
    const paginatedCards = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return cards.slice(start, start + PAGE_SIZE);
    }, [cards, currentPage]);

    const { tableScrollRef, handleTableScroll, showActionsDivider } = useStickyActionsDivider(
        paginatedCards.length,
        loading
    );

    const handleCreate = async (payload: Record<string, unknown>) => {
        if (!canCreateCard) {
            return;
        }
        setSubmitting(true);
        try {
            await apiFetchAdmin('/v0/admin/prepaid-cards', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            setCreateOpen(false);
            fetchCards();
        } catch (err) {
            console.error(err);
        } finally {
            setSubmitting(false);
        }
    };

    const handleUpdate = async (payload: Record<string, unknown>) => {
        if (!editCard || !canUpdateCard) return;
        setSubmitting(true);
        try {
            await apiFetchAdmin(`/v0/admin/prepaid-cards/${editCard.id}`, {
                method: 'PUT',
                body: JSON.stringify(payload),
            });
            fetchCards();
            setEditCard(null);
        } catch (err) {
            console.error(err);
        } finally {
            setSubmitting(false);
        }
    };

    const handleBatchCreate = async (payload: Record<string, unknown>) => {
        if (!canBatchCreate) {
            return;
        }
        setBatchSubmitting(true);
        try {
            const res = await apiFetchAdmin<ListResponse>('/v0/admin/prepaid-cards/batch', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            setBatchResult(res.prepaid_cards || []);
            setBatchOpen(false);
            setBatchResultOpen(true);
            fetchCards();
        } catch (err) {
            console.error(err);
        } finally {
            setBatchSubmitting(false);
        }
    };

    const handleCopyBatch = async () => {
        if (batchResult.length === 0) return;
        const lines = batchResult.map((card) => `${card.card_sn},${card.password},${card.amount}`);
        await navigator.clipboard.writeText(lines.join('\n'));
        showToast(t('Copied to clipboard'));
    };

    const handleDelete = async (card: PrepaidCard) => {
        if (!canDeleteCard) {
            return;
        }
        if (!confirm(t('Are you sure you want to delete prepaid card #{{id}}?', { id: card.id }))) {
            return;
        }
        try {
            await apiFetchAdmin(`/v0/admin/prepaid-cards/${card.id}`, { method: 'DELETE' });
            fetchCards();
        } catch (err) {
            console.error(err);
        }
    };

    const handleToggleEnabled = async (card: PrepaidCard) => {
        if (!canUpdateCard) {
            return;
        }
        try {
            await apiFetchAdmin(`/v0/admin/prepaid-cards/${card.id}`, {
                method: 'PUT',
                body: JSON.stringify({ is_enabled: !card.is_enabled }),
            });
            setCards((prev) =>
                prev.map((item) =>
                    item.id === card.id
                        ? { ...item, is_enabled: !card.is_enabled }
                        : item
                )
            );
        } catch (err) {
            console.error(err);
        }
    };

    if (!canListCards) {
        return (
            <AdminDashboardLayout title={t('Prepaid Cards')} subtitle={t('Manage prepaid cards for top-ups')}>
                <AdminNoAccessCard />
            </AdminDashboardLayout>
        );
    }

    return (
        <AdminDashboardLayout title={t('Prepaid Cards')} subtitle={t('Manage prepaid cards for top-ups')}>
            <div className="space-y-6">
                {(canBatchCreate || canCreateCard) && (
                    <div className="flex justify-end gap-2">
                        {canBatchCreate && (
                            <button
                                onClick={() => {
                                    setBatchResult([]);
                                    setBatchOpen(true);
                                }}
                                className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-background-dark text-slate-900 dark:text-white rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-medium border border-gray-200 dark:border-border-dark"
                            >
                                <Icon name="library_add" size={18} />
                                {t('Batch Create')}
                            </button>
                        )}
                        {canCreateCard && (
                            <button
                                onClick={() => setCreateOpen(true)}
                                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
                            >
                                <Icon name="add" size={18} />
                                {t('New Card')}
                            </button>
                        )}
                    </div>
                )}

                <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-white dark:bg-surface-dark p-3 rounded-xl border border-gray-200 dark:border-border-dark shadow-sm">
                    <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
                        <div className="relative w-full md:w-72">
                            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                                <Icon name="search" className="text-gray-400" />
                            </div>
                            <input
                                className="block w-full p-2.5 pl-10 text-sm text-slate-900 dark:text-white bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark rounded-lg focus:ring-primary focus:border-primary placeholder-gray-400 dark:placeholder-gray-500"
                                placeholder={t('Search by redeemed username...')}
                                type="text"
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                            />
                        </div>
                        <div className="relative">
                            <button
                                type="button"
                                id="prepaid-status-dropdown-btn"
                                onClick={() => setStatusMenuOpen(!statusMenuOpen)}
                                className="flex items-center justify-between gap-2 bg-gray-50 dark:bg-background-dark border border-gray-300 dark:border-border-dark text-slate-900 dark:text-white text-sm rounded-lg focus:ring-primary focus:border-primary p-2.5 whitespace-nowrap"
                                style={statusBtnWidth ? { width: statusBtnWidth } : undefined}
                            >
                                <span>
                                    {t(
                                        STATUS_OPTIONS.find((opt) => opt.value === statusFilter)?.label ||
                                            'All Status'
                                    )}
                                </span>
                                <Icon name={statusMenuOpen ? 'expand_less' : 'expand_more'} size={18} />
                            </button>
                            {statusMenuOpen && (
                                <StatusDropdownMenu
                                    status={statusFilter}
                                    menuWidth={statusBtnWidth}
                                    onSelect={(value) => {
                                        setStatusFilter(value);
                                        setCurrentPage(1);
                                        setStatusMenuOpen(false);
                                    }}
                                    onClose={() => setStatusMenuOpen(false)}
                                />
                            )}
                        </div>
                    </div>
                    <button
                        onClick={fetchCards}
                        className="h-10 w-10 inline-flex items-center justify-center rounded-lg border border-gray-200 dark:border-border-dark text-slate-500 hover:text-primary hover:bg-slate-50 dark:hover:bg-background-dark transition-colors"
                        title={t('Refresh')}
                    >
                        <Icon name="refresh" size={18} />
                    </button>
                </div>

                <div className="bg-white dark:bg-surface-dark rounded-xl border border-gray-200 dark:border-border-dark shadow-sm overflow-hidden">
                <div ref={tableScrollRef} className="overflow-x-auto" onScroll={handleTableScroll}>
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 dark:bg-surface-dark text-gray-500 dark:text-gray-400 uppercase text-xs font-semibold border-b border-gray-200 dark:border-border-dark">
                            <tr>
                                <th className="px-6 py-4">{t('ID')}</th>
                                <th className="px-6 py-4">{t('Name')}</th>
                                <th className="px-6 py-4">{t('Card SN')}</th>
                                <th className="px-6 py-4">{t('Password')}</th>
                                <th className="px-6 py-4">{t('Amount')}</th>
                                <th className="px-6 py-4">{t('Balance')}</th>
                                <th className="px-6 py-4">{t('User Group')}</th>
                                <th className="px-6 py-4">{t('Valid Days')}</th>
                                <th className="px-6 py-4">{t('Valid Until')}</th>
                                <th className="px-6 py-4">{t('Enabled')}</th>
                                <th className="px-6 py-4">{t('Redeemed')}</th>
                                <th className="px-6 py-4">{t('Redeemed By')}</th>
                                <th className="px-6 py-4">{t('Created At')}</th>
                                <th
                                    className={`px-6 py-4 text-center sticky right-0 z-20 bg-gray-50 dark:bg-surface-dark relative after:content-[''] after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-gray-200 dark:after:bg-border-dark after:pointer-events-none ${
                                        showActionsDivider ? 'after:opacity-100' : 'after:opacity-0'
                                    }`}
                                >
                                    {t('Actions')}
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-border-dark">
                            {loading ? (
                                [...Array(5)].map((_, i) => (
                                    <tr key={i}>
                                        <td colSpan={14} className="px-6 py-4">
                                            <div className="animate-pulse h-4 bg-slate-200 dark:bg-border-dark rounded"></div>
                                        </td>
                                    </tr>
                                ))
                            ) : paginatedCards.length === 0 ? (
                                <tr>
                                    <td colSpan={14} className="px-6 py-8 text-center text-slate-500 dark:text-text-secondary">
                                        {t('No prepaid cards found')}
                                    </td>
                                </tr>
                            ) : (
                                paginatedCards.map((card) => (
                                    <tr
                                        key={card.id}
                                        className="hover:bg-gray-50 dark:hover:bg-background-dark group"
                                    >
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-700 dark:text-white font-medium">
                                            {card.id}
                                        </td>
                                        <td className="px-6 py-4 text-slate-600 dark:text-text-secondary">
                                            {card.name}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary font-mono text-xs">
                                            {card.card_sn}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary font-mono text-xs">
                                            {card.password}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary font-mono">
                                            ${card.amount.toFixed(2)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary font-mono">
                                            ${card.balance.toFixed(2)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary">
                                            {card.user_group_id
                                                ? userGroups.find((g) => g.id === card.user_group_id)?.name || `#${card.user_group_id}`
                                                : t('No Group')}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary">
                                            {card.valid_days > 0 ? card.valid_days : t('Never')}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary">
                                            {card.valid_days === 0
                                                ? t('Never')
                                                : card.redeemed_at
                                                    ? card.expires_at
                                                        ? new Date(card.expires_at).toLocaleDateString(locale)
                                                        : '-'
                                                    : '-'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                                                card.is_enabled
                                                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20'
                                                    : 'bg-gray-100 text-gray-800 dark:bg-gray-500/10 dark:text-gray-400 border-gray-200 dark:border-gray-500/20'
                                            }`}>
                                                {card.is_enabled ? t('Yes') : t('No')}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                                                card.redeemed_at
                                                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20'
                                                    : 'bg-gray-100 text-gray-800 dark:bg-gray-500/10 dark:text-gray-400 border-gray-200 dark:border-gray-500/20'
                                            }`}>
                                                {card.redeemed_at ? t('Redeemed') : t('Unused')}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary">
                                            {card.redeemed_user?.username || '-'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-slate-600 dark:text-text-secondary font-mono text-xs">
                                            {new Date(card.created_at).toLocaleDateString(locale)}
                                        </td>
                                        <td
                                            className={`px-6 py-4 whitespace-nowrap text-center sticky right-0 z-10 bg-white dark:bg-surface-dark group-hover:bg-gray-50 dark:group-hover:bg-background-dark relative after:content-[''] after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-gray-200 dark:after:bg-border-dark after:pointer-events-none ${
                                                showActionsDivider ? 'after:opacity-100' : 'after:opacity-0'
                                            }`}
                                        >
                                            <div className="flex items-center justify-center gap-1">
                                                    {canUpdateCard && (
                                                        <button
                                                            onClick={() => setEditCard(card)}
                                                            className="p-2 text-gray-400 hover:text-primary hover:bg-gray-100 dark:hover:bg-background-dark rounded-lg transition-colors"
                                                            title={t('Edit')}
                                                        >
                                                            <Icon name="edit" size={18} />
                                                        </button>
                                                    )}
                                                    {canUpdateCard && (
                                                        <button
                                                            onClick={() => handleToggleEnabled(card)}
                                                            className={`p-2 rounded-lg transition-colors ${
                                                                card.is_enabled
                                                                    ? 'text-gray-400 hover:text-amber-500 hover:bg-gray-100 dark:hover:bg-background-dark'
                                                                    : 'text-gray-400 hover:text-emerald-500 hover:bg-gray-100 dark:hover:bg-background-dark'
                                                            }`}
                                                            title={card.is_enabled ? t('Disable') : t('Enable')}
                                                        >
                                                            <Icon
                                                                name={card.is_enabled ? 'toggle_off' : 'toggle_on'}
                                                                size={18}
                                                            />
                                                        </button>
                                                    )}
                                                    {canDeleteCard && (
                                                        <button
                                                            onClick={() => handleDelete(card)}
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
                            {t('Showing {{from}} to {{to}} of {{total}} cards', {
                                from: (currentPage - 1) * PAGE_SIZE + 1,
                                to: Math.min(currentPage * PAGE_SIZE, cards.length),
                                total: cards.length,
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
                            <span className="text-sm text-slate-600 dark:text-text-secondary">
                                {t('Page {{current}} of {{total}}', {
                                    current: currentPage,
                                    total: totalPages,
                                })}
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

            {createOpen && (
                <PrepaidCardModal
                    title={t('New Prepaid Card')}
                    initialData={buildFormData()}
                    userGroups={userGroups}
                    submitting={submitting}
                    onClose={() => setCreateOpen(false)}
                    onSubmit={handleCreate}
                />
            )}
            {editCard && (
                <PrepaidCardModal
                    title={t('Edit Prepaid Card #{{id}}', { id: editCard.id })}
                    initialData={buildFormData(editCard)}
                    userGroups={userGroups}
                    submitting={submitting}
                    onClose={() => setEditCard(null)}
                    onSubmit={handleUpdate}
                />
            )}
            {batchOpen && (
                <BatchCreateModal
                    submitting={batchSubmitting}
                    userGroups={userGroups}
                    onClose={() => setBatchOpen(false)}
                    onSubmit={handleBatchCreate}
                />
            )}
            {batchResultOpen && (
                <BatchResultModal
                    cards={batchResult}
                    onClose={() => setBatchResultOpen(false)}
                    onCopy={handleCopyBatch}
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
