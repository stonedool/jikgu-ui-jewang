import "./config/env.js";
import cors from "cors";
import express from "express";
import { z } from "zod";
import { answerPageQuestion, extractPageFacts } from "./agents/pageUnderstanding.js";
import { answerRagQuestion, addRagDocument, listRagDocuments } from "./agents/rag.js";
import { generateQuiz } from "./agents/quiz.js";
import { classifyQuery } from "./agents/router.js";
import type { AgentResponse, RagDocument } from "./types.js";

const app = express();
const port = Number(process.env.PORT || 8787);

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "2mb" }));

const ProductSignalsSchema = z.object({
  names: z.array(z.string()).default([]),
  prices: z.array(z.string()).default([]),
  availability: z.array(z.string()).default([]),
  options: z.array(z.string()).default([])
});

const PageContextSchema = z.object({
  url: z.string().default(""),
  title: z.string().default(""),
  visibleText: z.string().default(""),
  selectedText: z.string().optional(),
  allText: z.string().optional(),
  metaDescription: z.string().optional(),
  productSignals: ProductSignalsSchema.optional(),
  capturedAt: z.string().optional()
});

const QuerySchema = z.object({
  query: z.string().min(1),
  pageContext: PageContextSchema.optional(),
  userProfile: z.object({
    targetLanguage: z.string().optional(),
    nativeLanguage: z.string().optional(),
    level: z.enum(["beginner", "intermediate", "advanced"]).optional()
  }).optional()
});

const RagDocumentSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  source: z.string().min(1),
  sourceUrl: z.string().optional(),
  publishedAt: z.string().optional(),
  collectedAt: z.string().min(1),
  category: z.string().min(1),
  content: z.string().min(20)
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    openai: Boolean(process.env.OPENAI_API_KEY),
    now: new Date().toISOString()
  });
});

app.post("/api/query", async (req, res, next) => {
  try {
    const payload = QuerySchema.parse(req.body);
    const route = classifyQuery(payload.query, payload.pageContext);
    let response: AgentResponse;

    if (route === "page") {
      response = await answerPageQuestion(payload.query, payload.pageContext);
    } else if (route === "rag") {
      response = await answerRagQuestion(payload.query);
    } else if (route === "quiz") {
      response = await generateQuiz(payload.pageContext, payload.userProfile);
    } else {
      const pageFacts = extractPageFacts(payload.pageContext);
      const ragResponse = await answerRagQuestion(payload.query, pageFacts);
      response = {
        ...ragResponse,
        route: "mixed",
        answer: ragResponse.answer
      };
    }

    res.json(response);
  } catch (error) {
    next(error);
  }
});

app.post("/api/quiz", async (req, res, next) => {
  try {
    const payload = QuerySchema.pick({ pageContext: true, userProfile: true }).parse(req.body);
    const response = await generateQuiz(payload.pageContext, payload.userProfile);
    res.json(response);
  } catch (error) {
    next(error);
  }
});

app.get("/api/rag/documents", async (_req, res, next) => {
  try {
    const documents = await listRagDocuments();
    res.json({ documents });
  } catch (error) {
    next(error);
  }
});

app.post("/api/rag/documents", async (req, res, next) => {
  try {
    const document = RagDocumentSchema.parse(req.body) as RagDocument;
    const saved = await addRagDocument(document);
    res.status(201).json({ document: saved });
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({
      error: "Invalid request",
      issues: error.issues
    });
    return;
  }

  console.error(error);
  res.status(500).json({
    error: "Internal server error"
  });
});

app.listen(port, () => {
  console.log(`Agent server listening on http://localhost:${port}`);
});
