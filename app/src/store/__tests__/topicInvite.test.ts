import { describe, expect, it } from "vitest";
import { classifyRemoteNoteChange } from "../topicInvite";

function topicNote(spec: unknown, textAsWrapper = true): Record<string, unknown> {
  const raw = JSON.stringify(spec);
  return { type: "topic", text: textAsWrapper ? { string: raw } : raw };
}

describe("classifyRemoteNoteChange", () => {
  it("is generic for a non-topic note, even if its text happens to mention the user", () => {
    const note = { type: "story", text: { string: JSON.stringify({ title: "x", participants: ["alice"] }) } };

    expect(classifyRemoteNoteChange(note, "alice", false)).toEqual({ kind: "generic" });
  });

  it("is generic for a topic-message note (only the topic note itself carries participants)", () => {
    const note = { type: "topic-message", text: { string: "N1\nalice: hi" } };

    expect(classifyRemoteNoteChange(note, "alice", false)).toEqual({ kind: "generic" });
  });

  it("is an invite when the signed-in user is newly on the topic's participants list", () => {
    const note = topicNote({ title: "Smith family origins", participants: ["alice", "bob"] });

    expect(classifyRemoteNoteChange(note, "alice", false)).toEqual({
      kind: "invite",
      title: "Smith family origins",
    });
  });

  it("handles the unwrapped-string text shape the same as the {string} wrapper", () => {
    const note = topicNote({ title: "Smith family origins", participants: ["alice"] }, false);

    expect(classifyRemoteNoteChange(note, "alice", false)).toEqual({
      kind: "invite",
      title: "Smith family origins",
    });
  });

  it("is generic when the signed-in user isn't on the participants list", () => {
    const note = topicNote({ title: "Smith family origins", participants: ["bob"] });

    expect(classifyRemoteNoteChange(note, "alice", false)).toEqual({ kind: "generic" });
  });

  it("is generic for a topic with no participants at all", () => {
    const note = topicNote({ title: "Smith family origins" });

    expect(classifyRemoteNoteChange(note, "alice", false)).toEqual({ kind: "generic" });
  });

  it("is generic when there's no signed-in username to match against", () => {
    const note = topicNote({ title: "Smith family origins", participants: ["alice"] });

    expect(classifyRemoteNoteChange(note, null, false)).toEqual({ kind: "generic" });
  });

  it("is generic when already notified for this handle, even though the user is still a participant", () => {
    const note = topicNote({ title: "Smith family origins", participants: ["alice"] });

    expect(classifyRemoteNoteChange(note, "alice", true)).toEqual({ kind: "generic" });
  });
});
