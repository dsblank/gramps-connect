import { useEffect, useState, type ReactNode } from "react";
import { Alert, Anchor, Box, Group, Image, Loader, Modal, Paper, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { getToken, hasPermissions } from "../auth/auth";
import { fetchByHandle, type QueryItem } from "../store/api";
import { formatHash } from "../hash";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import {
  fetchHomeCounts, fetchLatestMessages, fetchLatestStories, fetchRecentlyChanged, STAT_VIEWS, timeAgo,
  type MessageItem, type RecentItem, type StoryItem,
} from "../store/homeStats";
import { fetchDefaultPersonHandle, setDefaultPersonHandle } from "../store/homePersonApi";
import { PERSON_VIEW } from "../store/views";
import { CircleGlyphButton } from "./CircleGlyphButton";
import { RecordPicker } from "./RecordPicker";
import { personLabel } from "./RefPickerField";
import iconChat from "../assets/icons/chat-message.svg";
import iconStory from "../assets/icons/story-book.svg";
import { t } from "../i18n/i18n";

const RECENT_LIMIT = 8;
const MESSAGE_LIMIT = 5;
const STORY_LIMIT = 5;

type Stage = "loading" | "ready" | "error";

/** #/home -- the page the Home icon at the top of the sidebar rail opens
 * (see Sidebar.tsx). A dashboard-style landing page, not another object
 * type: what's changed lately, who said what, and how big the tree is,
 * without picking a list first. Loads its own three small reads (see
 * homeStats.ts) rather than routing through a ViewStore -- nothing here is
 * a table a user filters or sorts, so there's no cache worth keeping. */
export function HomeView() {
  useDocumentTitle("Home — Gramps Connect");
  const [stage, setStage] = useState<Stage>("loading");
  const [error, setError] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [stories, setStories] = useState<StoryItem[]>([]);
  const [homePerson, setHomePerson] = useState<QueryItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getToken();
      const defaultHandle = await fetchDefaultPersonHandle(token);
      const [countsResult, recentResult, messagesResult, storiesResult, homePersonResult] = await Promise.all([
        fetchHomeCounts(),
        fetchRecentlyChanged(token, RECENT_LIMIT),
        fetchLatestMessages(token, MESSAGE_LIMIT),
        fetchLatestStories(token, STORY_LIMIT),
        defaultHandle ? fetchByHandle(PERSON_VIEW, token, defaultHandle) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setCounts(countsResult);
      setRecent(recentResult);
      setMessages(messagesResult);
      setStories(storiesResult);
      setHomePerson(homePersonResult);
      setStage("ready");
    })().catch((err: any) => {
      if (cancelled) return;
      setError(err.message ?? String(err));
      setStage("error");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Box p="md">
      <Title order={2} mb="md">{t("Home")}</Title>

      {stage === "loading" && (
        <Group py="xl" justify="center">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">{t("Loading the tree's overview…")}</Text>
        </Group>
      )}

      {stage === "error" && (
        <Alert color="red" title={t("Couldn't load the overview")}>{error}</Alert>
      )}

      {stage === "ready" && (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
          <Stack gap="lg">
            <Panel title={t("Home person")}>
              <HomePersonContent
                homePerson={homePerson}
                onChange={(person) => setHomePerson(person)}
              />
            </Panel>

            <Panel title={t("Messages")}>
              {messages.length === 0 ? (
                <Text size="sm" c="dimmed">{t("No messages yet.")}</Text>
              ) : (
                <Stack gap="sm">
                  {messages.map((m) => (
                    <Anchor
                      key={m.handle}
                      component="a"
                      href={formatHash({ viewKey: "messages", handle: m.handle })}
                      underline="never"
                      c="inherit"
                    >
                      <Group gap="xs" wrap="nowrap" align="flex-start">
                        <Image src={iconChat} alt="" w={20} h={20} mt={2} />
                        <Box style={{ flex: 1, minWidth: 0 }}>
                          <Text size="sm" fw={600} truncate>{m.author || "Someone"}</Text>
                          <Text size="sm" c="dimmed" truncate>{m.message}</Text>
                        </Box>
                        <Text size="xs" c="dimmed" style={{ flex: "none" }}>{timeAgo(m.changeUnix)}</Text>
                      </Group>
                    </Anchor>
                  ))}
                </Stack>
              )}
              <Anchor
                component="a"
                href={formatHash({ viewKey: "messages" })}
                size="sm"
                mt="sm"
                display="inline-block"
              >
                {t("See all messages")}
              </Anchor>
            </Panel>

            <Panel title={t("Recently changed objects")}>
              {recent.length === 0 ? (
                <Text size="sm" c="dimmed">{t("Nothing changed yet.")}</Text>
              ) : (
                <Stack gap="xs">
                  {recent.map((item) => {
                    const view = STAT_VIEWS.find((v) => v.key === item.viewKey);
                    return (
                      <Anchor
                        key={`${item.viewKey}-${item.handle}`}
                        component="a"
                        href={formatHash({ viewKey: item.viewKey, handle: item.handle })}
                        underline="never"
                        c="inherit"
                      >
                        <Group gap="xs" wrap="nowrap">
                          {view && <Image src={view.icon} alt="" w={20} h={20} />}
                          <Text size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
                            {item.label}
                          </Text>
                          <Text size="xs" c="dimmed" style={{ flex: "none" }}>{timeAgo(item.changeUnix)}</Text>
                        </Group>
                      </Anchor>
                    );
                  })}
                </Stack>
              )}
            </Panel>
          </Stack>

          <Stack gap="lg">
            <Panel title={t("Statistics")}>
              <Stack gap={6}>
                {STAT_VIEWS.map((v) => (
                  <Group key={v.key} justify="space-between" wrap="nowrap">
                    <Anchor component="a" href={formatHash({ viewKey: v.key })} size="sm" c="inherit" underline="never">
                      <Group gap="xs" wrap="nowrap">
                        <Image src={v.icon} alt="" w={20} h={20} />
                        <Text size="sm">{t(v.label)}</Text>
                      </Group>
                    </Anchor>
                    <Text size="sm" fw={600}>{(counts[v.key] ?? 0).toLocaleString()}</Text>
                  </Group>
                ))}
              </Stack>
            </Panel>

            <Panel title={t("Stories")}>
              {stories.length === 0 ? (
                <Text size="sm" c="dimmed">{t("No stories yet.")}</Text>
              ) : (
                <Stack gap="sm">
                  {stories.map((s) => (
                    <Anchor
                      key={s.handle}
                      component="a"
                      href={formatHash({ viewKey: "story", handle: s.handle })}
                      underline="never"
                      c="inherit"
                    >
                      <Group gap="xs" wrap="nowrap" align="flex-start">
                        <Image src={iconStory} alt="" w={20} h={20} mt={2} />
                        <Text size="sm" truncate style={{ flex: 1, minWidth: 0 }}>{s.title}</Text>
                        <Text size="xs" c="dimmed" style={{ flex: "none" }}>{timeAgo(s.changeUnix)}</Text>
                      </Group>
                    </Anchor>
                  ))}
                </Stack>
              )}
              <Anchor
                component="a"
                href={formatHash({ viewKey: "story" })}
                size="sm"
                mt="sm"
                display="inline-block"
              >
                {t("See all Stories")}
              </Anchor>
            </Panel>
          </Stack>
        </SimpleGrid>
      )}
    </Box>
  );
}

/** Bordered section, same convention VisualFrame uses for its own panel --
 * this page has five of them instead of one. */
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper withBorder p="md" radius="sm">
      <Title order={5} mb="sm">{title}</Title>
      {children}
    </Paper>
  );
}

/** The Home-person panel's body: a clickable name+icon once one is set
 * (its handle lives in gramps-web-api's /api/metadata/default-person/ --
 * the actual Gramps "home person", db.get_default_handle(), same one
 * Gramps desktop's Edit > Set Home Person writes -- not a per-browser
 * preference), or -- while unset, and only for an EditTree-permitted user
 * (owner role; matches the PUT's own server-side permission check) -- the
 * same circled "+" -> Modal -> RecordPicker pattern AttachControl.tsx's
 * SetFieldControl uses for every other empty singular-ref slot. */
function HomePersonContent({
  homePerson, onChange,
}: {
  homePerson: QueryItem | null;
  onChange: (person: QueryItem) => void;
}) {
  const [opened, setOpened] = useState(false);

  async function handlePick(item: QueryItem) {
    setOpened(false);
    const token = await getToken();
    await setDefaultPersonHandle(token, item.handle);
    onChange(item);
  }

  if (homePerson) {
    return (
      <Anchor
        component="a"
        href={formatHash({ viewKey: "person", handle: homePerson.handle })}
        underline="never"
        c="inherit"
      >
        <Group gap="sm" wrap="nowrap">
          <Image src={PERSON_VIEW.icon} alt="" w={28} h={28} />
          <Text size="sm" fw={600} truncate>{personLabel(homePerson)}</Text>
        </Group>
      </Anchor>
    );
  }

  if (!hasPermissions("EditTree")) {
    return <Text size="sm" c="dimmed">{t("No home person set.")}</Text>;
  }

  return (
    <>
      <CircleGlyphButton
        glyph="+"
        label={t("Set home person")}
        textLabel={t("Set home person")}
        onClick={() => setOpened(true)}
      />
      <Modal opened={opened} onClose={() => setOpened(false)} title={t("Setting the home person")} size="sm">
        <RecordPicker
          view={PERSON_VIEW}
          searchField="gramps_id"
          placeholder={PERSON_VIEW.simpleSearch?.placeholder ?? "Search…"}
          buildExpr={PERSON_VIEW.simpleSearch?.buildExpr}
          renderLabel={personLabel}
          onPick={handlePick}
          confirmWithButton
        />
      </Modal>
    </>
  );
}
