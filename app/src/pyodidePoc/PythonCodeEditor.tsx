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
}: {
  value: string;
  onChange: (value: string) => void;
  minHeight?: number;
}) {
  return (
    <div className={classes.wrapper} style={{ minHeight }}>
      <Editor
        value={value}
        onValueChange={onChange}
        highlight={highlight}
        padding={10}
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
