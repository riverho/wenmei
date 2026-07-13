import { describe, expect, it } from "vitest";
import { TerminalLinkTransform } from "./terminal-links";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("TerminalLinkTransform", () => {
  it("renders OSC 8 links bold without xterm's underline metadata", () => {
    const transform = new TerminalLinkTransform();
    const input = encoder.encode(
      "\u001b]8;;https://example.com\u001b\\https://example.com\u001b]8;;\u001b\\"
    );

    expect(decoder.decode(transform.transform(input))).toBe(
      "\u001b[1;24mhttps://example.com\u001b[22;24m"
    );
  });

  it("keeps an OSC 8 sequence intact when PTY chunks split it", () => {
    const transform = new TerminalLinkTransform();
    const first = encoder.encode("\u001b]8;;https://example.com\u001b");
    const second = encoder.encode("\\https://example.com\u001b]8;;\u001b\\");

    expect(decoder.decode(transform.transform(first))).toBe("");
    expect(decoder.decode(transform.transform(second))).toBe(
      "\u001b[1;24mhttps://example.com\u001b[22;24m"
    );
  });
});
