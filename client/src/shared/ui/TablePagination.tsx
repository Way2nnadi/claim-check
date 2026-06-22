export const TABLE_PAGE_SIZE = 10;

interface TablePaginationProps {
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
  idPrefix?: string;
}

function formatRowRange(
  page: number,
  pageSize: number,
  totalCount: number,
  itemLabel: string,
): string {
  if (totalCount === 0) {
    return `0 ${itemLabel}`;
  }
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalCount);
  return `${start}–${end} of ${totalCount} ${itemLabel}`;
}

export default function TablePagination({
  page,
  pageSize,
  totalCount,
  onPageChange,
  itemLabel = "rows",
  idPrefix = "table-pagination",
}: TablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);

  if (totalCount <= pageSize) {
    return null;
  }

  return (
    <nav
      className="table-pagination"
      aria-label={`${itemLabel} pagination`}
    >
      <p className="table-pagination-range" id={`${idPrefix}-range`}>
        {formatRowRange(safePage, pageSize, totalCount, itemLabel)}
      </p>
      <div className="table-pagination-actions">
        <button
          type="button"
          className="document-command compact table-pagination-button"
          aria-label={`Previous page of ${itemLabel}`}
          aria-controls={`${idPrefix}-panel`}
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          className="document-command compact table-pagination-button"
          aria-label={`Next page of ${itemLabel}`}
          aria-controls={`${idPrefix}-panel`}
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
        >
          Next
        </button>
      </div>
    </nav>
  );
}

export function paginateItems<T>(
  items: readonly T[],
  page: number,
  pageSize: number,
): {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  startIndex: number;
} {
  const totalCount = items.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const startIndex = (safePage - 1) * pageSize;

  return {
    items: items.slice(startIndex, startIndex + pageSize),
    page: safePage,
    pageSize,
    totalCount,
    totalPages,
    startIndex,
  };
}
