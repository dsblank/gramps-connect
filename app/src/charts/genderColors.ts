// Shared by the tree chart and RelationshipChart.tsx, so a person looks the
// same wherever they're drawn.

/** Slots 1 (blue) and 5 (magenta) of the validated categorical palette
 * (dataviz skill's references/palette.md), not slots 1+2 in fixed order --
 * blue/pink for male/female is a domain convention as strong as gramps-web's
 * own genderColor (and this screenshot's own reference), and the pair
 * passes every check `node scripts/validate_palette.js "#2a78d6,#e87ba4"
 * --mode light --pairs all` (and the dark equivalent) other than light
 * mode's contrast floor (magenta 2.62:1, WARN-band) -- relief for that is
 * the gender word folded into each box's <title> tooltip below, since nothing
 * here depends on the accent bar alone to say who's who. Unknown/other
 * (Gramps gender 2/3) get no accent at all, the same call
 * eventCategories.ts makes for its own "Other" category: a chromatic-enough
 * grey collides under CVD sim, and a bar with no identity to encode
 * shouldn't invent a third color to hold that place. */
export const GENDER_FILL: Record<0 | 1, { light: string; dark: string }> = {
  0: { light: "#e87ba4", dark: "#d55181" },
  1: { light: "#2a78d6", dark: "#3987e5" },
};
export const GENDER_LABEL: Record<number, string> = { 0: "female", 1: "male", 2: "unknown gender", 3: "other gender" };

export function genderAccent(gender: number | undefined, dark: boolean): string | null {
  if (gender !== 0 && gender !== 1) return null;
  return GENDER_FILL[gender][dark ? "dark" : "light"];
}
