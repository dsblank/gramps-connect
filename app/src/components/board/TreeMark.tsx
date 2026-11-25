// The Evidence Board's mark for "this changes the tree when you save": a
// small tree drawn in the text colour, put on every button and menu choice
// that stages a loose end, and nowhere else (pinning, moving, taking a card
// off the board never carry it). One glyph instead of a sentence per button.
import { t } from "../../i18n/i18n";
import css from "./board.module.css";

export function TreeMark({ size = 12 }: { size?: number }) {
  return (
    <svg
      className={css.treeMark}
      width={size}
      height={size}
      viewBox="0 0 12 12"
      role="img"
      aria-label={t("Changes the tree when you save")}
    >
      <title>{t("Changes the tree when you save")}</title>
      <circle cx="6" cy="4.6" r="3.9" fill="currentColor" opacity="0.85" />
      <rect x="5.1" y="7" width="1.8" height="4.6" rx="0.5" fill="currentColor" />
    </svg>
  );
}
