import {
  formatAggregationPeriod,
  formatViolationComparison,
  hasAggregationWindowContext,
} from "./format";
import type { AggregationWindowContext } from "./types";

interface AggregationWindowDetailProps {
  context: AggregationWindowContext | null | undefined;
}

export default function AggregationWindowDetail({
  context,
}: AggregationWindowDetailProps) {
  if (!hasAggregationWindowContext(context) || !context) {
    return null;
  }

  const comparison = formatViolationComparison(
    context.policy_limit,
    context.aggregate_value,
  );

  return (
    <div className="compliance-evaluation-aggregation-context">
      <p className="compliance-evaluation-aggregation-heading">
        <span className="compliance-evaluation-detail-label">Aggregation</span>
        {formatAggregationPeriod(context.aggregation_period)}
      </p>
      {comparison ? (
        <p className="compliance-evaluation-aggregation-comparison">{comparison}</p>
      ) : null}
      {context.included_rows.length > 0 ? (
        <ul className="compliance-evaluation-aggregation-rows">
          {context.included_rows.map((row) => (
            <li key={row.row_index}>
              Row {row.row_index + 1}
              {row.row_amount ? (
                <>
                  {" "}
                  · <span className="compliance-evaluation-comparison-value">{row.row_amount}</span>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {context.trip_id ? (
        <p className="compliance-evaluation-aggregation-meta">
          Trip ID: <code className="db-mono">{context.trip_id}</code>
        </p>
      ) : null}
      {context.attendee_count !== null && context.attendee_count > 1 ? (
        <p className="compliance-evaluation-aggregation-meta">
          Attendees: {context.attendee_count}
        </p>
      ) : null}
      {context.grouping_note ? (
        <p className="compliance-evaluation-aggregation-note">{context.grouping_note}</p>
      ) : null}
    </div>
  );
}
