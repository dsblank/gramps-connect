import { useRef, useState } from "react";
import { Combobox, TextInput } from "@mantine/core";
import { GoqlCompletionDropdown, useGoqlCompletion, COMPLETION_Z_INDEX } from "../goqlCompletion/useGoqlCompletion";
import { t } from "../../i18n/i18n";

/** A one-line Person GOQL box for "Color: Filter → GOQL…" in the charts,
 * with the same Tab completion as the list search box. The chart only
 * re-queries on Enter (or leaving the box), not on every keystroke. */
export function ChartGoqlInput({ applied, onApply, error }: {
  applied: string;
  onApply: (expr: string) => void;
  error: string | null;
}) {
  const [value, setValue] = useState(applied);
  const inputRef = useRef<HTMLInputElement>(null);
  const completion = useGoqlCompletion({
    value,
    setValue,
    fieldRef: inputRef,
    locate: (v) => ({ namespace: "Person", source: v, offset: 0 }),
  });
  const submit = () => {
    const expr = value.trim();
    if (expr !== applied) onApply(expr);
  };
  return (
    <Combobox store={completion.combobox} onOptionSubmit={completion.accept} position="top-start" width={320} withinPortal zIndex={COMPLETION_Z_INDEX}>
      <Combobox.Target withKeyboardNavigation={false}>
        <TextInput
          ref={inputRef}
          size="xs"
          w={260}
          ff="monospace"
          value={value}
          autoComplete="off"
          spellCheck={false}
          placeholder={`e.g. birth.date.sortval < Date('1850') · ${t("<Tab> completes")}`}
          error={error ?? undefined}
          aria-label={t("GOQL")}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setValue(v);
            completion.handleChange(v, e.currentTarget.selectionStart ?? v.length);
          }}
          onBlur={() => {
            completion.close();
            submit();
          }}
          onKeyDown={(e) => {
            if (completion.handleKeyDown(e)) return;
            if (e.key === "Enter") submit();
          }}
        />
      </Combobox.Target>
      <GoqlCompletionDropdown completions={completion.completions} />
    </Combobox>
  );
}
