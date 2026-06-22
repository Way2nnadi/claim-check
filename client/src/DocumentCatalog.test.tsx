import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DocumentCatalog from "./DocumentCatalog";
import type { AuthenticatedPrincipal } from "./types";

const adminPrincipal: AuthenticatedPrincipal = {
  subject: "admin-user",
  roles: ["admin"],
  auth_backend: "local",
};

const viewerPrincipal: AuthenticatedPrincipal = {
  subject: "viewer-user",
  roles: ["viewer"],
  auth_backend: "local",
};

describe("DocumentCatalog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the register panel for admins on an empty catalog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ items: [] }),
      }),
    );

    render(<DocumentCatalog principal={adminPrincipal} />);

    expect(await screen.findByRole("heading", { name: "No Policy Documents on file" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Register Policy Document" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Deposit document" })).toBeInTheDocument();
  });

  it("hides registration controls for viewers on an empty catalog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ items: [] }),
      }),
    );

    render(<DocumentCatalog principal={viewerPrincipal} />);

    expect(await screen.findByRole("heading", { name: "No Policy Documents on file" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Register Policy Document" })).not.toBeInTheDocument();
    expect(screen.getByText(/Ask an administrator to register a Policy Document/)).toBeInTheDocument();
  });

  it("registers a new document and opens its detail view", async () => {
    const newVersion = {
      document_id: "travel-policy",
      document_version_id: "docv-travel-v1",
      filename: "travel-policy.pdf",
      content_type: "application/pdf",
      size_bytes: 2048,
      sha256: "1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff",
      deleted_at: null,
      deletion_reason: null,
    };
    const refreshedCatalog = {
      items: [
        {
          document_id: "travel-policy",
          latest_document_version_id: "docv-travel-v1",
          latest_uploaded_at: "2026-06-22T12:00:00Z",
          version_count: 1,
          active_version_count: 1,
          has_deleted_versions: false,
        },
      ],
    };
    const versionLedger = {
      items: [newVersion],
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => newVersion,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => refreshedCatalog,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => versionLedger,
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<DocumentCatalog principal={adminPrincipal} />);

    await screen.findByRole("heading", { name: "Register Policy Document" });
    await userEvent.type(screen.getByLabelText("Document id"), "travel-policy");
    const file = new File(["pdf-bytes"], "travel-policy.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText(/Select PDF or DOCX/i), file);
    await userEvent.click(screen.getByRole("button", { name: "Deposit document" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/policy-documents/travel-policy/versions",
        expect.objectContaining({
          method: "POST",
          body: expect.any(FormData),
        }),
      );
    });

    expect(await screen.findByText("docv-travel-v1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New version" })).toBeInTheDocument();
  });

  it("toggles the register panel from the catalog toolbar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [
            {
              document_id: "expense-policy",
              latest_document_version_id: "docv-expense-v1",
              latest_uploaded_at: "2026-06-21T12:00:00Z",
              version_count: 1,
              active_version_count: 1,
              has_deleted_versions: false,
            },
          ],
        }),
      }),
    );

    render(<DocumentCatalog principal={adminPrincipal} />);

    expect(await screen.findByText("1 document indexed")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Register Policy Document" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Register document" }));
    expect(screen.getByRole("heading", { name: "Register Policy Document" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Register document" }));
    expect(screen.queryByRole("heading", { name: "Register Policy Document" })).not.toBeInTheDocument();
  });
});
