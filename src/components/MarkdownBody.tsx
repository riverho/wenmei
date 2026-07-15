import { useMemo, type MouseEvent } from "react";
import { renderMarkdownHTML } from "@/lib/markdown";

/** Rewrite bare `@path:line` mentions into `#open:` links before markdown
 *  rendering so they stay clickable inside formatted output (the container's
 *  click handler intercepts them). */
function linkifyMentions(text: string): string {
  return text.replace(
    /@([^\s:()[\]]+(?:\/[^\s:()[\]]+)*):(\d+)/g,
    "[@$1:$2](#open:$1)"
  );
}

/**
 * Sidecar markdown renderer — formats narrate/chat/alert bodies through the
 * same sanitized pipeline the document preview uses (renderMarkdownHTML +
 * DOMPurify), scaled down by the `.md-compact` styles in App.css.
 *
 * Links: `#open:<path>` anchors call `onOpenFile`; http(s) links open in a
 * detached popup after a confirm (same treatment as terminal links); every
 * other href is inert so nothing can navigate the webview away.
 */
export default function MarkdownBody({
  text,
  className = "",
  onOpenFile,
}: {
  text: string;
  className?: string;
  onOpenFile?: (path: string) => void;
}) {
  const html = useMemo(
    () => renderMarkdownHTML(onOpenFile ? linkifyMentions(text) : text),
    [text, onOpenFile]
  );

  function handleClick(e: MouseEvent<HTMLDivElement>) {
    const anchor = (e.target as HTMLElement).closest("a");
    if (!anchor) return;
    e.preventDefault();
    const href = anchor.getAttribute("href") ?? "";
    if (href.startsWith("#open:")) {
      e.stopPropagation();
      onOpenFile?.(decodeURIComponent(href.slice("#open:".length)));
      return;
    }
    if (/^https?:\/\//i.test(href)) {
      e.stopPropagation();
      if (!window.confirm(`Open this link?\n\n${href}`)) return;
      const popup = window.open();
      if (!popup) return;
      try {
        popup.opener = null;
      } catch {
        // Some webviews expose a read-only opener.
      }
      popup.location.href = href;
    }
  }

  return (
    <div
      className={`md-compact select-text ${className}`}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
