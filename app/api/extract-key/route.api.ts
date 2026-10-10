import { ExtractRequest, extractKey, toUserError } from "@/lib/ai";

// 中継のみ：受け取った画像はメモリ上で使うだけで、保存もログ出力もしない。
export const POST = async (req: Request) => {
  const parsed = ExtractRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "リクエストの形式が正しくありません" }, { status: 400 });

  try {
    const result = await extractKey(parsed.data.image, parsed.data.model, parsed.data.subject);
    return Response.json(result);
  } catch (e) {
    const { status, message } = toUserError(e);
    return Response.json({ error: message }, { status });
  }
};
