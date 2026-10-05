import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ActionIcon, Alert, Anchor, Box, Group, Loader, Modal, ScrollArea, TypographyStylesProvider } from "@mantine/core";
import { fetchWikiPage, wikiPageGithubUrl } from "../store/wikiDocsApi";
import { findWikiAnchor, renderWikiMarkdown } from "../store/wikiMarkdown";
import { getI18nSnapshot, subscribe as subscribeI18n, t } from "../i18n/i18n";

interface DocumentationDialogProps {
  opened: boolean;
  onClose: () => void;
}

const HOME_PAGE = "Home";

/** GitHub-recognized _Sidebar.md, reused as the in-app nav so the page list
 * never needs to be duplicated -- it's already what every wiki reader sees. */
const SIDEBAR_PAGE = "_Sidebar";

export function DocumentationDialog({ opened, onClose }: DocumentationDialogProps) {
  const { lang } = useSyncExternalStore(subscribeI18n, getI18nSnapshot);
  const [page, setPage] = useState(HOME_PAGE);
  // Language the reader picked from a page's "available in" banner (or
  // reached through a link naming one), overriding the app's own language
  // until the dialog reopens or the app language changes. null = follow it.
  const [docLang, setDocLang] = useState<string | null>(null);
  const viewLang = docLang ?? lang;
  const [history, setHistory] = useState<{ page: string; docLang: string | null }[]>([]);
  // Heading to scroll to once `page` has rendered -- set by a link with a
  // "#fragment", cleared once the jump has happened.
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  // Which page+language `content` belongs to, so a pending anchor waits for
  // the new page instead of jumping within the one still on screen.
  const [contentKey, setContentKey] = useState<string | null>(null);
  // Which language the currently-displayed content actually resolved to --
  // "en" whenever this page has no "{page}.{lang}.md" translation yet, even
  // if the UI itself is running in another language (fetchWikiPage falls
  // back silently; the reader just sees English for that one page).
  const [contentLang, setContentLang] = useState("en");
  const [sidebar, setSidebar] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!opened) return;
    setPage(HOME_PAGE);
    setDocLang(null);
    setHistory([]);
  }, [opened, lang]);

  useEffect(() => {
    if (!opened) return;
    fetchWikiPage(SIDEBAR_PAGE, viewLang).then((p) => setSidebar(p.markdown)).catch(() => setSidebar(null));
  }, [opened, viewLang]);

  useEffect(() => {
    if (!opened) return;
    setLoading(true);
    setError(null);
    fetchWikiPage(page, viewLang)
      .then((p) => {
        setContent(p.markdown);
        setContentKey(`${page}|${viewLang}`);
        setContentLang(p.lang);
      })
      .catch((err) => setError(err.message ?? String(err)))
      .finally(() => setLoading(false));
    contentRef.current?.scrollTo({ top: 0 });
  }, [opened, page, viewLang]);

  function navigateTo(target: string, anchor: string | null, linkLang: string | null) {
    const nextDocLang = linkLang ?? docLang;
    if (target !== page || nextDocLang !== docLang) {
      setHistory((h) => [...h, { page, docLang }]);
      setPage(target);
      setDocLang(nextDocLang);
    }
    setPendingAnchor(anchor);
  }

  function goBack() {
    setHistory((h) => {
      if (h.length === 0) return h;
      const previous = h[h.length - 1];
      setPage(previous.page);
      setDocLang(previous.docLang);
      return h.slice(0, -1);
    });
  }

  function handlePaneClick(e: React.MouseEvent<HTMLDivElement>) {
    const link = (e.target as HTMLElement).closest("a[data-wiki-page]");
    if (!link) return;
    e.preventDefault();
    // An empty data-wiki-page is a same-page "#fragment" link.
    navigateTo(
      link.getAttribute("data-wiki-page") || page,
      link.getAttribute("data-wiki-anchor"),
      link.getAttribute("data-wiki-lang"),
    );
  }

  const contentHtml = useMemo(() => (content ? renderWikiMarkdown(content) : ""), [content]);
  const sidebarHtml = useMemo(() => (sidebar ? renderWikiMarkdown(sidebar) : ""), [sidebar]);

  // Runs after the new page's HTML is in the DOM. Translated pages carry the
  // English heading slugs as explicit <a id> anchors (see
  // scripts/sync-wiki-translations.py), so the same anchor works in every
  // language; an anchor that isn't found just leaves the page at the top.
  useEffect(() => {
    if (!pendingAnchor || loading || contentKey !== `${page}|${viewLang}`) return;
    const viewport = contentRef.current;
    const target = viewport && findWikiAnchor(viewport, pendingAnchor);
    if (viewport && target) {
      const offset = target.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
      viewport.scrollTo({ top: viewport.scrollTop + offset });
    }
    setPendingAnchor(null);
  }, [pendingAnchor, loading, contentKey, page, viewLang, contentHtml]);

  return (
    <Modal opened={opened} onClose={onClose} title={t("Documentation")} size="90%" styles={{ body: { height: "80vh", padding: 0 } }}>
      <Group align="stretch" gap={0} h="100%" wrap="nowrap">
        <Box w={220} style={{ borderRight: "1px solid var(--mantine-color-default-border)", flexShrink: 0 }}>
          <ScrollArea h="100%" p="sm" onClickCapture={handlePaneClick}>
            {sidebar && (
              <TypographyStylesProvider p={0}>
                <div dangerouslySetInnerHTML={{ __html: sidebarHtml }} />
              </TypographyStylesProvider>
            )}
          </ScrollArea>
        </Box>
        <Box style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <Group justify="space-between" p="sm" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
            <ActionIcon variant="subtle" onClick={goBack} disabled={history.length === 0} aria-label={t("Back")}>
              ←
            </ActionIcon>
            <Anchor href={wikiPageGithubUrl(page, contentLang)} target="_blank" rel="noreferrer noopener" size="sm">
              {t("Open on GitHub")} ↗
            </Anchor>
          </Group>
          <ScrollArea style={{ flex: 1 }} p="lg" viewportRef={contentRef} onClickCapture={handlePaneClick}>
            {loading && (
              <Group justify="center" py="xl">
                <Loader size="sm" />
              </Group>
            )}
            {error && <Alert color="red">{error}</Alert>}
            {!loading && !error && content && (
              <TypographyStylesProvider p={0}>
                <div dangerouslySetInnerHTML={{ __html: contentHtml }} />
              </TypographyStylesProvider>
            )}
          </ScrollArea>
        </Box>
      </Group>
    </Modal>
  );
}
