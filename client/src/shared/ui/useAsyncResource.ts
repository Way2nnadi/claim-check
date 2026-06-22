import { describeFetchError } from "../../policy-documents/format";
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

export type AsyncResourceStatus = "idle" | "loading" | "ready" | "error";

export interface UseAsyncResourceResult<T> {
	status: AsyncResourceStatus;
	data: T | null;
	error: string | null;
	reload: () => Promise<T | null>;
	setData: Dispatch<SetStateAction<T | null>>;
}

export function useAsyncResource<T>(
	loader: () => Promise<T>,
	errorMessage: string,
	options: { loadOnMount?: boolean } = {},
): UseAsyncResourceResult<T> {
	const { loadOnMount = true } = options;
	const [status, setStatus] = useState<AsyncResourceStatus>(
		loadOnMount ? "loading" : "idle",
	);
	const [data, setData] = useState<T | null>(null);
	const [error, setError] = useState<string | null>(null);

	const reload = useCallback(async (): Promise<T | null> => {
		setStatus("loading");
		setError(null);

		try {
			const result = await loader();
			setData(result);
			setStatus("ready");
			return result;
		} catch (loadError: unknown) {
			setError(describeFetchError(loadError, errorMessage));
			setStatus("error");
			return null;
		}
	}, [errorMessage, loader]);

	useEffect(() => {
		if (loadOnMount) {
			void reload();
		}
	}, [loadOnMount, reload]);

	return { status, data, error, reload, setData };
}
