import { useEffect, useMemo, useRef, useState } from "react";
import { ActionIcon, Alert, Anchor, Box, Group, Loader, Modal, ScrollArea, TypographyStylesProvider } from "@mantine/core";
import DOMPurify from "dompurify";
import { Marked } from "marked";
import { fetchWikiPage, wikiAssetUrl, wikiPageGithubUrl } from "../store/wikiDocsApi";
import { t } from "../i18n/i18n";

interface DocumentationDialogProps {
  opened: boolean;
  onClose: () => void;
}

const HOME_PAGE = "Home";

/** Bare page name ("Overview", "Data-Model-and-Editing") -> wiki-internal
 * navigation; anything with a scheme, a leading "#"/"/", or a "/" in it
 * (asset paths like "images/x.png", or a real external URL) is left as a
 * normal link/asset reference instead. Matches how every page in
 * ../../../gramps-connect.wiki actually writes its links (checked: no
 * `[[wiki-link]]` syntax anywhere, just plain markdown). */
function isInternalWikiLink(href: string): boolean {
  return !/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(href) && !href.includes("/");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/** Fresh Marked instance per render so the link/image overrides can close
 * over the sanitize step below rather than mutating shared global state. */
function renderWikiMarkdown(markdown: string): string {
  const marked = new Marked({
    renderer: {
      link({ href, title, text }) {
        const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
        if (isInternalWikiLink(href)) {
          const page = href.split("#")[0];
          return `<a href="#" data-wiki-page="${escapeAttr(page)}"${titleAttr}>${text}</a>`;
        }
        const url = /^[a-z][a-z0-9+.-]*:/i.test(href) ? href : wikiAssetUrl(href);
        return `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer noopener"${titleAttr}>${text}</a>`;
      },
      image({ href, title, text }) {
        const url = /^[a-z][a-z0-9+.-]*:/i.test(href) ? href : wikiAssetUrl(href);
        const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
        return `<img src="${escapeAttr(url)}" alt="${escapeAttr(text)}"${titleAttr} style="max-width:100%" />`;
      },
    },
  });
  const html = marked.parse(markdown, { async: false }) as string;
  return DOMPurify.sanitize(html, { ADD_ATTR: ["target"] });
}

/** GitHub-recognized _Sidebar.md, reused as the in-app nav so the page list
 * never needs to be duplicated -- it's already what every wiki reader sees. */
const SIDEBAR_PAGE = "_Sidebar";

export function DocumentationDialog({ opened, onClose }: DocumentationDialogProps) {
  const [page, setPage] = useState(HOME_PAGE);
  const [history, setHistory] = useState<string[]>([]);
  const [content, setContent] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!opened) return;
    setPage(HOME_PAGE);
    setHistory([]);
    fetchWikiPage(SIDEBAR_PAGE).then(setSidebar).catch(() => setSidebar(null));
  }, [opened]);

  useEffect(() => {
    if (!opened) return;
    setLoading(true);
    setError(null);
    fetchWikiPage(page)
      .then((md) => setContent(md))
      .catch((err) => setError(err.message ?? String(err)))
      .finally(() => setLoading(false));
    contentRef.current?.scrollTo({ top: 0 });
  }, [opened, page]);

  function navigateTo(target: string) {
    if (target === page) return;
    setHistory((h) => [...h, page]);
    setPage(target);
  }

  function goBack() {
    setHistory((h) => {
      if (h.length === 0) return h;
      setPage(h[h.length - 1]);
      return h.slice(0, -1);
    });
  }

  function handlePaneClick(e: React.MouseEvent<HTMLDivElement>) {
    const link = (e.target as HTMLElement).closest("a[data-wiki-page]");
    if (!link) return;
    e.preventDefault();
    navigateTo(link.getAttribute("data-wiki-page") || HOME_PAGE);
  }

  const contentHtml = useMemo(() => (content ? renderWikiMarkdown(content) : ""), [content]);
  const sidebarHtml = useMemo(() => (sidebar ? renderWikiMarkdown(sidebar) : ""), [sidebar]);

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
            <Anchor href={wikiPageGithubUrl(page)} target="_blank" rel="noreferrer noopener" size="sm">
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
