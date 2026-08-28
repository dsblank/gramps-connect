// Shared "Result" area renderer for PyodidePocPanel.tsx (the tab-per-list
// runner) and GrampletEditDialog.tsx (the editor's own Execute button) --
// one place for "how does a Gramplet's output look", rather than two
// copies of the same status/Code/table switch. A `{type: "blocks"}`
// response (from `columns()`/`row()`/`html()`/`print()`, see GrampletBlock
// in types.ts and pyodideWorker.ts's `_finalize_blocks()`) renders each
// block, in call order, as a real GUI table or raw markup instead of a
// single Code block -- the whole point of that quartet existing, mirroring
// Gramps desktop's own GrampyScript addon.
import { Alert, Code, Table, Text } from "@mantine/core";
import DOMPurify from "dompurify";
import { t } from "../i18n/i18n";
import { ObjectCellButton } from "./ObjectCellButton";
import type { GrampletBlock, PyodideWorkerResponse, TableCell } from "./types";

// "queued": posted to the worker but not yet actually running -- another
// Gramplet's own script has the shared interpreter (pyodideWorker.ts
// serializes: at most one runs Python at a time) and hasn't finished yet.
// Distinct from "loading" (that request's own PyodideWorkerResponse of
// type "started" hasn't arrived) so switching to a tab behind a slow one
// reads as "waiting its turn", not "something's broken/stuck".
export type RunStatus = "idle" | "queued" | "loading" | "done" | "error";

// html(markup)'s result -- sanitized right here, the one place this
// untrusted string (arbitrary Python's own choice of text, see types.ts's
// ObjectCell doc comment) actually reaches the DOM, rather than trusting
// pyodideWorker.ts to have done it. `interactive=false` (the editor's own
// Execute preview) additionally blocks pointer events on the whole thing --
// DOMPurify strips scripts/handlers but a plain, sanitized <a href> inside
// the markup would still navigate the app away on click otherwise, same
// "don't lose the unsaved edit" reasoning ObjectCellButton's own
// interactive prop exists for.
function HtmlOutput({ markup, interactive }: { markup: string; interactive: boolean }) {
  const clean = DOMPurify.sanitize(markup);
  return (
    <div
      style={{
        marginBottom: "var(--mantine-spacing-xs)",
        ...(interactive ? undefined : { pointerEvents: "none" }),
      }}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}

function TableOutput({
  columns,
  rows,
  interactive,
}: {
  columns: string[];
  rows: TableCell[][];
  interactive: boolean;
}) {
  return (
    <Table
      striped
      withTableBorder
      withColumnBorders
      stickyHeader
      mb="xs"
      // Mantine's <Table> sets border-collapse: collapse unconditionally --
      // a well-documented CSS quirk that silently disables position: sticky
      // on <thead> in every browser (border-collapse: separate is required
      // for a sticky header to actually stick while scrolling), so this
      // overrides it back with an inline style (highest specificity, wins
      // over the class). border-spacing: 0 keeps the collapsed look --
      // separate's own default spacing would otherwise show gaps between
      // cells.
      style={{ borderCollapse: "separate", borderSpacing: 0 }}
    >
      <Table.Thead>
        <Table.Tr>
          {columns.map((col, i) => (
            <Table.Th key={i}>{col}</Table.Th>
          ))}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((row, i) => (
          <Table.Tr key={i}>
            {row.map((cell, j) => (
              <Table.Td key={j}>
                {typeof cell === "string" ? cell : interactive ? <ObjectCellButton cell={cell} /> : cell.text}
              </Table.Td>
            ))}
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

// One block's worth of output -- see GrampletBlock in types.ts. Rendered in
// call order, so html()/row() calls interleaved in a single run each keep
// their own place in the result instead of one silently overwriting another.
function BlockOutput({ block, interactive }: { block: GrampletBlock; interactive: boolean }) {
  if (block.type === "html") {
    return <HtmlOutput markup={block.markup} interactive={interactive} />;
  }
  return <TableOutput columns={block.columns} rows={block.rows} interactive={interactive} />;
}

export function GrampletResultView({
  status,
  response,
  // Off in GrampletEditDialog.tsx: an object cell's popup navigates via
  // hash.ts's formatHash(), which changes the route -- fine from
  // PyodidePocPanel.tsx's own tab (there's nothing there to lose), but the
  // editor holds an unsaved `code` draft in local state that a route
  // change would unmount and lose. Rendered as plain text rather than the
  // clickable ObjectCellButton so there's no dead-looking affordance to
  // click in the editor's own Execute-result preview.
  interactive = true,
}: {
  status: RunStatus;
  response: PyodideWorkerResponse | null;
  interactive?: boolean;
}) {
  if (status === "idle") {
    return (
      <Text size="xs" c="dimmed">
        {t("No output yet -- click Execute to run this Gramplet.")}
      </Text>
    );
  }
  if (status === "queued") {
    return (
      <Text size="xs" c="dimmed">
        {t("Waiting for another Gramplet to finish running…")}
      </Text>
    );
  }
  if (status === "loading") {
    // A live "progress" message (see PyodideWorkerResponse in types.ts) --
    // print()'s own snapshot-so-far, sent mid-run -- renders the same way
    // a finished run's blocks do, so a print()-then-time.sleep() loop's
    // output shows up as it happens instead of only once the whole run
    // finishes. Falls through to the plain "Running…" text below until the
    // first one arrives (nothing printed yet, or the code never calls
    // print() at all).
    if (response?.type === "progress" && response.blocks.length > 0) {
      return (
        <>
          {response.blocks.map((block, i) => (
            <BlockOutput key={i} block={block} interactive={interactive} />
          ))}
          <Text size="xs" c="dimmed">
            {t("Running…")}
          </Text>
        </>
      );
    }
    return (
      <Text size="xs" c="dimmed">
        {t("Running (first run also loads Pyodide, ~14MB, cached after)…")}
      </Text>
    );
  }
  if (status === "error") {
    return (
      <>
        {response?.type === "error" &&
          response.blocks.map((block, i) => <BlockOutput key={i} block={block} interactive={interactive} />)}
        <Alert color="red" title={t("Python error")}>
          <Code block>{response?.type === "error" ? response.text : ""}</Code>
        </Alert>
      </>
    );
  }
  if (response?.type === "blocks") {
    if (response.blocks.length === 0) {
      // Every real outcome -- a table, an html()/print() call, or the
      // code's own trailing expression value -- lands in `blocks` (see
      // GrampletBlock in types.ts and onmessage in pyodideWorker.ts), so
      // an empty array here means none of those ever happened: a `for`
      // loop with no trailing expression, whether or not it ever matched
      // anything, is the common case. Genuinely indistinguishable from a
      // Gramplet explicitly printing/returning an empty string; a rare
      // enough case that showing this friendlier message for it too is an
      // acceptable trade-off.
      return (
        <Text size="xs" c="dimmed">
          {t("No output -- the code didn't produce a result, and row()/html()/print() were never called.")}
        </Text>
      );
    }
    return (
      <>
        {response.blocks.map((block, i) => (
          <BlockOutput key={i} block={block} interactive={interactive} />
        ))}
      </>
    );
  }
  return null;
}
