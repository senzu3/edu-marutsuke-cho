"use client";

import { useRef, useState } from "react";
import type { Rect } from "@/lib/db";

export type LabeledRect = { rect: Rect; label?: string; kind: "mask" | "box" | "active" };

type Props = {
  imageUrl: string;
  rects: LabeledRect[];
  /** null のときは描画できない（表示のみ） */
  onDraw: ((rect: Rect) => void) | null;
  onSelect?: (label: string) => void;
};

const STYLE: Record<LabeledRect["kind"], string> = {
  mask: "bg-black border-2 border-pen",
  box: "border-2 border-accent bg-accent/10",
  active: "border-[3px] border-pen bg-pen/15",
};

/** 画像の上を指（マウス）でドラッグして四角を描く。名前欄の黒塗りと解答欄の指定に使う */
export const RectEditor = ({ imageUrl, rects, onDraw, onSelect }: Props) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ sx: number; sy: number; x: number; y: number } | null>(null);

  const toRatio = (e: React.PointerEvent) => {
    const r = boxRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };

  const toRect = (d: { sx: number; sy: number; x: number; y: number }): Rect => ({
    x: Math.min(d.sx, d.x),
    y: Math.min(d.sy, d.y),
    w: Math.abs(d.x - d.sx),
    h: Math.abs(d.y - d.sy),
  });

  const onDown = (e: React.PointerEvent) => {
    if (!onDraw) return;
    const p = toRatio(e);
    setDraft({ sx: p.x, sy: p.y, ...p });
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onMove = (e: React.PointerEvent) => {
    if (draft) setDraft({ ...draft, ...toRatio(e) });
  };

  const onUp = (e: React.PointerEvent) => {
    if (!draft || !onDraw) return;
    const rect = toRect({ ...draft, ...toRatio(e) });
    setDraft(null);
    if (rect.w > 0.015 && rect.h > 0.01) onDraw(rect);
  };

  return (
    <div
      ref={boxRef}
      className={`relative touch-none select-none overflow-hidden rounded-xl border border-line ${onDraw ? "cursor-crosshair" : ""}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => setDraft(null)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt="答案用紙" className="block w-full" draggable={false} />
      {rects.map((r, i) => (
        <div
          key={i}
          className={`absolute ${STYLE[r.kind]}`}
          style={{ left: `${r.rect.x * 100}%`, top: `${r.rect.y * 100}%`, width: `${r.rect.w * 100}%`, height: `${r.rect.h * 100}%` }}
        >
          {r.label && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onSelect?.(r.label!)}
              className={`absolute -top-0.5 left-0 -translate-y-full rounded px-1.5 text-xs font-bold text-white ${r.kind === "active" ? "bg-pen" : "bg-accent"}`}
            >
              {r.label}
            </button>
          )}
        </div>
      ))}
      {draft && (
        <div
          className="absolute border-2 border-dashed border-pen bg-pen/10"
          style={{
            left: `${toRect(draft).x * 100}%`,
            top: `${toRect(draft).y * 100}%`,
            width: `${toRect(draft).w * 100}%`,
            height: `${toRect(draft).h * 100}%`,
          }}
        />
      )}
    </div>
  );
};
