import { useState } from "react";
import { Alert, Button, Divider, Modal, NavLink, Stack, Text, Textarea, TextInput } from "@mantine/core";
import { getToken, hasPermissions } from "../../auth/auth";
import { attachNoteToObject } from "../../store/notesApi";
import { createTopic, parseTopicSpec, TOPIC_TYPE, type TopicSpec } from "../../store/topicsApi";
import { openTopicWindow } from "../../store/topicWindows";
import type { ObjectDetail } from "../../store/objectDetail";
import type { ViewConfig } from "../../store/views";
import { RELATED_CONFIG } from "./config";
import { ParticipantsInput } from "./ParticipantsInput";
import { summaryLine } from "./summary";
import { zipHandles } from "./sections/shared";
import { t } from "../../i18n/i18n";

interface RawTopicNote {
  type?: string;
  text?: { string?: string };
}

/** view.label is the sidebar's plural/collective name ("People", "Events",
 * "Places", ...) -- fine there, wrong in "Discuss this ___" ("this
 * people"). Only the plural ones need overriding; Family/Media/Output read
 * fine singular already via view.label.toLowerCase(). */
const SINGULAR_LABEL: Partial<Record<string, string>> = {
  person: "person", event: "event", place: "place", repository: "repository", source: "source", citation: "citation",
};

function singularLabel(view: ViewConfig): string {
  return SINGULAR_LABEL[view.key] ?? view.label.toLowerCase();
}

/** A short line under a "join" row's title -- description first, then who
 * was invited, joined with an em dash; either half may be missing. */
function joinRowDescription(spec: TopicSpec): string | undefined {
  const invited = spec.participants?.length ? `${t("with")} ${spec.participants.join(", ")}` : null;
  return [spec.description, invited].filter(Boolean).join(" — ") || undefined;
}

/** Top-right button on a RelatedPanel that opens a small dialog for
 * discussing the object currently shown -- replaces the old
 * MessageButton.tsx. Deliberately never navigates anywhere itself, and
 * picking a topic inside the dialog opens a floating chat window
 * (FloatingTopicWindow.tsx, via topicWindows.ts) rather than promoting to a
 * real view switch: the whole point is to keep discussing this record
 * without losing the record itself off screen.
 *
 * If this record already has one or more linked Topics (its own note_list
 * contains a Note typed "topic" -- the same zipHandles read
 * NotesSection.tsx's own "Topics" sub-list uses), the dialog offers a
 * choice: join one of those, or start a new one alongside them (a record
 * can reasonably have more than one live discussion -- e.g. a general one
 * and a narrower research question). With none yet, it skips straight to
 * the "start a new one" form. Reading and *joining* an existing topic needs
 * no permission check here at all (topicsApi.ts's postTopicMessage is
 * AddObject-only, enforced server-side when the thread itself is used, not
 * gated by this button) -- only *starting* a new one (creating the topic
 * and attaching it to this record) needs AddObject+EditObject, same gate
 * the old MessageButton had for its own create-and-attach step. So a
 * Contributor without EditObject can't start a fresh discussion here, but
 * can always join one someone else already started. */
export function DiscussButton({
  view, detail, onAttached,
}: {
  view: ViewConfig;
  detail: ObjectDetail;
  onAttached: () => void;
}) {
  const [opened, setOpened] = useState(false);
  const [mode, setMode] = useState<"choice" | "new">("choice");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [participants, setParticipants] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eligible = RELATED_CONFIG[view.key]?.includes("notes") ?? false;
  const canStartNew = hasPermissions("AddObject", "EditObject");

  const existingTopics = zipHandles<RawTopicNote>(detail.note_list, detail.extended?.notes)
    .filter(({ target }) => target?.type === TOPIC_TYPE)
    .map(({ handle, target }) => ({ handle, spec: parseTopicSpec(target.text?.string) }));

  if (!eligible || (existingTopics.length === 0 && !canStartNew)) return null;

  function open() {
    setError(null);
    setTitle(`About: ${summaryLine(view.key, detail) || t(view.label)}`);
    setDescription("");
    setParticipants([]);
    setMode(existingTopics.length > 0 ? "choice" : "new");
    setOpened(true);
  }

  function join(handle: string) {
    openTopicWindow(handle);
    setOpened(false);
  }

  async function startNew() {
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const topicHandle = await createTopic(token, title.trim(), description.trim() || undefined, participants);
      await attachNoteToObject(token, view, detail.handle, topicHandle);
      onAttached();
      openTopicWindow(topicHandle);
      setOpened(false);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="default" size="xs" onClick={open} aria-label={`Discuss this ${singularLabel(view)}`}>
        {t("Discuss")}
      </Button>
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title={mode === "choice" ? t("Discuss this record") : t("Start a new discussion")}
      >
        <Stack gap="sm">
          {mode === "choice" && (
            <>
              <Text size="sm" c="dimmed">{t("Join an existing discussion about this record:")}</Text>
              <Stack gap={2}>
                {existingTopics.map(({ handle, spec }) => (
                  <NavLink
                    key={handle}
                    label={spec.title}
                    description={joinRowDescription(spec)}
                    onClick={() => join(handle)}
                    style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: "var(--mantine-radius-sm)" }}
                  />
                ))}
              </Stack>
              {canStartNew && (
                <>
                  <Divider label={t("or")} labelPosition="center" />
                  <Button variant="default" onClick={() => setMode("new")}>
                    {t("Start a new discussion")}
                  </Button>
                </>
              )}
            </>
          )}
          {mode === "new" && (
            <>
              <TextInput label={t("Title")} value={title} onChange={(e) => setTitle(e.currentTarget.value)} autoFocus />
              <Textarea
                label={t("Description")}
                placeholder={t("What is this discussion about?")}
                value={description}
                onChange={(e) => setDescription(e.currentTarget.value)}
                autosize
                minRows={2}
              />
              <ParticipantsInput value={participants} onChange={setParticipants} />
              {error && <Alert color="red">{error}</Alert>}
              <Button.Group>
                {existingTopics.length > 0 && (
                  <Button variant="default" onClick={() => setMode("choice")} disabled={busy} fullWidth>
                    {t("Back")}
                  </Button>
                )}
                <Button onClick={startNew} loading={busy} disabled={!title.trim()} fullWidth>
                  {t("Create & open")}
                </Button>
              </Button.Group>
            </>
          )}
        </Stack>
      </Modal>
    </>
  );
}
