import type { Terminal } from "@xterm/xterm";

const ESC = 0x1b;
const BEL = 0x07;
const C1_OSC = 0x9d;
const C1_ST = 0x9c;
const BACKSLASH = 0x5c;

// OSC 8 is xterm's hyperlink protocol. xterm.js hard-codes OSC 8 cells to a
// dashed underline, unlike native terminals such as Ghostty. Strip only the
// OSC 8 control wrappers and replace them with normal terminal attributes;
// the link provider below restores clickability from the visible URL text.
const OSC8_PREFIX_ESC = [ESC, 0x5d, 0x38, 0x3b];
const OSC8_PREFIX_C1 = [C1_OSC, 0x38, 0x3b];
const LINK_OPEN = [ESC, 0x5b, 0x31, 0x3b, 0x32, 0x34, 0x6d];
const LINK_CLOSE = [ESC, 0x5b, 0x32, 0x32, 0x3b, 0x32, 0x34, 0x6d];

interface Osc8Sequence {
  end: number;
  opens: boolean;
}

function matchesAt(data: Uint8Array, offset: number, prefix: number[]) {
  if (offset + prefix.length > data.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (data[offset + i] !== prefix[i]) return false;
  }
  return true;
}

function prefixLengthAt(data: Uint8Array, offset: number) {
  if (matchesAt(data, offset, OSC8_PREFIX_ESC)) return OSC8_PREFIX_ESC.length;
  if (matchesAt(data, offset, OSC8_PREFIX_C1)) return OSC8_PREFIX_C1.length;
  return 0;
}

function findOsc8Start(data: Uint8Array, from: number) {
  for (let i = from; i < data.length; i += 1) {
    if (prefixLengthAt(data, i) > 0) return i;
  }
  return -1;
}

function findPartialPrefixStart(data: Uint8Array) {
  const prefixes = [OSC8_PREFIX_ESC, OSC8_PREFIX_C1];
  for (
    let start = Math.max(0, data.length - 3);
    start < data.length;
    start += 1
  ) {
    for (const prefix of prefixes) {
      const available = data.length - start;
      if (available >= prefix.length) continue;
      let matches = true;
      for (let i = 0; i < available; i += 1) {
        if (data[start + i] !== prefix[i]) {
          matches = false;
          break;
        }
      }
      if (matches) return start;
    }
  }
  return -1;
}

function decodeAscii(data: Uint8Array, start: number, end: number) {
  let value = "";
  for (let i = start; i < end; i += 1) value += String.fromCharCode(data[i]);
  return value;
}

function parseOsc8(data: Uint8Array, start: number): Osc8Sequence | null {
  const prefixLength = prefixLengthAt(data, start);
  if (prefixLength === 0) return null;

  const payloadStart = start + prefixLength;
  let end = payloadStart;
  let terminatorLength = 0;
  while (end < data.length) {
    if (data[end] === BEL || data[end] === C1_ST) {
      terminatorLength = 1;
      break;
    }
    if (data[end] === ESC && data[end + 1] === BACKSLASH) {
      terminatorLength = 2;
      break;
    }
    end += 1;
  }
  if (terminatorLength === 0) return null;

  const payload = decodeAscii(data, payloadStart, end);
  const separator = payload.indexOf(";");
  if (separator === -1) return null;

  return {
    end: end + terminatorLength,
    opens: payload.slice(separator + 1).length > 0,
  };
}

function appendBytes(target: number[], bytes: number[]) {
  for (const byte of bytes) target.push(byte);
}

function appendRange(
  target: number[],
  data: Uint8Array,
  start: number,
  end: number
) {
  for (let i = start; i < end; i += 1) target.push(data[i]);
}

/** Converts xterm's hard-coded OSC 8 underline into bold, plain link text. */
export class TerminalLinkTransform {
  private pending = new Uint8Array();
  private linkOpen = false;

  transform(data: Uint8Array) {
    const input = new Uint8Array(this.pending.length + data.length);
    input.set(this.pending);
    input.set(data, this.pending.length);
    this.pending = new Uint8Array();

    const output: number[] = [];
    let cursor = 0;
    while (cursor < input.length) {
      const start = findOsc8Start(input, cursor);
      if (start === -1) {
        const partialStart = findPartialPrefixStart(input);
        if (partialStart === -1) {
          appendRange(output, input, cursor, input.length);
        } else {
          appendRange(output, input, cursor, partialStart);
          this.pending = input.slice(partialStart);
        }
        break;
      }

      appendRange(output, input, cursor, start);
      const sequence = parseOsc8(input, start);
      if (!sequence) {
        // The control sequence may be split across PTY events. Keep it until
        // the next event, rather than leaking a partial escape into xterm.
        this.pending = input.slice(start);
        break;
      }

      if (sequence.opens) {
        if (this.linkOpen) appendBytes(output, LINK_CLOSE);
        appendBytes(output, LINK_OPEN);
        this.linkOpen = true;
      } else if (this.linkOpen) {
        appendBytes(output, LINK_CLOSE);
        this.linkOpen = false;
      }
      cursor = sequence.end;
    }

    return Uint8Array.from(output);
  }
}

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g;

function trimUrlPunctuation(url: string) {
  return url.replace(/[.,;:!?]+$/g, "");
}

function openTerminalLink(url: string) {
  if (!/^https?:\/\//i.test(url)) return;
  if (!window.confirm(`Open this link?\n\n${url}`)) return;
  const popup = window.open();
  if (!popup) return;
  try {
    popup.opener = null;
  } catch {
    // Some webviews expose a read-only opener.
  }
  popup.location.href = url;
}

/** Keeps visible HTTP(S) URLs clickable after OSC 8 metadata is normalized. */
export function registerTerminalLinkProvider(term: Terminal) {
  return term.registerLinkProvider({
    provideLinks(lineNumber, callback) {
      const line = term.buffer.active.getLine(lineNumber - 1);
      const text = line?.translateToString(true) ?? "";
      const links: Array<{
        text: string;
        range: {
          start: { x: number; y: number };
          end: { x: number; y: number };
        };
        decorations: { underline: false; pointerCursor: true };
        activate: (_event: MouseEvent, value: string) => void;
      }> = [];

      for (const match of text.matchAll(URL_PATTERN)) {
        const rawUrl = match[0];
        const url = trimUrlPunctuation(rawUrl);
        if (!url || match.index === undefined) continue;
        const start = match.index;
        const end = start + url.length;
        links.push({
          text: url,
          range: {
            start: { x: start + 1, y: lineNumber },
            end: { x: end, y: lineNumber },
          },
          decorations: { underline: false, pointerCursor: true },
          activate: (_event, value) => openTerminalLink(value),
        });
      }

      callback(links.length > 0 ? links : undefined);
    },
  });
}
