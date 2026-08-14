import { useEffect, useState, type ReactNode } from "react";
import { Alert, Anchor, Box, Group, Image, Loader, Paper, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { getToken } from "../auth/auth";
import { formatHash } from "../hash";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import {
  fetchHomeCounts, fetchLatestMessages, fetchRecentlyChanged, STAT_VIEWS, timeAgo,
  type MessageItem, type RecentItem,
} from "../store/homeStats";
import iconChat from "../assets/icons/chat-message.svg";

const RECENT_LIMIT = 8;
const MESSAGE_LIMIT = 5;

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getToken();
      const [countsResult, recentResult, messagesResult] = await Promise.all([
        fetchHomeCounts(),
        fetchRecentlyChanged(token, RECENT_LIMIT),
        fetchLatestMessages(token, MESSAGE_LIMIT),
      ]);
      if (cancelled) return;
      setCounts(countsResult);
      setRecent(recentResult);
      setMessages(messagesResult);
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
      <Title order={2} mb="md">Home</Title>

      {stage === "loading" && (
        <Group py="xl" justify="center">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">Loading the tree's overview…</Text>
        </Group>
      )}

      {stage === "error" && (
        <Alert color="red" title="Couldn't load the overview">{error}</Alert>
      )}

      {stage === "ready" && (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
          <Stack gap="lg">
            <Panel title="Messages">
              {messages.length === 0 ? (
                <Text size="sm" c="dimmed">No messages yet.</Text>
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
                See all messages
              </Anchor>
            </Panel>

            <Panel title="Recently changed objects">
              {recent.length === 0 ? (
                <Text size="sm" c="dimmed">Nothing changed yet.</Text>
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

          <Panel title="Statistics">
            <Stack gap={6}>
              {STAT_VIEWS.map((v) => (
                <Group key={v.key} justify="space-between" wrap="nowrap">
                  <Anchor component="a" href={formatHash({ viewKey: v.key })} size="sm" c="inherit" underline="never">
                    <Group gap="xs" wrap="nowrap">
                      <Image src={v.icon} alt="" w={20} h={20} />
                      <Text size="sm">{v.label}</Text>
                    </Group>
                  </Anchor>
                  <Text size="sm" fw={600}>{(counts[v.key] ?? 0).toLocaleString()}</Text>
                </Group>
              ))}
            </Stack>
          </Panel>
        </SimpleGrid>
      )}
    </Box>
  );
}

/** Bordered section, same convention VisualFrame uses for its own panel --
 * this page has three of them instead of one. */
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper withBorder p="md" radius="sm">
      <Title order={5} mb="sm">{title}</Title>
      {children}
    </Paper>
  );
}
