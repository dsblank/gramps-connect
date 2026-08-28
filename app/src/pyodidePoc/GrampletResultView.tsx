// Shared "Result" area renderer for PyodidePocPanel.tsx (the tab-per-list
// runner) and GrampletEditDialog.tsx (the editor's own Execute button) --
// one place for "how does a Gramplet's output look", rather than two
// copies of the same status/Code/table switch. A `{type: "table"}`
// response (from `columns()`/`row()`, see types.ts and pyodideWorker.ts's
// `_table_json()`) renders as a real GUI table instead of a Code block --
// the whole point of that pair existing, mirroring Gramps desktop's own
// GrampyScript addon.
import { Alert, Code, Table, Text } from "@mantine/core";
import DOMPurify from "dompurify";
import { t } from "../i18n/i18n";
import { ObjectCellButton } from "./ObjectCellButton";
import type { PyodideWorkerResponse } from "./types";

export type RunStatus = "idle" | "loading" | "done" | "error";

// print() output (response.printed), shown above whatever the run's own
// outcome was -- a table, a result value, or (most usefully) a traceback,
// since print() calls made before a mid-run crash are still in `printed`.
// Its own block rather than folded into the table/result Code below: it's
// always plain text regardless of outcome, and a table has no Code slot to
// fold it into at all.
function PrintedOutput({ text }: { text: string }) {
  if (!text) return null;
  return (
    <Code block mb="xs">
      {text}
    </Code>
  );
}

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
    <div style={interactive ? undefined : { pointerEvents: "none" }} dangerouslySetInnerHTML={{ __html: clean }} />
  );
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
  if (status === "loading") {
    return (
      <Text size="xs" c="dimmed">
        {t("Running (first run also loads Pyodide, ~14MB, cached after)…")}
      </Text>
    );
  }
  if (status === "error") {
    return (
      <>
        <PrintedOutput text={response?.type === "error" ? response.printed : ""} />
        <Alert color="red" title={t("Python error")}>
          <Code block>{response?.type === "error" ? response.text : ""}</Code>
        </Alert>
      </>
    );
  }
  if (response?.type === "html") {
    return (
      <>
        <PrintedOutput text={response.printed} />
        <HtmlOutput markup={response.markup} interactive={interactive} />
      </>
    );
  }
  if (response?.type === "table") {
    return (
      <>
        <PrintedOutput text={response.printed} />
        <Table striped withTableBorder withColumnBorders stickyHeader>
          <Table.Thead>
            <Table.Tr>
              {response.columns.map((col, i) => (
                <Table.Th key={i}>{col}</Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {response.rows.map((row, i) => (
              <Table.Tr key={i}>
                {row.map((cell, j) => (
                  <Table.Td key={j}>
                    {typeof cell === "string" ? cell
                      : interactive ? <ObjectCellButton cell={cell} />
                      : cell.text}
                  </Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </>
    );
  }
  if (response?.type === "result" && !response.text && !response.printed) {
    // pyodideWorker.ts sends "" (not the literal string "undefined") for
    // code whose last statement never reaches a trailing expression --
    // e.g. a `for` loop, whether or not it ever matched anything -- and
    // for row()/columns() calls that never appended a row (table is null
    // then too). Genuinely indistinguishable from a Gramplet explicitly
    // producing an empty string; a rare enough case that showing this
    // friendlier message for it too is an acceptable trade-off. Skipped
    // when the code printed something, even with no expression result --
    // the printed text below is the output then, not nothing.
    return (
      <Text size="xs" c="dimmed">
        {t("No output -- the code didn't produce a result, and row() was never called.")}
      </Text>
    );
  }
  return (
    <>
      <PrintedOutput text={response?.type === "result" ? response.printed : ""} />
      <Code block>{response?.type === "result" ? response.text : ""}</Code>
    </>
  );
}
