import type { PageContext, ProductSignals } from "./types";

const MAX_VISIBLE_CHARS = 14000;
const MAX_ALL_CHARS = 30000;

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{4}\b/g;
const CARD_RE = /\b(?:\d[ -]*?){13,19}\b/g;

function maskSensitiveText(value = ""): string {
  return value
    .replace(EMAIL_RE, "[masked-email]")
    .replace(CARD_RE, "[masked-number]")
    .replace(PHONE_RE, "[masked-phone]");
}

function cleanText(value = ""): string {
  return maskSensitiveText(value.replace(/\s+/g, " ").trim());
}

function isElementVisible(element: Element | null): boolean {
  if (!element) {
    return false;
  }

  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0
    && rect.height > 0
    && rect.bottom >= 0
    && rect.right >= 0
    && rect.top <= window.innerHeight
    && rect.left <= window.innerWidth;
}

function shouldSkipElement(element: Element | null): boolean {
  if (!element) {
    return true;
  }

  const tagName = element.tagName.toLowerCase();
  return [
    "script",
    "style",
    "noscript",
    "svg",
    "canvas",
    "input",
    "textarea",
    "select",
    "option"
  ].includes(tagName);
}

function collectVisibleText(): string {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      const text = cleanText(node.textContent || "");
      if (!text || text.length < 2 || shouldSkipElement(parent) || !isElementVisible(parent)) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const lines: string[] = [];
  let totalLength = 0;
  let current = walker.nextNode();

  while (current && totalLength < MAX_VISIBLE_CHARS) {
    const text = cleanText(current.textContent || "");
    if (text) {
      lines.push(text);
      totalLength += text.length;
    }
    current = walker.nextNode();
  }

  return lines.join("\n").slice(0, MAX_VISIBLE_CHARS);
}

function collectAllText(): string {
  const clone = document.body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("script,style,noscript,svg,canvas,input,textarea,select,option").forEach((node) => node.remove());
  return cleanText(clone.innerText || "").slice(0, MAX_ALL_CHARS);
}

function textFromSelector(selector: string, limit: number): string[] {
  return Array.from(document.querySelectorAll(selector))
    .map((element) => cleanText(element.textContent || ""))
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, limit);
}

function collectProductSignals(): ProductSignals {
  const names = [
    ...textFromSelector("h1", 3),
    ...textFromSelector("[itemprop='name']", 3),
    cleanText(document.querySelector("meta[property='og:title']")?.getAttribute("content") || "")
  ].filter(Boolean).slice(0, 6);

  const prices = textFromSelector(
    "[itemprop='price'], [class*='price' i], [id*='price' i], [data-testid*='price' i]",
    10
  );

  const availability = textFromSelector(
    "[itemprop='availability'], [class*='stock' i], [class*='availability' i], [class*='shipping' i], [id*='shipping' i]",
    10
  );

  const options = textFromSelector(
    "label, button, [role='option'], [aria-label]",
    24
  ).filter((value) => value.length <= 80);

  return {
    names,
    prices,
    availability,
    options
  };
}

function collectPageContext(): PageContext {
  return {
    url: location.href,
    title: document.title,
    visibleText: collectVisibleText(),
    selectedText: cleanText(window.getSelection()?.toString() || ""),
    allText: collectAllText(),
    metaDescription: cleanText(document.querySelector("meta[name='description']")?.getAttribute("content") || ""),
    productSignals: collectProductSignals(),
    capturedAt: new Date().toISOString()
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "COLLECT_PAGE_CONTEXT") {
    return false;
  }

  sendResponse({
    ok: true,
    pageContext: collectPageContext()
  });

  return true;
});
