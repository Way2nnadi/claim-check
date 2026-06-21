export type Role = "admin" | "approver" | "viewer";

export interface AuthenticatedPrincipal {
  subject: string;
  roles: Role[];
  auth_backend: string;
}
