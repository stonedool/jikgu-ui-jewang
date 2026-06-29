export type AgentRoute = "page" | "rag" | "quiz" | "mixed";

export interface ProductSignals {
  names: string[];
  prices: string[];
  availability: string[];
  options: string[];
}

export interface PageContext {
  url: string;
  title: string;
  visibleText: string;
  selectedText?: string;
  allText?: string;
  metaDescription?: string;
  productSignals?: ProductSignals;
  capturedAt?: string;
}

export interface UserProfile {
  targetLanguage?: string;
  nativeLanguage?: string;
  level?: "beginner" | "intermediate" | "advanced";
}

export interface QueryRequest {
  query: string;
  pageContext?: PageContext;
  userProfile?: UserProfile;
}

export interface Citation {
  id: string;
  title: string;
  source: string;
  sourceUrl?: string;
  publishedAt?: string;
  snippet: string;
  score?: number;
}

export interface QuizItem {
  id: string;
  word: string;
  sentence: string;
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
  difficulty: "beginner" | "intermediate" | "advanced";
}

export interface AgentResponse {
  route: AgentRoute;
  answer: string;
  citations?: Citation[];
  quizzes?: QuizItem[];
  vocabulary?: Array<{
    word: string;
    sentence: string;
    difficulty: string;
  }>;
  pageEvidence?: string[];
}

export interface RagDocument {
  id: string;
  title: string;
  source: string;
  sourceUrl?: string;
  publishedAt?: string;
  collectedAt: string;
  category: string;
  content: string;
}
