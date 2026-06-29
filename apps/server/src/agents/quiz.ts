import type { AgentResponse, PageContext, QuizItem, UserProfile } from "../types.js";
import { chatJson } from "../services/openai.js";
import { maskSensitiveText, splitSentences, truncate, unique } from "../utils/text.js";

const ENGLISH_STOP_WORDS = new Set([
  "about",
  "above",
  "after",
  "again",
  "also",
  "because",
  "before",
  "below",
  "between",
  "could",
  "every",
  "from",
  "have",
  "into",
  "more",
  "most",
  "other",
  "over",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "under",
  "with",
  "within",
  "would",
  "your"
]);

const ENGLISH_MEANINGS: Record<string, string> = {
  available: "이용 가능하거나 재고가 있는",
  eligible: "자격이 있는, 조건에 맞는",
  estimated: "예상되는",
  refurbished: "수리 또는 재정비된",
  compatible: "호환되는",
  warranty: "보증",
  condition: "상태",
  subscription: "정기 구독",
  recurring: "반복 결제되는",
  clearance: "통관 또는 재고 정리",
  restricted: "제한된",
  prohibited: "금지된",
  ingredient: "성분",
  dosage: "복용량",
  surcharge: "추가 요금",
  handling: "처리 또는 취급",
  refund: "환불",
  returnable: "반품 가능한",
  final: "최종의",
  duties: "관세",
  subtotal: "소계",
  checkout: "결제 단계",
  carrier: "배송사"
};

function normalizeLanguage(language?: string): string {
  const normalized = (language || "auto").trim().toLowerCase();
  const aliases: Record<string, string> = {
    english: "english",
    en: "english",
    영어: "english",
    japanese: "japanese",
    ja: "japanese",
    일본어: "japanese",
    chinese: "chinese",
    zh: "chinese",
    중국어: "chinese",
    spanish: "spanish",
    es: "spanish",
    스페인어: "spanish",
    french: "french",
    fr: "french",
    프랑스어: "french",
    german: "german",
    de: "german",
    독일어: "german",
    auto: "auto",
    자동: "auto"
  };

  return aliases[normalized] || normalized;
}

function languageLabel(language?: string): string {
  const normalized = normalizeLanguage(language);
  const labels: Record<string, string> = {
    auto: "페이지의 주요 외국어",
    english: "영어",
    japanese: "일본어",
    chinese: "중국어",
    spanish: "스페인어",
    french: "프랑스어",
    german: "독일어"
  };

  return labels[normalized] || language || "페이지의 주요 외국어";
}

function difficultyFor(term: string, language: string): QuizItem["difficulty"] {
  const charLength = Array.from(term).length;

  if (language === "japanese" || language === "chinese") {
    if (charLength >= 5) {
      return "advanced";
    }

    if (charLength >= 3) {
      return "intermediate";
    }

    return "beginner";
  }

  if (charLength >= 11 || /(tion|ment|ance|ence|able|ible|ship|surcharge|restricted)/i.test(term)) {
    return "advanced";
  }

  if (charLength >= 8 || ENGLISH_MEANINGS[term.toLowerCase()]) {
    return "intermediate";
  }

  return "beginner";
}

function scoreTerm(term: string, language: string): number {
  const normalized = term.toLowerCase();
  let score = Array.from(term).length;

  if (ENGLISH_MEANINGS[normalized]) {
    score += 8;
  }

  if (language === "japanese" || language === "chinese") {
    score += /[\p{Script=Han}]/u.test(term) ? 4 : 0;
  }

  if (/(tion|ment|ance|ence|able|ible|ship|ward|less|ful)$/i.test(term)) {
    score += 3;
  }

  return score;
}

function segmentCjkTerms(sentence: string, language: string): string[] {
  const locale = language === "japanese" ? "ja" : "zh";

  try {
    const Segmenter = Intl.Segmenter;
    const segmenter = new Segmenter(locale, { granularity: "word" });
    return Array.from(segmenter.segment(sentence))
      .filter((segment) => segment.isWordLike)
      .map((segment) => segment.segment.trim())
      .filter((term) => Array.from(term).length >= 2);
  } catch {
    return sentence.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆〤]{2,12}/gu) ?? [];
  }
}

function extractTerms(sentence: string, language: string): string[] {
  if (language === "japanese") {
    return segmentCjkTerms(sentence, language);
  }

  if (language === "chinese") {
    return segmentCjkTerms(sentence, language).filter((term) => !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(term));
  }

  if (language === "auto") {
    return [
      ...(sentence.match(/\b[A-Za-z][A-Za-z'-]{3,}\b/g) ?? []),
      ...(sentence.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆〤]{2,12}/gu) ?? [])
    ];
  }

  return sentence.match(/\b[\p{L}][\p{L}'-]{3,}\b/gu) ?? [];
}

function extractCandidates(text: string, targetLanguage?: string): Array<{ word: string; sentence: string; difficulty: QuizItem["difficulty"] }> {
  const language = normalizeLanguage(targetLanguage);
  const sentences = splitSentences(text);
  const candidates: Array<{ word: string; sentence: string; difficulty: QuizItem["difficulty"]; score: number }> = [];

  for (const sentence of sentences) {
    const words = unique(extractTerms(sentence, language));
    for (const word of words) {
      const normalized = word.toLowerCase().replace(/'s$/, "");
      if (ENGLISH_STOP_WORDS.has(normalized) || Array.from(normalized).length < 2) {
        continue;
      }

      if ((language === "auto" || language === "english") && /^[a-z'-]+$/i.test(normalized) && normalized.length < 4) {
        continue;
      }

      candidates.push({
        word: normalized,
        sentence,
        difficulty: difficultyFor(normalized, language),
        score: scoreTerm(normalized, language)
      });
    }
  }

  const seen = new Set<string>();
  return candidates
    .sort((a, b) => b.score - a.score)
    .filter((candidate) => {
      if (seen.has(candidate.word)) {
        return false;
      }
      seen.add(candidate.word);
      return true;
    })
    .slice(0, 10);
}

function varyAnswerPlacement(quiz: QuizItem, quizIndex: number): QuizItem {
  const options = quiz.options.filter((option) => option.trim().length > 0);
  if (options.length < 2) {
    return quiz;
  }

  const originalAnswerIndex = Number.isInteger(quiz.answerIndex)
    && quiz.answerIndex >= 0
    && quiz.answerIndex < options.length
    ? quiz.answerIndex
    : 0;
  const answer = options[originalAnswerIndex];
  const distractors = options.filter((_option, optionIndex) => optionIndex !== originalAnswerIndex);
  const targetAnswerIndex = (quizIndex + 1) % options.length;
  const variedOptions = [...distractors];

  variedOptions.splice(targetAnswerIndex, 0, answer);

  return {
    ...quiz,
    options: variedOptions,
    answerIndex: targetAnswerIndex
  };
}

function makeFallbackQuiz(candidate: { word: string; sentence: string; difficulty: QuizItem["difficulty"] }, index: number): QuizItem {
  const meaning = ENGLISH_MEANINGS[candidate.word] || "문맥에서 핵심 의미를 가진 단어 또는 표현";
  const options = [
    meaning,
    "배송 주소를 입력하는 칸",
    "결제 완료 후 발급되는 번호",
    "상품 이미지의 색상 정보"
  ];

  return varyAnswerPlacement({
    id: `${candidate.word}-${index}`,
    word: candidate.word,
    sentence: candidate.sentence,
    question: `"${candidate.word}"의 문맥상 의미로 가장 알맞은 것은?`,
    options,
    answerIndex: 0,
    explanation: `"${candidate.word}"는 이 문장에서 "${meaning}"라는 의미로 확인하면 좋습니다.`,
    difficulty: candidate.difficulty
  }, index);
}

interface LlmQuizResponse {
  quizzes: QuizItem[];
}

export async function generateQuiz(pageContext?: PageContext, userProfile?: UserProfile): Promise<AgentResponse> {
  const targetLanguage = languageLabel(userProfile?.targetLanguage);
  const text = maskSensitiveText(truncate([
    pageContext?.selectedText,
    pageContext?.visibleText,
    pageContext?.allText
  ].filter(Boolean).join("\n\n"), 12000));

  if (!text) {
    return {
      route: "quiz",
      answer: "퀴즈를 만들 페이지 텍스트가 없습니다. 페이지를 다시 수집해 주세요.",
      quizzes: [],
      vocabulary: []
    };
  }

  const system = [
    "너는 외국어 퀴즈 Agent다.",
    `학습 대상 언어는 ${targetLanguage}다.`,
    "현재 페이지 텍스트에서 실제로 등장한 학습 대상 언어의 단어 또는 표현만 골라 한국어 학습용 객관식 퀴즈를 만든다.",
    "학습 대상 언어가 자동이면 페이지의 주요 외국어를 판단하되, 사용자의 모국어로 보이는 한국어 표현은 퀴즈 대상으로 삼지 않는다.",
    "문맥상 의미를 기준으로 한다.",
    "정답 위치는 문항마다 다양하게 배치한다.",
    "JSON만 반환한다.",
    "형식: {\"quizzes\":[{\"id\":\"...\",\"word\":\"...\",\"sentence\":\"...\",\"question\":\"...\",\"options\":[\"...\"],\"answerIndex\":0,\"explanation\":\"...\",\"difficulty\":\"beginner|intermediate|advanced\"}]}",
    "answerIndex는 options 배열에서 정답이 있는 0부터 시작하는 위치다."
  ].join("\n");

  const user = [
    `사용자 수준: ${userProfile?.level || "intermediate"}`,
    `학습 대상 언어: ${targetLanguage}`,
    "페이지 텍스트:",
    text
  ].join("\n\n");

  const llmQuizzes = await chatJson<LlmQuizResponse>(system, user);
  const validQuizzes = llmQuizzes?.quizzes
    ?.filter((quiz) => quiz.options.length >= 4)
    .slice(0, 5)
    .map(varyAnswerPlacement);

  if (validQuizzes?.length) {
    return {
      route: "quiz",
      answer: "현재 페이지에서 퀴즈를 만들었습니다.",
      quizzes: validQuizzes,
      vocabulary: validQuizzes.map((quiz) => ({
        word: quiz.word,
        sentence: quiz.sentence,
        difficulty: quiz.difficulty
      }))
    };
  }

  const candidates = extractCandidates(text, userProfile?.targetLanguage).slice(0, 5);
  const quizzes = candidates.map(makeFallbackQuiz);

  return {
    route: "quiz",
    answer: quizzes.length
      ? "현재 페이지에서 난이도 있는 단어를 골라 퀴즈를 만들었습니다."
      : "현재 페이지에서 퀴즈 후보 단어를 찾지 못했습니다.",
    quizzes,
    vocabulary: candidates.map((candidate) => ({
      word: candidate.word,
      sentence: candidate.sentence,
      difficulty: candidate.difficulty
    }))
  };
}
