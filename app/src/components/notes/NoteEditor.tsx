// Rich-text editor for every Gramps note (the Note edit dialog and the new
// blog post dialog). TipTap/ProseMirror underneath, Mantine's
// RichTextEditor for the frame and toolbar; the value in and out is always
// a Gramps StyledText (store/styledText.ts converts), so formatting made
// here reads the same in Gramps desktop and gramps-web.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Button, CloseButton, ColorSwatch, FileButton, Group, Paper, Popover, Select, SimpleGrid, Stack, Text } from "@mantine/core";
import { RichTextEditor } from "@mantine/tiptap";
import { useEditor, type Editor } from "@tiptap/react";
import "@mantine/tiptap/styles.css";
import { getToken } from "../../auth/auth";
import { uploadMediaFile } from "../../store/jobsApi";
import { prepareImageUploads } from "../../store/imageResize";
import {
  docToStyledText, recordLink, sameStyledText, styledTextToDoc, type StyledText,
} from "../../store/styledText";
import {
  CITATION_VIEW, EVENT_VIEW, FAMILY_VIEW, MEDIA_VIEW, NOTE_VIEW, PERSON_VIEW, PLACE_VIEW, REPOSITORY_VIEW, SOURCE_VIEW,
  type ViewConfig,
} from "../../store/views";
import type { QueryItem } from "../../store/api";
import { RecordPicker } from "../RecordPicker";
import { pickerResultLabel } from "../RefPickerField";
import { HIGHLIGHT_COLOR, noteExtensions } from "./noteExtensions";
import { t } from "../../i18n/i18n";
import classes from "./NoteEditor.module.css";

/** Record types a note can link to (gramps' own styledtexteditor.py list). */
const LINK_TARGETS: { value: string; label: string; objectClass: string; view: ViewConfig }[] = [
  { value: "person", label: "Person", objectClass: "Person", view: PERSON_VIEW },
  { value: "family", label: "Family", objectClass: "Family", view: FAMILY_VIEW },
  { value: "event", label: "Event", objectClass: "Event", view: EVENT_VIEW },
  { value: "place", label: "Place", objectClass: "Place", view: PLACE_VIEW },
  { value: "source", label: "Source", objectClass: "Source", view: SOURCE_VIEW },
  { value: "citation", label: "Citation", objectClass: "Citation", view: CITATION_VIEW },
  { value: "repository", label: "Repository", objectClass: "Repository", view: REPOSITORY_VIEW },
  { value: "media", label: "Media", objectClass: "Media", view: MEDIA_VIEW },
  { value: "note", label: "Note", objectClass: "Note", view: NOTE_VIEW },
];

const FONT_COLORS = [
  "#000000", "#5C5F66", "#C92A2A", "#D9480F", "#E67700", "#2B8A3E",
  "#0B7285", "#1864AB", "#5F3DC4", "#A61E4D", "#862E9C", "#868E96",
];

type Panel = null | "record" | "image";

function Svg({ style, children }: { style?: CSSProperties; children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden>
      {children}
    </svg>
  );
}

const HighlightIcon = ({ style }: { style?: CSSProperties }) => (
  <Svg style={style}><path d="M3 19h4L17.5 8.5a2.83 2.83 0 0 0-4-4L3 15v4" /><path d="M12.5 5.5l4 4" /><path d="M14 19h7" /></Svg>
);
const ColorIcon = ({ style }: { style?: CSSProperties }) => (
  <Svg style={style}><path d="M9 15l3-9 3 9" /><path d="M10 12h4" /><path d="M5 20h14" /></Svg>
);
const RecordLinkIcon = ({ style }: { style?: CSSProperties }) => (
  <Svg style={style}><circle cx="9" cy="7" r="3" /><path d="M3 20v-1a5 5 0 0 1 9-3" /><path d="M14 17h6" /><path d="M17 14l3 3-3 3" /></Svg>
);
const ImageIcon = ({ style }: { style?: CSSProperties }) => (
  <Svg style={style}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></Svg>
);

function labelWithoutId(type: string, item: QueryItem): string {
  return pickerResultLabel(type, item).replace(/^\[[^\]]*\]\s*/, "") || String(item.gramps_id ?? item.handle);
}

function HighlightControl({ editor }: { editor: Editor }) {
  const active = editor.isActive("highlight");
  return (
    <RichTextEditor.Control
      active={active}
      aria-label={t("Highlight")}
      title={t("Highlight")}
      onClick={() => {
        const chain = editor.chain().focus();
        (active ? chain.unsetMark("highlight") : chain.setMark("highlight", { value: HIGHLIGHT_COLOR })).run();
      }}
    >
      <HighlightIcon />
    </RichTextEditor.Control>
  );
}

function FontColorControl({ editor }: { editor: Editor }) {
  const [opened, setOpened] = useState(false);
  const active = editor.isActive("fontcolor");
  return (
    <Popover opened={opened} onChange={setOpened} position="bottom" withinPortal={false} shadow="md">
      <Popover.Target>
        <RichTextEditor.Control
          active={active}
          aria-label={t("Text color")}
          title={t("Text color")}
          onClick={() => setOpened((o) => !o)}
        >
          <ColorIcon />
        </RichTextEditor.Control>
      </Popover.Target>
      <Popover.Dropdown p="xs">
        <SimpleGrid cols={6} spacing={6}>
          {FONT_COLORS.map((color) => (
            <ColorSwatch
              key={color}
              component="button"
              type="button"
              color={color}
              size={20}
              aria-label={color}
              style={{ cursor: "pointer" }}
              onClick={() => {
                editor.chain().focus().setMark("fontcolor", { value: color }).run();
                setOpened(false);
              }}
            />
          ))}
        </SimpleGrid>
        <Button
          variant="subtle"
          size="compact-xs"
          mt="xs"
          fullWidth
          onClick={() => {
            editor.chain().focus().unsetMark("fontcolor").run();
            setOpened(false);
          }}
        >
          {t("Default color")}
        </Button>
      </Popover.Dropdown>
    </Popover>
  );
}

/** "Link to a record" and "Insert image": shown between the toolbar and
 * the text rather than in a nested dialog, since Escape in a nested Mantine
 * Modal also closes the edit dialog underneath it. */
function PickerPanel({ editor, panel, onClose }: { editor: Editor; panel: Exclude<Panel, null>; onClose: () => void }) {
  const [targetType, setTargetType] = useState("person");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = LINK_TARGETS.find((x) => x.value === targetType) ?? LINK_TARGETS[0];
  const view = panel === "image" ? MEDIA_VIEW : target.view;
  const type = panel === "image" ? "media" : target.value;

  function pick(item: QueryItem) {
    if (panel === "image") {
      editor.chain().focus().insertGrampsImage(item.handle).run();
    } else {
      const href = recordLink(target.objectClass, item.handle);
      if (editor.state.selection.empty) {
        editor.chain().focus().insertContent({
          type: "text",
          text: labelWithoutId(type, item),
          marks: [{ type: "link", attrs: { href } }],
        }).run();
      } else {
        editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
      }
    }
    onClose();
  }

  async function upload(file: File | null) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const prepared = await prepareImageUploads([file]);
      if (!prepared) return;
      const token = await getToken();
      const handle = await uploadMediaFile(token, prepared[0]);
      editor.chain().focus().insertGrampsImage(handle).run();
      onClose();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Paper withBorder p="xs" m="xs" radius="sm">
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm" fw={500}>{panel === "image" ? t("Insert image") : t("Link to a record")}</Text>
          <CloseButton size="sm" onClick={onClose} aria-label={t("Close")} />
        </Group>
        {panel === "record" ? (
          <Select
            size="xs"
            data={LINK_TARGETS.map((x) => ({ value: x.value, label: t(x.label) }))}
            value={targetType}
            onChange={(v) => v && setTargetType(v)}
            allowDeselect={false}
            comboboxProps={{ withinPortal: false }}
            w={180}
          />
        ) : (
          <Group gap="xs">
            <FileButton onChange={upload} accept="image/*">
              {(props) => (
                <Button variant="default" size="xs" loading={uploading} {...props}>{t("Upload a new image…")}</Button>
              )}
            </FileButton>
            <Text size="xs" c="dimmed">{t("or choose existing media below")}</Text>
          </Group>
        )}
        <RecordPicker
          key={type}
          view={view}
          searchField="gramps_id"
          buildExpr={view.simpleSearch?.buildExpr}
          renderLabel={(item) => pickerResultLabel(type, item)}
          placeholder={view.simpleSearch?.placeholder ?? t("Search…")}
          onPick={pick}
        />
        {error && <Text size="xs" c="red">{error}</Text>}
      </Stack>
    </Paper>
  );
}

export interface NoteEditorProps {
  value: StyledText | null | undefined;
  onChange: (value: StyledText) => void;
  /** CSS min-height of the writing area. */
  minHeight?: number | string;
  /** CSS max-height of the writing area; it scrolls past this. */
  maxHeight?: number | string;
  /** Larger type for long-form writing (the blog dialog). */
  prose?: boolean;
  autofocus?: boolean;
  placeholder?: string;
}

export function NoteEditor({ value, onChange, minHeight = 240, maxHeight, prose = false, autofocus = false, placeholder }: NoteEditorProps) {
  const [panel, setPanel] = useState<Panel>(null);
  // What this editor last reported, so a parent echoing it back isn't
  // mistaken for an outside change that should reset the editor.
  const lastEmitted = useRef<StyledText | null>(value ?? null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: noteExtensions({ placeholder }),
    content: styledTextToDoc(value),
    autofocus: autofocus ? "end" : false,
    // Mantine's toolbar reads editor.isActive() while rendering.
    shouldRerenderOnTransaction: true,
    onUpdate: ({ editor }) => {
      const next = docToStyledText(editor.getJSON());
      lastEmitted.current = next;
      onChangeRef.current(next);
    },
  });

  // An outside change (an edit draft whose data finished loading after the
  // dialog opened): load it without reporting it back as an edit.
  useEffect(() => {
    if (!editor || sameStyledText(value, lastEmitted.current)) return;
    lastEmitted.current = value ?? null;
    editor.commands.setContent(styledTextToDoc(value), { emitUpdate: false });
  }, [editor, value]);

  const contentStyle = {
    "--note-min-height": typeof minHeight === "number" ? `${minHeight}px` : minHeight,
    maxHeight,
    overflowY: maxHeight ? "auto" : undefined,
  } as CSSProperties;

  return (
    <RichTextEditor editor={editor} className={prose ? `${classes.editor} ${classes.prose}` : classes.editor}>
      <RichTextEditor.Toolbar sticky stickyOffset={0}>
        <RichTextEditor.ControlsGroup>
          <RichTextEditor.Bold />
          <RichTextEditor.Italic />
          <RichTextEditor.Underline />
          <RichTextEditor.Strikethrough />
        </RichTextEditor.ControlsGroup>
        <RichTextEditor.ControlsGroup>
          <RichTextEditor.Superscript />
          <RichTextEditor.Subscript />
        </RichTextEditor.ControlsGroup>
        {editor && (
          <RichTextEditor.ControlsGroup>
            <HighlightControl editor={editor} />
            <FontColorControl editor={editor} />
            <RichTextEditor.ClearFormatting />
          </RichTextEditor.ControlsGroup>
        )}
        <RichTextEditor.ControlsGroup>
          <RichTextEditor.Link />
          <RichTextEditor.Control
            active={panel === "record"}
            aria-label={t("Link to a record")}
            title={t("Link to a record")}
            onClick={() => setPanel((p) => (p === "record" ? null : "record"))}
          >
            <RecordLinkIcon />
          </RichTextEditor.Control>
          <RichTextEditor.Unlink />
          <RichTextEditor.Control
            active={panel === "image"}
            aria-label={t("Insert image")}
            title={t("Insert image")}
            onClick={() => setPanel((p) => (p === "image" ? null : "image"))}
          >
            <ImageIcon />
          </RichTextEditor.Control>
        </RichTextEditor.ControlsGroup>
        <RichTextEditor.ControlsGroup>
          <RichTextEditor.Undo />
          <RichTextEditor.Redo />
        </RichTextEditor.ControlsGroup>
      </RichTextEditor.Toolbar>
      {editor && panel && <PickerPanel editor={editor} panel={panel} onClose={() => setPanel(null)} />}
      <RichTextEditor.Content style={contentStyle} />
    </RichTextEditor>
  );
}
