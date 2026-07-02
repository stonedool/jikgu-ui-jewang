import type { AgentResponse, PageContext, UserProfile } from "./types";

export const DEFAULT_SERVER_URL = "https://jikgu-ui-jewang-production.up.railway.app";

export async function getServerUrl(): Promise<string> {
  const result = await chrome.storage.local.get("serverUrl");
  return result.serverUrl || DEFAULT_SERVER_URL;
}

export async function setServerUrl(serverUrl: string): Promise<void> {
  await chrome.storage.local.set({ serverUrl });
}

async function requestJson<T>(path: string, body?: unknown): Promise<T> {
  const baseUrl = await getServerUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    throw new Error(`API ${response.status}: ${await response.text()}`);
  }

  return response.json() as Promise<T>;
}

export async function askAgent(
  query: string,
  pageContext: PageContext | null,
  userProfile: UserProfile
): Promise<AgentResponse> {
  return requestJson<AgentResponse>("/api/query", {
    query,
    pageContext,
    userProfile
  });
}

export async function generateQuiz(
  pageContext: PageContext | null,
  userProfile: UserProfile
): Promise<AgentResponse> {
  return requestJson<AgentResponse>("/api/quiz", {
    pageContext,
    userProfile
  });
}

export async function getHealth(): Promise<{ ok: boolean; openai: boolean; now: string }> {
  return requestJson<{ ok: boolean; openai: boolean; now: string }>("/api/health");
}
