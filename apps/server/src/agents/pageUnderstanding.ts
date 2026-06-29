import type { AgentResponse, PageContext } from "../types.js";
import { chatText } from "../services/openai.js";
import { maskSensitiveText, pickRelevantSentences, summarizeLines, truncate } from "../utils/text.js";

function compactUrl(value = ""): string {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return value.split("?")[0];
  }
}

function detectRestrictedGoodsHints(pageContext: PageContext): string[] {
  const text = [
    pageContext.title,
    pageContext.visibleText,
    pageContext.allText,
    pageContext.productSignals?.names.join(" "),
    pageContext.productSignals?.options.join(" ")
  ].filter(Boolean).join(" ").toLowerCase();

  const hints: string[] = [];

  if (/玩具|toy|toys|장난감|완구|피규어|figure|模型|모형|키즈|어린이/.test(text)) {
    hints.push("완구 어린이제품 안전인증 피규어 14세 이상 수집용 어린이용 아님");
  }

  if (/键盘|鍵盤|键帽|鍵帽|키보드|키캡|试轴器|軸|switch tester|mechanical keyboard|전자|电器|電器/.test(text)) {
    hints.push("전기용품 생활용품 안전관리 전파법 방송통신기자재 전자제품 주변기기");
  }

  if (/bluetooth|wireless|wifi|wi-fi|无线|無線|블루투스|무선|배터리|battery|电池|電池|충전|recharge/.test(text)) {
    hints.push("전파법 적합성평가 배터리 리튬 전기용품 수입요건");
  }

  if (/食品|食物|food|supplement|vitamin|건강기능식품|영양제|식품|비타민|멜라토닌|melatonin|의약품|medicine|drug|药|藥/.test(text)) {
    hints.push("식품 건강기능식품 의약품 위해식품 국내 반입차단 원료 성분 목록통관 배제");
  }

  if (/化妆品|化粧品|cosmetic|화장품|스킨케어|skincare|향수|perfume/.test(text)) {
    hints.push("화장품 기능성화장품 스테로이드 태반 성분미상 유해화장품 목록통관 배제");
  }

  if (/knife|칼|도검|총포|화약|석궁|모의총포|刀|枪|槍/.test(text)) {
    hints.push("도검 총포 모의총포 수입허가 반입제한물품");
  }

  return Array.from(new Set(hints));
}

function buildPageText(pageContext: PageContext): string {
  const selected = pageContext.selectedText ? `선택 텍스트:\n${pageContext.selectedText}\n\n` : "";
  const productSignals = pageContext.productSignals
    ? `상품 후보:\n${pageContext.productSignals.names.join("\n")}\n가격 후보:\n${pageContext.productSignals.prices.join("\n")}\n옵션 후보:\n${pageContext.productSignals.options.join("\n")}\n\n`
    : "";
  const body = pageContext.visibleText || pageContext.allText || "";

  return maskSensitiveText(truncate(`${selected}${productSignals}${body}`, 16000));
}

function removeInternalRoutingAdvice(answer: string): string {
  return answer
    .replace(/[^.\n。！？!?]*(직구지원\s*RAG\s*Agent|RAG\s*Agent|관련\s*Agent)[^.\n。！？!?]*(문의|확인|필요)[^.\n。！？!?]*[.\n。！？!?]?/gi, "")
    .replace(/[^.\n。！？!?]*(관세|통관|수입\s*제한|법령|세금)[^.\n。！？!?]*(이\s*페이지에\s*포함되어\s*있지\s*않|페이지에\s*없)[^.\n。！？!?]*(문의|필요|확인)[^.\n。！？!?]*[.\n。！？!?]?/g, "")
    .split(/\n+/)
    .map((line) => line.trimEnd())
    .filter((line) => {
      const normalized = line.replace(/\s+/g, " ");
      return !/직구지원\s*RAG\s*Agent/i.test(normalized)
        && !/RAG\s*Agent.*문의/i.test(normalized)
        && !/관련\s*Agent.*문의/i.test(normalized);
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function answerPageQuestion(query: string, pageContext?: PageContext): Promise<AgentResponse> {
  if (!pageContext) {
    return {
      route: "page",
      answer: "현재 페이지 컨텍스트가 없습니다. 확장 프로그램에서 페이지 새로고침 버튼을 눌러 다시 시도하세요.",
      pageEvidence: []
    };
  }

  const pageText = buildPageText(pageContext);
  const evidence = pickRelevantSentences(query, pageText, 6);
  const fallbackEvidence = evidence.length > 0 ? evidence : summarizeLines(pageText, 6);

  const system = [
    "너는 현재 브라우저 페이지를 읽고 답하는 페이지 이해 Agent다.",
    "한국어로 답한다.",
    "반드시 제공된 페이지 컨텍스트에 근거한다.",
    "관세, 통관, 수입 제한, 법령, 세금 같은 페이지 밖 정보는 답변에 포함하지 않는다.",
    "직구지원 RAG Agent, 다른 Agent, 내부 라우팅 구조를 사용자에게 언급하지 않는다.",
    "페이지에서 확인한 근거가 부족하면 페이지에서 확인되지 않는다고 짧게 말한다."
  ].join("\n");

  const user = [
    `사용자 질문: ${query}`,
    `페이지 제목: ${pageContext.title}`,
    `URL: ${pageContext.url}`,
    "페이지 컨텍스트:",
    pageText
  ].join("\n\n");

  const llmAnswer = await chatText(system, user);

  if (llmAnswer) {
    return {
      route: "page",
      answer: removeInternalRoutingAdvice(llmAnswer),
      pageEvidence: fallbackEvidence
    };
  }

  const answer = fallbackEvidence.length
    ? [
        "현재 페이지에서 질문과 관련 있어 보이는 내용은 아래와 같습니다.",
        "",
        ...fallbackEvidence.map((sentence) => `- ${sentence}`),
        "",
        "OpenAI API 키를 설정하면 이 근거를 바탕으로 더 자연스러운 번역과 설명을 생성합니다."
      ].join("\n")
    : "현재 페이지에서 질문과 직접 연결되는 문장을 찾지 못했습니다. 선택 텍스트를 지정하거나 페이지를 다시 수집해 주세요.";

  return {
    route: "page",
    answer,
    pageEvidence: fallbackEvidence
  };
}

export function extractPageFacts(pageContext?: PageContext): string {
  if (!pageContext) {
    return "";
  }

  const signals = pageContext.productSignals;
  const restrictedHints = detectRestrictedGoodsHints(pageContext);
  const lines = [
    `페이지 제목: ${pageContext.title}`,
    `사이트: ${compactUrl(pageContext.url)}`,
    restrictedHints.length ? `제한품목 검색 힌트: ${restrictedHints.join(" / ")}` : "",
    signals?.names.length ? `상품명 후보: ${signals.names.join(" / ")}` : "",
    signals?.prices.length ? `가격 후보: ${signals.prices.join(" / ")}` : "",
    signals?.availability.length ? `재고/배송 후보: ${signals.availability.join(" / ")}` : "",
    signals?.options.length ? `옵션 후보: ${signals.options.join(" / ")}` : "",
    ...summarizeLines(pageContext.visibleText || pageContext.allText || "", 5).map((line) => `페이지 문장: ${line}`)
  ];

  return maskSensitiveText(lines.filter(Boolean).join("\n"));
}
