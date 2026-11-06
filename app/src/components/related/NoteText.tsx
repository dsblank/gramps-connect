import type { CSSProperties, ReactNode } from "react";
import { Anchor } from "@mantine/core";
import type { OnNavigate } from "./types";
import {
  cssColor, cssFontSize, isSafeExternalUrl, parseGrampsLink, styledTextToDoc, type PmMark, type PmNode, type StyledText,
} from "../../store/styledText";
import { InlineMediaImage } from "../notes/InlineMediaImage";

function GrampsLink({ value, onNavigate, children }: { value: string; onNavigate: OnNavigate; children: ReactNode }) {
  const target = parseGrampsLink(value);
  if (target) {
    return (
      <Anchor
        component="button"
        type="button"
        underline="hover"
        style={{ display: "inline", font: "inherit", verticalAlign: "baseline" }}
        onClick={(e) => {
          e.stopPropagation();
          onNavigate(target.objectClass.toLowerCase(), target.handle);
        }}
      >
        {children}
      </Anchor>
    );
  }
  // A plain external URL under the same "link" tag type -- opens in a new
  // tab rather than through onNavigate, same treatment UrlsSection gives
  // every other external link in this app. Anything else (javascript:,
  // an unknown scheme) stays plain text.
  if (!isSafeExternalUrl(value)) return <>{children}</>;
  return (
    <Anchor href={value} target="_blank" rel="noopener noreferrer" style={{ font: "inherit" }} onClick={(e) => e.stopPropagation()}>
      {children}
    </Anchor>
  );
}

function markStyle(mark: PmMark): CSSProperties | null {
  const value = mark.attrs?.value;
  switch (mark.type) {
    case "bold":
      return { fontWeight: 700 };
    case "italic":
      return { fontStyle: "italic" };
    case "underline":
      return { textDecoration: "underline" };
    case "strike":
      return { textDecoration: "line-through" };
    case "fontcolor": {
      const color = cssColor(value);
      return color ? { color } : null;
    }
    case "highlight": {
      const color = cssColor(value);
      // Dark text on the highlight, so a light highlight stays readable
      // in dark mode.
      return color ? { backgroundColor: color, color: "#000" } : null;
    }
    case "fontface":
      return typeof value === "string" && value ? { fontFamily: value } : null;
    case "fontsize": {
      const size = cssFontSize(value);
      return size ? { fontSize: size } : null;
    }
    default:
      return null;
  }
}

function applyMarks(content: ReactNode, marks: PmMark[] | undefined, onNavigate: OnNavigate, key: number): ReactNode {
  let out = content;
  let link: string | null = null;
  const style: CSSProperties = {};
  for (const mark of marks ?? []) {
    if (mark.type === "link") link = String(mark.attrs?.href ?? "");
    else if (mark.type === "superscript") out = <sup>{out}</sup>;
    else if (mark.type === "subscript") out = <sub>{out}</sub>;
    else {
      const s = markStyle(mark);
      if (s) {
        // Underline and strikethrough together.
        if (s.textDecoration && style.textDecoration) s.textDecoration = `${style.textDecoration} ${s.textDecoration}`;
        Object.assign(style, s);
      }
    }
  }
  if (Object.keys(style).length) out = <span style={style}>{out}</span>;
  if (link !== null) out = <GrampsLink value={link} onNavigate={onNavigate}>{out}</GrampsLink>;
  return <span key={key}>{out}</span>;
}

/** A note's full text with its Gramps formatting (bold, italic, colors,
 * highlight, font face/size, super/subscript), gramps://.../handle/...
 * links to records (or plain external URLs) as real clickable links, and
 * inline images -- the same StyledText -> document conversion the editor
 * uses (store/styledText.ts), rendered as plain React rather than a
 * read-only editor, since a list can show many notes at once. Lines stay
 * lines (`white-space: pre-wrap`); a preformatted note (Gramps' note
 * format 1) is shown in a monospace font, as Gramps does. */
export function NoteText({ text, onNavigate, preformatted = false }: {
  text: StyledText;
  onNavigate: OnNavigate;
  preformatted?: boolean;
}) {
  const doc = styledTextToDoc(text);
  const lines: ReactNode[] = [];
  (doc.content ?? []).forEach((para: PmNode, i: number) => {
    if (i > 0) lines.push("\n");
    (para.content ?? []).forEach((node, j) => {
      const key = i * 100000 + j;
      if (node.type === "grampsImage") {
        // Clickable like any other link: it opens the Media record.
        const marks = [...(node.marks ?? []), { type: "link", attrs: { href: String(node.attrs?.link ?? "") } }];
        lines.push(applyMarks(<InlineMediaImage handle={String(node.attrs?.handle ?? "")} />, marks, onNavigate, key));
      } else if (!node.marks?.length) {
        lines.push(<span key={key}>{node.text}</span>);
      } else {
        lines.push(applyMarks(node.text, node.marks, onNavigate, key));
      }
    });
  });
  return (
    <span style={{ whiteSpace: preformatted ? "pre" : "pre-wrap", fontFamily: preformatted ? "monospace" : undefined, overflowX: preformatted ? "auto" : undefined, display: preformatted ? "block" : undefined }}>
      {lines}
    </span>
  );
}
