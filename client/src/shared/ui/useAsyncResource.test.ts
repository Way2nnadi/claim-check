import { useAsyncResource } from "./useAsyncResource";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

describe("useAsyncResource", () => {
	it("loads data on mount and exposes ready status", async () => {
		const loader = vi.fn(async () => ({ count: 3 }));

		const { result } = renderHook(() =>
			useAsyncResource(loader, "Unable to load summary."),
		);

		await waitFor(() => {
			expect(result.current.status).toBe("ready");
		});

		expect(loader).toHaveBeenCalledTimes(1);
		expect(result.current.data).toEqual({ count: 3 });
		expect(result.current.error).toBeNull();
	});

	it("captures fetch errors through describeFetchError", async () => {
		const loader = vi.fn(async () => {
			throw new Error("network down");
		});

		const { result } = renderHook(() =>
			useAsyncResource(loader, "Unable to load documents."),
		);

		await waitFor(() => {
			expect(result.current.status).toBe("error");
		});

		expect(result.current.data).toBeNull();
		expect(result.current.error).toBe("network down");
	});

	it("reload refreshes data after a successful mutation", async () => {
		let value = 1;
		const loader = vi.fn(async () => value);

		const { result } = renderHook(() =>
			useAsyncResource(loader, "Unable to load runs."),
		);

		await waitFor(() => {
			expect(result.current.status).toBe("ready");
		});

		value = 2;
		await result.current.reload();

		await waitFor(() => {
			expect(result.current.data).toBe(2);
		});

		expect(loader).toHaveBeenCalledTimes(2);
		expect(result.current.status).toBe("ready");
	});
});
