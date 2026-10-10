"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { DEFAULT_ABC, type AbcThresholds } from "./analytics";
import { MODELS, type ModelId, db } from "./db";
import { STATIC_EDITION } from "./edition";

export const useModel = (): ModelId => {
  const value = useLiveQuery(() => db.settings.get("model"))?.value;
  return MODELS.some((m) => m.id === value) ? (value as ModelId) : MODELS[0].id;
};

export const useKeepImages = () => useLiveQuery(() => db.settings.get("keepImages"))?.value === "true";

/** サーバーでAIが使えるか（APIキーが設定されているか）。確認中は null */
export const useAiAvailable = () => {
  // 公開版（AIなし）はサーバーがないので、問い合わせずに「AIなし」
  const [available, setAvailable] = useState<boolean | null>(STATIC_EDITION ? false : null);
  useEffect(() => {
    if (STATIC_EDITION) return;
    fetch("/api/status")
      .then((r) => r.json())
      .then((j) => setAvailable(!!j.aiAvailable))
      .catch(() => setAvailable(false));
  }, []);
  return available;
};

export type GradingMode = "ai" | "manual";

/**
 * 採点のしかた。設定画面で選んだもの。未設定なら、AIが使えればAI、使えなければAIなし。
 * AIを選んでいてもキーがなければAIなしになる。確認中は null
 */
export const useGradingMode = (): { mode: GradingMode | null; aiAvailable: boolean | null } => {
  const aiAvailable = useAiAvailable();
  const setting = useLiveQuery(async () => (await db.settings.get("mode"))?.value ?? "", []);
  if (aiAvailable === null || setting === undefined) return { mode: null, aiAvailable };
  return { mode: aiAvailable && setting !== "manual" ? "ai" : "manual", aiAvailable };
};

/** A・B・C の目安の基準（設定画面で変更できる） */
export const useAbc = (): AbcThresholds => {
  const a = useLiveQuery(() => db.settings.get("abcA"))?.value;
  const c = useLiveQuery(() => db.settings.get("abcC"))?.value;
  return { a: a ? Number(a) : DEFAULT_ABC.a, c: c ? Number(c) : DEFAULT_ABC.c };
};
