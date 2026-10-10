"use client";

import { useEffect, useState } from "react";
import { type Side, type Test, sideOf } from "./db";
import { blobToCanvas, cropBox } from "./warp";

export type AnswerKeyView = {
  /** 面ごとの解答用紙全体の表示用URL */
  sheets: Partial<Record<Side, string>>;
  /** 問題ごとの、解答用紙から切り出した解答欄の表示用URL */
  crops: Map<string, string>;
};

const EMPTY: AnswerKeyView = { sheets: {}, crops: new Map() };

/** 教員用の解答用紙を、画面に表示するためのURLにする（問題ごとの切り出しも作る）。画面を離れたら解放する */
export const useAnswerKey = (test: Test | undefined): AnswerKeyView => {
  const [view, setView] = useState<AnswerKeyView>(EMPTY);
  const keys = test?.answerKeys;
  const questions = test?.questions;

  useEffect(() => {
    if (!keys || !questions) return setView(EMPTY);
    let cancelled = false;
    const urls: string[] = [];
    (async () => {
      const sheets: AnswerKeyView["sheets"] = {};
      const crops = new Map<string, string>();
      for (const [side, blob] of Object.entries(keys) as [Side, Blob][]) {
        const url = URL.createObjectURL(blob);
        urls.push(url);
        sheets[side] = url;
        const canvas = await blobToCanvas(blob);
        for (const q of questions.filter((x) => sideOf(x) === side && x.box)) {
          const c = cropBox(canvas, q.box!);
          const b = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.85));
          if (!b) continue;
          const u = URL.createObjectURL(b);
          urls.push(u);
          crops.set(q.no, u);
        }
      }
      if (!cancelled) setView({ sheets, crops });
    })();
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [keys, questions]);

  return view;
};
