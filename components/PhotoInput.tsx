"use client";

type Props = {
  /** カメラのボタンの文字 */
  label: string;
  onPick: (file: File) => void;
  /** カメラのボタンの見た目（写真を選ぶボタンは、同じ大きさの控えめな見た目になる） */
  className?: string;
  /** 撮り直しのとき（写真を選ぶボタンが「選び直す」になる） */
  retake?: boolean;
  /** 2つのボタンを並べる枠の見た目 */
  wrapClassName?: string;
};

const FileButton = ({ text, capture, onPick, className }: { text: string; capture: boolean; onPick: (file: File) => void; className: string }) => (
  <label className={`${className} cursor-pointer`}>
    {text}
    <input
      type="file"
      accept="image/*"
      {...(capture ? { capture: "environment" as const } : {})}
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (file) onPick(file);
      }}
    />
  </label>
);

/**
 * 写真を撮る・選ぶボタン。
 * 「撮る」はiPad/スマホでカメラが直接起動し、「写真から選ぶ」は写真アプリ（既存の写真）やファイルから選べる
 */
export const PhotoInput = ({ label, onPick, className = "btn-primary", retake = false, wrapClassName = "" }: Props) => (
  <span className={`inline-flex flex-wrap gap-2 ${wrapClassName}`}>
    <FileButton text={`📷 ${label}`} capture onPick={onPick} className={className} />
    <FileButton
      text={retake ? "🖼 写真を選び直す" : "🖼 写真から選ぶ"}
      capture={false}
      onPick={onPick}
      className={className.replace(/\bbtn-(primary|pen)\b/, "btn-ghost")}
    />
  </span>
);
