// Formatted citation lines (styled runs from a template, or plain text
// from Legacy/Enhanced and pasted text) and copying them with their
// italics and bold intact.
import { useEffect, useState } from "react";
import { Button, Stack, Text } from "@mantine/core";
import { linesToHtml, linesToText, type TemplateRun } from "../../store/citationTemplateSyntax";
import { t } from "../../i18n/i18n";

/** Plain lines as runs, for formats that have no styles. */
export function plainLines(lines: string[]): TemplateRun[][] {
  return lines.filter(Boolean).map((text) => [{ text }]);
}

/** The lines, the first flush and the rest indented, as Gramps' report
 * endnotes print a citation. */
export function CitationLinesView({ lines }: { lines: TemplateRun[][] }) {
  return (
    <Stack gap={2}>
      {lines.map((runs, i) => (
        <Text key={i} size="sm" pl={i > 0 ? "md" : undefined} style={{ userSelect: "text" }}>
          {runs.map((run, j) => (
            <Text key={j} component="span" inherit fs={run.italic ? "italic" : undefined} fw={run.bold ? 700 : undefined}>
              {run.text}
            </Text>
          ))}
        </Text>
      ))}
    </Stack>
  );
}

/** Puts the lines on the clipboard as both formatted text (HTML: pasted
 * into a word processor or e-mail it keeps italics and bold) and plain
 * text (everywhere else), or only plain text where the browser can't
 * write both. */
export async function copyCitationLines(lines: TemplateRun[][]): Promise<void> {
  const text = linesToText(lines);
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([linesToHtml(lines)], { type: "text/html" }),
        }),
      ]);
      return;
    } catch {
      // Fall through to plain text.
    }
  }
  await navigator.clipboard.writeText(text);
}

export function CopyCitationButton({ lines }: { lines: TemplateRun[][] }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      size="compact-xs"
      variant="subtle"
      onClick={() => {
        copyCitationLines(lines)
          .then(() => setCopied(true))
          .catch(() => {});
      }}
    >
      {copied ? t("Copied") : t("Copy")}
    </Button>
  );
}
