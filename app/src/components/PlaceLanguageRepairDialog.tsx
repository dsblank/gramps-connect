import { useEffect, useState, useSyncExternalStore } from "react";
import { Alert, Button, Group, Loader, Modal, Progress, ScrollArea, Stack, Table, Text } from "@mantine/core";
import { applyPlaceLanguageFixes, findPlaceLanguageFixes, type PlaceLanguageFix } from "../store/placeLanguageRepair";
import { useDisplayFormatVersion } from "../store/placeIndex";
import { getViewStore } from "../store/registry";
import { t } from "../i18n/i18n";

type Stage = "preview" | "running" | "done";

interface PlaceLanguageRepairDialogProps {
  opened: boolean;
  onClose: () => void;
}

function langLabel(lang: string): string {
  return lang === "" ? t("(none)") : lang;
}

/** Tools -> Fix Place Name Languages -- previews and applies
 * placeLanguageRepair.ts's fixes. */
export function PlaceLanguageRepairDialog({ opened, onClose }: PlaceLanguageRepairDialogProps) {
  // Recompute as the Places cache loads.
  const placeStore = getViewStore("place");
  useSyncExternalStore(placeStore.subscribe, placeStore.getSnapshot);
  useDisplayFormatVersion();

  const [stage, setStage] = useState<Stage>("preview");
  // Frozen when Apply starts, so the list doesn't shift as saves land.
  const [applying, setApplying] = useState<PlaceLanguageFix[]>([]);
  const [progress, setProgress] = useState(0);
  const [failures, setFailures] = useState<{ grampsId: string; message: string }[]>([]);

  useEffect(() => {
    if (!opened) return;
    setStage("preview");
    setProgress(0);
    setFailures([]);
  }, [opened]);

  const fixes = opened && stage === "preview" ? findPlaceLanguageFixes() : null;

  function handleClose() {
    if (stage === "running") return;
    onClose();
  }

  async function handleApply(list: PlaceLanguageFix[]) {
    setApplying(list);
    setStage("running");
    setFailures(await applyPlaceLanguageFixes(list, setProgress));
    setStage("done");
  }

  const nameFixes = fixes?.filter((f) => f.lang).length ?? 0;
  const titleFixes = fixes?.filter((f) => f.title).length ?? 0;

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={t("Fix Place Name Languages")}
      size="xl"
      closeOnClickOutside={stage !== "running"}
      closeOnEscape={stage !== "running"}
    >
      <Stack gap="md">
        {stage === "preview" && (
          <>
            <Text size="sm">
              {t("A place title uses each place's first name in the place format's language. Places whose primary name is in a different language than one of their alternate names show the alternate name instead, often an old name kept by a Wikidata lookup. This gives those primary names the format's language, and rebuilds stored titles that were following the old names.")}
            </Text>
            {fixes === null ? (
              <Group gap="xs">
                <Loader size="xs" />
                <Text size="sm">{t("Loading places…")}</Text>
              </Group>
            ) : fixes.length === 0 ? (
              <Alert color="green">{t("No places need fixing.")}</Alert>
            ) : (
              <>
                <Text size="sm">
                  {t("{names} primary names to change, {titles} stored titles to rebuild:").replace("{names}", String(nameFixes)).replace("{titles}", String(titleFixes))}
                </Text>
                <ScrollArea.Autosize mah={400}>
                  <Table striped fz="xs" verticalSpacing={4}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>{t("ID")}</Table.Th>
                        <Table.Th>{t("Name")}</Table.Th>
                        <Table.Th>{t("Language")}</Table.Th>
                        <Table.Th>{t("Title")}</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {fixes.map((f) => (
                        <Table.Tr key={f.handle}>
                          <Table.Td>{f.grampsId}</Table.Td>
                          <Table.Td>{f.name}</Table.Td>
                          <Table.Td style={{ whiteSpace: "nowrap" }}>
                            {f.lang ? `${langLabel(f.lang.from)} → ${langLabel(f.lang.to)}` : ""}
                          </Table.Td>
                          <Table.Td>
                            {f.title && (
                              <>
                                <Text size="xs" c="dimmed" td="line-through">{f.title.from}</Text>
                                <Text size="xs">{f.title.to}</Text>
                              </>
                            )}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea.Autosize>
                <Text size="xs" c="dimmed">
                  {t("Each place is saved separately, so any of them can be undone from its History.")}
                </Text>
              </>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={handleClose}>{t("Cancel")}</Button>
              <Button disabled={!fixes?.length} onClick={() => fixes && void handleApply(fixes)}>
                {t("Fix {count} places").replace("{count}", String(fixes?.length ?? 0))}
              </Button>
            </Group>
          </>
        )}
        {stage === "running" && (
          <Stack gap="xs" py="md">
            <Text size="sm">{t("Saving {done} of {total}…").replace("{done}", String(progress)).replace("{total}", String(applying.length))}</Text>
            <Progress value={applying.length ? (100 * progress) / applying.length : 0} />
          </Stack>
        )}
        {stage === "done" && (
          <>
            {failures.length === 0 ? (
              <Alert color="green">{t("Fixed {count} places.").replace("{count}", String(applying.length))}</Alert>
            ) : (
              <Alert color="red" title={t("{count} places could not be saved").replace("{count}", String(failures.length))}>
                {failures.map((f) => (
                  <Text key={f.grampsId} size="sm">{f.grampsId}: {f.message}</Text>
                ))}
              </Alert>
            )}
            <Group justify="flex-end">
              <Button onClick={handleClose}>{t("Close")}</Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
