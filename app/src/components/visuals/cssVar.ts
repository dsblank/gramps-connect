/** Resolves a Mantine CSS custom property to a concrete colour string.
 *
 * Canvas drawing can't use `var(--mantine-color-text)` -- a 2D context takes
 * literal colour values -- so the visuals resolve the handful of theme tokens
 * they paint with once per render instead of hardcoding a second palette that
 * would then have to be kept in step with theme.ts and with light/dark. Read
 * off the document element, where Mantine defines them, and re-read (not
 * cached) because they change under the user when the colour scheme flips. */
export function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** The tokens both visuals paint with, resolved together.
 *
 * Surfaces and ink only -- deliberately no accent. The colour of a *mark* is
 * not a theme token here but a validated palette slot (see eventCategories.ts),
 * because a mark has separation and contrast floors to clear that a UI accent
 * doesn't: the app's own `--mantine-primary-color-filled` resolves to #0f5aa7
 * in dark mode, 2.25:1 against the dark body, and map markers painted with it
 * were invisible. Keeping it out of this type is what stops that being
 * reached for again. */
export interface VisualColors {
  surface: string;
  text: string;
  muted: string;
  border: string;
}

export function readVisualColors(): VisualColors {
  return {
    surface: cssVar("--mantine-color-body", "#ffffff"),
    text: cssVar("--mantine-color-text", "#000000"),
    muted: cssVar("--mantine-color-dimmed", "#868e96"),
    border: cssVar("--mantine-color-default-border", "#dee2e6"),
  };
}
