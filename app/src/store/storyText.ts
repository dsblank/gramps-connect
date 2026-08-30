// Seeding prose for story slides -- the sentence a generated StoryPoint
// starts with, so no slide is ever born blank. What's produced here is a
// *seed*: it's written into the spec at build time (storyBuilder.ts) and
// then belongs to the story, so a hand-edit in StoryEditor sticks and is
// never regenerated over. Nothing here is read at presentation time.
//
// Not translated. These are templated sentences, not fixed strings, so
// t() can't reach them the way it reaches a label -- Gramps' own
// narrator.py solves that with one gettext'd sentence per (event type x
// date modifier x place) combination, which is a much bigger commitment
// than this pilot has earned. Until then a non-English tree gets English
// seed text that the author can edit into their own words, rather than an
// empty card.

/** Third-person verb phrase for a one-person event, keyed by the display
 * type string formatEventType() produces (views.ts's EVENT_TYPE_LABELS).
 * A type with no entry here falls back to the noun form in momentText()
 * -- which is also what every *custom* event type gets, since those carry
 * whatever name the tree's author gave them. */
const PERSON_PHRASES: Record<string, string> = {
  Birth: "was born",
  Stillbirth: "was stillborn",
  Baptism: "was baptized",
  Christening: "was christened",
  "Adult Christening": "was christened",
  Blessing: "was blessed",
  Confirmation: "was confirmed",
  "First Communion": "took First Communion",
  "Bar Mitzvah": "celebrated their Bar Mitzvah",
  "Bas Mitzvah": "celebrated their Bas Mitzvah",
  Adopted: "was adopted",
  Graduation: "graduated",
  Degree: "was awarded a degree",
  Emigration: "emigrated",
  Immigration: "immigrated",
  Naturalization: "was naturalized",
  Ordination: "was ordained",
  Elected: "was elected",
  Retirement: "retired",
  Death: "died",
  Burial: "was buried",
  Cremation: "was cremated",
  Probate: "had their estate probated",
};

/** The same, for an event that belongs to a couple rather than a person --
 * a Family's own event_ref_list. Consulted first when a moment has two
 * subjects, so "Marriage" reads "were married" rather than falling to the
 * singular table (which has no entry for it anyway). */
const COUPLE_PHRASES: Record<string, string> = {
  Marriage: "were married",
  "Alternate Marriage": "were married",
  "Marriage Banns": "had their banns read",
  "Marriage Contract": "signed a marriage contract",
  "Marriage License": "took out a marriage license",
  "Marriage Settlement": "agreed a marriage settlement",
  Engagement: "were engaged",
  Divorce: "were divorced",
  "Divorce Filing": "filed for divorce",
  Annulment: "had their marriage annulled",
  Census: "were recorded in the census",
  Residence: "lived",
};

/** Everything a seeded sentence can draw on. `subjects` is who the moment
 * is about: empty (an opening card, or an event with nobody resolved), one
 * person, or a couple -- which is the only thing that decides singular vs.
 * plural phrasing here. */
export interface Moment {
  /** Display event type, e.g. "Birth" (visualData.ts's EventRecord.type). */
  type: string;
  subjects: string[];
  dateText: string;
  /** See EventRecord.datePreposition -- "" means dateText already reads as
   * its own phrase and takes nothing in front of it. */
  datePreposition: "" | "on" | "in";
  placeTitle: string;
  /** The event's own description, if the tree's author wrote one. */
  description: string;
  /** The subject's EventRef.role, when the moment came from one. A role
   * that isn't the subject's *own* (a Witness at someone else's baptism)
   * changes the sentence -- see SUBJECT_ROLES. */
  role?: string;
}

/** Roles that mean "this event is the subject's own", so the sentence can
 * say they were born / were married rather than that they took part.
 * "Primary" is a person's own event; "Family" is the role Gramps gives a
 * couple on their Family's event_ref_list (EventRoleType.FAMILY), which is
 * exactly what a marriage carries. Unknown/Custom/absent are treated the
 * same way rather than as third-party participation, since an unlabelled
 * ref in practice means nobody set one. */
const SUBJECT_ROLES = new Set(["", "Primary", "Family", "Unknown", "Custom"]);

export function isSubjectRole(role: string | undefined): boolean {
  return SUBJECT_ROLES.has(role ?? "");
}

/** "A & B", "A", or "" -- the ampersand form, matching how summary.ts
 * labels a Family. For prose use joinProse() instead. */
export function joinNames(names: string[]): string {
  return names.filter(Boolean).join(" & ");
}

function joinProse(names: string[]): string {
  const present = names.filter(Boolean);
  if (present.length <= 1) return present[0] ?? "";
  return `${present.slice(0, -1).join(", ")} and ${present[present.length - 1]}`;
}

/** Ends `text` with a full stop unless it already ends in some sentence
 * punctuation of its own -- so an author's description that reads "Second
 * son." isn't given a second period, and one that reads "Second son" is. */
function ensureSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** The slide's heading: the event type made specific by whose moment it is
 * ("Birth of Josef Meyer", "Marriage of Hans Meyer & Anna Schmidt"), or
 * the bare type when there's nobody to name. A person story could get away
 * with the bare type -- the subject never changes -- but a family story
 * can't, since half its slides would otherwise all read "Birth". */
export function momentTitle(moment: Moment): string {
  const names = joinNames(moment.subjects);
  const type = moment.type || "Moment";
  // "Baptism of Anna Schmidt" would be a plain lie about an event she only
  // witnessed, so a non-subject role names itself instead of the person.
  if (!isSubjectRole(moment.role)) return `${type} (${moment.role})`;
  return names ? `${type} of ${names}` : type;
}

/** The slide's body: one sentence placing the moment, followed by the
 * event's own description when there is one worth adding. Never empty --
 * with no subject, no date and no place it still falls back to the event
 * type, which is the least a card can say about itself. */
export function momentText(moment: Moment): string {
  const { type, subjects, dateText, datePreposition, placeTitle, description } = moment;
  const phrase = (subjects.length === 2 ? COUPLE_PHRASES[type] : PERSON_PHRASES[type]) ?? "";

  // Verb form when the type is one we have a phrase for, noun form
  // otherwise ("Occupation of Anna Schmidt in 1880 in Berlin.") -- which is
  // also where every custom event type lands.
  let sentence: string;
  if (!isSubjectRole(moment.role) && subjects.length > 0) {
    sentence = `${joinProse(subjects)} took part in this ${type} as ${moment.role}`;
  } else if (phrase && subjects.length > 0) sentence = `${joinProse(subjects)} ${phrase}`;
  else if (subjects.length > 0) sentence = `${type} of ${joinProse(subjects)}`;
  else sentence = type || "";

  if (dateText) sentence += datePreposition ? ` ${datePreposition} ${dateText}` : ` ${dateText}`;
  if (placeTitle) sentence += ` in ${placeTitle}`;
  sentence = ensureSentence(sentence);

  // The author's own words are kept as a second sentence rather than
  // replacing the first: a description is often a detail ("Second son") that
  // reads as a fragment on its own, and just as often GEDCOM-import noise
  // that merely repeats the event type, which is what the guard drops.
  const extra = description.trim();
  if (extra && extra.toLowerCase() !== type.toLowerCase() && !sentence.includes(extra)) {
    return `${sentence} ${ensureSentence(extra)}`.trim();
  }
  return sentence || type;
}

/** Both seeded fields for one moment, since every caller wants the pair. */
export function describeMoment(moment: Moment): { title: string; text: string } {
  return { title: momentTitle(moment), text: momentText(moment) };
}
