import type { AuthenticatedPrincipal } from "./types";
import { apiRequest } from "../api/client";

export function fetchMe(token: string): Promise<AuthenticatedPrincipal> {
  return apiRequest<AuthenticatedPrincipal>("/api/me", { method: "GET" }, token);
}
