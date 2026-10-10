import { GradeRequest, toUserError, transcribeAnswers } from "@/lib/ai";

// 中継のみ：受け取った画像はメモリ上で使うだけで、保存もログ出力もしない。
// 送られてくるのは「解答欄の切り出し画像」と「答えの形のヒント」だけ。
// 氏名・出席番号・答案全体・正答は受け付けない（GradeRequest は .strict() で余計な項目を拒否）。
export const POST = async (req: Request) => {
  const parsed = GradeRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "リクエストの形式が正しくありません" }, { status: 400 });

  try {
    return Response.json(await transcribeAnswers(parsed.data.items, parsed.data.model, parsed.data.subject));
  } catch (e) {
    const { status, message } = toUserError(e);
    return Response.json({ error: message }, { status });
  }
};
