import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Code, CopyButton, Group, Modal, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { getApiKey, getToken, composeApiKey, hasPermissions } from "../auth/auth";
import {
  ApiKeysUnsupported,
  createApiKey,
  deleteApiKey,
  listApiKeys,
  parseServerUtc,
  type ApiKeyInfo,
} from "../store/apiKeysApi";
import { confirmDialog } from "../store/confirmDialog";
import { t } from "../i18n/i18n";

function formatWhen(iso: string | null): string {
  return iso ? parseServerUtc(iso).toLocaleString() : t("Never");
}

/** Puts this session's own refresh-token key (getApiKey()) on the
 * clipboard -- the only kind of key a server older than gramps-web-api
 * v3.23.0 can give out, so it's the API keys dialog's fallback there. It
 * never expires and has the account's full permissions, and nothing short
 * of deleting the account revokes it (not even a password change -- see
 * getApiKey()), hence the warning. */
async function copySessionKey() {
  const apiKey = getApiKey();
  if (!apiKey) return;
  try {
    await navigator.clipboard.writeText(apiKey);
  } catch {
    // Clipboard access needs a secure context (https or localhost); on a
    // plain-http deployment there's nothing to fall back to.
    notifications.show({
      color: "red",
      title: "Couldn't copy API key",
      message: "The clipboard is unavailable in this browser context.",
    });
    return;
  }
  notifications.show({
    color: "yellow",
    title: "API key copied",
    message:
      "Set it as GRAMPS_WEB_API_KEY. It grants full access to your account " +
      "and never expires -- treat it like a password. Changing your password " +
      "does not revoke it.",
    autoClose: 10000,
  });
}

interface ApiKeysDialogProps {
  opened: boolean;
  onClose: () => void;
}

/** User menu -> API keys...: the current user's sync-scope keys (see
 * store/apiKeysApi.ts), one per program or computer -- listed with when
 * each was created and last used, removable one at a time, and created
 * with a name. A new key's value is shown once, already composed into the
 * GRAMPS_WEB_API_KEY shape (composeApiKey) so it can be pasted straight
 * into gramps-api-client or anything built on it. Keys the Gramps Web Sync
 * addon creates for itself ("Gramps Web Sync on <host>") show up here too,
 * which is what lets a lost computer be cut off without touching the
 * others. On a server older than gramps-web-api v3.23.0, which has no such
 * keys, it offers the old copy-this-session's-key instead
 * (copySessionKey). */
export function ApiKeysDialog({ opened, onClose }: ApiKeysDialogProps) {
  const canEdit = hasPermissions("EditOwnUser");
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ label: string; key: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      setKeys(await listApiKeys(token));
      setUnsupported(false);
    } catch (err: any) {
      if (err instanceof ApiKeysUnsupported) setUnsupported(true);
      else setError(err.message ?? String(err));
    }
  }, []);

  useEffect(() => {
    if (!opened) return;
    setError(null);
    setName("");
    setCreated(null);
    setKeys(null);
    if (canEdit) load();
  }, [opened, canEdit, load]);

  async function handleCreate() {
    setError(null);
    setCreating(true);
    try {
      const token = await getToken();
      const label = name.trim();
      const result = await createApiKey(token, label);
      setCreated({ label: result.label, key: composeApiKey(result.token) });
      setName("");
      await load();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleRemove(key: ApiKeyInfo) {
    const ok = await confirmDialog(
      t("Remove the API key \"{label}\"? Any program using it will stop working.").replace("{label}", key.label),
      t("Remove"),
    );
    if (!ok) return;
    setError(null);
    try {
      const token = await getToken();
      await deleteApiKey(token, key.id);
    } catch (err: any) {
      setError(err.message ?? String(err));
    }
    await load();
  }

  return (
    <Modal opened={opened} onClose={onClose} title={t("API keys")} size="md">
      <Stack gap="sm">
        {unsupported || !canEdit ? (
          <SessionKeyFallback unsupported={unsupported} />
        ) : (
          <>
            <Text size="sm" c="dimmed">
              {t("An API key lets Gramps on your computer, or another program, open this family tree. Remove a key if a computer is lost or you stop using that program.")}
            </Text>

            {keys && keys.length === 0 && <Text size="sm" c="dimmed" fs="italic">{t("No API keys yet.")}</Text>}
            {keys?.map((key) => (
              <Group key={key.id} justify="space-between" wrap="nowrap" align="flex-start">
                <div style={{ minWidth: 0 }}>
                  <Text size="sm" fw={500} style={{ overflowWrap: "anywhere" }}>{key.label}</Text>
                  <Text size="xs" c="dimmed">
                    {t("Created")}: {formatWhen(key.created_at)} · {t("Last used")}: {formatWhen(key.last_used_at)}
                  </Text>
                </div>
                <Button size="xs" variant="subtle" color="red" onClick={() => handleRemove(key)}>
                  {t("Remove")}
                </Button>
              </Group>
            ))}

            {created && (
              <Alert color="yellow" title={t("API key created")}>
                <Stack gap="xs">
                  {/* GRAMPS_WEB_API_KEY stays outside t(), which strips a string's
                      first "_" (a GTK mnemonic marker in the desktop vocabulary). */}
                  <Text size="sm">
                    {t("Copy this key now. It won't be shown again. Paste it where a program asks for a Gramps Web API key")}{" "}
                    (<Code>GRAMPS_WEB_API_KEY</Code>).
                  </Text>
                  <Code block style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{created.key}</Code>
                  <Group justify="flex-end">
                    <CopyButton value={created.key}>
                      {({ copied, copy }) => (
                        <Button size="xs" onClick={copy}>{copied ? t("Copied") : t("Copy")}</Button>
                      )}
                    </CopyButton>
                    <Button size="xs" variant="default" onClick={() => setCreated(null)}>{t("Done")}</Button>
                  </Group>
                </Stack>
              </Alert>
            )}

            <Group align="flex-end" wrap="nowrap">
              <TextInput
                style={{ flex: 1 }}
                label={t("Name")}
                placeholder={t("e.g. Gramps on my laptop")}
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim() && !creating) handleCreate();
                }}
              />
              <Button onClick={handleCreate} loading={creating} disabled={!name.trim()}>
                {t("Create API key")}
              </Button>
            </Group>
            {error && <Alert color="red">{error}</Alert>}
          </>
        )}
        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onClose}>{t("Close")}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** What the dialog shows instead of the key list when it can't have one:
 * a server older than v3.23.0, or (never in practice -- every role holds
 * it) no EditOwnUser. Offers this session's own key where there is one. */
function SessionKeyFallback({ unsupported }: { unsupported: boolean }) {
  const hasSessionKey = getApiKey() !== null;
  return (
    <>
      <Text size="sm">
        {unsupported
          ? t("This server can't create separate API keys (that needs Gramps Web API 3.23.0 or later).")
          : t("You don't have permission to manage API keys.")}
      </Text>
      {hasSessionKey && (
        <>
          <Text size="sm" c="dimmed">
            {t("You can copy this session's key instead. Unlike a separate key, it has full access to your account, never expires, and can't be removed later -- not even by changing your password.")}
          </Text>
          <Group>
            <Button variant="light" color="yellow" onClick={copySessionKey}>{t("Copy session key")}</Button>
          </Group>
        </>
      )}
    </>
  );
}
