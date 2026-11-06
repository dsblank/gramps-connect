// The note editor's ProseMirror schema: exactly the formatting a Gramps
// StyledText can hold (see store/styledText.ts, which converts between
// the two), and nothing it can't -- no headings, lists, quotes or code
// blocks, since a Gramps note has nowhere to store them. Mark and node
// names match the ones styledText.ts produces.
import { Mark, Node, markInputRule, markPasteRule, mergeAttributes, type Extensions } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Italic, { underscoreInputRegex, underscorePasteRegex } from "@tiptap/extension-italic";
import Link from "@tiptap/extension-link";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { Placeholder } from "@tiptap/extensions";
import { UNKNOWN_TAG_MARK, cssColor, cssFontSize, mediaLink } from "../../store/styledText";
import { InlineMediaImage } from "./InlineMediaImage";

/** gramps-web's highlight color, so a highlight from either app looks the
 * same in both. */
export const HIGHLIGHT_COLOR = "#FFFF00";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    grampsImage: {
      insertGrampsImage: (handle: string) => ReturnType;
    };
  }
}

/** A Gramps tag with a value (font color, highlight, font face, font
 * size), the value kept exactly as stored. Only parses back its own
 * data-* attribute, so pasting from a web page brings no colors along. */
function valueMark(name: string, style: (value: unknown) => string | undefined) {
  return Mark.create({
    name,
    addAttributes() {
      return {
        value: {
          default: null,
          parseHTML: (el) => {
            const raw = el.getAttribute(`data-gramps-${name}`);
            try {
              return raw == null ? null : JSON.parse(raw);
            } catch {
              return raw;
            }
          },
          renderHTML: (attrs) => {
            const css = style(attrs.value);
            return { [`data-gramps-${name}`]: JSON.stringify(attrs.value), ...(css ? { style: css } : {}) };
          },
        },
      };
    },
    parseHTML() {
      return [{ tag: `span[data-gramps-${name}]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["span", HTMLAttributes, 0];
    },
  });
}

const FontColor = valueMark("fontcolor", (v) => {
  const c = cssColor(v);
  return c ? `color: ${c}` : undefined;
});
const Highlight = valueMark("highlight", (v) => {
  const c = cssColor(v);
  return c ? `background-color: ${c}; color: inherit` : undefined;
}).extend({
  addInputRules() {
    return [markInputRule({
      find: /(?:^|\s)(==(?!\s+==)((?:[^=]+))==(?!\s+==))$/,
      type: this.type,
      getAttributes: () => ({ value: HIGHLIGHT_COLOR }),
    })];
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-h": () => this.editor.isActive("highlight")
        ? this.editor.commands.unsetMark("highlight")
        : this.editor.commands.setMark("highlight", { value: HIGHLIGHT_COLOR }),
    };
  },
});
const FontFace = valueMark("fontface", (v) => (typeof v === "string" && v ? `font-family: ${JSON.stringify(v)}` : undefined));
const FontSize = valueMark("fontsize", (v) => {
  const s = cssFontSize(v);
  return s ? `font-size: ${s}` : undefined;
});

/** A tag type this app doesn't know: kept, moved with its text, not shown. */
const UnknownTag = Mark.create({
  name: UNKNOWN_TAG_MARK,
  excludes: "",
  addAttributes() {
    return { name: { default: "" }, value: { default: null } };
  },
  renderHTML() {
    return ["span", {}, 0];
  },
});

function GrampsImageView({ node, selected }: ReactNodeViewProps) {
  return (
    <NodeViewWrapper as="span" style={{ display: "inline-block", maxWidth: "100%" }} data-drag-handle>
      <InlineMediaImage handle={String(node.attrs.handle)} maxHeight={300} selected={selected} />
    </NodeViewWrapper>
  );
}

/** An inline image: one U+FFFC under a gramps://Media link when stored. */
const GrampsImage = Node.create({
  name: "grampsImage",
  group: "inline",
  inline: true,
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      handle: { default: "" },
      link: { default: null },
    };
  },
  parseHTML() {
    return [{
      tag: "span[data-gramps-image]",
      getAttrs: (el) => ({ handle: (el as HTMLElement).getAttribute("data-gramps-image") ?? "" }),
    }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-gramps-image": node.attrs.handle }), "￼"];
  },
  addNodeView() {
    return ReactNodeViewRenderer(GrampsImageView);
  },
  addCommands() {
    return {
      insertGrampsImage: (handle) => ({ commands }) =>
        commands.insertContent({ type: this.name, attrs: { handle, link: mediaLink(handle) } }),
    };
  },
});

export function noteExtensions(options: { placeholder?: string } = {}): Extensions {
  return [
    ...(options.placeholder ? [Placeholder.configure({ placeholder: options.placeholder })] : []),
    StarterKit.configure({
      heading: false,
      blockquote: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      codeBlock: false,
      code: false,
      horizontalRule: false,
      // Replaced below: `*1850 … *1852` (born-in marks) must stay literal.
      italic: false,
      link: false,
      trailingNode: false,
    }),
    Italic.extend({
      addInputRules() {
        return [markInputRule({ find: underscoreInputRegex, type: this.type })];
      },
      addPasteRules() {
        return [markPasteRule({ find: underscorePasteRegex, type: this.type })];
      },
    }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      defaultProtocol: "https",
      protocols: ["gramps"],
      isAllowedUri: (url, ctx) => url.startsWith("gramps://") || ctx.defaultValidate(url),
      HTMLAttributes: { target: null, rel: null },
    }),
    Subscript,
    Superscript,
    FontColor,
    Highlight,
    FontFace,
    FontSize,
    UnknownTag,
    GrampsImage,
  ];
}
