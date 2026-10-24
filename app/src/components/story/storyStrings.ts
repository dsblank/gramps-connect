// The story package's words (its editor, map editor and player) in the
// app's language. Where the package has that language (editorLanguage:
// German, Spanish, French, Dutch), its own translations, plus the few
// words only this app's story editor says (APP_WORDS); in any other
// language, the English run through t(), as for the rest of the app.
import {
  EDITOR_ENGLISH, editorLanguage, editorStringsFor, MAP_EDITOR_ENGLISH, mapEditorStringsFor,
  type EditorStrings, type MapEditorStrings,
} from "@gramps-connect/story/editor";
import { stringsFor, type PlayerStrings } from "@gramps-connect/story/player";
import { getI18nSnapshot, t } from "../../i18n/i18n";

/** What only this app's story editor says, by the package's languages. */
const APP_WORDS: Record<string, Record<string, string>> = {
  de: {
    "Add a slide to see the story here.": "Fügen Sie eine Folie hinzu, um die Geschichte hier zu sehen.",
    "Defaults to the event's own type": "Standardmäßig der Typ des Ereignisses",
    "Event": "Ereignis",
    "The language the story is written in, e.g. en, de or fr-CA. Left empty, a download says the app's language.":
      "Die Sprache, in der die Geschichte geschrieben ist, z. B. en, de oder fr-CA. Leer gelassen, gibt ein Download die Sprache der App an.",
    "No photos yet. A slide can show several, one after another.": "Noch keine Fotos. Eine Folie kann mehrere zeigen, eines nach dem anderen.",
    "Not a language code, so it's left out.": "Kein Sprachcode, daher wird er weggelassen.",
    "Not shown: only images appear on a slide.": "Nicht angezeigt: Auf einer Folie erscheinen nur Bilder.",
    "Select existing…": "Vorhandenes auswählen…",
    "Upload photo": "Foto hochladen",
  },
  es: {
    "Add a slide to see the story here.": "Añada una diapositiva para ver aquí la historia.",
    "Defaults to the event's own type": "Por omisión, el tipo del evento",
    "Event": "Evento",
    "The language the story is written in, e.g. en, de or fr-CA. Left empty, a download says the app's language.":
      "El idioma en que está escrita la historia, p. ej. en, de o fr-CA. Si se deja vacío, una descarga indica el idioma de la aplicación.",
    "No photos yet. A slide can show several, one after another.": "Aún no hay fotos. Una diapositiva puede mostrar varias, una tras otra.",
    "Not a language code, so it's left out.": "No es un código de idioma, así que se omite.",
    "Not shown: only images appear on a slide.": "No se muestra: en una diapositiva solo aparecen imágenes.",
    "Select existing…": "Elegir existente…",
    "Upload photo": "Subir foto",
  },
  fr: {
    "Add a slide to see the story here.": "Ajoutez une diapositive pour voir l’histoire ici.",
    "Defaults to the event's own type": "Par défaut, le type de l’événement",
    "Event": "Événement",
    "The language the story is written in, e.g. en, de or fr-CA. Left empty, a download says the app's language.":
      "La langue dans laquelle l’histoire est écrite, p. ex. en, de ou fr-CA. Laissée vide, un téléchargement indique la langue de l’application.",
    "No photos yet. A slide can show several, one after another.": "Pas encore de photos. Une diapositive peut en montrer plusieurs, l’une après l’autre.",
    "Not a language code, so it's left out.": "Ce n’est pas un code de langue, il est donc laissé de côté.",
    "Not shown: only images appear on a slide.": "Non affiché : seules les images apparaissent sur une diapositive.",
    "Select existing…": "Choisir un existant…",
    "Upload photo": "Téléverser une photo",
  },
  nl: {
    "Add a slide to see the story here.": "Voeg een dia toe om het verhaal hier te zien.",
    "Defaults to the event's own type": "Standaard het type van de gebeurtenis",
    "Event": "Gebeurtenis",
    "The language the story is written in, e.g. en, de or fr-CA. Left empty, a download says the app's language.":
      "De taal waarin het verhaal is geschreven, bijv. en, de of fr-CA. Leeg gelaten vermeldt een download de taal van de app.",
    "No photos yet. A slide can show several, one after another.": "Nog geen foto's. Een dia kan er meerdere tonen, de een na de ander.",
    "Not a language code, so it's left out.": "Geen taalcode, dus die wordt weggelaten.",
    "Not shown: only images appear on a slide.": "Niet getoond: op een dia verschijnen alleen afbeeldingen.",
    "Select existing…": "Bestaande kiezen…",
    "Upload photo": "Foto uploaden",
  },
};

/** Each plain string of `english` through t(); its functions as they are. */
function viaT<T extends object>(english: T): T {
  return Object.fromEntries(
    Object.entries(english).map(([key, value]) => [key, typeof value === "string" ? t(value) : value]),
  ) as T;
}

export interface StoryWords {
  editor: EditorStrings;
  mapEditor: MapEditorStrings;
  /** For StoryPlayer's `strings`. */
  player: Partial<PlayerStrings>;
  /** An app-only phrase (APP_WORDS' English). */
  say: (english: string) => string;
}

/** The story package's words in the app's current language. Read on each
 * render, like t(): the app re-renders when the language changes. */
export function storyWords(lang = getI18nSnapshot().lang): StoryWords {
  const packaged = editorLanguage([lang]);
  if (packaged) {
    const words = APP_WORDS[packaged];
    return {
      editor: editorStringsFor(packaged),
      mapEditor: mapEditorStringsFor(packaged),
      player: stringsFor(packaged),
      say: (english) => words?.[english] ?? t(english),
    };
  }
  return {
    editor: viaT(EDITOR_ENGLISH),
    mapEditor: { ...viaT(MAP_EDITOR_ENGLISH), lockedMany: (count) => `${count} ${t("shapes can't be edited here")}` },
    player: { previous: t("Previous"), next: t("Next"), close: t("Close") },
    say: t,
  };
}
