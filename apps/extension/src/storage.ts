import type { QuizItem, StoredVocab } from "./types";

const VOCAB_KEY = "vocabulary";

export async function getVocabulary(): Promise<StoredVocab[]> {
  const result = await chrome.storage.local.get(VOCAB_KEY);
  return result[VOCAB_KEY] || [];
}

export async function recordQuizAnswer(quiz: QuizItem, correct: boolean): Promise<StoredVocab[]> {
  const vocabulary = await getVocabulary();
  const existing = vocabulary.find((item) => item.word === quiz.word);
  const nextItem: StoredVocab = {
    word: quiz.word,
    sentence: quiz.sentence,
    difficulty: quiz.difficulty,
    correctCount: (existing?.correctCount || 0) + (correct ? 1 : 0),
    wrongCount: (existing?.wrongCount || 0) + (correct ? 0 : 1),
    lastReviewedAt: new Date().toISOString()
  };

  const nextVocabulary = [
    nextItem,
    ...vocabulary.filter((item) => item.word !== quiz.word)
  ].slice(0, 200);

  await chrome.storage.local.set({ [VOCAB_KEY]: nextVocabulary });
  return nextVocabulary;
}

export async function clearVocabulary(): Promise<void> {
  await chrome.storage.local.set({ [VOCAB_KEY]: [] });
}
