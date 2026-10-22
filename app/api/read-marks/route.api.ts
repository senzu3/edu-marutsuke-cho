import { GradeRequest, readMarks, toUserError } from "@/lib/ai";

// 中継のみ：受け取った画像はメモリ上で使うだけで、保存もログ出力もしない。
// 採点済みの答案の「解答欄のまわりの切り出し画像」から、先生が付けた印（○✕△）を読み取る。
export const POST = async (req: Request) => {
  const parsed = GradeRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "リクエストの形式が正しくありません" }, { status: 400 });

  try {
    return Response.json(await readMarks(parsed.data.items, parsed.data.model, parsed.data.subject));
  } catch (e) {
    const { status, message } = toUserError(e);
    return Response.json({ error: message }, { status });
  }
};
