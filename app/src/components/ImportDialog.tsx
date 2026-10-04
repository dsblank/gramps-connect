import { useState } from "react";
import { Alert, Button, Code, CopyButton, FileButton, Group, List, Loader, Modal, ScrollArea, Stack, Text } from "@mantine/core";
import { getToken } from "../auth/auth";
import {
  IMPORT_EXTENSIONS,
  formatImportMessages,
  parseImportResult,
  previewImport,
  runImport,
  type ImportCounts,
  type ImportResult,
} from "../store/importApi";
import { clearAllOpfs } from "../store/opfs";
import { describeTaskFailure, waitForTask } from "../store/taskApi";
import { t } from "../i18n/i18n";

type Stage = "select" | "previewing" | "preview" | "importing" | "done" | "error";

// ObjectCountsSchema's fixed field set (gramps-web-api's schemas.py).
const COUNT_LABELS: Record<string, string> = {
  people: "People",
  families: "Families",
  events: "Events",
  places: "Places",
  repositories: "Repositories",
  sources: "Sources",
  citations: "Citations",
  media: "Media",
  notes: "Notes",
  tags: "Tags",
};

const BUSY_STAGES = new Set<Stage>(["previewing", "importing"]);

interface ImportDialogProps {
  opened: boolean;
  onClose: () => void;
}

function CountList({ counts }: { counts: ImportCounts }) {
  return (
    <List size="sm">
      {Object.entries(counts)
        .filter(([, n]) => n > 0)
        .map(([key, n]) => (
          <List.Item key={key}>
            {COUNT_LABELS[key] ?? key}: {n}
          </List.Item>
        ))}
    </List>
  );
}

/** The importer's diagnostics (e.g. GEDCOM lines it couldn't parse) as a
 * scrollable monospace block -- the GEDCOM report is one message with a
 * line per problem, so it can run long; the server already truncates it at
 * 100k chars with a closing "[Report truncated: ...]" line. */
function ImportReport({ messages, intro }: { messages: string[]; intro: string }) {
  const text = formatImportMessages(messages);
  return (
    <Alert color="yellow" title={t("Import report")}>
      <Stack gap="xs">
        <Text size="sm">{intro}</Text>
        <ScrollArea.Autosize mah={300} type="auto">
          <Code block style={{ whiteSpace: "pre" }}>
            {text}
          </Code>
        </ScrollArea.Autosize>
        <Group justify="flex-end">
          <CopyButton value={text}>
            {({ copied, copy }) => (
              <Button size="xs" variant="subtle" onClick={copy}>
                {copied ? t("Copied") : t("Copy report")}
              </Button>
            )}
          </CopyButton>
        </Group>
      </Stack>
    </Alert>
  );
}

function extensionOf(file: File): string {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}

/** Family Trees -> Import... flow: pick a file, preview its object counts
 * (plus any importer report, e.g. unparseable GEDCOM lines) via a dry run,
 * then confirm to run the real import. A real import that itself reports
 * problems stops on a "done" stage showing them before reloading; one that
 * doesn't reloads straight away. Both preview and the
 * real import dispatch the same Celery task (import_file) gramps-web-api
 * already runs for gramps-web's own import screen, so this just drives that
 * existing endpoint rather than adding anything server-side. */
export function ImportDialog({ opened, onClose }: ImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("select");
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [imported, setImported] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");

  function reset() {
    setFile(null);
    setStage("select");
    setPreview(null);
    setImported(null);
    setError("");
  }

  function handleClose() {
    if (BUSY_STAGES.has(stage)) return;
    if (stage === "done") {
      // the import landed -- every view's cache is already cleared, so
      // closing has to reload just like the Reload button does
      window.location.reload();
      return;
    }
    reset();
    onClose();
  }

  async function handlePreview() {
    if (!file) return;
    const ext = extensionOf(file);
    if (!(IMPORT_EXTENSIONS as readonly string[]).includes(ext)) {
      setError(`Unsupported file type: .${ext || "?"}`);
      setStage("error");
      return;
    }
    setStage("previewing");
    try {
      const token = await getToken();
      const result = await previewImport(token, ext, file);
      setPreview(
        result.kind === "task"
          ? parseImportResult((await waitForTask(result.task.id)).result_object)
          : result.result
      );
      setStage("preview");
    } catch (err: any) {
      setError(err.message ?? String(err));
      setStage("error");
    }
  }

  async function handleConfirm() {
    if (!file) return;
    const ext = extensionOf(file);
    setStage("importing");
    try {
      const token = await getToken();
      const result = await runImport(token, ext, file);
      let outcome: ImportResult;
      if (result.kind === "task") {
        const status = await waitForTask(result.task.id);
        if (status.state !== "SUCCESS") {
          throw new Error(describeTaskFailure(status));
        }
        outcome = parseImportResult(status.result_object);
      } else {
        outcome = result.result;
      }
      // Every view's local cache is now stale (it's missing the newly
      // imported rows) -- see clearAllOpfs()'s doc comment. With nothing
      // to report, reload straight away rather than making the user click
      // through a second dialog; otherwise show the report first.
      await clearAllOpfs();
      if (outcome.messages.length === 0) {
        window.location.reload();
        return;
      }
      setImported(outcome);
      setStage("done");
    } catch (err: any) {
      setError(err.message ?? String(err));
      setStage("error");
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={t("Import Family Tree")}
      size={(stage === "preview" && preview?.messages.length) || stage === "done" ? "lg" : "md"}
      closeOnClickOutside={!BUSY_STAGES.has(stage)}
      closeOnEscape={!BUSY_STAGES.has(stage)}
    >
      <Stack gap="md">
        {stage === "select" && (
          <>
            <FileButton onChange={setFile} accept={IMPORT_EXTENSIONS.map((ext) => `.${ext}`).join(",")}>
              {(props) => (
                <Button {...props} variant="light">
                  {t("Choose file")}
                </Button>
              )}
            </FileButton>
            {file && <Text size="sm">{file.name}</Text>}
            <Group justify="flex-end">
              <Button variant="default" onClick={handleClose}>
                {t("Cancel")}
              </Button>
              <Button disabled={!file} onClick={handlePreview}>
                {t("Preview")}
              </Button>
            </Group>
          </>
        )}

        {stage === "previewing" && (
          <Group justify="center" py="md">
            <Loader size="sm" />
            <Text size="sm">{t("Reading file…")}</Text>
          </Group>
        )}

        {stage === "preview" && preview && (
          <>
            <Text size="sm">{t("This file contains:")}</Text>
            <CountList counts={preview.counts} />
            {preview.messages.length > 0 && (
              <ImportReport
                messages={preview.messages}
                intro={t("The importer reported problems reading this file. Importing anyway will skip or approximate the data below.")}
              />
            )}
            <Text size="sm" c="dimmed">
              {t("Importing adds this data to the current family tree and locks it for writes by everyone else until it finishes. This cannot be undone from here.")}
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={handleClose}>
                {t("Cancel")}
              </Button>
              <Button onClick={handleConfirm}>{t("Import")}</Button>
            </Group>
          </>
        )}

        {stage === "importing" && (
          <Group justify="center" py="md">
            <Loader size="sm" />
            <Text size="sm">{t("Importing… this may take a while.")}</Text>
          </Group>
        )}

        {stage === "done" && imported && (
          <>
            <Text size="sm">{t("Import finished. Imported:")}</Text>
            <CountList counts={imported.counts} />
            <ImportReport
              messages={imported.messages}
              intro={t("Some of the file could not be imported as-is:")}
            />
            <Group justify="flex-end">
              <Button onClick={() => window.location.reload()}>{t("Reload")}</Button>
            </Group>
          </>
        )}

        {stage === "error" && (
          <>
            <Alert color="red" title={t("Import failed")}>
              {error}
            </Alert>
            <Group justify="flex-end">
              <Button variant="default" onClick={reset}>
                {t("Try again")}
              </Button>
              <Button variant="subtle" onClick={handleClose}>
                {t("Close")}
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
