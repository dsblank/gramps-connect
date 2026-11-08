import { useRef, useState, useSyncExternalStore } from "react";
import {
  Anchor,
  Badge,
  Button,
  CloseButton,
  Group,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import {
  BUILTIN_SITES,
  engineFromSuggestion,
  fillTemplate,
  isValidSearchUrl,
  loadPrefs,
  savePrefs,
  searchTermsFor,
  SUGGESTED_SITES,
  suggestionEngineKey,
  TEMPLATE_VARS,
  visibleSites,
  type ExternalSearchPrefs,
  type ExternalSite,
  type SearchTerms,
  type SiteAccess,
  type TemplateVar,
} from "../../store/externalSearch";
import type { ObjectDetail } from "../../store/objectDetail";
import { t } from "../../i18n/i18n";
import { DOCK_MARGIN, dockOffsets, getDock, subscribeDock } from "../../store/bottomDock";
import { getWindowStack, subscribeWindowStack, windowZIndex } from "../../store/windowStack";
import {
  closeExternalSearchWindow,
  EXTERNAL_SEARCH_CHIP_WIDTH,
  EXTERNAL_SEARCH_WINDOW_ID,
  getExternalSearchWindow,
  raiseExternalSearchWindow,
  setExternalSearchWindowMinimized,
  subscribeExternalSearchWindow,
} from "../../store/externalSearchWindow";
import { FloatingWindow } from "../FloatingWindow";
import { STORAGE_KEYS } from "../../store/storageKeys";

// gramps-web's own wording, so these come already translated from its
// Weblate catalog (app/public/lang/).
const ACCESS_LABEL: Record<SiteAccess, string> = {
  open: "Open access",
  registration: "Registration required",
  subscription: "Records require additional access",
};
const ACCESS_COLOR: Record<SiteAccess, string> = { open: "green", registration: "blue", subscription: "gray" };

const TERM_LABEL: Record<TemplateVar, string> = {
  name_given: "Given name",
  name_middle: "Middle name",
  name_surname: "Surname",
  place_name: "Place",
  birth_year: "Birth year",
  death_year: "Death year",
};

/** One line saying what will be searched for: "Johann Schmidt · 1832–1901
 * · Kirchheim" -- numbers and names only, so it needs no translation. */
function termsSummary(terms: SearchTerms): string {
  const name = [terms.name_given, terms.name_surname].filter(Boolean).join(" ");
  const years = terms.birth_year || terms.death_year ? `${terms.birth_year}–${terms.death_year}` : "";
  return [name, years, terms.place_name].filter(Boolean).join(" · ");
}

/** The External Search window (opened by ExternalSearchButton.tsx on a
 * person's RelatedPanel): links that look the person up on other
 * genealogy websites (store/externalSearch.ts). A floating window rather
 * than a modal, so it can stay up beside the person's own records -- and
 * across navigation, since it's mounted once in App.tsx next to
 * GrampletWindows -- while the links open in other tabs. One window: opening
 * it from another person switches it to them (store/externalSearchWindow.ts).
 *
 * The terms are worked out once per opening and shown at the top; Edit
 * lets them be changed for this search only (a spelling variant, dropping
 * a wrong place) without touching the record. Customize, in the same
 * window, switches built-in sites off and adds the user's own search URLs,
 * both kept per browser. */
export function ExternalSearchWindow() {
  const win = useSyncExternalStore(subscribeExternalSearchWindow, getExternalSearchWindow);
  const stack = useSyncExternalStore(subscribeWindowStack, getWindowStack);
  const offsets = dockOffsets(useSyncExternalStore(subscribeDock, getDock));
  if (!win) return null;
  const name = personName(win.detail);
  return (
    <FloatingWindow
      storageKey={STORAGE_KEYS.externalSearchWindowGeometry}
      title={name ? `${t("External Search")}: ${name}` : t("External Search")}
      zIndex={windowZIndex(stack, EXTERNAL_SEARCH_WINDOW_ID)}
      minimized={win.minimized}
      chipRight={offsets.get(EXTERNAL_SEARCH_WINDOW_ID) ?? DOCK_MARGIN}
      chipWidth={EXTERNAL_SEARCH_CHIP_WIDTH}
      defaultWidth={460}
      defaultHeight={520}
      onFocus={raiseExternalSearchWindow}
      onMinimize={setExternalSearchWindowMinimized}
      onClose={closeExternalSearchWindow}
    >
      {/* Keyed by opening, so each one starts from the person's own terms. */}
      <ExternalSearchContent key={win.generation} detail={win.detail} />
    </FloatingWindow>
  );
}

function personName(detail: ObjectDetail): string {
  const terms = searchTermsFor(detail);
  return [terms.name_given, terms.name_surname].filter(Boolean).join(" ");
}

function ExternalSearchContent({ detail }: { detail: ObjectDetail }) {
  const [terms, setTerms] = useState<SearchTerms>(() => searchTermsFor(detail));
  const [editingTerms, setEditingTerms] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [prefs, setPrefs] = useState<ExternalSearchPrefs>(loadPrefs);

  function updatePrefs(next: ExternalSearchPrefs) {
    setPrefs(next);
    savePrefs(next);
  }

  if (customizing) {
    return <CustomizePanel prefs={prefs} terms={terms} onChange={updatePrefs} onDone={() => setCustomizing(false)} />;
  }
  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        {t("Search external services for matching records.")}
      </Text>
      <Group gap="xs" wrap="nowrap" align="flex-start">
        <Text size="sm" fw={500} style={{ flex: 1, minWidth: 0 }}>
          {termsSummary(terms) || "—"}
        </Text>
        <Button variant="subtle" size="compact-xs" onClick={() => setEditingTerms((v) => !v)}>
          {editingTerms ? t("Done") : t("Edit")}
        </Button>
      </Group>
      {editingTerms && (
        <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs" verticalSpacing="xs">
          {TEMPLATE_VARS.map((key) => (
            <TextInput
              key={key}
              size="xs"
              label={t(TERM_LABEL[key])}
              value={terms[key]}
              onChange={(e) => setTerms({ ...terms, [key]: e.currentTarget.value })}
            />
          ))}
        </SimpleGrid>
      )}
      <Stack gap={2}>
        {visibleSites(prefs).map((site) => (
          <SiteLink key={site.key} site={site} terms={terms} />
        ))}
        {visibleSites(prefs).length === 0 && (
          <Text size="sm" c="dimmed">
            {t("No sites to show.")}
          </Text>
        )}
      </Stack>
      <Group justify="flex-end">
        <Button variant="subtle" size="xs" onClick={() => setCustomizing(true)}>
          {t("Customize…")}
        </Button>
      </Group>
    </Stack>
  );
}

/** A real link, so middle-click and copy-link work as on the app's other
 * links; noreferrer so the other site isn't sent this app's URL. */
function SiteLink({ site, terms }: { site: ExternalSite; terms: SearchTerms }) {
  return (
    <UnstyledButton
      component="a"
      href={fillTemplate(site.url, terms)}
      target="_blank"
      rel="noopener noreferrer"
      p="xs"
      style={{ borderRadius: 4 }}
    >
      <Group gap="sm" wrap="nowrap">
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text size="sm">{site.name}</Text>
        </div>
        {site.access && (
          <Badge variant="light" size="sm" color={ACCESS_COLOR[site.access]} tt="none">
            {t(ACCESS_LABEL[site.access])}
          </Badge>
        )}
        <Text size="sm" c="dimmed" aria-hidden>
          ↗
        </Text>
      </Group>
    </UnstyledButton>
  );
}

function newKey(): string {
  return `custom_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function CustomizePanel({
  prefs,
  terms,
  onChange,
  onDone,
}: {
  prefs: ExternalSearchPrefs;
  terms: SearchTerms;
  onChange: (prefs: ExternalSearchPrefs) => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const urlRef = useRef<HTMLInputElement>(null);
  const urlOk = isValidSearchUrl(url);
  const canAdd = name.trim() !== "" && urlOk;

  function toggleSite(key: string, shown: boolean) {
    const hidden = shown ? prefs.hidden.filter((k) => k !== key) : [...prefs.hidden, key];
    onChange({ ...prefs, hidden });
  }

  /** Puts {{variable}} at the URL field's cursor, not just at the end. */
  function insertVar(key: TemplateVar) {
    const input = urlRef.current;
    const token = `{{${key}}}`;
    const start = input?.selectionStart ?? url.length;
    const end = input?.selectionEnd ?? url.length;
    setUrl(url.slice(0, start) + token + url.slice(end));
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function addEngine() {
    if (!canAdd) return;
    onChange({ ...prefs, custom: [...prefs.custom, { key: newKey(), name: name.trim(), url: url.trim() }] });
    setName("");
    setUrl("");
  }

  return (
    <Stack gap="md">
      <Stack gap={6}>
        {BUILTIN_SITES.map((site) => (
          <Switch
            key={site.key}
            size="sm"
            label={site.name}
            checked={!prefs.hidden.includes(site.key)}
            onChange={(e) => toggleSite(site.key, e.currentTarget.checked)}
          />
        ))}
      </Stack>

      <Stack gap={4}>
        <Text size="sm" fw={500}>
          {t("Suggested sites")}
        </Text>
        <Text size="xs" c="dimmed">
          {t("Regional sites, not listed by default. Adding one puts it with your own search engines below.")}
        </Text>
        {SUGGESTED_SITES.map((site) => {
          const added = prefs.custom.some((e) => e.key === suggestionEngineKey(site));
          return (
            <Group key={site.key} gap="xs" wrap="nowrap">
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text size="sm">{site.name}</Text>
                <Text size="xs" c="dimmed">
                  {t(site.region)}
                </Text>
              </div>
              <Button
                size="compact-xs"
                variant="light"
                disabled={added}
                onClick={() => onChange({ ...prefs, custom: [...prefs.custom, engineFromSuggestion(site)] })}
              >
                {added ? t("Added") : t("Add")}
              </Button>
            </Group>
          );
        })}
      </Stack>

      {prefs.custom.length > 0 && (
        <Stack gap={4}>
          {prefs.custom.map((engine) => (
            <Group key={engine.key} gap="xs" wrap="nowrap">
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text size="sm">{engine.name}</Text>
                <Text size="xs" c="dimmed" ff="monospace" truncate title={engine.url}>
                  {engine.url}
                </Text>
              </div>
              <CloseButton
                size="sm"
                aria-label={t("Remove")}
                title={t("Remove")}
                onClick={() => onChange({ ...prefs, custom: prefs.custom.filter((e) => e.key !== engine.key) })}
              />
            </Group>
          ))}
        </Stack>
      )}

      <Stack gap="xs">
        <Text size="sm" fw={500}>
          {t("Add custom search engine")}
        </Text>
        <TextInput size="xs" label={t("Name")} placeholder={t("e.g., MyGenealogy")} value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <TextInput
          ref={urlRef}
          size="xs"
          label={t("Search URL")}
          placeholder="https://example.com/search?name={{name_given}}_{{name_surname}}"
          value={url}
          onChange={(e) => setUrl(e.currentTarget.value)}
          error={url.trim() !== "" && !urlOk ? t("Enter a web address starting with https://") : undefined}
          styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
        />
        <Text size="xs" c="dimmed">
          {t("Enter a search URL with template variables for person data. Available variables:")}
        </Text>
        <Group gap={4}>
          {TEMPLATE_VARS.map((key) => (
            <Badge
              key={key}
              component="button"
              type="button"
              variant="light"
              size="sm"
              tt="none"
              ff="monospace"
              style={{ cursor: "pointer" }}
              onClick={() => insertVar(key)}
              title={t(TERM_LABEL[key])}
            >
              {`{{${key}}}`}
            </Badge>
          ))}
        </Group>
        <Group justify="space-between">
          {urlOk ? (
            <Anchor size="xs" href={fillTemplate(url.trim(), terms)} target="_blank" rel="noopener noreferrer">
              {t("Try it with this person")} ↗
            </Anchor>
          ) : (
            <div />
          )}
          <Button size="xs" disabled={!canAdd} onClick={addEngine}>
            {t("Add")}
          </Button>
        </Group>
      </Stack>

      <Group justify="flex-end">
        <Button variant="default" size="xs" onClick={onDone}>
          {t("Done")}
        </Button>
      </Group>
    </Stack>
  );
}
