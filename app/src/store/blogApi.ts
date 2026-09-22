// Write path for Blog posts -- ported from gramps-web's own blog feature
// (GrampsjsViewNewBlogPost.js's _processedData/_fetchBlogTagHandle/
// _createBlogTag), same shape: a Source (title/author) plus its body as a
// separate Note, both tagged "Blog" (store/views.ts's BLOG_VIEW baseFilter
// matches the same tag), the Note attached via the Source's own note_list.
// One createObjects() batch, same two-object shape storyApi.ts's
// createStoryNote/generateStory uses for its own Note-plus-attach sequence.
import { createHandle, createObjects } from "./objectsApi";
import { getOrCreateTagHandle } from "./jobsApi";
import { getViewStore } from "./registry";

/** Same literal as BLOG_VIEW's own baseFilter in views.ts (`any(t.name ==
 * 'Blog' for t in tags)`) -- kept a plain duplicated string rather than a
 * shared export, same convention GENERATED_VIEW's own "report"/"export" tag
 * names already use (jobsPromote.ts's JobKind, views.ts's baseFilter). */
const BLOG_TAG_NAME = "Blog";

/** Creates a new blog post and requeries the Blog ViewStore so it shows up
 * immediately (same immediate-feedback reasoning as generateStory()'s own
 * requeryDebounced() call), returning the new Source's handle. Gets or
 * creates the "Blog" tag first (jobsApi.ts's getOrCreateTagHandle, the same
 * helper promoteJob() uses for its own report/export tags), so the very
 * first post in a fresh tree still works. `content` is optional -- a
 * title-only post (no Note, no note_list) is a valid Source same as
 * gramps-web's own blank-content case. */
export async function createBlogPost(
  token: string,
  title: string,
  author: string,
  content: string
): Promise<string> {
  const tagHandle = await getOrCreateTagHandle(token, BLOG_TAG_NAME);
  const sourceHandle = createHandle();
  const source: Record<string, unknown> = {
    _class: "Source",
    handle: sourceHandle,
    title,
    author,
    tag_list: [tagHandle],
  };
  const objects: Record<string, unknown>[] = [source];
  if (content.trim()) {
    const noteHandle = createHandle();
    source.note_list = [noteHandle];
    objects.push({
      _class: "Note",
      handle: noteHandle,
      text: { string: content },
      tag_list: [tagHandle],
    });
  }
  await createObjects(token, objects);
  getViewStore("blog").requeryDebounced();
  return sourceHandle;
}
