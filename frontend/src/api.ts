// Thin client for the Graphing Studio API. In production /api is proxied to Render by Vercel,
// so the session cookie is first-party and httpOnly (JavaScript never sees the token).

import type { Doc } from './engine/types';

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';

export type Role = 'admin' | 'tutor' | 'student' | 'viewer';
export interface User {
  id: string;
  name: string;
  email?: string;
  role: Role;
  classIds: string[];
}
export interface BoardSummary {
  id: string;
  ownerId: string;
  ownerName: string;
  ownerRole: Role;
  title: string;
  visibility: 'private' | 'class' | 'submitted';
  classId: string | null;
  version: number;
  updatedAt: string;
}
export interface Board extends BoardSummary {
  data: Doc;
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit & { json?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const { json, timeoutMs = 20_000, ...rest } = init;
  const signal = rest.signal ?? (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(timeoutMs) : undefined);
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      credentials: 'include',
      ...rest,
      signal,
      headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(rest.headers ?? {}) },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Your drawing is still saved on this device.', 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error || `Request failed (${res.status})`, res.status);
  return body as T;
}

export const api = {
  me: () => call<{ user: User }>('/api/auth/me').then((r) => r.user).catch((e) => (e instanceof ApiError && e.status === 401 ? null : Promise.reject(e))),
  exchange: (token: string) => call<{ user: User }>('/api/auth/exchange', { method: 'POST', json: { token }, timeoutMs: 60_000 }).then((r) => r.user),
  logout: () => call<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  devLogin: (role: string, name: string, classIds: string[]) => call<{ user: User }>('/api/dev/login', { method: 'POST', json: { role, name, classIds } }).then((r) => r.user),
  listBoards: (scope: 'mine' | 'shared') => call<{ boards: BoardSummary[] }>(`/api/boards?scope=${scope}`).then((r) => r.boards),
  getBoard: (id: string) => call<{ board: Board; permissions: { write: boolean; delete: boolean } }>(`/api/boards/${id}`),
  createBoard: (title: string, data: Doc) => call<{ board: Board }>('/api/boards', { method: 'POST', json: { title, data } }).then((r) => r.board),
  saveBoard: (id: string, title: string, data: Doc, version: number) => call<{ board: Board }>(`/api/boards/${id}`, { method: 'PUT', json: { title, data, version } }).then((r) => r.board),
  setVisibility: (id: string, visibility: 'private' | 'class' | 'submitted', classId: string | null) =>
    call<{ board: BoardSummary }>(`/api/boards/${id}/visibility`, { method: 'PATCH', json: { visibility, classId } }).then((r) => r.board),
  duplicate: (id: string) => call<{ board: Board }>(`/api/boards/${id}/duplicate`, { method: 'POST' }).then((r) => r.board),
  remove: (id: string) => call<{ ok: true }>(`/api/boards/${id}`, { method: 'DELETE' }),
};

export const TMP_SIGNIN_URL = (import.meta.env.VITE_TMP_SIGNIN_URL as string | undefined) ||
  'https://themodernpedagogues-70f4f230adc2.herokuapp.com/login';
export const TMP_HOME_URL = (import.meta.env.VITE_TMP_HOME_URL as string | undefined) || 'https://themodernpedagogues-70f4f230adc2.herokuapp.com';
