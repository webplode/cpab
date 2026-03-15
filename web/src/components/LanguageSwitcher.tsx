import type { RefObject } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';

type LanguageVariant = 'light' | 'dark';
type LanguageSize = 'sm' | 'md';
type LanguageMenuDirection = 'down' | 'up';
type LanguageMenuAlign = 'right' | 'left';

interface LanguageSwitcherProps {
    className?: string;
    variant?: LanguageVariant;
    size?: LanguageSize;
    menuDirection?: LanguageMenuDirection;
    menuAlign?: LanguageMenuAlign;
}

const languageOptions = [
    { code: 'en', label: 'English', titleKey: 'English' },
    { code: 'zh-CN', label: '简体中文', titleKey: 'Simplified Chinese' },
];

interface LanguageDropdownOption {
    code: string;
    label: string;
    title: string;
}

interface LanguageDropdownMenuProps {
    options: LanguageDropdownOption[];
    activeCode: string;
    menuWidth: number;
    variant: LanguageVariant;
    direction: LanguageMenuDirection;
    align: LanguageMenuAlign;
    anchorRef: RefObject<HTMLButtonElement | null>;
    ariaLabel: string;
    onSelect: (code: string) => void;
    onClose: () => void;
}

function LanguageDropdownMenu({
    options,
    activeCode,
    menuWidth,
    variant,
    direction,
    align,
    anchorRef,
    ariaLabel,
    onSelect,
    onClose,
}: LanguageDropdownMenuProps) {
    const [position, setPosition] = useState<{
        top?: number;
        bottom?: number;
        left: number;
        width: number;
    }>({ top: 0, bottom: undefined, left: 0, width: 0 });
    const isDark = variant === 'dark';

    useEffect(() => {
        const update = () => {
            const btn = anchorRef.current;
            if (!btn) return;
            const rect = btn.getBoundingClientRect();
            const width = Math.max(menuWidth, rect.width);
            const left = align === 'left' ? rect.left : rect.right - width;
            if (direction === 'up') {
                const bottom = window.innerHeight - rect.top + 4;
                setPosition({
                    top: undefined,
                    bottom,
                    left,
                    width,
                });
                return;
            }
            setPosition({
                top: rect.bottom + 4,
                bottom: undefined,
                left,
                width,
            });
        };

        update();
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => {
            window.removeEventListener('resize', update);
            window.removeEventListener('scroll', update, true);
        };
    }, [anchorRef, menuWidth, direction, align]);

    const menuClass = isDark
        ? 'bg-slate-900/95 border-white/10'
        : 'bg-white dark:bg-surface-dark border-gray-200 dark:border-border-dark';
    const itemBaseClass = isDark
        ? 'text-slate-200 hover:bg-white/10'
        : 'text-slate-900 dark:text-white hover:bg-gray-100 dark:hover:bg-background-dark';
    const itemActiveClass = isDark
        ? 'bg-white/10 text-white'
        : 'bg-gray-100 dark:bg-background-dark text-primary font-medium';

    return createPortal(
        <>
            <div className="fixed inset-0 z-[80]" onClick={onClose} />
            <div
                className={`fixed z-[90] ${menuClass} border rounded-lg shadow-lg overflow-hidden`}
                style={{
                    top: position.top,
                    bottom: position.bottom,
                    left: position.left,
                    width: position.width,
                }}
                role="listbox"
                aria-label={ariaLabel}
            >
                {options.map((opt) => {
                    const isActive = activeCode === opt.code;
                    return (
                        <button
                            key={opt.code}
                            type="button"
                            onClick={() => onSelect(opt.code)}
                            className={`w-full text-center px-4 py-2.5 text-sm transition-colors ${itemBaseClass} ${
                                isActive ? itemActiveClass : ''
                            }`}
                            aria-selected={isActive}
                            title={opt.title}
                            role="option"
                        >
                            {opt.label}
                        </button>
                    );
                })}
            </div>
        </>,
        document.body
    );
}

export function LanguageSwitcher({
    className = '',
    variant = 'light',
    size = 'sm',
    menuDirection = 'down',
    menuAlign = 'right',
}: LanguageSwitcherProps) {
    const { i18n, t } = useTranslation();
    const anchorRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    const menuWidth = useMemo(() => {
        if (typeof document === 'undefined') {
            return 0;
        }
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return 0;
        ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
        let maxWidth = 0;
        for (const opt of languageOptions) {
            const width = ctx.measureText(opt.label).width;
            if (width > maxWidth) maxWidth = width;
        }
        const horizontalPadding = 32;
        const extraBuffer = 12;
        return Math.ceil(maxWidth) + horizontalPadding + extraBuffer;
    }, []);
    const isDark = variant === 'dark';
    const isSmall = size === 'sm';
    const iconSize = isSmall ? 16 : 18;

    const sizeClass = 'h-9 w-9';
    const buttonClass = isDark
        ? 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white'
        : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900 dark:border-border-dark dark:bg-background-dark/50 dark:text-text-secondary dark:hover:text-white dark:hover:bg-surface-dark';

    const activeCode = i18n.language === 'zh-CN' ? 'zh-CN' : 'en';
    const translatedOptions = languageOptions.map((opt) => ({
        code: opt.code,
        label: opt.label,
        title: opt.label,
    }));

    useEffect(() => {
        if (!open) return;
        const handleKeydown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpen(false);
            }
        };
        window.addEventListener('keydown', handleKeydown);
        return () => window.removeEventListener('keydown', handleKeydown);
    }, [open]);

    return (
        <>
            <button
                ref={anchorRef}
                type="button"
                onClick={() => setOpen((prev) => !prev)}
                className={`inline-flex items-center justify-center rounded-lg border font-medium transition-colors ${sizeClass} ${buttonClass} ${className}`}
                aria-label={t('Language')}
                aria-haspopup="listbox"
                aria-expanded={open}
                title={t('Language')}
            >
                <Icon name="language" size={iconSize} />
            </button>
            {open ? (
                <LanguageDropdownMenu
                    options={translatedOptions}
                    activeCode={activeCode}
                    menuWidth={menuWidth}
                    variant={variant}
                    direction={menuDirection}
                    align={menuAlign}
                    anchorRef={anchorRef}
                    ariaLabel={t('Language')}
                    onSelect={(code) => {
                        i18n.changeLanguage(code);
                        setOpen(false);
                    }}
                    onClose={() => setOpen(false)}
                />
            ) : null}
        </>
    );
}
