import { describe, expect, it } from "vitest";
import {
  isValidDocumentId,
  normalizeDocumentId,
} from "./documentUpload";

describe("documentUpload", () => {
  it("normalizes document ids to lowercase kebab-case", () => {
    expect(normalizeDocumentId(" Travel Policy ")).toBe("travel-policy");
  });

  it("accepts valid document ids", () => {
    expect(isValidDocumentId("expense-policy")).toBe(true);
    expect(isValidDocumentId("expense-policy-v3")).toBe(true);
  });

  it("rejects invalid document ids", () => {
    expect(isValidDocumentId("")).toBe(false);
    expect(isValidDocumentId("Expense Policy")).toBe(false);
    expect(isValidDocumentId("-expense-policy")).toBe(false);
    expect(isValidDocumentId("expense_policy")).toBe(false);
  });
});
