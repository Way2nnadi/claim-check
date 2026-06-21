import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PolicyVersionCatalog from "./PolicyVersionCatalog";
import type { AuthenticatedPrincipal, Role } from "./types";

const policyVersionListResponse = {
  items: [
    {
      policy_version_id: "policy-v2",
      published_by: "approver-user",
      change_summary: "Raised lodging cap for international travel.",
      rule_count: 2,
      created_at: "2026-06-21T15:30:00Z",
    },
    {
      policy_version_id: "policy-v1",
      published_by: "approver-user",
      change_summary: "Initial immutable snapshot.",
      rule_count: 1,
      created_at: "2026-05-18T09:00:00Z",
    },
  ],
};

const policyVersionDetailResponse = {
  policy_version_id: "policy-v2",
  published_by: "approver-user",
  change_summary: "Raised lodging cap for international travel.",
  rules: [
    {
      rule_id: "rule-lodging-cap",
      statement: "International lodging is capped at $325 per night.",
      enforceability_class: "enforceable",
      lifecycle_state: "published",
      origin: {
        source_type: "extracted",
        extraction_run_id: "extract-2026-06-21",
        rationale: null,
      },
      scope: {
        country: null,
        expense_category: "lodging",
        travel_type: "international",
        employee_group: null,
        effective_start_date: "2026-07-01",
        effective_end_date: null,
      },
      citation: {
        document_id: "travel-policy",
        document_version_id: "docv-travel-v5",
        section_id: "lodging-intl",
        quote: "International lodging is capped at $325 per night.",
        start_char: 88,
        end_char: 138,
      },
      condition: {
        field: "lodging.amount",
        operator: "<=",
        value: "325",
      },
      applicability: {
        aggregation_period: "per_night",
        unit: "money",
        currency: "USD",
        limit_basis: "per traveler",
      },
      exceptions: [
        {
          description: "Conference hotel rates may exceed the cap with approver sign-off.",
          required_evidence: ["conference agenda", "approver approval"],
        },
      ],
    },
    {
      rule_id: "rule-lodging-guidance",
      statement: "Employees should prefer negotiated hotel blocks when available.",
      enforceability_class: "guidance",
      lifecycle_state: "published",
      origin: {
        source_type: "manual",
        extraction_run_id: null,
        rationale: "Captured as a preserved guidance note in the published snapshot.",
      },
      scope: {
        country: null,
        expense_category: "lodging",
        travel_type: null,
        employee_group: null,
        effective_start_date: null,
        effective_end_date: null,
      },
      citation: null,
      condition: null,
      applicability: null,
      exceptions: [],
    },
  ],
};

function makePrincipal(role: Role): AuthenticatedPrincipal {
  return {
    subject: `${role}-user`,
    roles: [role],
    auth_backend: "local",
  };
}

describe("PolicyVersionCatalog", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  describe.each([
    ["viewer", "viewer-token"],
    ["approver", "approver-token"],
    ["admin", "admin-token"],
  ] satisfies [Role, string][])(
    "as %s",
    (role, token) => {
      it("loads published Policy Versions, opens a snapshot, and exports JSON", async () => {
        window.sessionStorage.setItem("policy-pipeline.auth.token", token);

        const fetchMock = vi.fn().mockImplementation((url: string) => {
          if (url === "/api/policy-versions") {
            return Promise.resolve({
              ok: true,
              json: async () => policyVersionListResponse,
            });
          }
          if (url === "/api/policy-versions/policy-v2") {
            return Promise.resolve({
              ok: true,
              json: async () => policyVersionDetailResponse,
            });
          }
          if (url === "/api/policy-versions/policy-v2/snapshot") {
            return Promise.resolve({
              ok: true,
              blob: async () =>
                new Blob([JSON.stringify(policyVersionDetailResponse)], {
                  type: "application/json",
                }),
            });
          }
          return Promise.reject(new Error(`Unexpected fetch: ${url}`));
        });
        vi.stubGlobal("fetch", fetchMock);

        const clickMock = vi.fn();
        const link = {
          href: "",
          download: "",
          rel: "",
          click: clickMock,
          remove: vi.fn(),
        } as unknown as HTMLAnchorElement;
        const originalCreateElement = document.createElement.bind(document);
        vi.spyOn(document, "createElement").mockImplementation((tagName, options) => {
          if (tagName === "a") {
            return link as HTMLAnchorElement;
          }
          return originalCreateElement(tagName, options);
        });
        vi.stubGlobal("URL", {
          createObjectURL: vi.fn().mockReturnValue("blob:policy-version"),
          revokeObjectURL: vi.fn(),
        });

        render(<PolicyVersionCatalog principal={makePrincipal(role)} />);

        expect(await screen.findByText("policy-v2")).toBeInTheDocument();
        expect(screen.getAllByText("2 Rules").length).toBeGreaterThan(0);

        const listRequest = fetchMock.mock.calls[0]?.[1];
        expect(new Headers(listRequest?.headers).get("Authorization")).toBe(
          `Bearer ${token}`,
        );

        await userEvent.click(
          screen.getByRole("button", { name: /Open Policy Version policy-v2/i }),
        );

        expect(
          await screen.findByRole("heading", { name: "International lodging is capped at $325 per night." }),
        ).toBeInTheDocument();
        expect(screen.getByText("Rules")).toBeInTheDocument();
        expect(screen.getByText("Conference hotel rates may exceed the cap with approver sign-off.")).toBeInTheDocument();

        const detailRequest = fetchMock.mock.calls[1]?.[1];
        expect(new Headers(detailRequest?.headers).get("Authorization")).toBe(
          `Bearer ${token}`,
        );

        await userEvent.click(screen.getByRole("button", { name: "Export JSON" }));

        await waitFor(() => {
          expect(fetchMock).toHaveBeenCalledWith(
            "/api/policy-versions/policy-v2/snapshot",
            expect.any(Object),
          );
        });
        const exportRequest = fetchMock.mock.calls[2]?.[1];
        expect(new Headers(exportRequest?.headers).get("Authorization")).toBe(
          `Bearer ${token}`,
        );
        expect(clickMock).toHaveBeenCalled();
        expect(link.download).toBe("policy-v2.json");
      });
    },
  );
});
