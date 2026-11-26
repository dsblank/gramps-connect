import { describe, expect, it } from "vitest";
import { MEDIA_VIEW } from "../views";

const category = MEDIA_VIEW.columns.find((c) => c.key === "category")!;
const typeOf = (mime: string, item: Record<string, unknown> = {}) => category.toSql!(mime, item);

describe("Media Type column", () => {
  it("names the app's own tagged JSON records instead of calling them Document (#56)", () => {
    expect(typeOf("application/json", { is_custom_rule: 1 })).toBe("Custom Rule");
    expect(typeOf("application/json", { is_saved_filter: 2 })).toBe("Saved Filter");
    expect(typeOf("application/json", { is_list_column: 1 })).toBe("List Column");
    expect(typeOf("application/json", { is_gramplet: 1 })).toBe("Gramplet");
  });

  it("still calls an untagged JSON file a Document", () => {
    expect(typeOf("application/json", { is_custom_rule: 0, is_saved_filter: 0, is_list_column: 0 })).toBe("Document");
  });
});
