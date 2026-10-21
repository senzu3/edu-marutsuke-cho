"use client";

import { useEffect, useRef } from "react";
import { type Draft, db } from "./db";

// 作業の途中の状態を端末内に保存し、アプリを閉じても続きから再開できるようにする

export const gradeDraftKey = (testId: number) => `grade:${testId}`;
export const NEW_TEST_DRAFT_KEY = "newTest";

export const loadDraft = async <T,>(key: string) => (await db.drafts.get(key))?.data as T | undefined;

export const clearDraft = (key: string) => db.drafts.delete(key);

/**
 * value が変わるたびに、少し待ってから保存する（null のときは保存しない）。
 * enabled が false のあいだ（復元が終わる前など）は何もしない
 */
export const useAutoSaveDraft = (key: string, meta: Omit<Draft, "key" | "updatedAt" | "data"> | null, value: unknown, enabled: boolean) => {
  const latest = useRef({ meta, value });
  latest.current = { meta, value };
  useEffect(() => {
    if (!enabled || !meta || value === null) return;
    const timer = setTimeout(() => {
      const { meta: m, value: v } = latest.current;
      if (m && v !== null) db.drafts.put({ key, ...m, updatedAt: Date.now(), data: v });
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, value, meta?.label]);
};
