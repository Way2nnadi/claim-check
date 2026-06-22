import type { AuthenticatedPrincipal, Role } from "./auth/types";

export function hasAnyRole(
  principal: AuthenticatedPrincipal,
  allowedRoles: readonly Role[],
): boolean {
  return allowedRoles.some((role) => principal.roles.includes(role));
}
