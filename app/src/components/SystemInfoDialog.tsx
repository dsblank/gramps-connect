import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Code,
  CopyButton,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
} from "@mantine/core";
import { getToken } from "../auth/auth";
import { fetchMetadata, systemInfoLines } from "../store/metadataApi";
import { t } from "../i18n/i18n";

interface SystemInfoDialogProps {
  opened: boolean;
  onClose: () => void;
}

type Stage = "loading" | "ready" | "error";

/** Help > System Information: the versions and server features to paste
 * into a bug report, in the same shape gramps-web's own System Information
 * panel produces (see systemInfoLines) so a report from either frontend
 * reads the same way.
 *
 * Refetched on every open rather than memoized like the reports/exporters
 * lists: those describe installed plugins, but this is the thing someone
 * opens *because* something looks wrong, and a stale answer to that
 * question is worse than a second request. It also moves under the reader
 * -- a server upgraded, or a feature enabled, while this tab stayed open.
 */
export function SystemInfoDialog({ opened, onClose }: SystemInfoDialogProps) {
  const [stage, setStage] = useState<Stage>("loading");
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    setStage("loading");
    (async () => {
      const metadata = await fetchMetadata(await getToken());
      if (cancelled) return;
      setLines(systemInfoLines(metadata, __APP_VERSION__));
      setStage("ready");
    })().catch((err: any) => {
      if (cancelled) return;
      setError(err.message ?? String(err));
      setStage("error");
    });
    return () => {
      cancelled = true;
    };
  }, [opened]);

  const text = lines.join("\n");

  return (
    <Modal opened={opened} onClose={onClose} title={t("System Information")}>
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {t("Include this when reporting a problem — it says which versions of everything you are running, and what this server has switched on.")}
        </Text>

        {stage === "loading" && (
          <Group justify="center" py="md">
            <Loader size="sm" />
            <Text size="sm">{t("Asking the server…")}</Text>
          </Group>
        )}

        {stage === "error" && (
          <Alert color="red" title={t("Could not read the server's details")}>
            {error}
          </Alert>
        )}

        {stage === "ready" && (
          // One <Code block> holding the whole thing rather than a line
          // each: what's copied and what's on screen are then the same
          // string, and a hand-selection of it comes out already formatted
          // for anyone who copies by dragging instead of by button.
          <Code block>{text}</Code>
        )}

        <Group justify="flex-end">
          {stage === "ready" && (
            <CopyButton value={text}>
              {({ copied, copy }) => (
                <Button variant={copied ? "light" : "filled"} color={copied ? "teal" : undefined} onClick={copy}>
                  {copied ? "Copied" : "Copy"}
                </Button>
              )}
            </CopyButton>
          )}
          <Button variant="default" onClick={onClose}>
            {t("Close")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
