// Klien API backend Bakulan WA (Fastify).
// Pemetaan endpoint, diverifikasi dari apps/api/src/modules/*/routes.ts:
// - POST /auth/login { email, password } -> { accessToken, refreshToken, user }
// - POST /auth/register { email, password, businessName }
// - POST /auth/refresh { refreshToken } -> token baru (rotasi)
// - GET  /tenants/me
// - GET  /wa/status -> { status, phoneNumber, qr, lastConnectedAt }
// - POST /wa/connect, POST /wa/disconnect
// - GET  /persona, POST /persona, PATCH /persona/:id, POST /persona/:id/activate, DELETE /persona/:id
// - GET  /conversations, GET /messages?contact=&limit=, POST /conversations/resume-ai
// - GET  /billing/wallet, GET /billing/ledger, POST /billing/topup { amount }

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export type Tenant = {
  id: string;
  businessName: string;
  status: string;
  walletBalance: string;
  createdAt: string;
};

export type WaStatus = {
  status: string;
  waSessionId: string | null;
  phoneNumber: string | null;
  qr: string | null;
  lastConnectedAt: string | null;
};

export type Persona = {
  id: string;
  name: string;
  systemPrompt: string;
  aiProvider?: string;
  isActive?: boolean;
  createdAt?: string;
};

export type Conversation = {
  contactJid: string;
  lastMessageAt: string;
  messageCount: number;
};

export type ChatMessage = {
  id: string;
  contactJid: string;
  direction: string;
  content: string;
  createdAt: string;
};

export type Wallet = {
  balance: string;
  lowBalance: boolean;
  topupMin: number;
  topupMax: number;
};

const ACCESS_KEY = "bakulan_access_token";
const REFRESH_KEY = "bakulan_refresh_token";

export function getAccessToken() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACCESS_KEY);
}

export function setTokens(accessToken: string, refreshToken: string) {
  window.localStorage.setItem(ACCESS_KEY, accessToken);
  window.localStorage.setItem(REFRESH_KEY, refreshToken);
}

export function clearTokens() {
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const token = getAccessToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });

  // Access token backend hanya 15 menit. Coba refresh sekali, lalu ulangi.
  if (res.status === 401 && retry && typeof window !== "undefined") {
    const refreshToken = window.localStorage.getItem(REFRESH_KEY);
    if (refreshToken) {
      try {
        const r = await fetch(`${API_URL}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        if (r.ok) {
          const data = await r.json();
          setTokens(data.accessToken, data.refreshToken);
          return request<T>(path, init, false);
        }
      } catch {
        // jatuh ke error 401 di bawah
      }
    }
  }

  if (res.status === 204) return undefined as T;
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message =
      (data as { message?: string } | null)?.message ||
      `Permintaan gagal (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ accessToken: string; refreshToken: string; user: unknown }>(
      "/auth/login",
      { method: "POST", body: JSON.stringify({ email, password }) },
    ),
  register: (email: string, password: string, businessName: string) =>
    request<{ accessToken: string; refreshToken: string }>(
      "/auth/register",
      { method: "POST", body: JSON.stringify({ email, password, businessName }) },
    ),
  tenant: () => request<Tenant>("/tenants/me"),
  waStatus: () => request<WaStatus>("/wa/status"),
  waConnect: () =>
    request<{ waSessionId: string; status: string }>("/wa/connect", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  waDisconnect: () =>
    request<{ ok: boolean }>("/wa/disconnect", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  personas: () => request<Persona[]>("/persona"),
  createPersona: (body: { name: string; systemPrompt: string; aiProvider?: string }) =>
    request<Persona>("/persona", { method: "POST", body: JSON.stringify(body) }),
  activatePersona: (id: string) =>
    request<Persona>(`/persona/${id}/activate`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  deletePersona: (id: string) =>
    request<void>(`/persona/${id}`, { method: "DELETE" }),
  conversations: () => request<Conversation[]>("/conversations"),
  messages: (contact: string, limit = 50) =>
    request<{ messages: ChatMessage[] }>(
      `/messages?contact=${encodeURIComponent(contact)}&limit=${limit}`,
    ),
  resumeAi: (contactJid: string) =>
    request<void>("/conversations/resume-ai", {
      method: "POST",
      body: JSON.stringify({ contactJid }),
    }),
  wallet: () => request<Wallet>("/billing/wallet"),
  ledger: () =>
    request<{ entries: Array<{ id: string; type: string; amount: string; balanceAfter: string; referenceId: string; createdAt: string }> }>(
      "/billing/ledger?limit=30",
    ),
  topup: (amount: number) =>
    request<unknown>("/billing/topup", {
      method: "POST",
      body: JSON.stringify({ amount }),
    }),
};

export function formatRupiah(value: string | number) {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "Rp0";
  return `Rp${Math.round(n).toLocaleString("id-ID")}`;
}

export function shortContact(contactJid: string) {
  return contactJid.split("@")[0];
}
