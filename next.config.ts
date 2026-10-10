import type { NextConfig } from "next";

// 公開版（AIなし）は、サーバーなしで動く静的なファイル（.next-static/）として書き出す。
// APIの中継（app/api/*/route.api.ts）は公開版には含めない。
const isStatic = process.env.NEXT_PUBLIC_STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  // iPad等から同じWi-Fi経由でアクセスするため
  allowedDevOrigins: ["*.local", "192.168.*.*", "10.*.*.*"],
  // route.api.ts はAIを使う版（Macで起動する版）でだけ有効にする
  pageExtensions: isStatic ? ["tsx", "ts"] : ["tsx", "ts", "api.ts"],
  ...(isStatic
    ? {
        output: "export",
        // 起動中の開発サーバー（.next）とぶつからないように別のフォルダを使う。書き出し先もこのフォルダ（.next-static/）
        distDir: ".next-static",
        trailingSlash: true,
        basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
      }
    : {}),
};

export default nextConfig;
