// See .env.example. Unset (e.g. a same-origin deployment like the
// standalone build, where app/'s own server also serves the API) falls
// back to "" -- a relative `${API_BASE}/api/...` then resolves against
// the current page's own origin, which is exactly the desired behavior.
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? "";

/** The Gramps Discourse forum's gramps-connect category, where questions
 * and discussion happen -- linked from Help > Discussion Forum. */
export const DISCUSSION_FORUM_URL = "https://gramps.discourse.group/c/gramps-connect/35";

/** The project's home page (GitHub Pages), linked from the sign-in page. */
export const PROJECT_HOME_URL = "https://dsblank.github.io/gramps-connect/";

/** The Gramps Connect blog, opened by Help > Blog; its Atom feed is what
 * store/blogNews.ts checks daily for new posts. */
export const BLOG_URL = `${PROJECT_HOME_URL}blog/`;
export const BLOG_FEED_URL = `${BLOG_URL}feed.xml`;
