import OpenAI from "openai";

let client: OpenAI | null = null;

export function hasOpenAi(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function getOpenAiClient(): OpenAI | null {
  if (!hasOpenAi()) {
    return null;
  }

  client ??= new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  return client;
}

export function getModel(): string {
  return process.env.OPENAI_MODEL || "gpt-4.1-mini";
}

export async function chatText(system: string, user: string): Promise<string | null> {
  const openai = getOpenAiClient();
  if (!openai) {
    return null;
  }

  try {
    const response = await openai.chat.completions.create({
      model: getModel(),
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    });

    return response.choices[0]?.message.content?.trim() || null;
  } catch (error) {
    console.warn("OpenAI chatText failed; falling back to local response.", error);
    return null;
  }
}

export async function chatJson<T>(system: string, user: string): Promise<T | null> {
  const openai = getOpenAiClient();
  if (!openai) {
    return null;
  }

  try {
    const response = await openai.chat.completions.create({
      model: getModel(),
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    });

    const content = response.choices[0]?.message.content;
    if (!content) {
      return null;
    }

    return JSON.parse(content) as T;
  } catch (error) {
    console.warn("OpenAI chatJson failed; falling back to local response.", error);
    return null;
  }
}
