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
    throw await apiErrorFromResponse(response);
  }

  return (await response.json()) as T;
}

export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  let detail = `Request failed with status ${response.status}.`;
  try {
    const payload = (await response.json()) as {
      detail?: string | Array<{ loc?: Array<string | number>; msg?: string }>;
    };
    if (typeof payload.detail === "string" && payload.detail) {
      detail = payload.detail;
    } else if (Array.isArray(payload.detail) && payload.detail.length > 0) {
      detail = payload.detail
        .map((item) => {
          const message = item.msg?.replace(/^Value error,\s*/u, "").trim();
          const path = item.loc
            ?.filter((segment) => segment !== "body")
            .join(".");
          if (path && message) {
            return `${path}: ${message}`;
          }
          return message || detail;
        })
        .join(" ");
    }
  } catch {
    // Leave the default error message when the response is not JSON.
  }
  return new ApiError(detail, response.status);
}

export async function downloadAttachment(path: string, filename: string): Promise<void> {
  const token = getStoredToken();
  const headers = new Headers();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(path, { headers });

  if (!response.ok) {
    throw await apiErrorFromResponse(response);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
