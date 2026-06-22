import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DocumentDetail from "./DocumentDetail";

const expenseVersions = {
  items: [
    {
      document_id: "expense-policy",
      document_version_id: "docv-expense-v2",
      filename: "expense-policy-v2.pdf",
      content_type: "application/pdf",
      size_bytes: 2048,
      sha256: "abc123def4567890abcdef1234567890abcdef1234567890abcdef1234567890",
      created_at: "2026-06-22T10:00:00Z",
      deleted_at: null,
      deletion_reason: null,
    },
    {
      document_id: "expense-policy",
      document_version_id: "docv-expense-v1",
      filename: "expense-policy-v1.pdf",
      content_type: "application/pdf",
      size_bytes: 1024,
      sha256: "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321",
      created_at: "2026-06-20T10:00:00Z",
      deleted_at: "2026-06-20T10:00:00Z",
      deletion_reason: "Superseded by v2",
    },
  ],
};

describe("DocumentDetail", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("lists all document versions including archived uploads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => expenseVersions,
      }),
    );

    render(<DocumentDetail documentId="expense-policy" onBack={() => undefined} />);

    expect(await screen.findByText("docv-expense-v2")).toBeInTheDocument();
    expect(screen.getByText("expense-policy-v2.pdf")).toBeInTheDocument();
    expect(screen.queryByText("docv-expense-v1")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /Archived/i }));

    expect(await screen.findByText("docv-expense-v1")).toBeInTheDocument();
    expect(screen.getByText("Superseded by v2")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Archived/i })).toHaveAttribute("aria-selected", "true");
  });

  it("downloads active document versions as raw bytes", async () => {
    const blob = new Blob(["pdf-bytes"], { type: "application/pdf" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => expenseVersions,
      })
      .mockResolvedValueOnce({
        ok: true,
        blob: async () => blob,
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
      createObjectURL: vi.fn().mockReturnValue("blob:mock"),
      revokeObjectURL: vi.fn(),
    });

    render(<DocumentDetail documentId="expense-policy" onBack={() => undefined} />);

    await screen.findByText("docv-expense-v2");
    const [downloadButton] = screen.getAllByRole("button", { name: "Retrieve source" });
    if (!downloadButton) {
      throw new Error("Expected a download button for the active document version.");
    }
    await userEvent.click(downloadButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/policy-documents/expense-policy/versions/docv-expense-v2",
        expect.objectContaining({
          headers: expect.any(Headers),
        }),
      );
    });
    expect(clickMock).toHaveBeenCalled();
    expect(link.download).toBe("expense-policy-v2.pdf");
  });

  it("disables download for archived versions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => expenseVersions,
      }),
    );

    render(<DocumentDetail documentId="expense-policy" onBack={() => undefined} />);

    await screen.findByText("docv-expense-v2");
    expect(screen.getByRole("button", { name: "Retrieve source" })).not.toBeDisabled();

    await userEvent.click(screen.getByRole("tab", { name: /Archived/i }));
    await screen.findByText("docv-expense-v1");
    expect(screen.getByRole("button", { name: "Retrieve source" })).toBeDisabled();
    expect(screen.getByText(/Source unavailable for archived versions/)).toBeInTheDocument();
  });

  it("shows a not-found state for unknown document ids", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ items: [] }),
      }),
    );

    render(<DocumentDetail documentId="missing-policy" onBack={() => undefined} />);

    const notFound = (await screen.findByRole("heading", { name: "Document not found" })).closest(
      ".document-not-found",
    );
    expect(notFound).not.toBeNull();
    expect(within(notFound as HTMLElement).getByText("missing-policy")).toBeInTheDocument();
  });

  it("shows the upload drawer for admins and hides it for viewers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => expenseVersions,
      }),
    );

    const { rerender } = render(
      <DocumentDetail documentId="expense-policy" canUpload onBack={() => undefined} />,
    );

    await screen.findByText("docv-expense-v2");
    expect(screen.queryByRole("heading", { name: "New Document Version" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "New version" }));
    expect(screen.getByRole("heading", { name: "New Document Version" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deposit version" })).toBeInTheDocument();

    rerender(<DocumentDetail documentId="expense-policy" canUpload={false} onBack={() => undefined} />);
    expect(screen.queryByRole("heading", { name: "New Document Version" })).not.toBeInTheDocument();
  });

  it("uploads a document version and refreshes the ledger", async () => {
    const newVersion = {
      document_id: "expense-policy",
      document_version_id: "docv-expense-v3",
      filename: "expense-policy-v3.pdf",
      content_type: "application/pdf",
      size_bytes: 4096,
      sha256: "1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff",
      created_at: "2026-06-23T10:00:00Z",
      deleted_at: null,
      deletion_reason: null,
    };
    const refreshedVersions = {
      items: [newVersion, ...expenseVersions.items],
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => expenseVersions,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => newVersion,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => refreshedVersions,
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<DocumentDetail documentId="expense-policy" canUpload onBack={() => undefined} />);

    await screen.findByText("docv-expense-v2");
    await userEvent.click(screen.getByRole("button", { name: "New version" }));
    const file = new File(["pdf-bytes"], "expense-policy-v3.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText(/Select PDF or DOCX/i), file);
    await userEvent.click(screen.getByRole("button", { name: "Deposit version" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/policy-documents/expense-policy/versions",
        expect.objectContaining({
          method: "POST",
          body: expect.any(FormData),
        }),
      );
    });

    expect(await screen.findByText("docv-expense-v3")).toBeInTheDocument();
    expect(screen.getByText(/Prior Document Versions remain unchanged/)).toBeInTheDocument();
    expect(screen.getByText("docv-expense-v2")).toBeInTheDocument();
  });

  it("surfaces quality gate rejection messages from the backend", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => expenseVersions,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({
          detail: "Malformed PDF files are not supported because the file could not be parsed.",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<DocumentDetail documentId="expense-policy" canUpload onBack={() => undefined} />);

    await screen.findByText("docv-expense-v2");
    await userEvent.click(screen.getByRole("button", { name: "New version" }));
    const file = new File(["not-a-pdf"], "broken.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText(/Select PDF or DOCX/i), file);
    await userEvent.click(screen.getByRole("button", { name: "Deposit version" }));

    expect(
      await screen.findByText(
        "Malformed PDF files are not supported because the file could not be parsed.",
      ),
    ).toBeInTheDocument();
  });

  it("rejects unsupported file formats before upload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => expenseVersions,
      }),
    );

    render(<DocumentDetail documentId="expense-policy" canUpload onBack={() => undefined} />);

    await screen.findByText("docv-expense-v2");
    await userEvent.click(screen.getByRole("button", { name: "New version" }));
    const file = new File(["plain text"], "notes.pdf", { type: "text/plain" });
    await userEvent.upload(screen.getByLabelText(/Select PDF or DOCX/i), file);

    expect(
      screen.getByText("Only native-digital PDF and DOCX Policy Documents are supported."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deposit version" })).toBeDisabled();
  });

  it("shows archive controls for admins and hides them for viewers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => expenseVersions,
      }),
    );

    const { rerender } = render(
      <DocumentDetail documentId="expense-policy" canUpload onBack={() => undefined} />,
    );

    await screen.findByText("docv-expense-v2");
    expect(screen.getByRole("button", { name: "Strike from register" })).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: "Strike from register" })).toHaveLength(1);

    rerender(<DocumentDetail documentId="expense-policy" canUpload={false} onBack={() => undefined} />);
    expect(screen.queryByRole("button", { name: "Strike from register" })).not.toBeInTheDocument();
  });

  it("requires a deletion reason before archiving a version", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => expenseVersions,
      }),
    );

    render(<DocumentDetail documentId="expense-policy" canUpload onBack={() => undefined} />);

    await screen.findByText("docv-expense-v2");
    await userEvent.click(screen.getByRole("button", { name: "Strike from register" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm archive" }));

    expect(
      screen.getByText("Enter a reason before striking this version from the register."),
    ).toBeInTheDocument();
  });

  it("archives a document version and refreshes the ledger", async () => {
    const archivedVersion = {
      ...expenseVersions.items[0],
      deleted_at: "2026-06-21T16:00:00Z",
      deletion_reason: "Superseded by corrected policy language.",
    };
    const refreshedVersions = {
      items: [archivedVersion, expenseVersions.items[1]],
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => expenseVersions,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => archivedVersion,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => refreshedVersions,
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<DocumentDetail documentId="expense-policy" canUpload onBack={() => undefined} />);

    await screen.findByText("docv-expense-v2");
    await userEvent.click(screen.getByRole("button", { name: "Strike from register" }));
    await userEvent.type(
      screen.getByLabelText("Deletion reason"),
      "Superseded by corrected policy language.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Confirm archive" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/policy-documents/expense-policy/versions/docv-expense-v2",
        expect.objectContaining({
          method: "DELETE",
          body: JSON.stringify({ reason: "Superseded by corrected policy language." }),
        }),
      );
    });

    expect(await screen.findByText("Superseded by corrected policy language.")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Archived/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Archived/i })).toHaveTextContent("2");
    expect(screen.queryByRole("button", { name: "Strike from register" })).not.toBeInTheDocument();
  });

  it("surfaces retention and not-found errors from the backend", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => expenseVersions,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          detail:
            "Document Version is retained until 2099-01-01T00:00:00Z and cannot be deleted yet.",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<DocumentDetail documentId="expense-policy" canUpload onBack={() => undefined} />);

    await screen.findByText("docv-expense-v2");
    await userEvent.click(screen.getByRole("button", { name: "Strike from register" }));
    await userEvent.type(screen.getByLabelText("Deletion reason"), "Cleanup attempt.");
    await userEvent.click(screen.getByRole("button", { name: "Confirm archive" }));

    expect(
      await screen.findByText(
        "Document Version is retained until 2099-01-01T00:00:00Z and cannot be deleted yet.",
      ),
    ).toBeInTheDocument();
  });
});
