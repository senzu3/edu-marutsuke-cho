"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { type Result, type ResultItem, db } from "@/lib/db";
import { JudgeButtons } from "@/components/JudgeButtons";
import { type Verdict, isManual, isUnjudged, judgeItem } from "@/lib/grading";
import { allowsPartial, needsImage, normalize } from "@/lib/judge";
import { useAnswerKey } from "@/lib/answer-key";

type Mode = "review" | "question";

const manualGroup = (item: ResultItem) =>
  item.needsReview ? "\u0000u" : item.correct ? "\u0000o" : item.earned !== undefined ? "\u0000p" : "\u0000x";
const MANUAL_LABELS: Record<string, string> = {
  "\u0000u": "未判定（画像を見て○✕）",
  "\u0000o": "○にした答え",
  "\u0000p": "△（部分点）にした答え",
  "\u0000x": "✕にした答え",
};
type Entry = { result: Result; item: ResultItem; name: string };

const StatusMark = ({ item }: { item: ResultItem }) =>
  item.needsReview ? (
    <span className="grid size-7 place-items-center rounded-full border-2 border-review font-bold text-review">?</span>
  ) : item.correct ? (
    <span className="size-7 rounded-full border-[3px] border-pen" />
  ) : item.earned !== undefined ? (
    <span className="grid h-7 place-items-center px-0.5 text-sm font-bold text-pen">△{item.earned}</span>
  ) : (
    <span className="grid size-7 place-items-center text-xl font-bold text-pen">✕</span>
  );

const Review = () => {
  const testId = Number(useSearchParams().get("id"));
  const test = useLiveQuery(() => db.tests.get(testId), [testId]);
  const students = useLiveQuery(() => db.students.toArray());
  const results = useLiveQuery(() => db.results.where("testId").equals(testId).toArray(), [testId]);
  const crops = useLiveQuery(() => db.crops.where("testId").equals(testId).toArray(), [testId]);
  const [mode, setMode] = useState<Mode>("review");
  const [questionNo, setQuestionNo] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const answerKey = useAnswerKey(test);

  // 切り出し画像の表示用URL（画面を離れたら解放）
  const cropUrls = useMemo(() => new Map((crops ?? []).map((c) => [`${c.studentNo}|${c.no}`, URL.createObjectURL(c.blob)])), [crops]);
  useEffect(() => () => cropUrls.forEach((u) => URL.revokeObjectURL(u)), [cropUrls]);

  if (!test || !students || !results || !crops) return <p className="text-muted">読み込み中…</p>;

  const nameOf = (no: number) => students.find((s) => s.no === no)?.name ?? "";
  const answerOf = (no: string) => test.questions.find((q) => q.no === no);
  const entries: Entry[] = results
    .sort((a, b) => a.studentNo - b.studentNo)
    .flatMap((r) => r.items.map((item) => ({ result: r, item, name: nameOf(r.studentNo) })));
  const pending = entries.filter((e) => e.item.needsReview);
  const selectedNo = questionNo ?? test.questions[0]?.no;

  const questionOf = (no: string) => test.questions.find((q) => q.no === no);
  const pointsOf = (no: string) => questionOf(no)?.points ?? 1;
  const allowPartial = (no: string) => allowsPartial(questionOf(no)?.format);

  const judge = async (entry: Entry, v: Verdict) => {
    const resolved = await judgeItem(entry.result.id!, entry.item.no, v);
    const learnable = v.correct && !entry.item.correct && !!entry.item.studentAnswer && !["essay", "kanji"].includes(questionOf(entry.item.no)?.format ?? "");
    setToast(
      resolved > 0
        ? `「${entry.item.studentAnswer}」を ${entry.item.no} の別解として登録し、同じ答えの ${resolved}件も○にしました`
        : learnable
          ? `「${entry.item.studentAnswer}」を ${entry.item.no} の別解として覚えました`
          : "",
    );
  };

  const renderCrop = (entry: Entry) => {
    const url = cropUrls.get(`${entry.result.studentNo}|${entry.item.no}`);
    return url ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt={`${entry.result.studentNo}番の${entry.item.no}の解答欄`} className={`${needsImage(questionOf(entry.item.no)?.format) ? "max-h-48" : "max-h-28"} w-full rounded-lg border border-line bg-white object-contain`} />
    ) : (
      <div className="grid h-20 place-items-center rounded-lg border border-dashed border-line text-xs text-muted">画像なし</div>
    );
  };

  /** 教員用の解答用紙から切り出した、その問題の解答欄 */
  const renderKeyCrop = (no: string, size = "max-h-28") => {
    const url = answerKey.crops.get(no);
    return url ? (
      <div>
        <p className="text-[10px] font-bold text-muted">解答用紙</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={`${no}の解答`} className={`${size} w-full rounded-lg border border-pen/40 bg-white object-contain`} />
      </div>
    ) : null;
  };

  const clearCrops = async () => {
    if (!confirm("このテストの解答欄の切り出し画像を削除します（採点結果は残ります）。よろしいですか？")) return;
    await db.crops.where("testId").equals(testId).delete();
  };

  // 問題ごと：同じ答え（表記ゆれは同一視）でまとめる
  const groups = (() => {
    const map = new Map<string, Entry[]>();
    for (const e of entries.filter((x) => x.item.no === selectedNo)) {
      // AIなしの答えは読み取った文字がないので、「未判定」「○にした」「✕にした」でまとめる
      // 丸付け済みの答案から読んだ結果は、読み取った先生の印でまとめる
      const key = isManual(e.item) ? manualGroup(e.item) : e.item.teacherMark ? `mark:${e.item.teacherMark}` : normalize(e.item.studentAnswer);
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    const rank = (es: Entry[]) => (es.some((e) => isUnjudged(e.item)) ? -1 : es.some((e) => e.item.needsReview) ? 0 : es.some((e) => !e.item.correct) ? 1 : 2);
    return [...map.values()].sort((a, b) => rank(a) - rank(b) || b.length - a.length);
  })();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <Link href={`/grade?id=${testId}`} className="text-sm text-muted hover:underline">
            ← 採点に戻る
          </Link>
          <h1 className="text-2xl font-bold">{test.title}：確認</h1>
        </div>
        <div className="inline-flex rounded-xl border border-line bg-white p-1">
          <button onClick={() => setMode("review")} className={`rounded-lg px-4 py-1.5 text-sm font-bold ${mode === "review" ? "bg-ink text-white" : "text-muted"}`}>
            要確認・未判定（{pending.length}）
          </button>
          <button onClick={() => setMode("question")} className={`rounded-lg px-4 py-1.5 text-sm font-bold ${mode === "question" ? "bg-ink text-white" : "text-muted"}`}>
            問題ごとに並べる
          </button>
        </div>
      </div>

      {toast && (
        <p className="flex items-center gap-2 rounded-lg bg-ok/10 px-4 py-2 text-sm text-ok">
          ✓ {toast}
          <button className="ml-auto text-muted" onClick={() => setToast("")} aria-label="閉じる">
            ✕
          </button>
        </p>
      )}

      {mode === "review" &&
        (pending.length === 0 ? (
          <div className="card text-center text-muted">
            <p className="text-4xl">✓</p>
            <p className="mt-2">要確認の答えはありません。</p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pending.map((e) => (
              <li key={`${e.result.id}-${e.item.no}`} className="card space-y-2 border-review/50 p-4">
                <div className="flex items-baseline gap-2">
                  <span className="font-bold">
                    {e.result.studentNo}番 <span className="text-sm font-normal text-muted">{e.name}</span>
                  </span>
                  <span className="ml-auto rounded bg-paper px-2 text-sm font-bold">{e.item.no}</span>
                </div>
                {answerKey.crops.has(e.item.no) ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-[10px] font-bold text-muted">児童</p>
                      {renderCrop(e)}
                    </div>
                    {renderKeyCrop(e.item.no)}
                  </div>
                ) : (
                  renderCrop(e)
                )}
                <div className="text-sm">
                  {isUnjudged(e.item) ? (
                    <p className="text-muted">AIなし：画像を見て判定してください</p>
                  ) : (
                  e.item.teacherMark ? (
                  <p>
                    読み取った先生の印：<b>{e.item.teacherMark}</b>
                  </p>
                  ) : (
                  <p>
                    読み取り：<b>{e.item.studentAnswer || "（空欄）"}</b>
                    {e.item.otherReading && <span className="text-muted">（または「{e.item.otherReading}」）</span>}
                  </p>
                  )
                  )}
                  <p className="text-muted">
                    {answerOf(e.item.no)?.format === "essay" ? "模範解答" : "正答"}：{answerOf(e.item.no)?.answer}
                  </p>
                  {!isUnjudged(e.item) && e.item.reasons?.map((r) => (
                    <p key={r} className="text-xs text-review">
                      ⚠ {r}
                    </p>
                  ))}
                </div>
                <JudgeButtons points={pointsOf(e.item.no)} allowPartial={allowPartial(e.item.no)} onVerdict={(v) => judge(e, v)} />
              </li>
            ))}
          </ul>
        ))}

      {mode === "question" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {test.questions.map((q) => {
              const n = entries.filter((e) => e.item.no === q.no && e.item.needsReview).length;
              return (
                <button
                  key={q.no}
                  onClick={() => setQuestionNo(q.no)}
                  className={`relative rounded-lg border px-3 py-1.5 text-sm font-bold ${q.no === selectedNo ? "border-accent bg-accent text-white" : "border-line bg-white"}`}
                >
                  {q.no}
                  {n > 0 && <span className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-review text-xs text-white">{n}</span>}
                </button>
              );
            })}
          </div>
          {selectedNo && (
            <div className="flex flex-wrap items-start gap-4">
              {answerKey.crops.has(selectedNo) && (
                <div className="w-64 max-w-full">{renderKeyCrop(selectedNo, needsImage(questionOf(selectedNo)?.format) ? "max-h-48" : "max-h-32")}</div>
              )}
              <p className="text-sm">
                正答：<b>{answerOf(selectedNo)?.answer}</b>
                {(answerOf(selectedNo)?.alternatives?.length ?? 0) > 0 && <span className="text-muted">　別解：{answerOf(selectedNo)!.alternatives!.join("、")}</span>}
              </p>
            </div>
          )}
          {groups.length === 0 && <div className="card text-center text-muted">まだ採点結果がありません。</div>}
          {groups.map((group) => {
            const unjudged = isUnjudged(group[0].item);
            const manual = isManual(group[0].item);
            const mark = group[0].item.teacherMark;
            const label = manual ? MANUAL_LABELS[manualGroup(group[0].item)] : mark ? `先生の印：${mark}` : group[0].item.studentAnswer || "（空欄）";
            return (
              <section key={label} className="card space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-lg font-bold">{manual || mark ? label : `「${label}」`}</span>
                  <span className="text-sm text-muted">{group.length}人</span>
                  <span className="ml-auto text-sm text-muted">まとめて</span>
                  <JudgeButtons
                    points={pointsOf(selectedNo!)}
                    allowPartial={allowPartial(selectedNo!)}
                    onVerdict={async (v) => {
                      for (const e of group) await judgeItem(e.result.id!, e.item.no, v);
                      const mark = v.correct ? "○" : v.earned !== undefined ? `△（${v.earned}点）` : "✕";
                      setToast(`${manual ? label : `「${label}」`}の ${group.length}人をまとめて${mark}にしました${unjudged && v.correct ? "。✕の人だけ個別に直してください" : ""}`);
                    }}
                  />
                </div>
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                  {group.map((e) => (
                    <li key={e.result.id} className={`space-y-1.5 rounded-xl border p-2 ${e.item.needsReview ? "border-review bg-review/5" : "border-line"}`}>
                      <div className="flex items-center gap-1.5 text-sm">
                        <StatusMark item={e.item} />
                        <b>{e.result.studentNo}</b>
                        <span className="truncate text-xs text-muted">{e.name}</span>
                      </div>
                      {renderCrop(e)}
                      <JudgeButtons
                        size="sm"
                        item={e.item}
                        points={pointsOf(e.item.no)}
                        allowPartial={allowPartial(e.item.no)}
                        onVerdict={(v) => judge(e, v)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {crops.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4 text-sm text-muted">
          解答欄の切り出し画像 {crops.length}枚をこの端末に保存中（名前欄は含みません）。
          <button className="btn-ghost ml-auto text-sm" onClick={clearCrops}>
            採点が終わったので画像を削除
          </button>
        </div>
      )}
    </div>
  );
};

// URL は /grade?id=5 の形（サーバーなしの公開版でも動くように）
const Page = () => (
  <Suspense fallback={<p className="text-muted">読み込み中…</p>}>
    <Review />
  </Suspense>
);

export default Page;
