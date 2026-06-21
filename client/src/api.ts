import type { AuthenticatedPrincipal } from "./types";

export const SESSION_STORAGE_TOKEN_KEY = "policy-pipeline.auth.token";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function getStoredToken(): string | null {
  return window.sessionStorage.getItem(SESSION_STORAGE_TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  window.sessionStorage.setItem(SESSION_STORAGE_TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  window.sessionStorage.removeItem(SESSION_STORAGE_TOKEN_KEY);
}

function shouldSetJsonContentType(body: BodyInit | null | undefined): body is string {
  return typeof body === "string";
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  token: string | null = getStoredToken(),
): Promise<T> {
  const headers = new Headers(init.headers);

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (shouldSetJsonContentType(init.body) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    headers,
  });

  if (!response.ok) {
    let detail = `Request failed with status ${response.status}.`;
    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload.detail) {
        detail = payload.detail;
      }
    } catch {
      // Leave the default error message when the response is not JSON.
    }
    throw new ApiError(detail, response.status);
  }

  return (await response.json()) as T;
}

export function fetchMe(token: string): Promise<AuthenticatedPrincipal> {
  return apiRequest<AuthenticatedPrincipal>("/api/me", { method: "GET" }, token);
}
