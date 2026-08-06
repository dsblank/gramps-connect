// See .env.example. Unset (e.g. a same-origin deployment like the
// standalone build, where app/'s own server also serves the API) falls
// back to "" -- a relative `${API_BASE}/api/...` then resolves against
// the current page's own origin, which is exactly the desired behavior.
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? "";
