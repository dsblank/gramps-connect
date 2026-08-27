// Shared "Result" area renderer for PyodidePocPanel.tsx (the tab-per-list
// runner) and GrampletEditDialog.tsx (the editor's own Execute button) --
// one place for "how does a Gramplet's output look", rather than two
// copies of the same status/Code/table switch. A `{type: "table"}`
// response (from `columns()`/`row()`, see types.ts and pyodideWorker.ts's
// `_table_json()`) renders as a real GUI table instead of a Code block --
// the whole point of that pair existing, mirroring Gramps desktop's own
// GrampyScript addon.
import { Alert, Code, Table, Text } from "@mantine/core";
import { t } from "../i18n/i18n";
import type { PyodideWorkerResponse } from "./types";

export type RunStatus = "idle" | "loading" | "done" | "error";

export function GrampletResultView({ status, response }: { status: RunStatus; response: PyodideWorkerResponse | null }) {
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
      <Alert color="red" title={t("Python error")}>
        <Code block>{response?.type === "error" ? response.text : ""}</Code>
      </Alert>
    );
  }
  if (response?.type === "table") {
    return (
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
                <Table.Td key={j}>{cell}</Table.Td>
              ))}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    );
  }
  if (response?.type === "result" && !response.text) {
    // pyodideWorker.ts sends "" (not the literal string "undefined") for
    // code whose last statement never reaches a trailing expression --
    // e.g. a `for` loop, whether or not it ever matched anything -- and
    // for row()/columns() calls that never appended a row (table is null
    // then too). Genuinely indistinguishable from a Gramplet explicitly
    // producing an empty string; a rare enough case that showing this
    // friendlier message for it too is an acceptable trade-off.
    return (
      <Text size="xs" c="dimmed">
        {t("No output -- the code didn't produce a result, and row() was never called.")}
      </Text>
    );
  }
  return <Code block>{response?.type === "result" ? response.text : ""}</Code>;
}
