import type { AgentRoute, PageContext } from "../types.js";

const QUIZ_TERMS = [
  "퀴즈",
  "문제",
  "단어",
  "표현",
  "뜻",
  "빈칸",
  "학습",
  "vocab",
  "quiz",
  "word",
  "meaning"
];

const RAG_TERMS = [
  "관세",
  "통관",
  "수입",
  "금지",
  "제한",
  "법령",
  "법",
  "개인통관",
  "고유부호",
  "배송대행",
  "배대지",
  "면세",
  "부가세",
  "소비자원",
  "분쟁",
  "환불 절차",
  "직구 방법",
  "인증",
  "인증요건",
  "인증 요건",
  "요건대상",
  "요건 대상",
  "요건",
  "안전인증",
  "안전 인증",
  "적합성평가",
  "적합성 평가",
  "전파법",
  "전기용품",
  "방송통신기자재",
  "customs",
  "duty",
  "import",
  "restricted"
];

const PAGE_TERMS = [
  "이 상품",
  "이 페이지",
  "옵션",
  "리뷰",
  "설명",
  "번역",
  "배송 문구",
  "반품 문구",
  "가격",
  "사이즈",
  "색상",
  "해석",
  "page",
  "review",
  "option",
  "translate"
];

function includesAny(query: string, terms: string[]): boolean {
  const normalized = query.toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

export function classifyQuery(query: string, pageContext?: PageContext): AgentRoute {
  const wantsQuiz = includesAny(query, QUIZ_TERMS);
  const wantsRag = includesAny(query, RAG_TERMS);
  const wantsPage = includesAny(query, PAGE_TERMS) || Boolean(pageContext?.selectedText);
  const hasPageContext = Boolean(pageContext?.visibleText || pageContext?.allText);

  if (wantsQuiz) {
    return "quiz";
  }

  if (wantsRag && (wantsPage || /이\s*거|해도\s*돼|괜찮|구매/.test(query)) && hasPageContext) {
    return "mixed";
  }

  if (wantsRag) {
    return "rag";
  }

  if (wantsPage || hasPageContext) {
    return "page";
  }

  return "rag";
}
