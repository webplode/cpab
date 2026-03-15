export const API_BASE_URL =
    typeof window === 'undefined'
        ? ''
        : import.meta.env.DEV
            ? 'http://127.0.0.1:8318'
            : window.location.origin;

export const TOKEN_KEY_FRONT = 'front_token';
export const TOKEN_KEY_ADMIN = 'admin_token';
export const USER_KEY_FRONT = 'front_user';
export const USER_KEY_ADMIN = 'admin_user';

export async function apiFetchFront<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;

    const isFormData = options.body instanceof FormData;
    const headers: HeadersInit = {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers,
    };

    const token = localStorage.getItem(TOKEN_KEY_FRONT);
    if (token) {
        (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
        ...options,
        headers,
    });

    if (response.status === 401) {
        localStorage.removeItem(TOKEN_KEY_FRONT);
        localStorage.removeItem(USER_KEY_FRONT);
        window.location.href = '/login';
        throw new Error('Unauthorized');
    }

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed with status ${response.status}`);
    }

    if (response.status === 204 || response.headers.get('content-length') === '0') {
        return {} as T;
    }

    return response.json();
}

export async function apiFetchAdmin<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;

    const isFormData = options.body instanceof FormData;
    const headers: HeadersInit = {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers,
    };

    const token = localStorage.getItem(TOKEN_KEY_ADMIN);
    if (token) {
        (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
        ...options,
        headers,
    });

    if (response.status === 401) {
        localStorage.removeItem(TOKEN_KEY_ADMIN);
        localStorage.removeItem(USER_KEY_ADMIN);
        window.location.href = '/admin/login';
        throw new Error('Unauthorized');
    }

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed with status ${response.status}`);
    }

    if (response.status === 204 || response.headers.get('content-length') === '0') {
        return {} as T;
    }

    return response.json();
}

export const apiFetch = apiFetchFront;
