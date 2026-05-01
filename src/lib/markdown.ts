interface MarkdownToken {
  type: string;
  content?: string;
  level?: number;
  language?: string;
  items?: string[];
  ordered?: boolean;
  href?: string;
  title?: string;
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

    // Unordered list
    if (line.match(/^[-*+]\s/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^[-*+]\s/)) {
        items.push(lines[i].replace(/^[-*+]\s/, ""));
        i++;
      }
      tokens.push({ type: "list", items, ordered: false });
      continue;
    }

    // Ordered list
    if (line.match(/^\d+\.\s/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s/)) {
        items.push(lines[i].replace(/^\d+\.\s/, ""));
        i++;
      }
      tokens.push({ type: "list", items, ordered: true });
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
      while (i < lines.length && lines[i].trim() !== "" && !lines[i].match(/^(#{1,6}\s|```|>\s|[-*+]\s|\d+\.\s|---)/)) {
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

function renderInline(text: string): string {
  let result = escapeHtml(text);
  // Bold
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/__(.+?)__/g, "<strong>$1</strong>");
  // Italic
  result = result.replace(/\*(.+?)\*/g, "<em>$1</em>");
  result = result.replace(/_(.+?)_/g, "<em>$1</em>");
  // Inline code
  result = result.replace(/`(.+?)`/g, "<code class=\"inline-code\">$1</code>");
  // Links
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="md-link">$1</a>');
  // Strikethrough
  result = result.replace(/~~(.+?)~~/g, "<del>$1</del>");
  return result;
}

export function renderMarkdownHTML(text: string): string {
  const tokens = parseMarkdown(text);
  let html = "";

  for (const token of tokens) {
    switch (token.type) {
      case "heading":
        html += `<h${token.level} class="md-h${token.level}">${renderInline(token.content || "")}</h${token.level}>\n`;
        break;
      case "paragraph":
        html += `<p class="md-p">${renderInline(token.content || "")}</p>\n`;
        break;
      case "blockquote":
        html += `<blockquote class="md-blockquote"><p>${renderInline(token.content || "")}</p></blockquote>\n`;
        break;
      case "code":
        html += `<pre class="md-pre"><code class="md-code">${escapeHtml(token.content || "")}</code></pre>\n`;
        break;
      case "list": {
        const tag = token.ordered ? "ol" : "ul";
        html += `<${tag} class="md-${tag}">\n`;
        for (const item of token.items || []) {
          html += `<li class="md-li">${renderInline(item)}</li>\n`;
        }
        html += `</${tag}>\n`;
        break;
      }
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
  // Keywords
  result = result.replace(
    /\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|try|catch|throw|new|this|typeof|instanceof|in|of)\b/g,
    '<span class="syntax-keyword">$1</span>'
  );
  // Strings
  result = result.replace(
    /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g,
    '<span class="syntax-string">$1</span>'
  );
  // Comments
  result = result.replace(
    /(\/\/.*$|\/\*[\s\S]*?\*\/)/gm,
    '<span class="syntax-comment">$1</span>'
  );
  // Numbers
  result = result.replace(
    /\b(\d+(?:\.\d+)?)\b/g,
    '<span class="syntax-number">$1</span>'
  );
  // Functions
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

export function getProgress(content: string, scrollTop: number, clientHeight: number): number {
  const totalHeight = content.split("\n").length * 24; // approx line height
  if (totalHeight <= clientHeight) return 100;
  return Math.min(100, Math.round((scrollTop / (totalHeight - clientHeight)) * 100));
}
