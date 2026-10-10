// 版の切り替え。公開版（AIなし）は、サーバーなしの静的なファイルとして書き出す。
// NEXT_PUBLIC_STATIC_EXPORT=1 でビルドすると公開版になる（package.json の build:static）。

/** 公開版（AIなし・サーバーなし）か */
export const STATIC_EDITION = process.env.NEXT_PUBLIC_STATIC_EXPORT === "1";

/** GitHub Pages などでサブフォルダに置くときのパス（例: "/edu-marutsuke"）。ふだんは空 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
