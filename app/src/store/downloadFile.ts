// Shared by every "hand the browser a file to save" flow (RelatedPanel's
// GeneratedItemActions.tsx, jobsPromote.ts's media-archive downloads) --
// factored out rather than duplicated once a second caller needed it.

/** Programmatically clicks a synthetic `<a download>` to trigger a browser
 * save. `fileName` (via the `download` attribute) is only honoured on a
 * same-origin URL -- a blob: object URL qualifies, the API's own host in a
 * deployment where it's a separate origin doesn't (see callers for how each
 * gets a same-origin URL to click). */
export function clickDownloadLink(href: string, fileName?: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.rel = "noopener";
  if (fileName) a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
