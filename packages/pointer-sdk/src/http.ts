import { PointerError } from './types.js';

export interface HttpOptions {
  apiBase: string;
  apiKey?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export async function request<T>(
  opts: HttpOptions,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const f = opts.fetch ?? globalThis.fetch;
  if (!f) throw new Error('No fetch implementation available');

  const url = `${opts.apiBase.replace(/\/$/, '')}${path}`;
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (opts.apiKey && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${opts.apiKey}`);
  }

  const ctrl = new AbortController();
  const timer = opts.timeoutMs ? setTimeout(() => ctrl.abort(), opts.timeoutMs) : null;

  let res: Response;
  try {
    res = await f(url, { ...init, headers, signal: init.signal ?? ctrl.signal });
  } finally {
    if (timer) clearTimeout(timer);
  }

  const ct = res.headers.get('content-type') ?? '';
  const isJson = ct.includes('application/json');
  const body = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null);

  if (!res.ok) {
    throw new PointerError(
      `Request failed ${res.status} ${res.statusText} for ${path}`,
      res.status,
      body,
    );
  }
  return body as T;
}
