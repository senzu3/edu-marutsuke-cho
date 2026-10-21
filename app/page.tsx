"use client";

import { useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { ExcelExportButton } from "@/components/ExcelExportButton";
import { type Test, db, gradedSides, sidesOf } from "@/lib/db";
import { STATIC_EDITION } from "@/lib/edition";
import { SUBJECTS, type Subject, subjectOf } from "@/lib/subjects";

const Home = () => {
  const tests = useLiveQuery(() => db.tests.orderBy("createdAt").reverse().toArray());
  const studentCount = useLiveQuery(() => db.students.count());
  const results = useLiveQuery(() => db.results.toArray());
  const [filter, setFilter] = useState<Subject | "all">("all");
  const drafts = useLiveQuery(() => db.drafts.orderBy("key").toArray());

  if (!tests || studentCount === undefined || !results || !drafts) return null;

  // 裏面があるテストは、表と裏の両方を採点した人数
  const gradedCount = (t: Test) => results.filter((r) => r.testId === t.id && gradedSides(t, r).length === sidesOf(t).length).length;
  const pendingReview = (testId: number) =>
    results.filter((r) => r.testId === testId).reduce((n, r) => n + r.items.filter((i) => i.needsReview).length, 0);
  const average = (testId: number) => {
    const rs = results.filter((r) => r.testId === testId);
    if (rs.length === 0) return null;
    return Math.round((rs.reduce((s, r) => s + r.score / r.total, 0) / rs.length) * 100);
  };

  return (
    <div className="space-y-6">
      {drafts.length > 0 && (
        <section className="card space-y-2 border-accent/40 bg-accent/5">
          <h2 className="font-bold">↩ 途中の作業があります</h2>
          <ul className="space-y-2">
            {[...drafts]
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((d) => (
                <li key={d.key} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1">
                    {d.label}
                    <span className="ml-2 text-xs text-muted">
                      {new Date(d.updatedAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </span>
                  <Link href={d.href} className="btn-primary py-1.5 text-sm">
                    続きから →
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      )}
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">テスト一覧</h1>
          <p className="text-sm text-muted">写真を撮るだけで丸付け。最終判断は先生がタップで直せます。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {results.length > 0 && <ExcelExportButton variant="large" />}
          <Link href="/tests/new" className="btn-primary">
            ＋ 答案用紙を登録
          </Link>
        </div>
      </section>

      {studentCount === 0 && (
        <div className="card border-review/50 bg-review/5">
          <p className="font-bold">はじめに：クラス名簿を登録しましょう</p>
          <p className="mt-1 text-sm text-muted">
            出席番号と名前を登録します。名前はこの端末の中だけに保存され、{STATIC_EDITION ? "どこにも送信しません" : "AIには送られません"}。
          </p>
          <Link href="/settings" className="btn-ghost mt-3">
            名簿を登録する
          </Link>
        </div>
      )}

      {(() => {
        const present = SUBJECTS.filter((x) => tests.some((t) => subjectOf(t) === x));
        return present.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            {(["all", ...present] as const).map((x) => (
              <button
                key={x}
                onClick={() => setFilter(x)}
                className={`rounded-full border px-3 py-1 text-sm font-bold ${filter === x ? "border-ink bg-ink text-white" : "border-line bg-white text-muted"}`}
              >
                {x === "all" ? "すべて" : x}
                <span className="ml-1 font-normal">{x === "all" ? tests.length : tests.filter((t) => subjectOf(t) === x).length}</span>
              </button>
            ))}
          </div>
        ) : null;
      })()}

      {tests.length === 0 ? (
        <div className="card text-center text-muted">
          <p className="text-4xl">📝</p>
          <p className="mt-2">まだテストがありません。模範解答の写真から答案用紙を登録しましょう。</p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tests.filter((t) => filter === "all" || subjectOf(t) === filter).map((t) => {
            const done = gradedCount(t);
            const avg = average(t.id!);
            const pending = pendingReview(t.id!);
            return (
              <li key={t.id} className="card flex flex-col gap-3">
                <div>
                  <p className="text-lg font-bold">
                    <span className="mr-2 inline-block rounded-md border border-line px-1.5 py-0.5 align-middle text-xs font-bold text-muted">{subjectOf(t)}</span>
                    {t.title || "（無題のテスト）"}
                  </p>
                  <p className="text-xs text-muted">
                    {new Date(t.createdAt).toLocaleDateString("ja-JP")}・{t.questions.length}問{t.back && "・表裏"}
                  </p>
                </div>
                <div>
                  <div className="flex justify-between text-sm">
                    <span>
                      採点済み {done}/{studentCount}人
                    </span>
                    {avg !== null && <span className="text-muted">平均 {avg}%</span>}
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-line">
                    <div className="h-full bg-ok" style={{ width: `${studentCount ? (done / studentCount) * 100 : 0}%` }} />
                  </div>
                </div>
                {pending > 0 && (
                  <Link href={`/grade/review?id=${t.id}`} className="rounded-lg bg-review/10 px-3 py-2 text-sm font-bold text-review">
                    ⚠ 要確認 {pending}件 →
                  </Link>
                )}
                <div className="mt-auto flex gap-2">
                  <Link href={`/grade?id=${t.id}`} className="btn-pen flex-1">
                    ○ 採点する
                  </Link>
                  <Link href={`/analytics?test=${t.id}`} className="btn-ghost">
                    結果
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default Home;
