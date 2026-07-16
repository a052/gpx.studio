import { get } from 'svelte/store';
import { settings } from '$lib/logic/settings';

const { corsProxyUrl } = settings;

let patched = false;

function getRequestUrl(input: RequestInfo | URL): string {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    return input.url;
}

function isProxyableUrl(url: string): boolean {
    return url.startsWith('http://') || url.startsWith('https://');
}

// Try the request directly, and only when it fails with a network/CORS error
// (fetch rejects with a TypeError), retry through the user-configured CORS proxy.
// The proxy is used by concatenating the target URL directly after the proxy address.
export function installCorsProxyFetch() {
    if (patched || typeof window === 'undefined') return;
    patched = true;

    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        // Clone Request bodies up front so a failed first attempt does not leave
        // the body stream consumed before we can retry through the proxy.
        const requestClone = input instanceof Request ? input.clone() : null;

        try {
            return await originalFetch(input, init);
        } catch (e) {
            const proxy = get(corsProxyUrl).trim();
            const url = getRequestUrl(input);

            if (
                !(e instanceof TypeError) ||
                proxy === '' ||
                !isProxyableUrl(url) ||
                url.startsWith(proxy)
            ) {
                throw e;
            }

            const proxiedUrl = proxy + url;
            if (requestClone) {
                return originalFetch(new Request(proxiedUrl, requestClone));
            }
            return originalFetch(proxiedUrl, init);
        }
    };
}
