import { useEffect, useState } from "react";
import { Alert, Anchor, Button, Group, Loader, Modal, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { getToken, hasPermissions } from "../auth/auth";
import { fetchResearcher, updateResearcher, type Researcher } from "../store/metadataApi";
import { t } from "../i18n/i18n";

interface ResearcherDialogProps {
  opened: boolean;
  onClose: () => void;
}

/** Name/address/contact info for whoever maintains this tree -- GET/PUT
 * /api/metadata/researcher/, the info GEDCOM export headers (SOUR/SUBM)
 * conventionally carry. Field set and order mirror desktop Gramps' own
 * "Edit Researcher Information" tool. GET needs no particular permission
 * (every logged-in user sees the read-only view, same as gramps-web's
 * GrampsjsResearcher readonly mode on its Sysinfo view); the Edit button
 * that switches to the form only shows for EditTree, the same tier
 * OwnerAdministrationDialog.tsx's tree-rename control uses. */
const RESEARCHER_FIELDS: { key: keyof Researcher; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "addr", label: "Address" },
  { key: "locality", label: "Locality" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "country", label: "Country" },
  { key: "postal", label: "Postal code" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
];

export function ResearcherDialog({ opened, onClose }: ResearcherDialogProps) {
  const [researcher, setResearcher] = useState<Researcher | null>(null);
  const [draft, setDraft] = useState<Researcher>({});
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canEdit = hasPermissions("EditTree");

  useEffect(() => {
    if (!opened) return;
    setEditing(false);
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const r = await fetchResearcher(await getToken());
        setResearcher(r);
        setDraft(r);
      } catch (err: any) {
        setError(err.message ?? String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [opened]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const saved = await updateResearcher(await getToken(), draft);
      setResearcher(saved);
      setDraft(saved);
      setEditing(false);
      notifications.show({ color: "green", message: t("Researcher information saved.") });
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  const address = researcher
    ? [
        researcher.addr, researcher.locality, researcher.city,
        researcher.state, researcher.country, researcher.postal,
      ].filter(Boolean).join(", ")
    : "";

  return (
    <Modal opened={opened} onClose={onClose} title={t("Researcher")}>
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {t("Contact info for whoever maintains this tree — the info GEDCOM export headers conventionally carry.")}
        </Text>

        {loading && (
          <Group justify="center" py="md">
            <Loader size="sm" />
          </Group>
        )}

        {error && <Alert color="red">{error}</Alert>}

        {!loading && researcher && (
          editing ? (
            <Stack gap="sm">
              {RESEARCHER_FIELDS.map(({ key, label }) => (
                <TextInput
                  key={key}
                  label={t(label)}
                  value={draft[key] ?? ""}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setDraft((prev) => ({ ...prev, [key]: value }));
                  }}
                  disabled={saving}
                />
              ))}
              <Group justify="flex-end">
                <Button variant="default" onClick={() => { setDraft(researcher); setEditing(false); }} disabled={saving}>
                  {t("Cancel")}
                </Button>
                <Button onClick={handleSave} loading={saving}>
                  {t("Save")}
                </Button>
              </Group>
            </Stack>
          ) : (
            <Stack gap={4}>
              <Text size="sm"><b>{t("Name")}:</b> {researcher.name || "—"}</Text>
              <Text size="sm">
                <b>{t("Email")}:</b>{" "}
                {researcher.email ? <Anchor href={`mailto:${researcher.email}`}>{researcher.email}</Anchor> : "—"}
              </Text>
              <Text size="sm">
                <b>{t("Phone")}:</b>{" "}
                {researcher.phone ? <Anchor href={`tel:${researcher.phone}`}>{researcher.phone}</Anchor> : "—"}
              </Text>
              <Text size="sm"><b>{t("Address")}:</b> {address || "—"}</Text>
              {canEdit && (
                <Group justify="flex-end" mt="sm">
                  <Button variant="outline" onClick={() => setEditing(true)}>{t("Edit")}</Button>
                </Group>
              )}
            </Stack>
          )
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>{t("Close")}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
