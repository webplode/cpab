import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../Icon';

export interface MultiGroupDropdownOption {
    id: number;
    name: string;
}

export interface MultiGroupDropdownMenuProps {
    anchorId: string;
    groups: MultiGroupDropdownOption[];
    selectedIds: number[];
    search: string;
    emptyLabel: string;
    menuWidth?: number;
    onSearchChange: (value: string) => void;
    onToggle: (value: number) => void;
    onClear: () => void;
    onClose: () => void;
}

export function MultiGroupDropdownMenu({
    anchorId,
    groups,
    selectedIds,
    search,
    emptyLabel,
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
                        <span className="truncate">{emptyLabel}</span>
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

