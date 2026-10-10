"use client";

import type { ResultItem } from "@/lib/db";
import { type Verdict, askPartial } from "@/lib/grading";

type Props = {
  /** 現在の判定（まとめて判定するボタンでは省略） */
  item?: ResultItem;
  points: number;
  /** △（部分点）を出すか。記述・ことば・式の問題で使う */
  allowPartial: boolean;
  onVerdict: (v: Verdict) => void;
  size?: "sm" | "md";
};

/** ○ △ ✕ の判定ボタン */
export const JudgeButtons = ({ item, points, allowPartial, onVerdict, size = "md" }: Props) => {
  const decided = item && !item.needsReview;
  const isPartial = decided && item.earned !== undefined;
  const sz = size === "sm" ? "size-9" : "size-10";
  const cls = (on: boolean, onCls: string) => `${sz} shrink-0 rounded-full border-2 font-bold ${on ? onCls : "border-line bg-white"}`;

  return (
    <div className="flex shrink-0 gap-1.5">
      <button onClick={() => onVerdict({ correct: true })} className={cls(!!decided && item.correct, "border-pen bg-pen text-white")} aria-label="正解">
        ○
      </button>
      {allowPartial && (
        <button
          onClick={() => {
            const earned = askPartial(points, item?.earned);
            if (earned !== null) onVerdict({ correct: false, earned });
          }}
          className={`${cls(!!isPartial, "border-pen bg-pen/10 text-pen")} ${isPartial ? "w-auto px-2 text-xs" : ""}`}
          aria-label="部分点"
        >
          {isPartial ? `△${item.earned}` : "△"}
        </button>
      )}
      <button
        onClick={() => onVerdict({ correct: false })}
        className={cls(!!decided && !item.correct && !isPartial, "border-ink bg-ink text-white")}
        aria-label="不正解"
      >
        ✕
      </button>
    </div>
  );
};
