// Tab completion for a GOQL where_expr typed into any text field -- the
// list search box (FilterBar), the Custom Rule editor (FilterPickerDialog)
// and GOQL strings inside a Gramplet's Python (GrampletEditDialog). The
// suggestions themselves come from store/goqlCompletion.ts; this is the
// keyboard handling, text insertion and dropdown state they share.
//
// Tab completes the word at the cursor: one match is inserted outright,
// several insert what they share and list the rest. The list follows
// further typing; arrows move, Tab/Enter pick, Escape closes. A pick that
// ends in what continues it (`date.`, `address_list[`, `any(`, `and `)
// goes straight on to listing what comes next. Tab inside GOQL never moves
// focus, even with nothing to complete (Shift+Tab still does).
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Combobox, Group, ScrollArea, Text, useCombobox, type ComboboxStore } from "@mantine/core";
import { commonPrefix, completeGoql, type Completion } from "../../store/goqlCompletion";
import { t } from "../../i18n/i18n";

/** Where a GOQL expression sits inside a field's text. */
export interface GoqlSpot {
  /** GOQL type the expression is written against ("Person", ...). */
  namespace: string;
  /** The expression's text, the same length as value.slice(offset, offset
   * + source.length): anything not GOQL (a Custom Rule's `{minAge}`, an
   * f-string's `{surname}`) is masked to an equally long value. */
  source: string;
  /** Where `source` starts in the field's text. */
  offset: number;
  /** The quote character that would end the expression's enclosing
   * string (a Gramplet's Python string), so a suggested string quote uses
   * the other one. */
  enclosingQuote?: string;
}

/** Locate the GOQL expression containing `cursor` in `value`, or null when
 * the cursor isn't in one (Tab then keeps its usual meaning). */
export type GoqlLocator = (value: string, cursor: number) => GoqlSpot | null;

/** zIndex for every completion dropdown. Mantine's default (300) is below
 * the app's nested dialogs (zIndex 1000, with their own pickers at 1001),
 * so the list opened behind the field being typed in. Completions are
 * short-lived and belong to the focused field, so they sit above all of it. */
export const COMPLETION_Z_INDEX = 2000;

type TextField = HTMLInputElement | HTMLTextAreaElement;

export interface GoqlCompletion {
  combobox: ComboboxStore;
  completions: Completion[];
  /** Call first from the field's onKeyDown; true when it handled the key
   * (and called preventDefault), so the caller should do nothing more. */
  handleKeyDown: (e: KeyboardEvent<Element>) => boolean;
  /** Call from the field's onChange, after updating the value. */
  handleChange: (value: string, cursor: number) => void;
  /** Pass to <Combobox onOptionSubmit>. */
  accept: (name: string) => void;
  close: () => void;
}

/** No field so far supplies Env values, so Env is never suggested. */
const NO_ENV: string[] = [];

export function useGoqlCompletion({
  value,
  setValue,
  fieldRef,
  locate,
}: {
  value: string;
  setValue: (value: string) => void;
  fieldRef: RefObject<TextField | null>;
  locate: GoqlLocator;
}): GoqlCompletion {
  const combobox = useCombobox();
  const [completions, setCompletions] = useState<Completion[]>([]);
  // Where to put the cursor once an inserted completion has rendered.
  const pendingCursor = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingCursor.current === null || !fieldRef.current) return;
    fieldRef.current.setSelectionRange(pendingCursor.current, pendingCursor.current);
    pendingCursor.current = null;
  }, [value, fieldRef]);
  useEffect(() => {
    if (combobox.dropdownOpened) combobox.selectFirstOption();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completions]);
  // Lets a Modal around the field see Escape is the list's, not its own
  // (Mantine's own Combobox.Target sets this too, but a field whose list
  // is anchored elsewhere -- the Gramplet code editor -- isn't the target).
  // Removed again only if this added it -- a field may set it permanently.
  useEffect(() => {
    const field = fieldRef.current;
    if (!field || !combobox.dropdownOpened || field.hasAttribute("data-mantine-stop-propagation")) return;
    field.setAttribute("data-mantine-stop-propagation", "true");
    return () => field.removeAttribute("data-mantine-stop-propagation");
  }, [combobox.dropdownOpened, fieldRef]);

  function cursorOf(): number {
    return fieldRef.current?.selectionStart ?? value.length;
  }

  /** Completions at `cursor` in `text`, in `text`'s own coordinates. */
  function suggest(text: string, cursor: number): Completion[] | null {
    const spot = locate(text, cursor);
    if (!spot) return null;
    return completeGoql(spot.namespace, spot.source, cursor - spot.offset, NO_ENV).map((c) => ({
      ...c,
      // A quote inside a Python "..." string would end it; use '...' there.
      name: c.name === spot.enclosingQuote ? (c.name === '"' ? "'" : '"') : c.name,
      start: c.start + spot.offset,
    }));
  }

  function close() {
    combobox.closeDropdown();
    setCompletions([]);
  }

  function show(results: Completion[]) {
    setCompletions(results);
    if (results.length > 0) combobox.openDropdown();
    else combobox.closeDropdown();
  }

  /** Replace value[start, cursor) with `text` and put the cursor after it. */
  function insertAt(start: number, cursor: number, text: string): { value: string; cursor: number } {
    const next = value.slice(0, start) + text + value.slice(cursor);
    const after = start + text.length;
    if (next === value) {
      // Nothing to insert (the word was already complete): no re-render
      // will come to consume a pendingCursor, so a queued one would sit
      // there and yank the cursor back on the *next* keystroke instead.
      fieldRef.current?.setSelectionRange(after, after);
      return { value: next, cursor: after };
    }
    pendingCursor.current = after;
    setValue(next);
    return { value: next, cursor: after };
  }

  function insertCompletion(start: number, cursor: number, name: string) {
    const inserted = insertAt(start, cursor, name);
    // An opening quote goes on too: a type's names come inside it
    // (`type == "` -> Census, ...); any other string offers nothing.
    if (/[.[( ]$/.test(name) || name === '"' || name === "'") show(suggest(inserted.value, inserted.cursor) ?? []);
    else close();
  }

  function accept(name: string) {
    const chosen = completions.find((c) => c.name === name);
    if (chosen) insertCompletion(chosen.start, cursorOf(), name);
    else close();
  }

  /** Returns false when the cursor isn't in GOQL at all. */
  function tabComplete(): boolean {
    const cursor = cursorOf();
    const results = suggest(value, cursor);
    if (results === null) return false;
    if (results.length === 1) {
      insertCompletion(results[0].start, cursor, results[0].name);
    } else if (results.length > 1) {
      const shared = commonPrefix(results.map((r) => r.name));
      const start = results[0].start;
      const inserted = shared.length > cursor - start ? insertAt(start, cursor, shared) : { value, cursor };
      show(suggest(inserted.value, inserted.cursor) ?? []);
    }
    return true;
  }

  function handleKeyDown(e: KeyboardEvent<Element>): boolean {
    if (e.nativeEvent.isComposing) return false;
    if (combobox.dropdownOpened) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (e.key === "ArrowDown") combobox.selectNextOption();
        else combobox.selectPreviousOption();
        return true;
      }
      if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
        e.preventDefault();
        combobox.clickSelectedOption();
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
        return true;
      }
    }
    if (e.key === "Tab" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      if (tabComplete()) {
        e.preventDefault();
        return true;
      }
    }
    return false;
  }

  function handleChange(next: string, cursor: number) {
    pendingCursor.current = null;
    if (combobox.dropdownOpened) show(suggest(next, cursor) ?? []);
  }

  return { combobox, completions, handleKeyDown, handleChange, accept, close };
}

function completionKindLabel(kind: Completion["kind"]): string {
  switch (kind) {
    case "column": return t("column");
    case "keyword": return t("keyword");
    case "function": return t("function");
    case "operator": return t("operator");
    case "constant_class": return t("constants");
    case "env": return t("value");
    case "variable": return t("variable");
    default: return "";
  }
}

// The dimmed hint beside each suggestion: where a relationship leads
// (`→ Event`), what a collection holds (`[Event]`), a field's JSON type
// (left as the code word, like the names themselves), else what kind of
// word it is.
function completionDetail(c: Completion): string {
  if (c.kind === "relationship") return `→ ${t(String(c.detail))}`;
  if (c.kind === "collection") return c.detail ? `[${t(String(c.detail))}]` : "[…]";
  if (c.kind === "punctuation") return c.detail === "list" ? t("list") : t("text");
  if (c.kind === "index") return t("first item");
  if (c.kind === "type_name") return String(c.detail);
  if (c.kind === "field") return Array.isArray(c.detail) ? c.detail.join(" | ") : (c.detail ?? "");
  return completionKindLabel(c.kind);
}

/** The suggestion list, for inside a <Combobox store={combobox}>. */
export function GoqlCompletionDropdown({ completions }: { completions: Completion[] }) {
  return (
    <Combobox.Dropdown>
      <Combobox.Options>
        <ScrollArea.Autosize mah={260} type="scroll">
          {completions.map((c) => (
            <Combobox.Option value={c.name} key={c.name}>
              <Group justify="space-between" wrap="nowrap" gap="sm">
                <Text size="sm" ff="monospace">{c.name}</Text>
                <Text size="xs" c="dimmed" ff="monospace">{completionDetail(c)}</Text>
              </Group>
            </Combobox.Option>
          ))}
        </ScrollArea.Autosize>
      </Combobox.Options>
    </Combobox.Dropdown>
  );
}
