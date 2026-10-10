import type { MetadataRoute } from "next";
import { BASE_PATH } from "@/lib/edition";

// 公開版（静的な書き出し）でも作れるように
export const dynamic = "force-static";

const manifest = (): MetadataRoute.Manifest => ({
  name: "まるつけ帳",
  short_name: "まるつけ帳",
  start_url: `${BASE_PATH}/`,
  display: "standalone",
  background_color: "#fbf8f1",
  theme_color: "#fbf8f1",
  icons: [{ src: `${BASE_PATH}/icon.svg`, sizes: "any", type: "image/svg+xml" }],
});

export default manifest;
