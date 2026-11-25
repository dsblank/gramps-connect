// A cheap, non-cryptographic checksum (32-bit FNV-1a, hex-encoded) --
// plenty to detect "this changed since it was copied", the only thing it's
// used for: an installed Gramplet's code (pyodidePoc/grampletStore.ts) and
// an edited built-in saved filter's original (builtinSavedFilters.ts). Not
// a security boundary.
export function hashCode(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
