// 公開版で、先生が自分のAPIキーを入れたときだけ使う。ブラウザから直接 Anthropic社のAPIを呼ぶ（間にサーバーは入らない）。
// 送る内容はサーバー版と同じ（名前欄を塗りつぶした画像・切り出した解答欄・答えの形のヒントのみ）。
import Anthropic from "@anthropic-ai/sdk";
import { ExtractRequest, GradeRequest, MarksRequest, type GradeItem, type ModelId, runExtractKey, runReadMarks, runTranscribe, toUserError } from "./ai-core";
import type { Subject } from "./subjects";

const KEY_HINT = "「名簿・設定」のAPIキーを確認";

const clientFor = (apiKey: string) =>
  // キーは先生自身のもので、この端末のブラウザにだけ保存している。ブラウザから直接呼ぶための指定
  new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });

const run = async <T>(task: () => Promise<T>) => {
  try {
    return await task();
  } catch (e) {
    throw new Error(toUserError(e, KEY_HINT).message);
  }
};

export const extractKeyDirect = (apiKey: string, image: string, model: ModelId, subject: Subject) => {
  // サーバー版と同じ形のチェック（余計な項目は送らない）
  const req = ExtractRequest.parse({ image, model, subject });
  return run(() => runExtractKey(clientFor(apiKey), req.image, req.model, req.subject));
};

export const transcribeDirect = (apiKey: string, items: GradeItem[], model: ModelId, subject: Subject) => {
  const req = GradeRequest.parse({ items, model, subject });
  return run(() => runTranscribe(clientFor(apiKey), req.items, req.model, req.subject));
};

export const readMarksDirect = (apiKey: string, items: GradeItem[], model: ModelId, subject: Subject, scoreImage?: string) => {
  const req = MarksRequest.parse({ items, model, subject, ...(scoreImage ? { scoreImage } : {}) });
  return run(() => runReadMarks(clientFor(apiKey), req.items, req.model, req.subject, req.scoreImage));
};

/** キーが使えるかを確かめる（モデルの一覧を取るだけで、画像は送らず、費用もかからない） */
export const checkKey = (apiKey: string) => run(() => clientFor(apiKey).models.list({ limit: 1 }).then(() => true));
