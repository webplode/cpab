import { useCallback, useEffect, useRef, useState, type UIEvent as ReactUIEvent } from 'react';

export function useStickyActionsDivider(trigger1?: unknown, trigger2?: unknown) {
    const tableScrollRef = useRef<HTMLDivElement>(null);
    const [showActionsDivider, setShowActionsDivider] = useState(true);

    const updateActionsDivider = useCallback((container?: HTMLDivElement | null) => {
        const target = container ?? tableScrollRef.current;
        if (!target) {
            return;
        }
        const remainingToRight = target.scrollWidth - target.clientWidth - target.scrollLeft;
        setShowActionsDivider(remainingToRight > 0.5);
    }, []);

    const handleTableScroll = useCallback(
        (event: ReactUIEvent<HTMLDivElement>) => {
            updateActionsDivider(event.currentTarget);
        },
        [updateActionsDivider]
    );

    useEffect(() => {
        const frame = window.requestAnimationFrame(() => updateActionsDivider());
        const handleResize = () => updateActionsDivider();
        window.addEventListener('resize', handleResize);
        return () => {
            window.cancelAnimationFrame(frame);
            window.removeEventListener('resize', handleResize);
        };
    }, [updateActionsDivider, trigger1, trigger2]);

    return {
        tableScrollRef,
        handleTableScroll,
        showActionsDivider,
    };
}
