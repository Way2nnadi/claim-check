# Policy Pipeline

## Local development

Run the backend and client in separate terminals.

### Backend

1. Install Python dependencies:

```bash
uv sync
```

2. Create a local Postgres database named `policy_pipeline` and set environment values in `.env`:

```env
POLICY_PIPELINE_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/policy_pipeline
```

CORS for the Vite dev origin (`http://127.0.0.1:5173`) is enabled by default. Override with `POLICY_PIPELINE_CORS_ALLOWED_ORIGINS` when the client runs on a different host or port.

3. Apply the database schema:

```bash
uv run alembic upgrade head
```

4. Start the API on `127.0.0.1:8000`:

```bash
uv run dev
```

### Client

1. Install frontend dependencies:

```bash
npm ci --prefix client
```

2. Start the Vite dev server on `127.0.0.1:5173`:

```bash
npm run client:dev
```

The client proxies `/api/*` requests to `http://127.0.0.1:8000` by default. To point at a different backend, set `POLICY_PIPELINE_CLIENT_API_PROXY_TARGET` before starting Vite.

### Local sign-in

With the default local auth settings, use one of these bearer tokens from the sign-in screen:

- `local-admin-token`
- `local-approver-token`
- `local-viewer-token`

## Expense Report CSV import

Expense Reports are imported from a fixed-template CSV on an all-or-nothing basis.
If any row fails validation, the API returns file-level and row-level errors and does not persist a partial Expense Report.

## Client architecture (v1)

The Policy Pipeline Client uses **Vite + React + TypeScript** with a single-page shell and local component state for navigation and data loading. Issue #41 originally suggested **React Router** and **TanStack Query**; v1 intentionally omits both:

- **Navigation** lives in `App.tsx` section state rather than URL routes. Deep links and browser back/forward are deferred.
- **Server state** uses `fetch` wrappers in `api.ts` plus per-screen `useEffect` loads instead of a shared query cache. Polling and cache invalidation can be added when extraction-run refresh becomes painful.

This keeps the first client thin and shippable while preserving the same backend API boundary.
