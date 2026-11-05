import { useEffect, useState, type ReactNode } from "react";
import { ActionIcon, Alert, Anchor, Box, Group, Image, Loader, Modal, Paper, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { getToken } from "../auth/auth";
import type { QueryItem } from "../store/api";
import { formatHash } from "../hash";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import {
  fetchHomeCounts, fetchRecentTopics, fetchLatestStories, fetchLatestBlogPosts, fetchRecentlyChanged, fetchHomePerson, STAT_VIEWS, timeAgo,
  fetchRecentlyVisited, fetchHomeBookmarks,
  type RecentItem, type StoryItem, type TopicItem, type BlogPostItem,
} from "../store/homeStats";
import { getHomePersonHandle, setHomePersonHandle } from "../store/homePersonPreference";
import { EVENT_VIEW, PERSON_VIEW } from "../store/views";
import {
  fetchAnniversaryWindow, formatDaysUntil, formatWindow, formatYears, windowRange,
  type AnniversaryItem, type AnniversaryWindow,
} from "../store/upcomingAnniversaries";
import { BlogPostView } from "./BlogPostView";
import { CircleGlyphButton } from "./CircleGlyphButton";
import { RecordPicker } from "./RecordPicker";
import { personLabel } from "./RefPickerField";
import iconChat from "../assets/icons/chat-message.svg";
import iconStory from "../assets/icons/story-book.svg";
import iconBlog from "../assets/icons/blog-post.svg";
import { t } from "../i18n/i18n";

const RECENT_LIMIT = 8;
const TOPIC_LIMIT = 5;
const STORY_LIMIT = 5;
const BLOG_LIMIT = 3;
const ANNIVERSARY_LIMIT = 8;
// How many 30-day windows the arrows go either way: about a year.
const ANNIVERSARY_WINDOWS = 12;

type Stage = "loading" | "ready" | "error";

/** BlogPostView's own onNavigate ("Show source details") from a context
 * with no aside/reference-detail pane to preview into -- same plain hash
 * assignment FloatingTopicWindow.tsx's own navigateAway already uses for
 * the same reason. */
function navigateAway(type: string, handle: string): void {
  window.location.hash = formatHash({ viewKey: type, handle });
}

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
  const [visited, setVisited] = useState<RecentItem[]>([]);
  const [bookmarks, setBookmarks] = useState<RecentItem[]>([]);
  const [topics, setTopics] = useState<TopicItem[]>([]);
  const [stories, setStories] = useState<StoryItem[]>([]);
  const [blogPosts, setBlogPosts] = useState<BlogPostItem[]>([]);
  const [openBlogHandle, setOpenBlogHandle] = useState<string | null>(null);
  const [homePerson, setHomePerson] = useState<QueryItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getToken();
      const homeHandle = getHomePersonHandle();
      const [
        countsResult, recentResult, topicsResult, storiesResult, blogResult, homePersonResult, visitedResult, bookmarksResult,
      ] = await Promise.all([
        fetchHomeCounts(),
        fetchRecentlyChanged(token, RECENT_LIMIT),
        fetchRecentTopics(token, TOPIC_LIMIT),
        fetchLatestStories(token, STORY_LIMIT),
        fetchLatestBlogPosts(token, BLOG_LIMIT),
        homeHandle ? fetchHomePerson(token, homeHandle) : Promise.resolve(null),
        fetchRecentlyVisited(token, RECENT_LIMIT),
        fetchHomeBookmarks(token, RECENT_LIMIT),
      ]);
      if (cancelled) return;
      setCounts(countsResult);
      setRecent(recentResult);
      setTopics(topicsResult);
      setStories(storiesResult);
      setBlogPosts(blogResult);
      setHomePerson(homePersonResult);
      setVisited(visitedResult);
      setBookmarks(bookmarksResult);
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
          <Text c="dimmed">{t("Loading the tree's overview…")}</Text>
        </Group>
      )}

      {stage === "error" && (
        <Alert color="red" title={t("Couldn't load the overview")}>{error}</Alert>
      )}

      {stage === "ready" && (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
          <Stack gap="lg">
            <Panel title={t("Home person")}>
              <HomePersonContent
                homePerson={homePerson}
                onChange={(person) => setHomePerson(person)}
              />
            </Panel>

            <Panel title={t("Statistics")}>
              <Stack gap={6}>
                {STAT_VIEWS.map((v) => (
                  <Group key={v.key} justify="space-between" wrap="nowrap">
                    <Anchor component="a" href={formatHash({ viewKey: v.key })} c="inherit" underline="never">
                      <Group gap="xs" wrap="nowrap">
                        <Image src={v.icon} alt="" w={20} h={20} />
                        <Text>{t(v.label)}</Text>
                      </Group>
                    </Anchor>
                    <Text fw={600}>{(counts[v.key] ?? 0).toLocaleString()}</Text>
                  </Group>
                ))}
              </Stack>
            </Panel>

            <Panel title={t("Recently visited")}>
              {visited.length === 0 ? (
                <Text c="dimmed">{t("Records you open will be listed here.")}</Text>
              ) : (
                <RecordRows items={visited} />
              )}
              <Anchor component="a" href={formatHash({ viewKey: "visited" })} mt="sm" display="inline-block">
                {t("See all visited")}
              </Anchor>
            </Panel>
          </Stack>

          <Stack gap="lg">
            <Panel title={t("Discussions")}>
              {topics.length === 0 ? (
                <Text c="dimmed">{t("No discussions yet.")}</Text>
              ) : (
                <Stack gap="sm">
                  {topics.map((topic) => (
                    <Anchor
                      key={topic.handle}
                      component="a"
                      href={formatHash({ viewKey: "topics", handle: topic.handle })}
                      underline="never"
                      c="inherit"
                    >
                      <Group gap="xs" wrap="nowrap" align="flex-start">
                        <Image src={iconChat} alt="" w={20} h={20} mt={2} />
                        <Text truncate style={{ flex: 1, minWidth: 0 }}>{topic.title}</Text>
                        <Text size="xs" c="dimmed" style={{ flex: "none" }}>{timeAgo(topic.changeUnix)}</Text>
                      </Group>
                    </Anchor>
                  ))}
                </Stack>
              )}
              <Anchor
                component="a"
                href={formatHash({ viewKey: "topics" })}
                mt="sm"
                display="inline-block"
              >
                {t("See all discussions")}
              </Anchor>
            </Panel>

            <Panel title={t("Change Log")}>
              {recent.length === 0 ? (
                <Text c="dimmed">{t("Nothing changed yet.")}</Text>
              ) : (
                <RecordRows items={recent} />
              )}
              <Anchor component="a" href={formatHash({ viewKey: "changed" })} mt="sm" display="inline-block">
                {t("See all changes")}
              </Anchor>
            </Panel>

            <AnniversaryCard />
          </Stack>

          <Stack gap="lg">
            <Panel title={t("Stories")}>
              {stories.length === 0 ? (
                <Text c="dimmed">{t("No stories yet.")}</Text>
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
                        <Text truncate style={{ flex: 1, minWidth: 0 }}>{s.title}</Text>
                        <Text size="xs" c="dimmed" style={{ flex: "none" }}>{timeAgo(s.changeUnix)}</Text>
                      </Group>
                    </Anchor>
                  ))}
                </Stack>
              )}
              <Anchor
                component="a"
                href={formatHash({ viewKey: "story" })}
                mt="sm"
                display="inline-block"
              >
                {t("See all Stories")}
              </Anchor>
            </Panel>

            <Panel title={t("Blog")}>
              {blogPosts.length === 0 ? (
                <Text c="dimmed">{t("No blog posts yet.")}</Text>
              ) : (
                <Stack gap="sm">
                  {blogPosts.map((post) => (
                    <Anchor
                      key={post.handle}
                      component="button"
                      type="button"
                      onClick={() => setOpenBlogHandle(post.handle)}
                      underline="never"
                      c="inherit"
                      style={{ textAlign: "left" }}
                    >
                      <Group gap="xs" wrap="nowrap" align="flex-start">
                        <Image src={iconBlog} alt="" w={20} h={20} mt={2} />
                        <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                          <Text truncate>{post.title}</Text>
                          {post.author && <Text size="xs" c="dimmed" truncate>{post.author}</Text>}
                        </Stack>
                        <Text size="xs" c="dimmed" style={{ flex: "none" }}>{timeAgo(post.changeUnix)}</Text>
                      </Group>
                    </Anchor>
                  ))}
                </Stack>
              )}
              <Anchor
                component="a"
                href={formatHash({ viewKey: "blog" })}
                mt="sm"
                display="inline-block"
              >
                {t("See all blog posts")}
              </Anchor>
            </Panel>

            <Panel title={t("Bookmarks")}>
              {bookmarks.length === 0 ? (
                <Text c="dimmed">{t("No bookmarks yet. The star next to a record's name adds one.")}</Text>
              ) : (
                <RecordRows items={bookmarks} />
              )}
              <Anchor component="a" href={formatHash({ viewKey: "bookmarks" })} mt="sm" display="inline-block">
                {t("See all bookmarks")}
              </Anchor>
            </Panel>
          </Stack>
        </SimpleGrid>
      )}
      <BlogPostView
        handle={openBlogHandle}
        opened={openBlogHandle !== null}
        onClose={() => setOpenBlogHandle(null)}
        onNavigate={navigateAway}
      />
    </Box>
  );
}

/** A Home card's list of records: type icon, name, and how long ago (a
 * change for Change Log and Bookmarks, a visit for Recently visited), each
 * row a link to that record. */
function RecordRows({ items }: { items: RecentItem[] }) {
  return (
    <Stack gap="xs">
      {items.map((item) => {
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
              <Text truncate style={{ flex: 1, minWidth: 0 }}>
                {item.label}
              </Text>
              {item.changeUnix > 0 && (
                <Text size="xs" c="dimmed" style={{ flex: "none" }}>{timeAgo(item.changeUnix)}</Text>
              )}
            </Group>
          </Anchor>
        );
      })}
    </Stack>
  );
}

/** The Anniversaries card: a 30-day window at a time, starting today,
 * showing the eight most recent events in it (so living memory comes
 * before 1850), and how many more it holds. The arrows step a window back
 * or forward, up to about a year either way. Windows are kept as they're
 * fetched, so stepping back over them doesn't ask again.
 *
 * Loads on its own, not in HomeView's Promise.all: for a Guest the server
 * answers this query in Python, not SQL (7 s on a 100k tree vs 0.9 s with
 * view-private), so it mustn't hold up the page. */
function AnniversaryCard() {
  // 0 = today and the 29 days after, 1 = the 30 after those, -1 = the 30
  // days up to yesterday, ...
  const [index, setIndex] = useState(0);
  const [windows, setWindows] = useState<Map<number, AnniversaryWindow>>(() => new Map());
  const current = windows.get(index);

  useEffect(() => {
    if (windows.has(index)) return;
    let cancelled = false;
    (async () => {
      const token = await getToken();
      // never throws: logs and returns an empty window on error
      return fetchAnniversaryWindow(token, ANNIVERSARY_LIMIT, index);
    })().catch((): AnniversaryWindow => ({ ...windowRange(index, new Date()), items: [], total: null })).then((loaded) => {
      if (!cancelled) setWindows((prev) => new Map(prev).set(index, loaded));
    });
    return () => {
      cancelled = true;
    };
  }, [index, windows]);

  // What's still showing while the next window loads: the one just left.
  const [shown, setShown] = useState<AnniversaryWindow | undefined>(undefined);
  useEffect(() => {
    if (current) setShown(current);
  }, [current]);

  const loading = !current;
  const more = shown && shown.total !== null ? shown.total - shown.items.length : 0;

  return (
    <Panel
      title={t("Anniversaries")}
      actions={
        <Group gap={4} wrap="nowrap">
          {loading && shown && <Loader size="xs" />}
          {shown && <Text size="xs" c="dimmed">{formatWindow(shown.start, shown.end)}</Text>}
          <ActionIcon variant="subtle" size="sm" onClick={() => setIndex((i) => i - 1)}
            disabled={loading || index <= -ANNIVERSARY_WINDOWS}
            aria-label={t("Earlier anniversaries")} title={t("Earlier anniversaries")}>
            ‹
          </ActionIcon>
          <ActionIcon variant="subtle" size="sm" onClick={() => setIndex((i) => i + 1)}
            disabled={loading || index >= ANNIVERSARY_WINDOWS}
            aria-label={t("Later anniversaries")} title={t("Later anniversaries")}>
            ›
          </ActionIcon>
        </Group>
      }
    >
      {!shown ? (
        <Group gap="xs">
          <Loader size="xs" />
          <Text c="dimmed">{t("Looking for anniversaries…")}</Text>
        </Group>
      ) : shown.items.length === 0 ? (
        <Text c="dimmed">{t("No births, marriages or deaths with an exact date in these 30 days.")}</Text>
      ) : (
        <Box style={{ opacity: loading ? 0.5 : 1 }}>
          <AnniversaryRows items={shown.items} />
          {more > 0 && (
            <Text size="xs" c="dimmed" mt="xs">
              {t("…and %s more in these 30 days").replace("%s", String(more))}
            </Text>
          )}
        </Box>
      )}
    </Panel>
  );
}

/** The Anniversaries card's rows: event type and who, the original date
 * and how many years it marks, and how soon (or how long ago). Each row
 * links to the person (or family) rather than the event itself. */
function AnniversaryRows({ items }: { items: AnniversaryItem[] }) {
  return (
    <Stack gap="xs">
      {items.map((item) => (
        <Anchor
          key={item.eventHandle}
          component="a"
          href={formatHash({ viewKey: item.viewKey, handle: item.handle })}
          underline="never"
          c="inherit"
        >
          <Group gap="xs" wrap="nowrap" align="flex-start">
            <Image src={EVENT_VIEW.icon} alt="" w={20} h={20} mt={2} />
            <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
              <Text truncate>{item.who ? `${item.typeLabel} — ${item.who}` : item.typeLabel}</Text>
              <Text size="xs" c="dimmed" truncate>
                {item.years === null ? item.dateLabel : `${item.dateLabel} · ${formatYears(item.years)}`}
              </Text>
            </Stack>
            <Text size="xs" c={item.daysUntil === 0 ? undefined : "dimmed"} fw={item.daysUntil === 0 ? 600 : undefined} style={{ flex: "none" }}>
              {formatDaysUntil(item.daysUntil)}
            </Text>
          </Group>
        </Anchor>
      ))}
    </Stack>
  );
}

/** Bordered section, same convention VisualFrame uses for its own panel --
 * this page has five of them instead of one. */
function Panel({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <Paper withBorder p="md" radius="sm">
      {actions ? (
        <Group justify="space-between" wrap="nowrap" mb="sm">
          <Title order={5}>{title}</Title>
          {actions}
        </Group>
      ) : (
        <Title order={5} mb="sm">{title}</Title>
      )}
      {children}
    </Paper>
  );
}

/** The Home-person panel's body: a clickable name+icon once one is set (with
 * a pencil to change it), or a circled "+" -> Modal -> RecordPicker
 * (AttachControl.tsx's SetFieldControl pattern) to pick one. Purely a
 * per-browser preference (homePersonPreference.ts's localStorage,
 * tree-scoped) -- same convention gramps-web's own GrampsjsHomePerson.js
 * uses (appState.updateSettings(), itself a plain localStorage write), not
 * Gramps' own db.default_person (Edit > Set Home Person in Gramps desktop)
 * -- so no permission check: every user can set their own shortcut, the
 * same as gramps-web lets any logged-in user set theirs. */
function HomePersonContent({
  homePerson, onChange,
}: {
  homePerson: QueryItem | null;
  onChange: (person: QueryItem) => void;
}) {
  const [opened, setOpened] = useState(false);

  function handlePick(item: QueryItem) {
    setOpened(false);
    setHomePersonHandle(item.handle);
    onChange(item);
  }

  return (
    <>
      {homePerson ? (
        <Group gap="xs" wrap="nowrap">
          <Anchor
            component="a"
            href={formatHash({ viewKey: "person", handle: homePerson.handle })}
            underline="never"
            c="inherit"
            style={{ minWidth: 0 }}
          >
            <Group gap="sm" wrap="nowrap">
              <Image src={PERSON_VIEW.icon} alt="" w={28} h={28} />
              <Text fw={600} truncate>{personLabel(homePerson)}</Text>
            </Group>
          </Anchor>
          <CircleGlyphButton
            glyph="✎"
            label={t("Change home person")}
            onClick={() => setOpened(true)}
            size={16}
          />
        </Group>
      ) : (
        <CircleGlyphButton
          glyph="+"
          label={t("Set home person")}
          textLabel={t("Set home person")}
          onClick={() => setOpened(true)}
        />
      )}
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
