// Validation for the manifest fields window Gramplets added (`kind`,
// `category` -- see types.ts and GRAMPLETS_PLAN.md), shared by
// grampletMedia.ts's isGramplet() (a tree manifest: skipped if invalid) and
// app/scripts/build-gramplet-catalog.mjs (a Store entry: the build fails).
// Deliberately free of runtime imports -- only `import type`, which
// esbuild drops -- so that Node script can load this file with a bare
// esbuild transform, the same way export-gql-presets.mjs loads
// gqlFilterPresets.ts, keeping one source of truth for both.
import type { GrampletKind } from "./types";

export const GRAMPLET_KINDS: readonly GrampletKind[] = ["view", "window"];

/** The kind a manifest declares, with missing meaning "view" -- every
 * Gramplet saved before `kind` existed is a View Gramplet. */
export function grampletKind(manifest: { kind?: GrampletKind }): GrampletKind {
  return manifest.kind ?? "view";
}

/** Why a manifest's `kind`/`category` fields are invalid, or null if
 * they're fine (including absent). Only these two -- the older fields are
 * checked by each caller as before. */
export function validateGrampletKindFields(manifest: Record<string, unknown>): string | null {
  const { kind, category } = manifest;
  if (kind !== undefined && !GRAMPLET_KINDS.includes(kind as GrampletKind)) {
    return `"kind" must be one of ${GRAMPLET_KINDS.join(", ")}`;
  }
  if (category !== undefined && typeof category !== "string") return `"category" must be a string`;
  return null;
}
