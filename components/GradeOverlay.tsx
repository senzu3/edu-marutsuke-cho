"use client";

import type { ResultItem } from "@/lib/db";

type Props = {
  imageUrl: string;
  items: ResultItem[];
  onToggle: (no: string) => void;
};

const Mark = ({ item }: { item: ResultItem }) => {
  if (item.needsReview)
    return (
      <span className="grid size-full place-items-center rounded-full border-[0.6cqw] border-review bg-review/15 font-bold text-review" style={{ fontSize: "3.6cqw" }}>
        ?
      </span>
    );
  if (item.correct) return <span className="block size-full rounded-full border-[0.7cqw] border-pen" />;
  if (item.earned !== undefined)
    return (
      <span className="grid size-full place-items-center font-bold leading-none text-pen" style={{ fontSize: "7cqw" }}>
        △
      </span>
    );
  return (
    <span className="grid size-full place-items-center font-bold leading-none text-pen" style={{ fontSize: "7cqw" }}>
      ✕
    </span>
  );
};

/** 答案画像の上に ○ ✕ ？ を重ねて表示。タップで正誤を切り替えられる */
export const GradeOverlay = ({ imageUrl, items, onToggle }: Props) => (
  <div className="relative overflow-hidden rounded-xl border border-line" style={{ containerType: "inline-size" }}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={imageUrl} alt="採点中の答案（名前欄は黒塗り済み）" className="block w-full" />
    {items
      .filter((i) => i.x !== null && i.y !== null)
      .map((i) => (
        <button
          key={i.no}
          type="button"
          onClick={() => onToggle(i.no)}
          aria-label={`${i.no} を${i.correct ? "不正解" : "正解"}にする`}
          className="absolute -translate-x-1/2 -translate-y-1/2 opacity-90 transition hover:scale-110"
          style={{ left: `${i.x! * 100}%`, top: `${i.y! * 100}%`, width: "8cqw", height: "8cqw" }}
        >
          <Mark item={i} />
        </button>
      ))}
  </div>
);
