interface MarkdownToken {
  type: string;
  content?: string;
  level?: number;
  language?: string;
  items?: string[];
  checked?: boolean[];
  ordered?: boolean;
  href?: string;
  title?: string;
  rows?: string[][];
  header?: string[];
  align?: string[];
  raw?: string;
}

type RefMap = Record<string, { url: string; title?: string }>;

function extractReferences(text: string): { refs: RefMap; cleaned: string } {
  const refs: RefMap = {};
  const lines = text.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\[([^\]]+)\]:\s+(\S+)(?:\s+"([^"]*)")?\s*$/);
    if (m) {
      refs[m[1].toLowerCase()] = { url: m[2], title: m[3] };
    } else {
      kept.push(line);
    }
  }
  return { refs, cleaned: kept.join("\n") };
}

export function parseMarkdown(text: string): MarkdownToken[] {
  const tokens: MarkdownToken[] = [];
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      tokens.push({
        type: "code",
        language: lang || "text",
        content: codeLines.join("\n"),
      });
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      tokens.push({
        type: "heading",
        level: headingMatch[1].length,
        content: headingMatch[2],
      });
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      tokens.push({
        type: "blockquote",
        content: quoteLines.join("\n"),
      });
      continue;
    }

    // Unordered list (including task lists)
    if (line.match(/^[-*+]\s/)) {
      const items: string[] = [];
      const checked: boolean[] = [];
      while (i < lines.length && lines[i].match(/^[-*+]\s/)) {
        const raw = lines[i];
        const task = raw.match(/^[-*+]\s+\[([ x])\]\s+(.*)$/);
        if (task) {
          checked.push(task[1] === "x");
          items.push(task[2]);
        } else {
          checked.push(false);
          items.push(raw.replace(/^[-*+]\s/, ""));
        }
        i++;
      }
      tokens.push({ type: "list", items, checked, ordered: false });
      continue;
    }

    // Ordered list
    if (line.match(/^\d+\.\s/)) {
      const items: string[] = [];
      const checked: boolean[] = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s/)) {
        items.push(lines[i].replace(/^\d+\.\s/, ""));
        checked.push(false);
        i++;
      }
      tokens.push({ type: "list", items, checked, ordered: true });
      continue;
    }

    // Table
    if (line.startsWith("|") && i + 1 < lines.length) {
      const sepLine = lines[i + 1];
      if (sepLine.startsWith("|") && /^\|[\s:-]+\|/.test(sepLine)) {
        const header = line
          .split("|")
          .slice(1, -1)
          .map(s => s.trim());
        const align = sepLine
          .split("|")
          .slice(1, -1)
          .map(s => {
            const t = s.trim();
            if (t.startsWith(":") && t.endsWith(":")) return "center";
            if (t.endsWith(":")) return "right";
            return "left";
          });
        const rows: string[][] = [];
        i += 2;
        while (i < lines.length && lines[i].startsWith("|")) {
          const cells = lines[i]
            .split("|")
            .slice(1, -1)
            .map(s => s.trim());
          rows.push(cells);
          i++;
        }
        tokens.push({ type: "table", header, rows, align });
        continue;
      }
    }

    // HTML block
    if (/^<[a-zA-Z][^>]*\s*\/?>/.test(line)) {
      const rawLines: string[] = [line];
      i++;
      while (i < lines.length) {
        const closingTag = line.match(/^<([a-zA-Z]+)/);
        const closeMatch = closingTag
          ? new RegExp(`^</${closingTag[1]}\\s*>`)
          : null;
        if (closeMatch && closeMatch.test(lines[i])) {
          rawLines.push(lines[i]);
          i++;
          break;
        }
        // If next line starts a known block, stop
        if (
          lines[i].startsWith("```") ||
          lines[i].startsWith("#") ||
          lines[i].startsWith("> ") ||
          lines[i].trim() === ""
        ) {
          break;
        }
        rawLines.push(lines[i]);
        i++;
      }
      tokens.push({ type: "html", raw: rawLines.join("\n") });
      continue;
    }

    // Horizontal rule
    if (line.match(/^---\s*$/)) {
      tokens.push({ type: "hr" });
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      tokens.push({ type: "blank" });
      i++;
      continue;
    }

    // Paragraph
    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].match(/^(#{1,6}\s|```|>\s|[-*+]\s|\d+\.\s|---|\|)/) &&
      !/^<[a-zA-Z]/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    tokens.push({
      type: "paragraph",
      content: paraLines.join(" "),
    });
  }

  return tokens;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const HTML_PLACEHOLDER = "%%HTML__";

function renderInline(text: string, refs?: RefMap): string {
  // Step 1: protect raw HTML tags from escaping
  const htmlTags: string[] = [];
  const noHtml = text.replace(/<([a-zA-Z/][a-zA-Z0-9_-]*(?:\s[^>]*)?)>/g, m => {
    htmlTags.push(m);
    return `${HTML_PLACEHOLDER}${htmlTags.length - 1}__`;
  });

  let result = escapeHtml(noHtml);

  // Step 2: restore HTML placeholders
  result = result.replace(
    /%%HTML__(\d+)__/g,
    (_, idx) => htmlTags[parseInt(idx)]
  );

  // Inline code (must run before other patterns to protect code)
  result = result.replace(
    /`(.+?)`/g,
    (_m, code: string) => `<code class="inline-code">${escapeHtml(code)}</code>`
  );

  // Bold
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/__(.+?)__/g, "<strong>$1</strong>");

  // Italic
  result = result.replace(/\*(.+?)\*/g, "<em>$1</em>");
  result = result.replace(/_(.+?)_/g, "<em>$1</em>");

  // Images (![alt](url))
  result = result.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    '<img src="$2" alt="$1" class="md-img" />'
  );

  // Links [text](url)
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" class="md-link">$1</a>'
  );

  // Reference-style links [text][ref]
  if (refs) {
    result = result.replace(
      /\[([^\]]+)\]\[([^\]]+)\]/g,
      (_m, text: string, ref: string) => {
        const def = refs[ref.toLowerCase()];
        if (def) {
          const title = def.title ? ` title="${def.title}"` : "";
          return `<a href="${def.url}" class="md-link"${title}>${text}</a>`;
        }
        return _m;
      }
    );
    // Implicit reference [text]
    result = result.replace(/\[([^\]]+)\](?!\()/g, (_m, text: string) => {
      const def = refs[text.toLowerCase()];
      if (def) {
        const title = def.title ? ` title="${def.title}"` : "";
        return `<a href="${def.url}" class="md-link"${title}>${text}</a>`;
      }
      return _m;
    });
  }

  // Auto-links <url>
  result = result.replace(
    /<(https?:\/\/[^>]+)>/g,
    '<a href="$1" class="md-link" rel="noreferrer">$1</a>'
  );

  // Strikethrough
  result = result.replace(/~~(.+?)~~/g, "<del>$1</del>");

  return result;
}

export function renderMarkdownHTML(text: string): string {
  const { refs, cleaned } = extractReferences(text);
  const tokens = parseMarkdown(cleaned);
  let html = "";

  for (const token of tokens) {
    switch (token.type) {
      case "heading":
        html += `<h${token.level} class="md-h${token.level}">${renderInline(token.content || "", refs)}</h${token.level}>\n`;
        break;
      case "paragraph":
        html += `<p class="md-p">${renderInline(token.content || "", refs)}</p>\n`;
        break;
      case "blockquote":
        html += `<blockquote class="md-blockquote"><p>${renderInline(token.content || "", refs)}</p></blockquote>\n`;
        break;
      case "code":
        html += `<pre class="md-pre"><code class="md-code">${escapeHtml(token.content || "")}</code></pre>\n`;
        break;
      case "list": {
        const tag = token.ordered ? "ol" : "ul";
        html += `<${tag} class="md-${tag}">\n`;
        for (let j = 0; j < (token.items || []).length; j++) {
          const item = token.items![j];
          const isChecked = token.checked?.[j];
          const checkbox =
            isChecked !== undefined
              ? `<input type="checkbox" class="md-task"${isChecked ? " checked" : ""} disabled /> `
              : "";
          html += `<li class="md-li">${checkbox}${renderInline(item, refs)}</li>\n`;
        }
        html += `</${tag}>\n`;
        break;
      }
      case "table": {
        html += '<div class="md-table-wrap"><table class="md-table">\n';
        if (token.header?.length) {
          html += "<thead><tr>";
          for (let j = 0; j < token.header.length; j++) {
            const al = token.align?.[j] || "left";
            html += `<th class="md-th" style="text-align:${al}">${renderInline(token.header[j], refs)}</th>`;
          }
          html += "</tr></thead>\n";
        }
        if (token.rows?.length) {
          html += "<tbody>\n";
          for (const row of token.rows) {
            html += "<tr>";
            for (let j = 0; j < row.length; j++) {
              const al = token.align?.[j] || "left";
              html += `<td class="md-td" style="text-align:${al}">${renderInline(row[j], refs)}</td>`;
            }
            html += "</tr>\n";
          }
          html += "</tbody>\n";
        }
        html += "</table></div>\n";
        break;
      }
      case "html":
        html += (token.raw || "") + "\n";
        break;
      case "hr":
        html += `<hr class="md-hr" />\n`;
        break;
      case "blank":
        html += `<div class="md-blank"></div>\n`;
        break;
    }
  }

  return html;
}

export function highlightCode(code: string): string {
  let result = escapeHtml(code);
  result = result.replace(
    /\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|try|catch|throw|new|this|typeof|instanceof|in|of)\b/g,
    '<span class="syntax-keyword">$1</span>'
  );
  result = result.replace(
    /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g,
    '<span class="syntax-string">$1</span>'
  );
  result = result.replace(
    /(\/\/.*$|\/\*[\s\S]*?\*\/)/gm,
    '<span class="syntax-comment">$1</span>'
  );
  result = result.replace(
    /\b(\d+(?:\.\d+)?)\b/g,
    '<span class="syntax-number">$1</span>'
  );
  result = result.replace(
    /\b([a-zA-Z_]\w*)\s*(?=\()/g,
    '<span class="syntax-function">$1</span>'
  );
  return result;
}

export function getLineNumbers(content: string): string {
  const lines = content.split("\n").length;
  return Array.from({ length: Math.max(lines, 1) }, (_, i) => i + 1).join("\n");
}

export function getReadingTime(content: string): string {
  const words = content.trim().split(/\s+/).length;
  const minutes = Math.ceil(words / 200);
  return `${minutes} min read`;
}

export function getProgress(
  content: string,
  scrollTop: number,
  clientHeight: number
): number {
  const totalHeight = content.split("\n").length * 24;
  if (totalHeight <= clientHeight) return 100;
  return Math.min(
    100,
    Math.round((scrollTop / (totalHeight - clientHeight)) * 100)
  );
}
