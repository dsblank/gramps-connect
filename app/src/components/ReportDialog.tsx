import { useEffect, useState } from "react";
import {
  Alert,
  Anchor,
  Button,
  Collapse,
  ColorInput,
  Group,
  Loader,
  Modal,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { getToken } from "../auth/auth";
import { getViewStore } from "../store/registry";
import { getReport, runReport, type ReportDetail } from "../store/reportsApi";
import {
  describeReportRun,
  parseReportOptions,
  toRequestOptions,
  type OptionField,
} from "../store/reportOptions";
import { trackJob } from "../store/jobsPoll";
import { jobsPollCallbacks, notifyJobStarted } from "../store/jobsCallbacks";
import { promoteJob } from "../store/jobsPromote";

type Stage = "loading" | "ready" | "error";

// Above this many choices a plain dropdown stops being usable -- the
// person-valued options list every person in the tree (2157 in the dev
// fixture), so those get a search box and a capped visible list instead.
const SEARCHABLE_ABOVE = 20;

// Views whose selected row can pre-fill a report's subject. Keyed by
// ViewConfig.key, and matched to options purely by value (see
// prefillFromSelection) rather than by guessing which option is a
// PersonOption -- the abstract schema doesn't say.
const PREFILL_VIEWS = ["person", "family", "note", "media"];

interface ReportDialogProps {
  reportId: string | null;
  onClose: () => void;
}

/** Gramps IDs of whatever is currently selected in the views a report can
 * take as a subject. Nothing here forces a view to load: an unvisited
 * view has no cache to read and simply contributes nothing. */
function selectedGrampsIds(): string[] {
  const ids: string[] = [];
  for (const key of PREFILL_VIEWS) {
    const store = getViewStore(key);
    const handle = store.getSnapshot().selectedHandle;
    if (!handle) continue;
    const grampsId = store.grampsIdForHandle(handle);
    if (grampsId) ids.push(grampsId);
  }
  return ids;
}

/** Seeds each field with its parsed initial value, then upgrades any
 * enumerated field that *offers* a currently-selected record to that
 * record. Matching on the value means this can only ever produce
 * something the server's own validate_options() already accepts, and that
 * an option enumerating plain indices ("0", "1", "2" -- the filter
 * selectors) can't be hit by accident. */
function initialValues(fields: OptionField[]): Record<string, string> {
  const selected = selectedGrampsIds();
  const values: Record<string, string> = {};
  for (const field of fields) {
    const match = field.choices?.find((choice) => selected.includes(choice.value));
    values[field.key] = match ? match.value : field.initial;
  }
  return values;
}

/** Runs one report: a dialog built entirely from the report's own
 * abstract option schema (see store/reportOptions.ts), with no per-report
 * knowledge here or anywhere else -- so an addon report the server picks
 * up renders as readily as a stock one.
 *
 * Dispatching hands off to the pipeline that already existed: the file
 * becomes a `report`-tagged Media object and shows up in the Output view,
 * announced by the same toast the catch-up sweep uses. That's fire and
 * forget, so the dialog closes on Generate rather than sitting open
 * waiting for a report that may take minutes. */
export function ReportDialog({ reportId, onClose }: ReportDialogProps) {
  const [stage, setStage] = useState<Stage>("loading");
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [fields, setFields] = useState<OptionField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [showPaper, setShowPaper] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!reportId) return;
    let cancelled = false;
    setStage("loading");
    setShowPaper(false);
    (async () => {
      try {
        const detail = await getReport(await getToken(), reportId);
        if (cancelled) return;
        const parsed = parseReportOptions(detail.options_dict, detail.options_help);
        setReport(detail);
        setFields(parsed);
        setValues(initialValues(parsed));
        setStage("ready");
      } catch (err: any) {
        if (cancelled) return;
        setError(err.message ?? String(err));
        setStage("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  function setValue(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  /** Dispatches the report and closes immediately, without awaiting any of
   * it -- a report can take minutes, and none of that time needs the
   * dialog (or the user) present.
   *
   * Closing first matters most where it's least obvious. With a Celery
   * broker the POST returns a task id straight away and it's trackJob()
   * that does the waiting. *Without* one, run_task() (gramps-web-api's
   * api/tasks.py) runs the report inline, so the POST itself doesn't
   * return until the file exists -- awaiting it here is what pinned a
   * spinner to the dialog for the whole generation. Either way the request
   * outlives the dialog and the toasts report how it went.
   *
   * The one thing lost on the inline path is closing the tab mid-run: the
   * catch-up sweep can only rescue jobs that reached Celery, so there's no
   * TaskTree row to find one by. Nothing to be done client-side about
   * that; a deployment with a broker doesn't have the problem. */
  function handleGenerate() {
    if (!report) return;
    const { id, name } = report;
    const desc = describeReportRun(name, fields, values);
    const options = toRequestOptions(fields, values);
    onClose();
    notifyJobStarted("report", name);

    (async () => {
      const token = await getToken();
      const result = await runReport(token, id, options);
      if (result.kind === "task") {
        // trackJob() polls, promotes and toasts on its own, and is
        // deliberately not awaited (see its doc comment).
        trackJob(result.taskId, "report", jobsPollCallbacks, desc);
        return;
      }
      // Ran inline, so the finished file is already there -- same
      // promotion, just with no task to watch first.
      const promoted = await promoteJob(token, "report", result.url, desc);
      if (promoted) jobsPollCallbacks.onPromoted(promoted, "report");
    })().catch((err: any) => {
      jobsPollCallbacks.onFailed("report", err.message ?? String(err));
    });
  }

  // familylines_graph 422s server-side unless gidlist names at least one
  // person (validate_options in gramps_webapi/api/report.py) -- the one
  // report-specific rule the schema doesn't express, caught here rather
  // than left to come back as an opaque error after the round trip.
  const missingRequired = fields.some(
    (field) => field.kind === "personlist" && !(values[field.key] ?? "").trim()
  );

  const paperFields = fields.filter((field) => field.group === "paper");

  return (
    <Modal
      opened={reportId !== null}
      onClose={onClose}
      title={report?.name ?? "Report"}
      size="lg"
    >
      <Stack gap="md">
        {stage === "loading" && (
          <Group justify="center" py="md">
            <Loader size="sm" />
            <Text size="sm">Loading options…</Text>
          </Group>
        )}

        {/* Only ever a failure to *load* the report's options -- once
            Generate is pressed the dialog is gone, and how the run itself
            went is reported by toast (see handleGenerate). */}
        {stage === "error" && (
          <>
            <Alert color="red" title="Could not load this report">
              {error}
            </Alert>
            <Group justify="flex-end">
              <Button variant="subtle" onClick={onClose}>
                Close
              </Button>
            </Group>
          </>
        )}

        {stage === "ready" && report && (
          <>
            {report.description && (
              <Text size="sm" c="dimmed">
                {report.description}
              </Text>
            )}

            {fields
              .filter((field) => field.group !== "paper")
              .map((field) => (
                <OptionInput
                  key={field.key}
                  field={field}
                  value={values[field.key] ?? field.initial}
                  onChange={(value) => setValue(field.key, value)}
                />
              ))}

            {paperFields.length > 0 && (
              <>
                <Anchor component="button" type="button" size="sm" onClick={() => setShowPaper((v) => !v)}>
                  {showPaper ? "▾" : "▸"} Paper and formatting ({paperFields.length})
                </Anchor>
                <Collapse in={showPaper}>
                  <Stack gap="md">
                    {paperFields.map((field) => (
                      <OptionInput
                        key={field.key}
                        field={field}
                        value={values[field.key] ?? field.initial}
                        onChange={(value) => setValue(field.key, value)}
                      />
                    ))}
                  </Stack>
                </Collapse>
              </>
            )}

            <Group justify="flex-end">
              <Button variant="default" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleGenerate} disabled={missingRequired}>
                Generate
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}

interface OptionInputProps {
  field: OptionField;
  value: string;
  onChange: (value: string) => void;
}

/** One option, as whichever widget its schema kind calls for. The help
 * sentence is the only label the API offers (see store/reportOptions.ts),
 * so it's used as one directly rather than being duplicated into a
 * description underneath. */
function OptionInput({ field, value, onChange }: OptionInputProps) {
  switch (field.kind) {
    case "boolean":
      return (
        <Switch
          label={field.label}
          checked={value === "True"}
          onChange={(event) => onChange(event.currentTarget.checked ? "True" : "False")}
        />
      );

    case "select": {
      const choices = field.choices ?? [];
      return (
        <Select
          label={field.label}
          data={choices.map((choice) => ({ value: choice.value, label: choice.label }))}
          value={value}
          onChange={(next) => onChange(next ?? value)}
          searchable={choices.length > SEARCHABLE_ABOVE}
          limit={100}
          allowDeselect={false}
          comboboxProps={{ withinPortal: true }}
          // The output format's labels are deliberately terse ("PDF", see
          // reportOptions.ts) so the closed select stays readable; the
          // schema's full sentence goes underneath, where there's room.
          renderOption={
            field.key === "off"
              ? ({ option }) => {
                  const description = choices.find((c) => c.value === option.value)?.description;
                  return (
                    <div>
                      <Text size="sm">{option.label}</Text>
                      {description && (
                        <Text size="xs" c="dimmed">
                          {description}
                        </Text>
                      )}
                    </div>
                  );
                }
              : undefined
          }
        />
      );
    }

    case "number":
      return (
        <NumberInput
          label={field.label}
          value={value === "" ? "" : Number(value)}
          onChange={(next) => onChange(String(next))}
          allowDecimal={field.allowDecimal ?? true}
        />
      );

    case "color":
      return <ColorInput label={field.label} format="hex" value={value} onChange={onChange} />;

    case "textlist":
      return (
        <Textarea
          label={field.label}
          autosize
          minRows={2}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      );

    case "personlist":
      return (
        <TextInput
          label={field.label}
          description="Gramps IDs, separated by spaces"
          placeholder="I0044 I0128"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      );

    default:
      return (
        <TextInput
          label={field.label}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      );
  }
}
