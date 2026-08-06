import { Anchor } from "@mantine/core";
import type { OnNavigate } from "./types";

interface StyledTextTag {
  name: string;
  ranges: [number, number][];
  value: string;
}

interface StyledText {
  string: string;
  tags?: StyledTextTag[];
}

interface LinkSpan {
  start: number;
  end: number;
  value: string;
}

/** Note.text's `tags` array carries every formatting span (bold, italic,
 * highlight, ...) -- only StyledTextTagType.LINK ("link", see gramps/gen/
 * lib/styledtexttagtype.py) is a real navigable reference, so that's the
 * only one rendered specially here; everything else in a note's markup
 * (bold/italic/font color/...) is deliberately still plain text, same
 * simplification the note view already had before this. A link's `value`
 * is either `gramps://<ObjectClass>/handle/<handle>` (an in-app
 * reference -- Person, Family, Event, Place, Repository, Source,
 * Citation, Media, Note, per gramps' own styledtexteditor.py) or a plain
 * external URL; gramps' own note editor tells the two apart the same way,
 * by checking the "gramps://" prefix. */
function linkSpansFrom(tags: StyledTextTag[] | undefined): LinkSpan[] {
  const spans: LinkSpan[] = [];
  for (const tag of tags ?? []) {
    if (tag.name !== "link") continue;
    for (const [start, end] of tag.ranges) {
      spans.push({ start, end, value: tag.value });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

function GrampsLink({ value, onNavigate, children }: { value: string; onNavigate: OnNavigate; children: string }) {
  const match = /^gramps:\/\/([A-Za-z]+)\/handle\/(.+)$/.exec(value);
  if (match) {
    const [, objectClass, handle] = match;
    return (
      <Anchor
        component="button"
        type="button"
        underline="hover"
        style={{ display: "inline" }}
        onClick={(e) => {
          e.stopPropagation();
          onNavigate(objectClass.toLowerCase(), handle);
        }}
      >
        {children}
      </Anchor>
    );
  }
  // A plain external URL under the same "link" tag type -- opens in a new
  // tab rather than through onNavigate, same treatment UrlsSection gives
  // every other external link in this app.
  return (
    <Anchor href={value} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
      {children}
    </Anchor>
  );
}

/** A note's full text with its embedded gramps://.../handle/... links
 * (person/event/place/... references, or plain external URLs) rendered as
 * real clickable spans instead of plain characters -- everything else in
 * `whiteSpace: pre-wrap` plain text, matching how the rest of the note
 * already rendered. */
export function NoteText({ text, onNavigate }: { text: StyledText; onNavigate: OnNavigate }) {
  const spans = linkSpansFrom(text.tags);
  if (spans.length === 0) {
    return <span style={{ whiteSpace: "pre-wrap" }}>{text.string}</span>;
  }

  const pieces: (string | { link: LinkSpan })[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) continue; // overlapping link tags -- keep the earlier one, skip the rest
    if (span.start > cursor) pieces.push(text.string.slice(cursor, span.start));
    pieces.push({ link: span });
    cursor = span.end;
  }
  if (cursor < text.string.length) pieces.push(text.string.slice(cursor));

  return (
    <span style={{ whiteSpace: "pre-wrap" }}>
      {pieces.map((piece, i) =>
        typeof piece === "string" ? (
          <span key={i}>{piece}</span>
        ) : (
          <GrampsLink key={i} value={piece.link.value} onNavigate={onNavigate}>
            {text.string.slice(piece.link.start, piece.link.end)}
          </GrampsLink>
        )
      )}
    </span>
  );
}
