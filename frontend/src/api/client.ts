import type {
  AuthResponse,
  ExpenseDetail,
  Friend,
  GroupDetail,
  GroupSummary,
  GroupSummaryPayload,
  MemberBalance,
  SettlementDetail,
  SplitMethod,
  User,
  ApiErrorBody,
} from "./types";

const TOKEN_KEY = "sess_token";

/**
 * Local Vite uses `/api` (proxied to :3001).
 * Production sets `VITE_API_BASE_URL` to the public API, e.g.
 * `https://sess-api.onrender.com` (no trailing slash).
 */
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(
  /\/$/,
  ""
) ?? "/api";

/** Render free tier can take 30–60s to wake from sleep. */
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 3;

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(status: number | null, err: unknown): boolean {
  if (status === 502 || status === 503 || status === 504) return true;
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof TypeError) return true; // network / failed to fetch
  return false;
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  const token = getStoredToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
        signal: controller.signal,
      });

      if (res.status === 204) {
        return undefined as T;
      }

      // Cold start / gateway errors — wait and retry.
      if (
        isRetryable(res.status, null) &&
        attempt < MAX_RETRIES
      ) {
        await sleep(1500 * attempt);
        continue;
      }

      const data: unknown = await res.json().catch(() => ({}));

      if (!res.ok) {
        const body = data as ApiErrorBody;
        throw new ApiError(
          body.error?.message ?? `Request failed (${res.status})`,
          res.status,
          body.error?.code
        );
      }

      return data as T;
    } catch (err) {
      lastError = err;
      if (err instanceof ApiError) throw err;
      if (attempt < MAX_RETRIES && isRetryable(null, err)) {
        await sleep(1500 * attempt);
        continue;
      }
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new ApiError(
          "Server is taking too long to respond (it may be waking up). Try again.",
          504,
          "TIMEOUT"
        );
      }
      throw new ApiError(
        "Cannot reach the API. The free server may be asleep — wait a few seconds and retry.",
        0,
        "NETWORK"
      );
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new ApiError("Request failed", 0, "NETWORK");
}

export const api = {
  register(body: {
    email: string;
    displayName: string;
    password: string;
  }): Promise<AuthResponse> {
    return request("/auth/register", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  login(body: { email: string; password: string }): Promise<AuthResponse> {
    return request("/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  me(): Promise<User> {
    return request("/auth/me");
  },

  listGroups(): Promise<GroupSummary[]> {
    return request("/groups");
  },

  createGroup(name: string): Promise<GroupDetail> {
    return request("/groups", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  },

  getGroup(groupId: string): Promise<GroupDetail> {
    return request(`/groups/${groupId}`);
  },

  addMember(groupId: string, email: string): Promise<GroupDetail> {
    return request(`/groups/${groupId}/members`, {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },

  listFriends(): Promise<Friend[]> {
    return request("/friends");
  },

  addFriend(body: { email?: string; userId?: string }): Promise<Friend> {
    return request("/friends", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  removeFriend(friendUserId: string): Promise<void> {
    return request(`/friends/${friendUserId}`, { method: "DELETE" });
  },

  listExpenses(groupId: string): Promise<ExpenseDetail[]> {
    return request(`/groups/${groupId}/expenses`);
  },

  createExpense(
    groupId: string,
    body: {
      description: string;
      amount: string;
      paidByUserId: string;
      expenseDate: string;
      splitMethod: SplitMethod;
      participantIds: string[];
      splits?: Record<string, string | number>;
    }
  ): Promise<ExpenseDetail> {
    return request(`/groups/${groupId}/expenses`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  deleteExpense(groupId: string, expenseId: string): Promise<void> {
    return request(`/groups/${groupId}/expenses/${expenseId}`, {
      method: "DELETE",
    });
  },

  getBalances(groupId: string): Promise<MemberBalance[]> {
    return request(`/groups/${groupId}/balances`);
  },

  getSettlements(groupId: string): Promise<SettlementDetail[]> {
    return request(`/groups/${groupId}/settlements`);
  },

  getSummary(groupId: string): Promise<GroupSummaryPayload> {
    return request(`/groups/${groupId}/summary`);
  },

  completeSettlement(settlementId: string): Promise<SettlementDetail> {
    return request(`/settlements/${settlementId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "COMPLETED" }),
    });
  },
};
