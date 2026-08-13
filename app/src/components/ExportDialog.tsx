import { useEffect, useState } from "react";
import {
  Alert,
  Anchor,
  Button,
  Collapse,
  Group,
  Loader,
  Modal,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { getToken, hasPermissions } from "../auth/auth";
import {
  DEFAULT_LIVING,
  DEFAULT_YEARS_AFTER_DEATH,
  exportQueryParams,
  initialToggleValues,
  listExporters,
  LIVING_MODES,
  runExport,
  togglesFor,
  type ExporterSummary,
} from "../store/exportersApi";
import { exportLabel, promoteJob, stripMnemonic } from "../store/jobsPromote";
import { trackJob } from "../store/jobsPoll";
import { jobsPollCallbacks, notifyJobStarted } from "../store/jobsCallbacks";

type Stage = "loading" | "ready" | "error";

// Matches gramps-web-api's PERMISSIONS map (auth/const.py).
const PERM_VIEW_PRIVATE = "ViewPrivate";

// Offered first when it's installed: the only format that round-trips a
// tree without loss, and the one desktop Gramps recommends for backups.
const PREFERRED_EXTENSION = "gramps";

interface ExportDialogProps {
  opened: boolean;
  onClose: () => void;
}

// Fetched once per session, on the first open of the dialog, and shared by
// every instance of it (App.tsx renders one of two header layouts, each
// with its own MenuBar, and swaps between them on resize). The list is
// fixed for the life of the server process -- it's the set of installed
// exporter plugins, not tree data -- so there's nothing to invalidate.
// Same arrangement MenuBar.tsx uses for the reports list.
let exportersPromise: Promise<ExporterSummary[]> | null = null;

function loadExporters(): Promise<ExporterSummary[]> {
  if (!exportersPromise) {
    exportersPromise = (async () => listExporters(await getToken()))().catch((err) => {
      // Don't cache the failure: the next open should try again.
      exportersPromise = null;
      throw err;
    });
  }
  return exportersPromise;
}

/** Family Trees -> Export... flow: pick a format, adjust what goes into
 * it, and dispatch the export.
 *
 * The finished file isn't downloaded here. It goes down the same pipeline
 * a report does -- promoted to an `export`-tagged Media object, announced
 * by toast, and downloadable from the Output view (see store/jobsPromote.ts
 * and related/GeneratedItemActions.tsx) -- which is what lets an export
 * that takes minutes survive this dialog, this tab, and this session. */
export function ExportDialog({ opened, onClose }: ExportDialogProps) {
  const [stage, setStage] = useState<Stage>("loading");
  const [exporters, setExporters] = useState<ExporterSummary[]>([]);
  const [extension, setExtension] = useState<string>(PREFERRED_EXTENSION);
  const [toggles, setToggles] = useState<Record<string, boolean>>(initialToggleValues);
  const [living, setLiving] = useState(DEFAULT_LIVING);
  const [yearsAfterDeath, setYearsAfterDeath] = useState(DEFAULT_YEARS_AFTER_DEATH);
  const [showOptions, setShowOptions] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    setStage("loading");
    loadExporters()
      .then((list) => {
        if (cancelled) return;
        setExporters(list);
        // Only ever a *default*: a format the user picked in an earlier
        // open of this dialog stays picked, since the component stays
        // mounted between opens.
        setExtension((current) =>
          list.some((exporter) => exporter.extension === current)
            ? current
            : (list.find((exporter) => exporter.extension === PREFERRED_EXTENSION) ?? list[0])
                ?.extension ?? current
        );
        setStage(list.length === 0 ? "error" : "ready");
        if (list.length === 0) setError("This server has no exporters installed.");
      })
      .catch((err: any) => {
        if (cancelled) return;
        setError(err.message ?? String(err));
        setStage("error");
      });
    return () => {
      cancelled = true;
    };
  }, [opened]);

  const exporter = exporters.find((candidate) => candidate.extension === extension) ?? null;
  const optionToggles = togglesFor(extension);

  function setToggle(key: string, value: boolean) {
    setToggles((prev) => ({ ...prev, [key]: value }));
  }

  /** Dispatches the export and closes immediately, for exactly the reasons
   * ReportDialog.handleGenerate does (see its comment): with a Celery
   * broker the POST returns a task id at once and trackJob() does the
   * waiting; without one, run_task() runs the export inline and the POST
   * doesn't return until the file exists -- so awaiting it here would pin
   * a spinner to the dialog for the whole export of the tree. Either way
   * the request outlives the dialog and the toasts report how it went. */
  function handleExport() {
    if (!exporter) return;
    const { name } = exporter;
    const params = exportQueryParams(extension, { toggles, living, yearsAfterDeath });
    const desc = exportLabel(name);
    onClose();
    notifyJobStarted("export", stripMnemonic(name));

    (async () => {
      const token = await getToken();
      const result = await runExport(token, extension, params);
      if (result.kind === "task") {
        // trackJob() polls, promotes and toasts on its own, and is
        // deliberately not awaited (see its doc comment).
        trackJob(result.taskId, "export", jobsPollCallbacks, desc);
        return;
      }
      // Ran inline, so the finished file is already there -- same
      // promotion, just with no task to watch first.
      const promoted = await promoteJob(token, "export", result.url, desc);
      if (promoted) jobsPollCallbacks.onPromoted(promoted, "export");
    })().catch((err: any) => {
      jobsPollCallbacks.onFailed("export", err.message ?? String(err));
    });
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Export Family Tree">
      <Stack gap="md">
        {stage === "loading" && (
          <Group justify="center" py="md">
            <Loader size="sm" />
            <Text size="sm">Loading formats…</Text>
          </Group>
        )}

        {/* Only ever a failure to *list the formats* -- once Export is
            pressed the dialog is gone, and how the run itself went is
            reported by toast (see handleExport). */}
        {stage === "error" && (
          <>
            <Alert color="red" title="Could not load export formats">
              {error}
            </Alert>
            <Group justify="flex-end">
              <Button variant="subtle" onClick={onClose}>
                Close
              </Button>
            </Group>
          </>
        )}

        {stage === "ready" && (
          <>
            <Select
              label="Format"
              data={exporters.map((candidate) => ({
                value: candidate.extension,
                label: `${stripMnemonic(candidate.name)} (.${candidate.extension})`,
              }))}
              value={extension}
              onChange={(next) => setExtension(next ?? extension)}
              allowDeselect={false}
              comboboxProps={{ withinPortal: true }}
            />

            {exporter?.description && (
              <Text size="sm" c="dimmed">
                {exporter.description}
              </Text>
            )}

            {/* Same warning gramps-web shows above its own export button:
                the server filters private records out of the export for a
                user who may not see them, so what comes back is quietly
                smaller than the tree. */}
            {!hasPermissions(PERM_VIEW_PRIVATE) && (
              <Text size="sm" c="orange">
                You do not have permission to view private records, so the export will be
                incomplete.
              </Text>
            )}

            <Anchor component="button" type="button" size="sm" onClick={() => setShowOptions((v) => !v)}>
              {showOptions ? "▾" : "▸"} Options ({optionToggles.length + 1})
            </Anchor>
            <Collapse in={showOptions}>
              <Stack gap="md">
                <Select
                  label="Living people"
                  data={LIVING_MODES.map((mode) => ({ value: mode.value, label: mode.label }))}
                  value={living}
                  onChange={(next) => setLiving(next ?? living)}
                  allowDeselect={false}
                  comboboxProps={{ withinPortal: true }}
                />
                {/* Only means anything once living people are restricted:
                    it widens who counts as living (LivingProxyDb), so it
                    would be an inert field under "Include all". */}
                {living !== DEFAULT_LIVING && (
                  <NumberInput
                    label="Years after death"
                    description="Treat someone as living for this long after they died."
                    min={0}
                    allowDecimal={false}
                    value={yearsAfterDeath}
                    onChange={(next) => setYearsAfterDeath(Number(next) || 0)}
                  />
                )}
                {optionToggles.map((toggle) => (
                  <Switch
                    key={toggle.key}
                    label={toggle.label}
                    description={toggle.description}
                    checked={toggles[toggle.key] ?? toggle.initial}
                    onChange={(event) => setToggle(toggle.key, event.currentTarget.checked)}
                  />
                ))}
              </Stack>
            </Collapse>

            <Text size="sm" c="dimmed">
              The finished file appears in Output, where you can download it.
            </Text>

            <Group justify="flex-end">
              <Button variant="default" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleExport} disabled={!exporter}>
                Export
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
