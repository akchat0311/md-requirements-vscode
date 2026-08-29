import { describe, it, expect } from "vitest";
import { applyEol, applyTextEdit, minimalDiff, toLf } from "../src/textSync";

describe("toLf / applyEol", () => {
  it("normalizes CRLF and bare CR to LF", () => {
    expect(toLf("a\r\nb\rc\n")).toBe("a\nb\nc\n");
  });

  it("round-trips CRLF documents", () => {
    const crlf = "line one\r\nline two\r\n";
    expect(applyEol(toLf(crlf), "\r\n")).toBe(crlf);
  });

  it("leaves LF documents untouched", () => {
    const lf = "line one\nline two\n";
    expect(applyEol(toLf(lf), "\n")).toBe(lf);
  });
});

describe("minimalDiff", () => {
  const cases: Array<[string, string, string]> = [
    ["insertion in middle", "hello world\n", "hello brave world\n"],
    ["deletion in middle", "hello brave world\n", "hello world\n"],
    ["replacement", "the cat sat\n", "the dog sat\n"],
    ["append at end", "abc\n", "abc\ndef\n"],
    ["prepend at start", "abc\n", "intro\nabc\n"],
    ["repeated content edit", "aaa aaa aaa\n", "aaa aab aaa\n"],
    ["empty to content", "", "content\n"],
    ["content to empty", "content\n", ""],
    ["crlf content", "a\r\nb\r\n", "a\r\nx\r\nb\r\n"],
  ];

  it.each(cases)("%s: applying the diff reproduces the new text", (_name, oldT, newT) => {
    const edit = minimalDiff(oldT, newT);
    expect(edit).not.toBeNull();
    expect(applyTextEdit(oldT, edit!)).toBe(newT);
  });

  it("returns null for identical texts", () => {
    expect(minimalDiff("same\n", "same\n")).toBeNull();
  });

  it("produces a minimal range for a single-word edit in a large document", () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line number ${i}`).join("\n");
    const edited = lines.replace("line number 250", "line number 250 EDITED");
    const edit = minimalDiff(lines, edited)!;
    // The replaced window must stay within the edited line's neighborhood,
    // never ballooning to a whole-document replace.
    expect(edit.endOld - edit.start).toBeLessThan(40);
    expect(applyTextEdit(lines, edit)).toBe(edited);
  });

  it("handles overlapping prefix/suffix without double-counting", () => {
    // "aa" -> "aaa": naive prefix (2) + suffix (2) would overlap.
    const edit = minimalDiff("aa", "aaa")!;
    expect(applyTextEdit("aa", edit)).toBe("aaa");
  });
});
