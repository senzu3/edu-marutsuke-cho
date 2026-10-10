"use client";

type Props = { label: string; onPick: (file: File) => void; className?: string };

/** スマホ/iPadではカメラが起動し、PCではファイル選択になる */
export const PhotoInput = ({ label, onPick, className = "btn-primary" }: Props) => (
  <label className={`${className} cursor-pointer`}>
    📷 {label}
    <input
      type="file"
      accept="image/*"
      capture="environment"
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (file) onPick(file);
      }}
    />
  </label>
);
