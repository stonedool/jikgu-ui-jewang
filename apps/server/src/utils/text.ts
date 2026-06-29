const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{4}\b/g;
const CARD_RE = /\b(?:\d[ -]*?){13,19}\b/g;

export function maskSensitiveText(value = ""): string {
  return value
    .replace(EMAIL_RE, "[masked-email]")
    .replace(CARD_RE, "[masked-number]")
    .replace(PHONE_RE, "[masked-phone]");
}

export function normalizeWhitespace(value = ""): string {
  return value.replace(/\s+/g, " ").trim();
}

export function truncate(value = "", maxLength = 12000): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}

export function splitSentences(value = ""): string[] {
  return value
    .replace(/\r/g, "\n")
    .split(/(?<=[.!?。！？])\s+|\n+/)
    .map((sentence) => normalizeWhitespace(sentence))
    .filter((sentence) => sentence.length > 12);
}

export function tokenize(value = ""): string[] {
  return value
    .toLowerCase()
    .match(/[a-z가-힣0-9]+/g)?.filter((token) => token.length > 1) ?? [];
}

export function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

export function pickRelevantSentences(query: string, text: string, limit = 5): string[] {
  const queryTerms = new Set(tokenize(query));
  const sentences = splitSentences(text);

  return sentences
    .map((sentence) => {
      const tokens = tokenize(sentence);
      const score = tokens.reduce((sum, token) => sum + (queryTerms.has(token) ? 2 : 0), 0)
        + Math.min(sentence.length / 240, 1);
      return { sentence, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.sentence);
}

export function summarizeLines(text: string, limit = 6): string[] {
  return splitSentences(text)
    .filter((sentence) => sentence.length < 260)
    .slice(0, limit);
}
