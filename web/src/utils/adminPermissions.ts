import { useCallback, useMemo } from 'react';
import { USER_KEY_ADMIN } from '../api/config';

export function buildAdminPermissionKey(method: string, path: string): string {
    return `${method.toUpperCase()} ${path}`;
}

function getStoredAdminState(): { permissions: string[]; isSuperAdmin: boolean } {
    const raw = localStorage.getItem(USER_KEY_ADMIN);
    if (!raw) {
        return { permissions: [], isSuperAdmin: false };
    }
    try {
        const data = JSON.parse(raw) as {
            permissions?: unknown;
            is_super_admin?: unknown;
            isSuperAdmin?: unknown;
        };
        const permissions = Array.isArray(data.permissions)
            ? data.permissions.filter((item): item is string => typeof item === 'string')
            : [];
        const isSuperAdmin = Boolean(data.is_super_admin ?? data.isSuperAdmin);
        return { permissions, isSuperAdmin };
    } catch {
        return { permissions: [], isSuperAdmin: false };
    }
}

export function getStoredAdminPermissions(): string[] {
    const { permissions } = getStoredAdminState();
    return permissions;
}

export function useAdminPermissions() {
    const { permissions, isSuperAdmin } = useMemo(() => getStoredAdminState(), []);
    const permissionSet = useMemo(() => new Set(permissions), [permissions]);

    const hasPermission = useCallback(
        (key: string): boolean => isSuperAdmin || permissionSet.has(key),
        [isSuperAdmin, permissionSet]
    );

    const hasAnyPermission = useCallback(
        (keys: string[]): boolean => isSuperAdmin || keys.some((key) => permissionSet.has(key)),
        [isSuperAdmin, permissionSet]
    );

    return {
        permissions,
        isSuperAdmin,
        hasPermission,
        hasAnyPermission,
    };
}
