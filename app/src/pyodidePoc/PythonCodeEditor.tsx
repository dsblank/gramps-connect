// A small, dependency-light code field for editing a Gramplet's `code` --
// react-simple-code-editor is just a textarea/pre overlay (no language
// server, no line numbers), paired with Prism's Python grammar for
// tokenizing. Colors come from PythonCodeEditor.module.css rather than one
// of Prism's own bundled themes: those aren't theme-aware (light-on-dark
// or dark-on-light, not both), and this app already has a `light-dark()`
// convention (see DataTable.module.css) worth matching instead of adding
// a second, clashing color system.
import { useEffect, useRef, useState } from "react";
import { Combobox } from "@mantine/core";
import Editor from "react-simple-code-editor";
import Prism from "prismjs";
import "prismjs/components/prism-python";
import classes from "./PythonCodeEditor.module.css";
import { GoqlCompletionDropdown, useGoqlCompletion, type GoqlLocator } from "../components/goqlCompletion/useGoqlCompletion";
import getCaretCoordinates from "textarea-caret";
import { goqlStringInPython, maskTemplateFields } from "../store/goqlLocate";

function highlight(code: string): string {
  return Prism.highlight(code, Prism.languages.python, "python");
}

// Tab completion inside the GOQL strings a Gramplet passes to people(),
// filter("Person", ...) and the like; Tab anywhere else still indents.
const locateGoqlString: GoqlLocator = (value, cursor) => {
  const found = goqlStringInPython(value, cursor);
  if (!found) return null;
  return {
    namespace: found.namespace,
    source: maskTemplateFields(value.slice(found.start, found.end)),
    offset: found.start,
    enclosingQuote: found.quote,
  };
};

export function PythonCodeEditor({
  value,
  onChange,
  minHeight = 200,
  readOnly = false,
}: {
  value: string;
  onChange: (value: string) => void;
  minHeight?: number;
  /** For a code *preview* (GrampletStorePanel.tsx's per-entry detail, shown
   * before install/update) rather than an editable field -- still
   * highlighted the same as an editable one, just not typeable into.
   * `onChange` is still required even here (react-simple-code-editor's own
   * `onValueChange` prop isn't optional), simplest as a no-op from the
   * caller rather than this component special-casing it away. */
  readOnly?: boolean;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  // react-simple-code-editor doesn't hand out its textarea; found once
  // mounted.
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    fieldRef.current = contentRef.current?.querySelector("textarea") ?? null;
  }, []);
  const completion = useGoqlCompletion({ value, setValue: onChange, fieldRef, locate: locateGoqlString });
  // The list opens at the cursor, not under the whole (tall) editor --
  // textarea-caret measures where the cursor is drawn, relative to the
  // textarea (which never scrolls itself here: the wrapper does).
  const [caret, setCaret] = useState({ top: 0, left: 0, height: 0 });
  useEffect(() => {
    const field = fieldRef.current;
    if (!completion.combobox.dropdownOpened || !field) return;
    setCaret(getCaretCoordinates(field, field.selectionStart ?? value.length));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completion.combobox.dropdownOpened, completion.completions]);

  return (
    <div className={classes.wrapper} style={{ minHeight }}>
      <div ref={contentRef} style={{ position: "relative" }}>
        <Editor
          value={value}
          onValueChange={(next) => {
            onChange(next);
            completion.handleChange(next, fieldRef.current?.selectionStart ?? next.length);
          }}
          // Called before the editor's own Tab-indent; a handled key (Tab
          // in a GOQL string) is preventDefault-ed, which skips it.
          onKeyDown={(e) => {
            if (!readOnly) completion.handleKeyDown(e);
          }}
          onBlur={completion.close}
          highlight={highlight}
          tabSize={4}
          insertSpaces
          padding={10}
          readOnly={readOnly}
          textareaClassName={classes.textarea}
          preClassName={classes.pre}
          style={{
            fontFamily: "var(--mantine-font-family-monospace, ui-monospace, monospace)",
            fontSize: 13,
            minHeight,
          }}
        />
        <Combobox
          store={completion.combobox}
          onOptionSubmit={completion.accept}
          position="bottom-start"
          width={320}
          withinPortal
        >
          <Combobox.Target withKeyboardNavigation={false} withAriaAttributes={false}>
            <span
              aria-hidden
              style={{ position: "absolute", top: caret.top, left: caret.left, height: caret.height, width: 1, pointerEvents: "none" }}
            />
          </Combobox.Target>
          <GoqlCompletionDropdown completions={completion.completions} />
        </Combobox>
      </div>
    </div>
  );
}
