import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BookOpen,
  Check,
  Eraser,
  ExternalLink,
  GraduationCap,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Send,
  Settings,
  ShieldCheck,
  X
} from "lucide-react";
import { askAgent, generateQuiz, getHealth, getServerUrl, setServerUrl } from "./api";
import { collectPageContext } from "./pageContext";
import { clearVocabulary, getVocabulary, recordQuizAnswer } from "./storage";
import type { AgentResponse, PageContext, QuizItem, StoredVocab, UserProfile } from "./types";
import "./styles.css";

type View = "chat" | "quiz" | "vocab";
type ServerState = "checking" | "online" | "offline";

interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  route?: AgentResponse["route"];
  citations?: AgentResponse["citations"];
  evidence?: string[];
}

const routeLabels: Record<AgentResponse["route"], string> = {
  page: "페이지",
  rag: "직구 RAG",
  quiz: "퀴즈",
  mixed: "혼합"
};

const routeClassNames: Record<AgentResponse["route"], string> = {
  page: "route-page",
  rag: "route-rag",
  quiz: "route-quiz",
  mixed: "route-mixed"
};

const defaultProfile: UserProfile = {
  targetLanguage: "auto",
  nativeLanguage: "Korean",
  level: "intermediate"
};

function formatUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function insertAfterMessage(messages: ChatMessage[], targetId: string, message: ChatMessage): ChatMessage[] {
  const targetIndex = messages.findIndex((item) => item.id === targetId);
  if (targetIndex === -1) {
    return [message, ...messages];
  }

  return [
    ...messages.slice(0, targetIndex + 1),
    message,
    ...messages.slice(targetIndex + 1)
  ];
}

function App() {
  const [view, setView] = useState<View>("chat");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pageContext, setPageContext] = useState<PageContext | null>(null);
  const [serverState, setServerState] = useState<ServerState>("checking");
  const [serverHasOpenAi, setServerHasOpenAi] = useState(false);
  const [serverUrl, setServerUrlState] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [quizzes, setQuizzes] = useState<QuizItem[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [vocabulary, setVocabulary] = useState<StoredVocab[]>([]);
  const [profile, setProfile] = useState<UserProfile>(defaultProfile);

  const selectedText = pageContext?.selectedText?.trim();
  const pageSummary = useMemo(() => {
    if (!pageContext) {
      return "페이지 미수집";
    }

    return pageContext.title || formatUrl(pageContext.url);
  }, [pageContext]);

  async function refreshHealth() {
    setServerState("checking");
    try {
      const health = await getHealth();
      setServerState(health.ok ? "online" : "offline");
      setServerHasOpenAi(health.openai);
    } catch {
      setServerState("offline");
      setServerHasOpenAi(false);
    }
  }

  async function refreshPage() {
    setBusy(true);
    setStatusText("페이지 수집 중");
    try {
      const context = await collectPageContext();
      setPageContext(context);
      setStatusText("페이지 수집 완료");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "페이지 수집 실패");
    } finally {
      setBusy(false);
    }
  }

  async function sendQuery(
    queryText: string,
    options: { pageContextOverride?: PageContext } = {}
  ) {
    const trimmed = queryText.trim();
    if (!trimmed || busy) {
      return;
    }

    setBusy(true);
    setInput("");
    const userMessageId = makeId("user");
    setMessages((current) => [
      {
        id: userMessageId,
        role: "user",
        content: trimmed
      },
      ...current
    ]);

    try {
      const context = options.pageContextOverride || pageContext || await collectPageContext();
      setPageContext(context);
      const response = await askAgent(trimmed, context, profile);
      setMessages((current) => insertAfterMessage(
        current,
        userMessageId,
        {
          id: makeId("agent"),
          role: "agent",
          content: response.answer,
          route: response.route,
          citations: response.citations,
          evidence: response.pageEvidence
        }
      ));

      if (response.quizzes?.length) {
        setQuizzes(response.quizzes);
        setView("quiz");
      }
    } catch (error) {
      setMessages((current) => insertAfterMessage(
        current,
        userMessageId,
        {
          id: makeId("agent-error"),
          role: "agent",
          content: error instanceof Error ? error.message : "요청 처리 중 오류가 발생했습니다."
        }
      ));
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendQuery(input);
  }

  async function handleGenerateQuiz() {
    setBusy(true);
    setStatusText("퀴즈 생성 중");
    try {
      const context = pageContext || await collectPageContext();
      setPageContext(context);
      const response = await generateQuiz(context, profile);
      setQuizzes(response.quizzes || []);
      setAnswers({});
      setStatusText(response.answer);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "퀴즈 생성 실패");
    } finally {
      setBusy(false);
    }
  }

  async function handleSelectedTranslation() {
    if (busy) {
      return;
    }

    setStatusText("선택 텍스트 확인 중");

    try {
      const context = await collectPageContext();
      setPageContext(context);

      if (!context.selectedText?.trim()) {
        setStatusText("번역할 텍스트를 선택하세요");
        return;
      }

      await sendQuery("선택한 텍스트만 자연스럽게 한국어로 번역해줘.", {
        pageContextOverride: context
      });
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "선택 텍스트 확인 실패");
    }
  }

  async function handleAnswer(quiz: QuizItem, optionIndex: number) {
    if (answers[quiz.id] !== undefined) {
      return;
    }

    const correct = optionIndex === quiz.answerIndex;
    setAnswers((current) => ({ ...current, [quiz.id]: optionIndex }));
    const nextVocabulary = await recordQuizAnswer(quiz, correct);
    setVocabulary(nextVocabulary);
  }

  async function saveServerUrl() {
    await setServerUrl(serverUrl.trim() || "http://localhost:8787");
    await refreshHealth();
    setSettingsOpen(false);
  }

  async function clearVocab() {
    await clearVocabulary();
    setVocabulary([]);
  }

  useEffect(() => {
    getServerUrl().then(setServerUrlState);
    refreshHealth();
    getVocabulary().then(setVocabulary);
    refreshPage();
  }, []);

  const quickActions = [
    {
      label: "페이지 요약",
      icon: BookOpen,
      query: "이 페이지의 핵심 내용을 한국어로 요약해줘.",
      title: "현재 페이지 전체 요약"
    },
    {
      label: "선택 번역",
      icon: MessageSquareText,
      query: "",
      title: "선택한 텍스트만 번역",
      action: "selection"
    },
    {
      label: "직구 확인",
      icon: ShieldCheck,
      query: "이 상품이 제한 품목이나 인증 요건 대상인지 직구 문서 기준으로 짧게 판정해줘.",
      title: "제한 품목/인증 요건 판정"
    },
    {
      label: "단어 퀴즈",
      icon: GraduationCap,
      query: "",
      title: "현재 페이지 단어 퀴즈 생성",
      action: "quiz"
    }
  ];

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">왕</div>
          <div>
            <h1>직구의제왕</h1>
            <p>{pageSummary}</p>
          </div>
        </div>
        <div className="top-actions">
          <span className={`status-dot ${serverState}`} title={`서버: ${serverState}`} />
          <button className="icon-button" type="button" title="페이지 새로고침" onClick={refreshPage} disabled={busy}>
            {busy ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
          </button>
          <button className="icon-button" type="button" title="설정" onClick={() => setSettingsOpen((open) => !open)}>
            <Settings size={18} />
          </button>
        </div>
      </header>

      {settingsOpen && (
        <section className="settings-panel">
          <label htmlFor="server-url">Agent 서버</label>
          <div className="settings-row">
            <input
              id="server-url"
              value={serverUrl}
              onChange={(event) => setServerUrlState(event.target.value)}
              placeholder="http://localhost:8787"
            />
            <button type="button" onClick={saveServerUrl}>저장</button>
          </div>
          <div className="settings-row compact">
            <label htmlFor="level">학습 수준</label>
            <select
              id="level"
              value={profile.level}
              onChange={(event) => setProfile((current) => ({
                ...current,
                level: event.target.value as UserProfile["level"]
              }))}
            >
              <option value="beginner">초급</option>
              <option value="intermediate">중급</option>
              <option value="advanced">고급</option>
            </select>
          </div>
          <div className="settings-row compact">
            <label htmlFor="target-language">학습 언어</label>
            <select
              id="target-language"
              value={profile.targetLanguage}
              onChange={(event) => setProfile((current) => ({
                ...current,
                targetLanguage: event.target.value
              }))}
            >
              <option value="auto">자동</option>
              <option value="English">영어</option>
              <option value="Japanese">일본어</option>
              <option value="Chinese">중국어</option>
              <option value="Spanish">스페인어</option>
              <option value="French">프랑스어</option>
              <option value="German">독일어</option>
            </select>
          </div>
          <p className="server-note">{serverHasOpenAi ? "OpenAI 연결됨" : "기본 엔진 사용 중"}</p>
        </section>
      )}

      <nav className="tabs" aria-label="Agent views">
        <button type="button" className={view === "chat" ? "active" : ""} onClick={() => setView("chat")}>
          <MessageSquareText size={16} />
          채팅
        </button>
        <button type="button" className={view === "quiz" ? "active" : ""} onClick={() => setView("quiz")}>
          <GraduationCap size={16} />
          퀴즈
        </button>
        <button type="button" className={view === "vocab" ? "active" : ""} onClick={() => setView("vocab")}>
          <BookOpen size={16} />
          단어장
        </button>
      </nav>

      <section className="context-strip">
        <div>
          <span>{pageContext ? formatUrl(pageContext.url) : "활성 탭"}</span>
          <strong>{selectedText ? "선택 텍스트 있음" : `${pageContext?.visibleText.length || 0}자`}</strong>
        </div>
        <p>{statusText || (serverState === "offline" ? "서버 연결 필요" : "준비됨")}</p>
      </section>

      {view === "chat" && (
        <section className="chat-view">
          <form className="composer" onSubmit={handleSubmit}>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="질문 입력"
              rows={2}
            />
            <button type="submit" title="전송" disabled={busy || !input.trim()}>
              {busy ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
            </button>
          </form>

          <div className="quick-actions">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.label}
                  type="button"
                  title={action.title}
                  onClick={() => {
                    if (action.action === "selection") {
                      return handleSelectedTranslation();
                    }

                    if (action.action === "quiz") {
                      return handleGenerateQuiz().then(() => setView("quiz"));
                    }

                    return sendQuery(action.query);
                  }}
                  disabled={busy}
                >
                  <Icon size={16} />
                  {action.label}
                </button>
              );
            })}
          </div>

          <div className="messages">
            {messages.length === 0 && (
              <div className="empty-state">
                <MessageSquareText size={22} />
                <span>페이지 컨텍스트 대기 중</span>
              </div>
            )}

            {messages.map((message) => (
              <article key={message.id} className={`message ${message.role}`}>
                <div className="message-meta">
                  <span>{message.role === "user" ? "사용자" : "Agent"}</span>
                  {message.route && (
                    <span className={`route-badge ${routeClassNames[message.route]}`}>
                      {routeLabels[message.route]}
                    </span>
                  )}
                </div>
                <p>{message.content}</p>

                {message.citations?.length ? (
                  <div className="citations">
                    {message.citations.map((citation) => (
                      <a key={citation.id} href={citation.sourceUrl || "#"} target="_blank" rel="noreferrer">
                        <span>{citation.title}</span>
                        <ExternalLink size={13} />
                      </a>
                    ))}
                  </div>
                ) : null}

                {message.evidence?.length ? (
                  <details className="evidence">
                    <summary>페이지 근거</summary>
                    {message.evidence.map((item) => (
                      <p key={item}>{item}</p>
                    ))}
                  </details>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      )}

      {view === "quiz" && (
        <section className="quiz-view">
          <div className="quiz-toolbar">
            <button type="button" onClick={handleGenerateQuiz} disabled={busy}>
              {busy ? <Loader2 className="spin" size={16} /> : <GraduationCap size={16} />}
              생성
            </button>
            <span>{quizzes.length}문항</span>
          </div>

          <div className="quiz-list">
            {quizzes.length === 0 && (
              <div className="empty-state">
                <GraduationCap size={22} />
                <span>퀴즈 없음</span>
              </div>
            )}

            {quizzes.map((quiz, quizIndex) => {
              const chosen = answers[quiz.id];
              const solved = chosen !== undefined;

              return (
                <article key={quiz.id} className="quiz-card">
                  <div className="quiz-head">
                    <span>{quizIndex + 1}</span>
                    <strong>{quiz.word}</strong>
                    <em>{quiz.difficulty}</em>
                  </div>
                  <p className="sentence">{quiz.sentence}</p>
                  <h2>{quiz.question}</h2>
                  <div className="options">
                    {quiz.options.map((option, optionIndex) => {
                      const isCorrect = optionIndex === quiz.answerIndex;
                      const isChosen = chosen === optionIndex;
                      const className = solved
                        ? isCorrect
                          ? "correct"
                          : isChosen
                            ? "wrong"
                            : ""
                        : "";

                      return (
                        <button
                          key={option}
                          type="button"
                          className={className}
                          onClick={() => handleAnswer(quiz, optionIndex)}
                          disabled={solved}
                        >
                          <span>{optionIndex + 1}</span>
                          {option}
                          {solved && isCorrect && <Check size={15} />}
                          {solved && isChosen && !isCorrect && <X size={15} />}
                        </button>
                      );
                    })}
                  </div>
                  {solved && <p className="explanation">{quiz.explanation}</p>}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {view === "vocab" && (
        <section className="vocab-view">
          <div className="quiz-toolbar">
            <span>{vocabulary.length}개</span>
            <button type="button" onClick={clearVocab}>
              <Eraser size={16} />
              비우기
            </button>
          </div>
          <div className="vocab-list">
            {vocabulary.length === 0 && (
              <div className="empty-state">
                <BookOpen size={22} />
                <span>저장된 단어 없음</span>
              </div>
            )}

            {vocabulary.map((item) => (
              <article key={item.word} className="vocab-row">
                <div>
                  <strong>{item.word}</strong>
                  <p>{item.sentence}</p>
                </div>
                <div className="score">
                  <span className="ok">{item.correctCount}</span>
                  <span className="bad">{item.wrongCount}</span>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
