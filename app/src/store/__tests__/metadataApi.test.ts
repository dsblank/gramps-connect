import { describe, expect, it } from "vitest";
import { deprecationWarnings, systemInfoLines, type Metadata } from "../metadataApi";

/** A /api/metadata/ response from a server new enough to report every
 * field systemInfoLines looks at. */
const FULL: Metadata = {
  gramps: { version: "6.0.8" },
  gramps_webapi: { version: "3.19.0" },
  gramps_object_query_language: { version: "0.3.4" },
  locale: { lang: "en" },
  server: { multi_tree: false, task_queue: true },
};

describe("systemInfoLines", () => {
  it("reports the versions, the locale and the task queue", () => {
    expect(systemInfoLines(FULL, "0.1.0")).toEqual([
      "Gramps 6.0.8",
      "Gramps Web API 3.19.0",
      "Gramps Connect 0.1.0",
      "Gramps Object Query Language 0.3.4",
      "locale: en",
      "task queue: true",
    ]);
  });

  it("leaves out what this client can't be affected by", () => {
    // All of these are reported by the server and all deliberately not
    // shown -- an extra field must never grow a line of its own just
    // because it arrived. The two QL packages are the subtle ones: neither
    // is the gramps-object-query-language the /query/ endpoints use, so
    // neither belongs in a bug report about this app.
    const lines = systemInfoLines(
      {
        ...FULL,
        gramps_ql: { version: "0.4.0" },
        object_ql: { version: "0.1.3" },
        search: { sifts: { version: "1.3.1" } },
        server: { multi_tree: true, task_queue: true, ocr: true, chat: false, face_detection: true },
      } as Metadata,
      "0.1.0"
    );
    expect(lines.some((line) => /sifts|OCR|chat|multi-tree|face/i.test(line))).toBe(false);
    // Gramps Object Query Language is the only query-language line: neither
    // Gramps QL (0.4.0) nor object_ql (0.1.3) appears.
    expect(lines.filter((line) => /QL|Query Language|0\.4\.0|0\.1\.3/.test(line))).toEqual([
      "Gramps Object Query Language 0.3.4",
    ]);
  });

  it("omits versions the server didn't report", () => {
    const lines = systemInfoLines({ ...FULL, gramps_object_query_language: undefined }, "0.1.0");
    expect(lines.some((line) => line.startsWith("Gramps Object Query Language"))).toBe(false);
    // A neighbour's absence leaves the rest untouched.
    expect(lines).toContain("Gramps Web API 3.19.0");
  });

  it("keeps a false task queue but drops one the server didn't send", () => {
    // "no queue configured" and "too old to say" are different answers --
    // printing the second as `task queue: false` would be a lie in a bug
    // report.
    expect(systemInfoLines({ ...FULL, server: { task_queue: false } }, "0.1.0")).toContain(
      "task queue: false"
    );
    expect(systemInfoLines({ ...FULL, server: {} }, "0.1.0").some((l) => l.startsWith("task queue"))).toBe(
      false
    );
  });

  it("survives a response with nothing in it", () => {
    expect(systemInfoLines({}, "0.1.0")).toEqual(["Gramps Connect 0.1.0"]);
  });

  it("reports email and thumbnail support, only when the server says", () => {
    const lines = systemInfoLines(
      {
        ...FULL,
        server: {
          task_queue: false,
          email: false,
          thumbnails: { pdf: true, video: false },
          max_thumbnail_file_bytes: 52428800,
        },
      },
      "0.1.0"
    );
    expect(lines.slice(-5)).toEqual([
      "task queue: false",
      "email: false",
      "PDF thumbnails: true",
      "video thumbnails: false",
      "max thumbnail file size: 50 MB",
    ]);
    // a pre-3.22 server sends none of them: no line claims otherwise
    expect(systemInfoLines(FULL, "0.1.0").some((l) => /email|thumbnail/.test(l))).toBe(false);
  });

  it("lists deprecated settings last, one line each", () => {
    const metadata: Metadata = {
      ...FULL,
      deprecations: [
        { option: "TREE", replacement: "GRAMPSWEB_TREE", message: "Use `GRAMPSWEB_TREE`.", removed_in: "4.0.0" },
        { option: "SEARCH_INDEX_DIR", replacement: "SEARCH_INDEX_DB_URI" },
      ],
    };
    expect(systemInfoLines(metadata, "0.1.0").slice(-2)).toEqual([
      "deprecated setting: TREE -> GRAMPSWEB_TREE",
      "deprecated setting: SEARCH_INDEX_DIR -> SEARCH_INDEX_DB_URI",
    ]);
    expect(deprecationWarnings(metadata).map((d) => d.option)).toEqual(["TREE", "SEARCH_INDEX_DIR"]);
  });

  it("has no warnings when the server sends none, or doesn't show them to this user", () => {
    expect(deprecationWarnings({ ...FULL, deprecations: [] })).toEqual([]);
    expect(deprecationWarnings(FULL)).toEqual([]);
  });
});
