"use client";

import { useState } from "react";
import { CornerEditor } from "@/components/CornerEditor";
import { PhotoInput } from "@/components/PhotoInput";
import { type Quad, type SourceImage, defaultQuad, detectQuad, encodeJpeg, loadSource, warp } from "@/lib/warp";

type Props = {
  /** 答案用紙テンプレートの大きさ（同じ大きさにそろえて、見比べやすくする） */
  width: number;
  height: number;
  /** 登録済みの解答用紙の表示用URL */
  currentUrl?: string;
  onCapture: (blob: Blob) => void | Promise<void>;
  onRemove?: () => void;
};

/** 教員用の解答用紙（赤刷りなど）を撮影し、答案用紙と同じ大きさにまっすぐ補正する */
export const AnswerKeyCapture = ({ width, height, currentUrl, onCapture, onRemove }: Props) => {
  const [source, setSource] = useState<SourceImage | null>(null);
  const [quad, setQuad] = useState<Quad>(defaultQuad());
  const [auto, setAuto] = useState(false);

  const pick = async (f: File) => {
    if (source) URL.revokeObjectURL(source.url);
    const loaded = await loadSource(f);
    const detected = detectQuad(loaded.canvas);
    setSource(loaded);
    setQuad(detected ?? defaultQuad());
    setAuto(!!detected);
  };

  const done = async () => {
    if (!source) return;
    const { blob } = await encodeJpeg(warp(source.canvas, quad, width, height), 0.85);
    URL.revokeObjectURL(source.url);
    setSource(null);
    await onCapture(blob);
  };

  if (source)
    return (
      <div className="space-y-2">
        <div className="mx-auto max-w-md">
          <CornerEditor imageUrl={source.url} quad={quad} onChange={setQuad} />
        </div>
        <p className={`text-sm ${auto ? "text-ok" : "text-review"}`}>
          {auto ? "✓ 用紙の四すみを自動で見つけました。ずれていたら丸を動かしてください。" : "四すみを自動で見つけられませんでした。丸を動かして合わせてください。"}
        </p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={done}>
            まっすぐにして登録
          </button>
          <PhotoInput label="撮り直す" onPick={pick} className="btn-ghost" retake />
          <button
            className="btn-ghost"
            onClick={() => {
              URL.revokeObjectURL(source.url);
              setSource(null);
            }}
          >
            ← やめる
          </button>
        </div>
      </div>
    );

  return (
    <div className="flex flex-wrap items-center gap-3">
      {currentUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={currentUrl} alt="登録した解答用紙" className="h-28 rounded-lg border border-line object-contain" />
      )}
      <div className="flex flex-wrap gap-2">
        <PhotoInput label={currentUrl ? "撮り直す" : "解答用紙を撮影"} onPick={pick} className={currentUrl ? "btn-ghost text-sm" : "btn-primary text-sm"} retake={!!currentUrl} />
        {currentUrl && onRemove && (
          <button className="btn-ghost text-sm" onClick={onRemove}>
            登録を外す
          </button>
        )}
      </div>
    </div>
  );
};
