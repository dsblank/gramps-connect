// Live translation of the Gramps desktop-app string vocabulary, via gramps-
// web-api's existing POST /api/translations/<lang> endpoint (translations.py
// -- no trailing slash on the route, unlike most gramps-web-api endpoints --
// runs each string through the installed `gramps` package's own gettext
// catalog, gramps_locale.translation.sgettext(s)). No static copy to keep in
// sync: this is exactly the mechanism ../gramps-web uses for its own
// `grampsStrings` corpus (GrampsJs.js's _loadStrings), reused unchanged here.
import { API_BASE } from "../config";
import { getToken } from "../auth/auth";

export async function fetchTranslations(strings: string[], lang: string): Promise<Record<string, string>> {
  const token = await getToken();
  const res = await fetch(`${API_BASE}/api/translations/${lang}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ strings }),
  });
  if (!res.ok) return {};
  const data: { original: string; translation: string }[] = await res.json();
  // sgettext falls back to echoing the original string when it has no
  // translation for it -- drop those rather than let a real miss stomp a
  // genuine static-corpus translation for the same string (see i18n.ts's
  // "desktop wins on collision" merge).
  return Object.fromEntries(
    data.filter(({ original, translation }) => translation !== original).map(({ original, translation }) => [original, translation]),
  );
}

/** Every language this server's installed `gramps` build has a compiled
 * catalog for, each labeled with its own native name -- gramps-web asks the
 * same GET /api/translations/ endpoint for exactly this (see its
 * GrampsjsViewSettingsUser.js's _fetchDataLang(), which renders `native`
 * directly) rather than hardcoding language names client-side. */
export async function fetchLanguages(): Promise<{ language: string; native: string }[]> {
  const token = await getToken();
  const res = await fetch(`${API_BASE}/api/translations/?sort=native`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  return res.json();
}
