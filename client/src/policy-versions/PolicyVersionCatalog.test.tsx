import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PolicyVersionCatalog from "./PolicyVersionCatalog";
import type { AuthenticatedPrincipal, Role } from "../shared/auth/types";

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

const publishedPolicyVersionListResponse = {
  items: [
    {
      policy_version_id: "policy-v3",
      published_by: "approver-user",
      change_summary: "Approved meal and lodging adjustments for summer travel.",
      rule_count: 3,
      created_at: "2026-06-22T08:00:00Z",
    },
    ...policyVersionListResponse.items,
  ],
};

const publishedPolicyVersionDetailResponse = {
  policy_version_id: "policy-v3",
  published_by: "approver-user",
  change_summary: "Approved meal and lodging adjustments for summer travel.",
  rules: [
    {
      rule_id: "rule-meal-cap-v3",
      statement: "Domestic meals are capped at $90 per day.",
      enforceability_class: "enforceable",
      lifecycle_state: "published",
      origin: {
        source_type: "manual",
        extraction_run_id: null,
        rationale: "Approver reconciled approved meal cap edits before publication.",
      },
      scope: {
        country: "US",
        expense_category: "meals",
        travel_type: "domestic",
        employee_group: "employees",
        effective_start_date: "2026-07-01",
        effective_end_date: null,
      },
      citation: null,
      condition: {
        field: "meal.amount",
        operator: "<=",
        value: "90",
      },
      applicability: {
        aggregation_period: "per_day",
        unit: "money",
        currency: "USD",
        limit_basis: "per employee",
      },
      exceptions: [],
    },
  ],
};

const compiledRuleSetResponse = {
  compiled_rule_set_id: "compiled-policy-v2",
  policy_version_id: "policy-v2",
  compiled_by: "admin-user",
  compiled_at: "2026-06-22T11:00:00Z",
  summary: {
    compiled: 1,
    skipped_non_enforceable: 1,
    compile_error: 0,
  },
  entries: [
    {
      rule_id: "rule-lodging-cap",
      status: "compiled",
      source_rule: policyVersionDetailResponse.rules[0],
      compiled_rule: {
        rule_id: "rule-lodging-cap",
        statement: policyVersionDetailResponse.rules[0].statement,
        scope: policyVersionDetailResponse.rules[0].scope,
        condition: policyVersionDetailResponse.rules[0].condition,
        applicability: policyVersionDetailResponse.rules[0].applicability,
        exceptions: policyVersionDetailResponse.rules[0].exceptions,
        citation: policyVersionDetailResponse.rules[0].citation,
      },
      skip_reason: null,
      error_reason: null,
    },
    {
      rule_id: "rule-lodging-guidance",
      status: "skipped_non_enforceable",
      source_rule: policyVersionDetailResponse.rules[1],
      compiled_rule: null,
      skip_reason: "Guidance Rules are not machine-checkable.",
      error_reason: null,
    },
  ],
};

function compiledRuleSetsForPolicyVersion(policyVersionId: string) {
  return `/api/policy-versions/${encodeURIComponent(policyVersionId)}/compiled-rule-sets`;
}

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

        const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
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
          if (url === compiledRuleSetsForPolicyVersion("policy-v2")) {
            return Promise.resolve({
              ok: true,
              json: async () => ({ items: [] }),
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
          screen.getByRole("button", { name: /Open policy-v2/i }),
        );

        expect(
          await screen.findByRole("heading", { name: "International lodging is capped at $325 per night." }),
        ).toBeInTheDocument();
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

  it("does not open publish controls for viewer clearance", async () => {
    window.sessionStorage.setItem("policy-pipeline.auth.token", "viewer-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => policyVersionListResponse,
      }),
    );

    render(<PolicyVersionCatalog principal={makePrincipal("viewer")} />);

    expect(await screen.findByText("policy-v2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish Policy Version" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Policy Version id")).not.toBeInTheDocument();
  });

  it("does not open the publish drawer until the toolbar button is clicked", async () => {
    window.sessionStorage.setItem("policy-pipeline.auth.token", "admin-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => policyVersionListResponse,
      }),
    );

    render(<PolicyVersionCatalog principal={makePrincipal("admin")} />);

    expect(await screen.findByText("policy-v2")).toBeInTheDocument();
    expect(screen.queryByLabelText("Policy Version id")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Publish Policy Version" }));

    expect(await screen.findByLabelText("Policy Version id")).toBeInTheDocument();
  });

  describe.each([
    ["approver", "approver-token"],
    ["admin", "admin-token"],
  ] satisfies [Role, string][])("publish as %s", (role, token) => {
    it("publishes a new Policy Version, redirects to detail, and keeps it in the list", async () => {
      window.sessionStorage.setItem("policy-pipeline.auth.token", token);

      let listCallCount = 0;
      const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url === "/api/policy-versions" && (init?.method ?? "GET") === "GET") {
          listCallCount += 1;
          return Promise.resolve({
            ok: true,
            json: async () =>
              listCallCount === 1
                ? policyVersionListResponse
                : publishedPolicyVersionListResponse,
          });
        }
        if (url === "/api/policy-versions" && init?.method === "POST") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              policy_version_id: "policy-v3",
              rule_count: 3,
              status: "published",
              published_by: "approver-user",
            }),
          });
        }
        if (url === "/api/policy-versions/policy-v3") {
          return Promise.resolve({
            ok: true,
            json: async () => publishedPolicyVersionDetailResponse,
          });
        }
        if (url === compiledRuleSetsForPolicyVersion("policy-v3")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ items: [] }),
          });
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      });
      vi.stubGlobal("fetch", fetchMock);

      render(<PolicyVersionCatalog principal={makePrincipal(role)} />);

      expect(await screen.findByText("policy-v2")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Publish Policy Version" }));
      expect(await screen.findByLabelText("Policy Version id")).toBeInTheDocument();

      await userEvent.type(screen.getByLabelText("Policy Version id"), "policy-v3");
      await userEvent.type(
        screen.getByLabelText("Change summary"),
        "Approved meal and lodging adjustments for summer travel.",
      );
      await userEvent.click(screen.getByRole("button", { name: "Publish" }));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/policy-versions",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              policy_version_id: "policy-v3",
              change_summary:
                "Approved meal and lodging adjustments for summer travel.",
            }),
          }),
        );
      });

      expect(
        await screen.findByRole("heading", {
          name: "Domestic meals are capped at $90 per day.",
        }),
      ).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Policy Versions" }));

      expect(await screen.findByText("policy-v3")).toBeInTheDocument();
      expect(screen.getByText("Approved meal and lodging adjustments for summer travel.")).toBeInTheDocument();
    });

    it("surfaces a clear no-approved-Rules error", async () => {
      window.sessionStorage.setItem("policy-pipeline.auth.token", token);

      const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url === "/api/policy-versions" && (init?.method ?? "GET") === "GET") {
          return Promise.resolve({
            ok: true,
            json: async () => policyVersionListResponse,
          });
        }
        if (url === "/api/policy-versions" && init?.method === "POST") {
          return Promise.resolve({
            ok: false,
            status: 422,
            json: async () => ({
              detail: "Policy Version requires at least one approved Rule.",
            }),
          });
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      });
      vi.stubGlobal("fetch", fetchMock);

      render(<PolicyVersionCatalog principal={makePrincipal(role)} />);

      expect(await screen.findByText("policy-v2")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Publish Policy Version" }));
      expect(await screen.findByLabelText("Policy Version id")).toBeInTheDocument();

      await userEvent.type(screen.getByLabelText("Policy Version id"), "policy-v3");
      await userEvent.type(screen.getByLabelText("Change summary"), "Ready to publish.");
      await userEvent.click(screen.getByRole("button", { name: "Publish" }));

      expect(
        await screen.findByText(
          "No approved Rules are available for publication. Approve at least one Candidate Rule or create a Manual Rule first.",
        ),
      ).toBeInTheDocument();
    });

    it("surfaces version conflicts clearly", async () => {
      window.sessionStorage.setItem("policy-pipeline.auth.token", token);

      const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url === "/api/policy-versions" && (init?.method ?? "GET") === "GET") {
          return Promise.resolve({
            ok: true,
            json: async () => policyVersionListResponse,
          });
        }
        if (url === "/api/policy-versions" && init?.method === "POST") {
          return Promise.resolve({
            ok: false,
            status: 409,
            json: async () => ({
              detail:
                "Published Policy Versions are immutable and cannot be overwritten.",
            }),
          });
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      });
      vi.stubGlobal("fetch", fetchMock);

      render(<PolicyVersionCatalog principal={makePrincipal(role)} />);

      expect(await screen.findByText("policy-v2")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Publish Policy Version" }));
      expect(await screen.findByLabelText("Policy Version id")).toBeInTheDocument();

      await userEvent.type(screen.getByLabelText("Policy Version id"), "policy-v2");
      await userEvent.type(
        screen.getByLabelText("Change summary"),
        "Attempted overwrite of an immutable snapshot.",
      );
      await userEvent.click(screen.getByRole("button", { name: "Publish" }));

      expect(
        await screen.findByText(
          "Published Policy Versions are immutable and cannot be overwritten.",
        ),
      ).toBeInTheDocument();
    });
  });

  it("does not show compile controls for viewer clearance", async () => {
    window.sessionStorage.setItem("policy-pipeline.auth.token", "viewer-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
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
        if (url === compiledRuleSetsForPolicyVersion("policy-v2")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ items: [] }),
          });
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }),
    );

    render(<PolicyVersionCatalog principal={makePrincipal("viewer")} />);

    expect(await screen.findByText("policy-v2")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Open policy-v2/i }));
    expect(await screen.findByText("Not compiled")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compile Rule Set" })).not.toBeInTheDocument();
  });

  it("lets admin compile a Policy Version and shows per-rule status", async () => {
    window.sessionStorage.setItem("policy-pipeline.auth.token", "admin-token");

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
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
      if (
        url === compiledRuleSetsForPolicyVersion("policy-v2") &&
        init?.method === "POST"
      ) {
        return Promise.resolve({
          ok: true,
          json: async () => compiledRuleSetResponse,
        });
      }
      if (url === compiledRuleSetsForPolicyVersion("policy-v2")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [] }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PolicyVersionCatalog principal={makePrincipal("admin")} />);

    expect(await screen.findByText("policy-v2")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Open policy-v2/i }));
    expect(await screen.findByRole("button", { name: "Compile Rule Set" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Compile Rule Set" }));

    expect(await screen.findByText("1 compiled · 1 skipped")).toBeInTheDocument();
    expect(screen.getAllByText("Compiled").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Skipped").length).toBeGreaterThan(0);
  });
});
