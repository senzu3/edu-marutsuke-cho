"use client";

import { useRef, useState } from "react";
import type { Point, Quad } from "@/lib/warp";

type Props = { imageUrl: string; quad: Quad; onChange: (quad: Quad) => void };

const LABELS = ["左上", "右上", "右下", "左下"];

/** 写真の上で、用紙の四隅に4つの丸を合わせてもらう */
export const CornerEditor = ({ imageUrl, quad, onChange }: Props) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  const toRatio = (e: React.PointerEvent): Point => {
    const r = boxRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };

  const move = (e: React.PointerEvent) => {
    if (dragging === null) return;
    const next = [...quad] as Quad;
    next[dragging] = toRatio(e);
    onChange(next);
  };

  const points = quad.map((p) => `${p.x * 100},${p.y * 100}`).join(" ");

  return (
    <div className="space-y-2">
      <div
        ref={boxRef}
        className="relative touch-none select-none overflow-hidden rounded-xl border border-line"
        onPointerMove={move}
        onPointerUp={(e) => {
          move(e);
          setDragging(null);
        }}
        onPointerCancel={() => setDragging(null)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="撮影した用紙" className="block w-full" draggable={false} />
        <svg className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polygon points={points} fill="rgba(47,93,138,0.12)" stroke="#2f5d8a" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
        </svg>
        {quad.map((p, i) => (
          <button
            key={i}
            type="button"
            aria-label={`${LABELS[i]}の角`}
            onPointerDown={(e) => {
              setDragging(i);
              e.currentTarget.parentElement?.setPointerCapture?.(e.pointerId);
            }}
            className={`absolute grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[3px] border-white shadow-lg ${dragging === i ? "bg-pen" : "bg-accent"}`}
            style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
          >
            <span className="size-1.5 rounded-full bg-white" />
          </button>
        ))}
      </div>
      <p className="text-sm text-muted">4つの青い丸を、用紙の四すみに合わせてください。ななめに撮った写真もまっすぐに直します。</p>
    </div>
  );
};
