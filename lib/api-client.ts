import type { Kanten, ModelId, Rect } from "./db";
import type { Transcription } from "./judge";
import type { Subject } from "./subjects";

export type ExtractedKey = {
  title: string;
  questions: { no: string; answer: string; tag: string; kanten: Kanten | ""; points: number; box: Rect | null }[];
};

export type GradeResponse = { answers: Transcription[] };

export type GradeRequestItem = { no: string; image: string; hint: string };

const post = async <T>(path: string, body: unknown): Promise<T> => {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ error: "サーバーから正しい応答がありませんでした" }));
  if (!res.ok) throw new Error(json.error ?? "エラーが発生しました");
  return json as T;
};

/** 模範解答（名前欄は黒塗り済み）から問題・正答・解答欄の位置を読み取る */
export const requestExtractKey = (image: string, model: ModelId, subject: Subject) =>
  post<ExtractedKey>("/api/extract-key", { image, model, subject });

/** 送るのは「解答欄の切り出し画像」と「答えの形のヒント」だけ。氏名・出席番号・答案全体・正答は送らない */
export const requestGrade = (items: GradeRequestItem[], model: ModelId, subject: Subject) =>
  post<GradeResponse>("/api/grade", { items, model, subject });
