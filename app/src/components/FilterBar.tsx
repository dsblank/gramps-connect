import { useState } from "react";
import { getViewStore } from "../store/registry";
import type { ViewConfig } from "../store/views";

interface FilterBarProps {
  view: ViewConfig;
}

// Quick-filter buttons compose into the same where_expr box rather than
// bypassing it with a separate filter mechanism -- they just fill in (and
// immediately apply) an example exists(...)/count(...) expression. Both
// examples use the "events" relationship, which only Person has among
// this app's views so far.
const EVENT_EXAMPLES: { label: string; expr: string }[] = [
  { label: "has events", expr: "exists(events)" },
  { label: "3+ events", expr: "count(events) > 2" },
];

/** Rendered keyed by view.key from the parent so switching views remounts
 * it fresh (clears the input/error, matching the original spike's
 * selectView() resetting #where-expr/#filter-error). */
export function FilterBar({ view }: FilterBarProps) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  async function apply(whereExpr: string | null) {
    setError(null);
    setApplying(true);
    try {
      await getViewStore(view.key).runQuery(whereExpr, false);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="filter-bar">
      <div className="filter-controls">
        <label htmlFor="where-expr">where_expr:</label>
        <input
          id="where-expr"
          type="text"
          value={input}
          placeholder={view.wherePlaceholder}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply(input.trim() || null);
          }}
        />
        <button disabled={applying} onClick={() => apply(input.trim() || null)}>
          Apply
        </button>
        <button
          disabled={applying}
          onClick={() => {
            setInput("");
            apply(null);
          }}
        >
          Clear
        </button>
      </div>
      {view.key === "person" && (
        <div className="filter-examples">
          Examples:
          {EVENT_EXAMPLES.map(({ label, expr }) => (
            <button
              key={expr}
              type="button"
              onClick={() => {
                setInput(expr);
                apply(expr);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="filter-error">{error}</div>
    </div>
  );
}
