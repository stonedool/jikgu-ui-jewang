import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { AgentResponse, Citation, RagDocument } from "../types.js";
import { chatText } from "../services/openai.js";
import { normalizeWhitespace, tokenize, truncate } from "../utils/text.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const serverRoot = path.resolve(__dirname, "../..");
const dataDir = path.join(serverRoot, "data");
const samplePath = path.join(dataDir, "rag-docs.sample.json");
const localPath = path.join(dataDir, "local-docs.json");
const faissIndexDir = path.join(dataDir, "rag", "index");
const faissSearchScript = path.join(serverRoot, "scripts", "search_faiss.py");

let cachedDocuments: RagDocument[] | null = null;

async function readJsonFile(filePath: string): Promise<RagDocument[]> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as RagDocument[];
  } catch {
    return [];
  }
}

export async function loadRagDocuments(): Promise<RagDocument[]> {
  if (cachedDocuments) {
    return cachedDocuments;
  }

  const [sampleDocs, localDocs] = await Promise.all([
    readJsonFile(samplePath),
    readJsonFile(localPath)
  ]);

  cachedDocuments = [...sampleDocs, ...localDocs];
  return cachedDocuments;
}

export async function listRagDocuments(): Promise<RagDocument[]> {
  return loadRagDocuments();
}

export async function addRagDocument(document: RagDocument): Promise<RagDocument> {
  const localDocs = await readJsonFile(localPath);
  const nextDocs = [
    ...localDocs.filter((doc) => doc.id !== document.id),
    document
  ];

  await writeFile(localPath, `${JSON.stringify(nextDocs, null, 2)}\n`, "utf8");
  cachedDocuments = null;
  return document;
}

function scoreDocument(queryTokens: string[], doc: RagDocument): number {
  const titleTokens = tokenize(doc.title);
  const categoryTokens = tokenize(doc.category);
  const contentTokens = tokenize(doc.content);
  let score = 0;

  for (const queryToken of queryTokens) {
    score += titleTokens.filter((token) => token.includes(queryToken) || queryToken.includes(token)).length * 5;
    score += categoryTokens.filter((token) => token.includes(queryToken) || queryToken.includes(token)).length * 3;
    score += contentTokens.filter((token) => token.includes(queryToken) || queryToken.includes(token)).length;
  }

  return score;
}

function makeSnippet(queryTokens: string[], doc: RagDocument): string {
  const sentences = doc.content.split(/(?<=[.!?。！？])\s+/).map(normalizeWhitespace);
  const ranked = sentences
    .map((sentence) => ({
      sentence,
      score: queryTokens.reduce((sum, token) => sum + (sentence.toLowerCase().includes(token) ? 1 : 0), 0)
    }))
    .sort((a, b) => b.score - a.score);

  return truncate(ranked[0]?.sentence || doc.content, 360);
}

function dedupeCitations(citations: Citation[], limit: number): Citation[] {
  const seen = new Set<string>();
  const uniqueCitations: Citation[] = [];

  for (const citation of citations) {
    const key = citation.sourceUrl || `${citation.source}:${citation.title}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueCitations.push(citation);

    if (uniqueCitations.length >= limit) {
      break;
    }
  }

  return uniqueCitations;
}

export async function retrieveDocuments(query: string, limit = 4): Promise<Citation[]> {
  const faissResults = await retrieveFaissDocuments(query, limit * 3);
  if (faissResults.length > 0) {
    return dedupeCitations(faissResults, limit);
  }

  const docs = await loadRagDocuments();
  const queryTokens = tokenize(query);

  const keywordResults = docs
    .map((doc) => {
      const score = scoreDocument(queryTokens, doc);
      return {
        id: doc.id,
        title: doc.title,
        source: doc.source,
        sourceUrl: doc.sourceUrl,
        publishedAt: doc.publishedAt,
        snippet: makeSnippet(queryTokens, doc),
        score
      };
    })
    .filter((citation) => citation.score > 0)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit * 3);

  return dedupeCitations(keywordResults, limit);
}

interface FaissSearchResponse {
  results?: Array<{
    id: string;
    title: string;
    source: string;
    sourceUrl?: string;
    publishedAt?: string;
    snippet: string;
    score?: number;
  }>;
  error?: string;
}

async function retrieveFaissDocuments(query: string, limit: number): Promise<Citation[]> {
  try {
    const python = process.env.PYTHON_PATH || "python";
    const { stdout } = await execFileAsync(
      python,
      [
        faissSearchScript,
        "--query",
        truncate(query, 5000),
        "--limit",
        String(limit),
        "--index-dir",
        faissIndexDir
      ],
      {
        maxBuffer: 1024 * 1024 * 4,
        windowsHide: true
      }
    );

    const parsed = JSON.parse(stdout.trim()) as FaissSearchResponse;
    if (parsed.error) {
      console.warn(`FAISS search unavailable: ${parsed.error}`);
      return [];
    }

    return (parsed.results || [])
      .filter((result) => (result.score ?? 0) > 0)
      .map((result) => ({
        id: result.id,
        title: result.title,
        source: result.source,
        sourceUrl: result.sourceUrl,
        publishedAt: result.publishedAt,
        snippet: result.snippet,
        score: result.score
      }));
  } catch (error) {
    console.warn("FAISS search failed; falling back to keyword RAG.", error);
    return [];
  }
}

function removeGenericCheckAdvice(answer: string): string {
  return answer
    .replace(/[^.\n。！？!?]*(별도\s*확인|확인이\s*필요|확인할\s*필요|확인해야\s*합니다|확인하는\s*것이\s*중요|확인하시(?:길|기)?\s*바랍니다|확인하세요|확인해\s*주세요|최종\s*확인)[^.\n。！？!?]*[.\n。！？!?]?/g, "")
    .split(/\n+/)
    .map((line) => line.trimEnd())
    .filter((line) => {
      const normalized = line.replace(/\s+/g, " ");
      return !/확인하시(?:길|기)?\s*바랍니다/.test(normalized)
        && !/확인해\s*주세요/.test(normalized)
        && !/확인하세요/.test(normalized)
        && !/확인이\s*필요/.test(normalized)
        && !/확인할\s*필요/.test(normalized)
        && !/확인해야\s*합니다/.test(normalized)
        && !/확인하는\s*것이\s*중요/.test(normalized)
        && !/별도\s*확인/.test(normalized)
        && !/최종\s*확인/.test(normalized)
        && !/최신\s*(안내|자료|정보).*(확인|참고)/.test(normalized);
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isRestrictedGoodsQuery(query: string): boolean {
  return /제한|금지|반입|통관|요건|인증|전파법|안전인증|직구/.test(query);
}

function removeGenericCustomsIntro(answer: string, query: string): string {
  if (!isRestrictedGoodsQuery(query)) {
    return answer;
  }

  return answer
    .split(/\n+/)
    .map((line) => line.trimEnd())
    .filter((line) => {
      const normalized = line.replace(/\s+/g, " ");
      return !/개인통관\s*고유부호.*(필요|발급)/.test(normalized)
        && !/물품가격.*(미화\s*)?150.*(관세|부가|면제|과세)/.test(normalized)
        && !/과세가격.*(운송비|보험료|물품대금)/.test(normalized)
        && !/개인사용.*(수입요건\s*)?면제/.test(normalized)
        && !/1개.*(수입요건\s*)?면제/.test(normalized)
        && !/해외직구\s*시\s*통관\s*절차/.test(normalized);
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function alignRestrictedGoodsVerdict(answer: string): string {
  const hasRequirementSignal = /전파법|전기용품|적합성평가|안전인증|방송통신기자재|배터리|무선|블루투스/i.test(answer);
  if (!hasRequirementSignal) {
    return answer;
  }

  return answer.replace(/^판정:\s*제한 가능성 낮음[.\s]*/m, "판정: 요건 대상 가능성.\n");
}

export async function answerRagQuestion(query: string, extraContext = ""): Promise<AgentResponse> {
  const citations = await retrieveDocuments(`${query}\n${extraContext}`, 4);

  if (citations.length === 0) {
    return {
      route: "rag",
      answer: "직구지원 문서에서 관련 근거를 찾지 못했습니다. 운영용 공식 문서를 추가한 뒤 다시 질문해 주세요.",
      citations: []
    };
  }

  const system = [
    "너는 직구지원 RAG Agent다.",
    "한국어로 답한다.",
    "반드시 제공된 문서 근거만 사용한다.",
    "상품 페이지의 구체적 옵션/리뷰/가격 판단은 페이지 이해 Agent 영역이라고 구분한다.",
    "답변에는 출처 제목과 날짜를 짧게 언급한다.",
    "마무리 문장으로 '확인하시길 바랍니다', '확인하세요', '최종 확인하세요' 같은 일반 안내 문구를 쓰지 않는다.",
    "'확인이 필요합니다', '확인할 필요가 있습니다', '확인해야 합니다', '확인하는 것이 중요합니다' 같은 일반 점검 문장도 쓰지 않는다.",
    "페이지 보조 정보가 제공되어도 '페이지 정보', URL, 가격 후보, 옵션 후보, 페이지 문장 목록을 그대로 재출력하지 않는다.",
    "페이지 보조 정보는 상품 유형이나 위험 가능성을 추론하는 데만 조용히 사용한다.",
    "제한 품목 여부를 묻는 경우, 첫 문장을 반드시 '판정: 제한 가능성 낮음', '판정: 요건 대상 가능성', '판정: 반입제한 가능성', '판정: 문서상 직접 제한 근거 없음' 중 하나로 시작한다.",
    "제한 품목 답변은 최대 3문장으로 쓴다.",
    "사용자가 직접 묻지 않으면 개인통관고유부호, 150달러 면세, 일반 과세가격 설명을 쓰지 않는다.",
    "개인사용 1개 수입요건 면제 같은 예외 설명은 사용자가 직접 묻지 않으면 쓰지 않는다.",
    "무선, 블루투스, 배터리, 전자제품, 전기용품, 방송통신기자재는 '제한 가능성 낮음'이 아니라 '요건 대상 가능성'으로 분류한다.",
    "일반 통관 절차 설명보다 해당 상품군의 제한/인증/반입 요건만 말한다.",
    "제공된 문서에 해당 품목군의 제한 근거가 없으면 '문서상 직접 제한 근거 없음'이라고 답한다.",
    "문서 근거에서 알 수 있는 내용만 간결하게 정리한다."
  ].join("\n");

  const user = [
    `사용자 질문: ${query}`,
    extraContext ? `내부 보조 정보(답변에 그대로 출력 금지):\n${extraContext}` : "",
    "검색된 문서:",
    ...citations.map((citation, index) => [
      `[${index + 1}] ${citation.title}`,
      `source: ${citation.source}`,
      `publishedAt: ${citation.publishedAt || "unknown"}`,
      `snippet: ${citation.snippet}`
    ].join("\n"))
  ].filter(Boolean).join("\n\n");

  const llmAnswer = await chatText(system, user);

  if (llmAnswer) {
    return {
      route: "rag",
      answer: alignRestrictedGoodsVerdict(removeGenericCustomsIntro(removeGenericCheckAdvice(llmAnswer), query)),
      citations
    };
  }

  const answer = [
    "검색된 직구지원 문서 기준 요약입니다.",
    "",
    ...citations.map((citation) => `- ${citation.title}: ${citation.snippet} (${citation.source}, ${citation.publishedAt || "날짜 미상"})`)
  ].join("\n");

  return {
    route: "rag",
    answer: alignRestrictedGoodsVerdict(removeGenericCustomsIntro(removeGenericCheckAdvice(answer), query)),
    citations
  };
}
