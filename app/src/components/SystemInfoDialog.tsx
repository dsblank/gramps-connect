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
import { deprecationWarnings, fetchMetadata, systemInfoLines, type Deprecation } from "../store/metadataApi";
import { t } from "../i18n/i18n";

interface SystemInfoDialogProps {
  opened: boolean;
  onClose: () => void;
}

type Stage = "loading" | "ready" | "error";

/** A deprecation message with its `backticked` option names shown as code,
 * the way gramps-web renders the same messages. */
function InlineCode({ text }: { text: string }) {
  return <>{text.split("`").map((part, i) => (i % 2 ? <Code key={i}>{part}</Code> : part))}</>;
}

/** The server's deprecated settings, in full -- only ever non-empty for a
 * site admin or a single-tree server's owner (see Metadata.deprecations),
 * the people who can change the server's configuration. */
function DeprecationWarnings({ warnings }: { warnings: Deprecation[] }) {
  return (
    <Alert color="yellow" title={t("Warnings")}>
      <Stack gap="xs">
        <Text size="sm">{t("The server uses configuration options that are no longer supported.")}</Text>
        {warnings.map((d) => (
          <div key={d.option}>
            <Text size="sm" fw={500}>
              <Code>{d.option}</Code>
              {d.replacement && <> → <Code>{d.replacement}</Code></>}
            </Text>
            {d.message && <Text size="sm"><InlineCode text={d.message} /></Text>}
            {d.removed_in && (
              <Text size="xs" c="dimmed">
                {t("Support will be removed in Gramps Web API %s.").replace("%s", d.removed_in)}
              </Text>
            )}
          </div>
        ))}
      </Stack>
    </Alert>
  );
}

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
 * Any deprecated server settings are listed in full under the block (and
 * one line each inside it, so they're in a pasted report too).
 */
export function SystemInfoDialog({ opened, onClose }: SystemInfoDialogProps) {
  const [stage, setStage] = useState<Stage>("loading");
  const [lines, setLines] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<Deprecation[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    setStage("loading");
    (async () => {
      const metadata = await fetchMetadata(await getToken());
      if (cancelled) return;
      setLines(systemInfoLines(metadata, __APP_VERSION__));
      setWarnings(deprecationWarnings(metadata));
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

        {stage === "ready" && warnings.length > 0 && <DeprecationWarnings warnings={warnings} />}

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
