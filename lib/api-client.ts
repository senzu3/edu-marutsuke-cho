import { type Kanten, type ModelId, type Rect, getSetting } from "./db";
import { STATIC_EDITION } from "./edition";
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

/** 公開版：先生が自分で入れたAPIキー（この端末にだけ保存）。なければAIは使えない */
const ownKey = async () => {
  const key = await getSetting("apiKey", "");
  if (!key) throw new Error("APIキーが登録されていません。「名簿・設定」で登録してください。");
  return key;
};

/** 模範解答（名前欄は黒塗り済み）から問題・正答・解答欄の位置を読み取る */
export const requestExtractKey = async (image: string, model: ModelId, subject: Subject): Promise<ExtractedKey> => {
  if (!STATIC_EDITION) return post<ExtractedKey>("/api/extract-key", { image, model, subject });
  const { extractKeyDirect } = await import("./ai-browser");
  return extractKeyDirect(await ownKey(), image, model, subject);
};

/** 送るのは「解答欄の切り出し画像」と「答えの形のヒント」だけ。氏名・出席番号・答案全体・正答は送らない */
export const requestGrade = async (items: GradeRequestItem[], model: ModelId, subject: Subject): Promise<GradeResponse> => {
  if (!STATIC_EDITION) return post<GradeResponse>("/api/grade", { items, model, subject });
  const { transcribeDirect } = await import("./ai-browser");
  return transcribeDirect(await ownKey(), items, model, subject);
};
