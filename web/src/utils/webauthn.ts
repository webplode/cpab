function bufferToBase64Url(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBuffer(value: string): ArrayBuffer {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padding = base64.length % 4 ? '='.repeat(4 - (base64.length % 4)) : '';
    const binary = atob(base64 + padding);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

type CredentialDescriptorWithId = Omit<PublicKeyCredentialDescriptor, 'id'> & {
    id: string | ArrayBuffer;
};

type PublicKeyCreationOptionsLike = Omit<
    PublicKeyCredentialCreationOptions,
    'challenge' | 'user' | 'excludeCredentials'
> & {
    challenge: string | ArrayBuffer;
    user: PublicKeyCredentialUserEntity & { id: string | ArrayBuffer };
    excludeCredentials?: CredentialDescriptorWithId[];
};

type PublicKeyRequestOptionsLike = Omit<
    PublicKeyCredentialRequestOptions,
    'challenge' | 'allowCredentials'
> & {
    challenge: string | ArrayBuffer;
    allowCredentials?: CredentialDescriptorWithId[];
};

function unwrapPublicKey<T>(options: unknown): T {
    if (options && typeof options === 'object' && 'publicKey' in options) {
        return (options as { publicKey: T }).publicKey;
    }
    return options as T;
}

function toBuffer(value: string | ArrayBuffer): ArrayBuffer {
    return typeof value === 'string' ? base64UrlToBuffer(value) : value;
}

export function parseCreationOptions(options: unknown): PublicKeyCredentialCreationOptions {
    const publicKey = unwrapPublicKey<PublicKeyCreationOptionsLike>(options);
    return {
        ...publicKey,
        challenge: toBuffer(publicKey.challenge),
        user: {
            ...publicKey.user,
            id: toBuffer(publicKey.user.id),
        },
        excludeCredentials: (publicKey.excludeCredentials || []).map((cred) => ({
            ...cred,
            id: toBuffer(cred.id),
        })),
    } as PublicKeyCredentialCreationOptions;
}

export function parseRequestOptions(options: unknown): PublicKeyCredentialRequestOptions {
    const publicKey = unwrapPublicKey<PublicKeyRequestOptionsLike>(options);
    return {
        ...publicKey,
        challenge: toBuffer(publicKey.challenge),
        allowCredentials: (publicKey.allowCredentials || []).map((cred) => ({
            ...cred,
            id: toBuffer(cred.id),
        })),
    } as PublicKeyCredentialRequestOptions;
}

export function credentialToJSON(credential: PublicKeyCredential): Record<string, unknown> {
    const response = credential.response as
        | AuthenticatorAttestationResponse
        | AuthenticatorAssertionResponse;
    const json: Record<string, unknown> = {
        id: credential.id,
        rawId: bufferToBase64Url(credential.rawId),
        type: credential.type,
        response: {
            clientDataJSON: bufferToBase64Url(response.clientDataJSON),
        },
    };

    if ('attestationObject' in response) {
        (json.response as Record<string, unknown>).attestationObject = bufferToBase64Url(
            response.attestationObject
        );
    }
    if ('authenticatorData' in response) {
        (json.response as Record<string, unknown>).authenticatorData = bufferToBase64Url(
            response.authenticatorData
        );
    }
    if ('signature' in response) {
        (json.response as Record<string, unknown>).signature = bufferToBase64Url(
            response.signature
        );
    }
    if ('userHandle' in response && response.userHandle) {
        (json.response as Record<string, unknown>).userHandle = bufferToBase64Url(
            response.userHandle
        );
    }

    if (credential.getClientExtensionResults) {
        json.clientExtensionResults = credential.getClientExtensionResults();
    }

    return json;
}

