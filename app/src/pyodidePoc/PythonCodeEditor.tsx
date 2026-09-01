// A small, dependency-light code field for editing a Gramplet's `code` --
// react-simple-code-editor is just a textarea/pre overlay (no language
// server, no line numbers), paired with Prism's Python grammar for
// tokenizing. Colors come from PythonCodeEditor.module.css rather than one
// of Prism's own bundled themes: those aren't theme-aware (light-on-dark
// or dark-on-light, not both), and this app already has a `light-dark()`
// convention (see DataTable.module.css) worth matching instead of adding
// a second, clashing color system.
import Editor from "react-simple-code-editor";
import Prism from "prismjs";
import "prismjs/components/prism-python";
import classes from "./PythonCodeEditor.module.css";

function highlight(code: string): string {
  return Prism.highlight(code, Prism.languages.python, "python");
}

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
  return (
    <div className={classes.wrapper} style={{ minHeight }}>
      <Editor
        value={value}
        onValueChange={onChange}
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
    </div>
  );
}
