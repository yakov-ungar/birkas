import type { ApiError } from '@tuition/shared';

let csrfToken = '';
export const setCsrf = (t: string) => {
  csrfToken = t;
};

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

/** Fired when the server says the session is gone, so the app can return to the login screen. */
export const AUTH_LOST = 'auth-lost';

export async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method !== 'GET' && csrfToken ? { 'x-csrf-token': csrfToken } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new HttpError(0, 'network', 'אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב');
  }
  if (res.ok) {
    const ct = res.headers.get('content-type') ?? '';
    return (ct.includes('application/json') ? await res.json() : await res.text()) as T;
  }
  let err: ApiError['error'] = { code: 'unknown', message: 'אירעה שגיאה. נסו שוב' };
  try {
    err = ((await res.json()) as ApiError).error ?? err;
  } catch {
    // non-JSON error body
  }
  if (res.status === 401 && !url.startsWith('/api/auth/login') && !url.startsWith('/api/auth/invite')) {
    window.dispatchEvent(new CustomEvent(AUTH_LOST, { detail: err }));
  }
  throw new HttpError(res.status, err.code, err.message, err.fields);
}

export const get = <T>(url: string) => api<T>('GET', url);
export const post = <T>(url: string, body: unknown = {}) => api<T>('POST', url, body);
export const patch = <T>(url: string, body: unknown) => api<T>('PATCH', url, body);

/** Downloads a server-generated file (e.g. CSV) using the session cookie. */
export async function download(url: string, filename: string) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new HttpError(res.status, 'download', 'ההורדה נכשלה');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await res.blob());
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
