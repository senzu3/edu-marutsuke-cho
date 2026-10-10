import { aiAvailable } from "@/lib/ai";

export const dynamic = "force-dynamic";

// AIが使えるかどうかだけを返す（APIキーの中身は返さない）
export const GET = () => Response.json({ aiAvailable: aiAvailable() });
