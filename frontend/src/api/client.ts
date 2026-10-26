import { createSseParser } from '../office/sse';

const BASE = '/api/v1';
const REFRESH_KEY = 'ace.refreshToken';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Access token chỉ giữ trong bộ nhớ. Refresh token nằm trong localStorage để giữ đăng nhập sau khi tải lại trang.
let accessToken: string | null = null;
let refreshing: Promise<AuthResult | null> | null = null;
let sessionLostHandler: (() => void) | null = null;

function readRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

function writeRefreshToken(value: string | null): void {
  try {
    if (value === null) {
      localStorage.removeItem(REFRESH_KEY);
    } else {
      localStorage.setItem(REFRESH_KEY, value);
    }
  } catch {
    // Trình duyệt chặn lưu trữ: vẫn dùng được trong phiên hiện tại.
  }
}

export function onSessionLost(handler: (() => void) | null): void {
  sessionLostHandler = handler;
}

export function applySession(result: AuthResult): void {
  accessToken = result.accessToken;
  writeRefreshToken(result.refreshToken);
}

export function clearSession(): void {
  accessToken = null;
  writeRefreshToken(null);
}

export function hasStoredSession(): boolean {
  return readRefreshToken() !== null;
}

async function toApiError(res: Response): Promise<ApiError> {
  let message = `Lỗi ${res.status}`;
  try {
    const body = (await res.json()) as { message?: unknown };
    if (Array.isArray(body.message)) {
      message = body.message.join('; ');
    } else if (typeof body.message === 'string') {
      message = body.message;
    }
  } catch {
    // Phản hồi không phải JSON: giữ thông báo mặc định.
  }
  return new ApiError(res.status, message);
}

const NETWORK_MESSAGE = 'Không kết nối được máy chủ. Hãy kiểm tra backend đã chạy chưa.';

async function guardedFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new ApiError(0, NETWORK_MESSAGE);
  }
}

/** Đổi refresh token lấy cặp token mới. Nhiều nơi gọi cùng lúc chỉ gửi một yêu cầu (xoay vòng token chỉ dùng được một lần). */
export function refreshSession(): Promise<AuthResult | null> {
  if (refreshing) {
    return refreshing;
  }
  const token = readRefreshToken();
  if (!token) {
    return Promise.resolve(null);
  }
  refreshing = (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: token }),
      });
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          clearSession(); // token bị từ chối: phiên đã hết hạn hoặc bị thu hồi
        }
        return null;
      }
      const result = (await res.json()) as AuthResult;
      applySession(result);
      return result;
    } catch {
      return null; // lỗi mạng: giữ nguyên token để thử lại sau
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function authHeader(): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const send = () =>
    guardedFetch(`${BASE}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...authHeader(),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });

  let res = await send();
  if (res.status === 401 && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) {
      res = await send();
    } else {
      sessionLostHandler?.();
    }
  }
  if (!res.ok) {
    throw await toApiError(res);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

/**
 * Đọc luồng Server-Sent Events bằng fetch (EventSource không gửi được header Authorization).
 * Trả về khi máy chủ đóng luồng; ném lỗi nếu không mở được.
 */
export async function readStream(
  path: string,
  handlers: { onOpen: () => void; onData: (data: string) => void },
  signal: AbortSignal,
): Promise<void> {
  const open = () =>
    guardedFetch(`${BASE}${path}`, {
      headers: { Accept: 'text/event-stream', ...authHeader() },
      signal,
    });

  let res = await open();
  if (res.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed) {
      res = await open();
    }
  }
  if (!res.ok) {
    throw await toApiError(res);
  }
  if (!res.body) {
    throw new ApiError(0, 'Trình duyệt không hỗ trợ đọc luồng sự kiện.');
  }

  handlers.onOpen();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser(handlers.onData);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return;
    }
    parser.push(decoder.decode(value, { stream: true }));
  }
}
