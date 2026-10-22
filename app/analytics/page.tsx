"use client";

import { type ReactNode, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { ExcelExportButton } from "@/components/ExcelExportButton";
import { abcOf, errorTypes, kantenStats, kantenTotals, pct, questionStats, tagStats } from "@/lib/analytics";
import { KANTEN_SHORT, type Result, SIDE_LABEL, type Student, type Test, db, gradedSides, itemPoints, sidesOf } from "@/lib/db";
import { useAbc } from "@/lib/settings-hooks";
import { SUBJECTS, type Subject, subjectOf } from "@/lib/subjects";

type Tab = "class" | "student" | "test";

/** 単色の横棒（正答率）。値の文字は棒の色ではなく文字色で表示 */
const Bar = ({ label, rate, sub, warn, note }: { label: string; rate: number; sub?: string; warn?: boolean; note?: ReactNode }) => (
  <div className="grid grid-cols-[minmax(0,10rem)_1fr_3.5rem] items-center gap-3 text-sm" title={`${label}：${pct(rate)}${sub ? `（${sub}）` : ""}`}>
    <span className="truncate">
      {warn && <span className="mr-1 text-pen">▼</span>}
      {label}
    </span>
    <span className="h-3 overflow-hidden rounded-full bg-line/60">
      <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(rate * 100, 1)}%` }} />
    </span>
    <span className="text-right font-bold tabular-nums">{pct(rate)}</span>
    {note && <span className="col-span-3 -mt-2 text-xs">{note}</span>}
  </div>
);

/** 丸付け済みの答案に書かれた合計点が、○✕と配点から計算した点と合わないか（全部の面を採点し終えたときだけ比べる） */
const writtenMismatch = (test: Test | undefined, r: Result) =>
  !!test && r.writtenScore !== undefined && gradedSides(test, r).length === sidesOf(test).length && r.writtenScore !== r.score;

/** 答案に書かれた合計点の表示（読み取れていないときは何も出さない） */
const WrittenScore = ({ test, r }: { test: Test | undefined; r: Result }) =>
  r.writtenScore === undefined ? null : writtenMismatch(test, r) ? (
    <span className="font-bold text-pen">
      ⚠ 答案の合計点 {r.writtenScore}点（計算した点 {r.score}点と合いません）
    </span>
  ) : (
    <span className="text-muted">答案の合計点 {r.writtenScore}点</span>
  );

/** A・B・C の目安の印 */
const AbcBadge = ({ rate }: { rate: number }) => {
  const g = abcOf(rate, useAbc());
  const cls = g === "A" ? "border-ok text-ok" : g === "C" ? "border-pen bg-pen/10 text-pen" : "border-line text-ink";
  return <span className={`inline-grid size-6 place-items-center rounded-md border text-xs font-bold ${cls}`}>{g}</span>;
};

/** 児童 × 観点 の得点率と A・B・C の目安 */
/** 教科ごとに、テストと結果を分ける（観点別の評価は教科ごとに出す） */
const bySubject = (tests: Test[], results: Result[]) =>
  SUBJECTS.flatMap((subject) => {
    const ts = tests.filter((t) => subjectOf(t) === subject);
    const ids = new Set(ts.map((t) => t.id));
    const rs = results.filter((r) => ids.has(r.testId));
    return ts.length && kantenStats(rs, ts).length ? [{ subject, tests: ts, results: rs }] : [];
  });

const KantenTable = ({ students, tests, results }: { students: Student[]; tests: Test[]; results: Result[] }) => {
  const groups = bySubject(tests, results);
  if (groups.length === 0)
    return (
      <section className="card text-sm text-muted">
        観点別の集計は、答案用紙の登録で問題ごとに「観点」（知識・技能／思考・判断・表現 など）を設定すると表示されます。
      </section>
    );
  return (
    <>
      {groups.map((g) => (
        <KantenTableOne key={g.subject} subject={g.subject} students={students} tests={g.tests} results={g.results} />
      ))}
    </>
  );
};

const KantenTableOne = ({ students, tests, results, subject }: { students: Student[]; tests: Test[]; results: Result[]; subject: Subject }) => {
  const overall = kantenStats(results, tests);
  const abc = useAbc();
  return (
    <section className="card space-y-3">
      <h2 className="font-bold">観点別の得点率と評価の目安（{subject}）</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead className="text-left text-muted">
            <tr>
              <th className="py-1 pr-2">番号</th>
              {overall.map((k) => (
                <th key={k.kanten} className="px-2 py-1 text-center">
                  {KANTEN_SHORT[k.kanten]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {students.map((st) => {
              const mine = new Map(kantenStats(results.filter((r) => r.studentNo === st.no), tests).map((k) => [k.kanten, k]));
              return (
                <tr key={st.no} className="border-t border-line">
                  <td className="whitespace-nowrap py-1.5 pr-2 font-bold" title={st.name}>
                    {st.no} <span className="font-normal text-muted">{st.name}</span>
                  </td>
                  {overall.map((o) => {
                    const k = mine.get(o.kanten);
                    return (
                      <td key={o.kanten} className="px-2 text-center tabular-nums" title={k ? `${k.earned}/${k.points}点` : undefined}>
                        {k ? (
                          <span className="inline-flex items-center gap-2">
                            {pct(k.rate)} <AbcBadge rate={k.rate} />
                          </span>
                        ) : (
                          <span className="text-muted">–</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr className="border-t-2 border-line font-bold">
              <td className="py-1.5">クラス</td>
              {overall.map((o) => (
                <td key={o.kanten} className="text-center tabular-nums">
                  {pct(o.rate)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        得点率＝その観点の得点の合計 ÷ 採点した問題の配点の合計。目安：A {abc.a}%以上／B {abc.c}%以上／C {abc.c}%未満（設定画面で変更できます）。最終的な評価は先生が判断してください。
      </p>
    </section>
  );
};

const Empty = () => (
  <div className="card text-center text-muted">まだ採点結果がありません。テストを採点すると、ここに分析が表示されます。</div>
);

const ClassView = ({ students, tests, results }: { students: Student[]; tests: Test[]; results: Result[] }) => {
  const overall = tagStats(results, tests);
  const errors = errorTypes(results).slice(0, 8);
  return (
    <div className="space-y-5">
      <section className="card space-y-3">
        <h2 className="font-bold">単元ごとのクラス正答率</h2>
        {overall.map((s) => (
          <Bar key={s.tag} label={s.tag} rate={s.rate} sub={`${s.correct}/${s.total}問`} warn={s.rate < 0.7} />
        ))}
        <p className="text-xs text-muted">▼ はクラス全体で正答率70%未満の単元（復習の候補）</p>
      </section>

      <section className="card space-y-3">
        <h2 className="font-bold">児童 × 単元の正答率</h2>
        <div className="overflow-x-auto">
          <table className="border-separate border-spacing-0.5 text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 bg-white px-2 text-left text-muted">番号</th>
                {overall.map((s) => (
                  <th key={s.tag} className="max-w-24 px-1 pb-1 align-bottom font-bold text-muted">
                    {s.tag}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {students.map((st) => {
                const mine = new Map(tagStats(results.filter((r) => r.studentNo === st.no), tests).map((s) => [s.tag, s]));
                return (
                  <tr key={st.no}>
                    <td className="sticky left-0 whitespace-nowrap bg-white px-2 font-bold" title={st.name}>
                      {st.no} <span className="font-normal text-muted">{st.name}</span>
                    </td>
                    {overall.map((o) => {
                      const s = mine.get(o.tag);
                      if (!s) return <td key={o.tag} className="h-8 min-w-12 rounded bg-paper text-center text-muted">–</td>;
                      return (
                        <td
                          key={o.tag}
                          title={`${st.no}番 ${o.tag}：${pct(s.rate)}（${s.correct}/${s.total}問）`}
                          className={`h-8 min-w-12 rounded text-center font-bold tabular-nums ${s.rate >= 0.55 ? "text-white" : "text-ink"}`}
                          style={{ background: `color-mix(in oklab, var(--color-accent) ${Math.round(12 + s.rate * 88)}%, white)` }}
                        >
                          {pct(s.rate)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">色が濃いほど正答率が高い。薄いマスがその児童の苦手単元です。</p>
      </section>

      <KantenTable students={students} tests={tests} results={results} />

      {errors.length > 0 && (
        <section className="card space-y-2">
          <h2 className="font-bold">よくある誤りの傾向（AIの推定）</h2>
          <ul className="flex flex-wrap gap-2">
            {errors.map(([type, n]) => (
              <li key={type} className="rounded-full border border-line px-3 py-1 text-sm">
                {type} <b className="tabular-nums">{n}</b>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

const StudentView = ({ students, tests, results }: { students: Student[]; tests: Test[]; results: Result[] }) => {
  const [no, setNo] = useState(students[0]?.no ?? 0);
  const mine = results.filter((r) => r.studentNo === no);
  const stats = tagStats(mine, tests);
  const classRate = new Map(tagStats(results, tests).map((s) => [s.tag, s.rate]));
  const weak = [...stats].filter((s) => s.rate < 1).sort((a, b) => a.rate - b.rate).slice(0, 3);
  const strong = [...stats].filter((s) => s.rate >= 0.9).sort((a, b) => b.total - a.total).slice(0, 3);
  const errors = errorTypes(mine).slice(0, 5);
  const kantenGroups = bySubject(tests, results).map((g) => ({
    subject: g.subject,
    kanten: kantenStats(g.results.filter((r) => r.studentNo === no), g.tests),
    classKanten: new Map(kantenStats(g.results, g.tests).map((k) => [k.kanten, k.rate])),
  }));

  return (
    <div className="space-y-5">
      <select className="input max-w-xs" value={no} onChange={(e) => setNo(Number(e.target.value))}>
        {students.map((s) => (
          <option key={s.no} value={s.no}>
            {s.no}番 {s.name}
          </option>
        ))}
      </select>

      {mine.length === 0 ? (
        <Empty />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <section className="card">
              <h2 className="font-bold text-ok">得意な単元</h2>
              {strong.length ? (
                <ul className="mt-2 space-y-1">{strong.map((s) => <li key={s.tag}>◎ {s.tag}（{pct(s.rate)}）</li>)}</ul>
              ) : (
                <p className="mt-2 text-sm text-muted">正答率90%以上の単元はまだありません</p>
              )}
            </section>
            <section className="card">
              <h2 className="font-bold text-pen">苦手かもしれない単元</h2>
              {weak.length ? (
                <ul className="mt-2 space-y-1">
                  {weak.map((s) => (
                    <li key={s.tag}>
                      ▼ {s.tag}（{pct(s.rate)}
                      <span className="text-xs text-muted">／クラス平均 {pct(classRate.get(s.tag) ?? 0)}</span>）
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted">全問正解です</p>
              )}
              {errors.length > 0 && <p className="mt-3 text-xs text-muted">誤りの傾向：{errors.map(([t, n]) => `${t}(${n})`).join("、")}</p>}
            </section>
          </div>

          {kantenGroups.map(({ subject, kanten, classKanten }) => kanten.length > 0 && (
            <section key={subject} className="card space-y-3">
              <h2 className="font-bold">観点別の得点率（{subject}）</h2>
              {kanten.map((k) => (
                <div key={k.kanten} className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <Bar label={k.kanten} rate={k.rate} sub={`${k.earned}/${k.points}点・クラス平均 ${pct(classKanten.get(k.kanten) ?? 0)}`} warn={k.rate < 0.7} />
                  </div>
                  <AbcBadge rate={k.rate} />
                </div>
              ))}
              <p className="text-xs text-muted">右の A・B・C は得点率からの目安です（基準は設定画面で変更できます）。</p>
            </section>
          ))}

          <section className="card space-y-3">
            <h2 className="font-bold">単元ごとの正答率</h2>
            {stats.map((s) => (
              <Bar key={s.tag} label={s.tag} rate={s.rate} sub={`${s.correct}/${s.total}問・クラス平均 ${pct(classRate.get(s.tag) ?? 0)}`} warn={s.rate < 0.7} />
            ))}
          </section>

          <section className="card space-y-3">
            <h2 className="font-bold">テストごとの得点</h2>
            {[...mine]
              .sort((a, b) => (tests.find((t) => t.id === a.testId)?.createdAt ?? 0) - (tests.find((t) => t.id === b.testId)?.createdAt ?? 0))
              .map((r) => (
                <Bar
                  key={r.id}
                  label={tests.find((t) => t.id === r.testId)?.title ?? "?"}
                  rate={r.score / r.total}
                  sub={`${r.score}/${r.total}点`}
                  note={
                    r.writtenScore !== undefined && (
                      <>
                        <span className="text-muted">
                          {r.score}/{r.total}点・
                        </span>
                        <WrittenScore test={tests.find((t) => t.id === r.testId)} r={r} />
                      </>
                    )
                  }
                />
              ))}
          </section>
        </>
      )}
    </div>
  );
};

const TestView = ({ students, tests, results, initial }: { students: Student[]; tests: Test[]; results: Result[]; initial: number | null }) => {
  const [id, setId] = useState(initial ?? tests[0]?.id ?? 0);
  const test = tests.find((t) => t.id === id);
  const rs = results.filter((r) => r.testId === id);
  if (!test) return <Empty />;
  const qs = questionStats(rs, test).sort((a, b) => a.rate - b.rate);
  const avg = rs.length ? rs.reduce((s, r) => s + r.score / r.total, 0) / rs.length : 0;
  const totals = kantenTotals(test.questions);
  const kantenScore = (r: Result, kanten: string) =>
    r.items.reduce((s, i) => {
      const q = test.questions.find((x) => x.no === i.no);
      return q?.kanten === kanten ? s + itemPoints(i, q.points) : s;
    }, 0);

  return (
    <div className="space-y-5">
      <select className="input max-w-md" value={id} onChange={(e) => setId(Number(e.target.value))}>
        {tests.map((t) => (
          <option key={t.id} value={t.id}>
            {t.title}
          </option>
        ))}
      </select>
      {rs.length === 0 ? (
        <Empty />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="card">
              <p className="text-sm text-muted">平均</p>
              <p className="text-3xl font-bold tabular-nums">{pct(avg)}</p>
            </div>
            <div className="card">
              <p className="text-sm text-muted">採点済み</p>
              <p className="text-3xl font-bold tabular-nums">
                {rs.length}
                <span className="text-base text-muted">/{students.length}人</span>
              </p>
            </div>
            <div className="card">
              <p className="text-sm text-muted">最も正答率が低い問題</p>
              <p className="text-3xl font-bold">
                {qs[0]?.no} <span className="text-base text-muted">{pct(qs[0]?.rate ?? 0)}</span>
              </p>
            </div>
          </div>
          {rs.some((r) => writtenMismatch(test, r)) && (
            <p className="rounded-lg border border-pen bg-pen/5 px-3 py-2 text-sm text-pen">
              ⚠ 答案に書かれた合計点と、○✕から計算した点が合わない児童がいます：
              <b>
                {rs
                  .filter((r) => writtenMismatch(test, r))
                  .map((r) => `${r.studentNo}番`)
                  .join("、")}
              </b>
              。採点画面か「問題ごとに見る」で○✕△と配点を確認してください。
            </p>
          )}
          <section className="card space-y-3">
            <h2 className="font-bold">問題ごとの正答率（低い順）</h2>
            {qs.map((q) => (
              <Bar key={q.no} label={`${q.no}　${q.tag}`} rate={q.rate} sub={`正答 ${q.answer}・${q.correct}/${q.total}人`} warn={q.rate < 0.7} />
            ))}
          </section>
          <section className="card">
            <h2 className="mb-2 font-bold">児童ごとの得点</h2>
            <table className="w-full text-sm">
              <tbody>
                {students.map((s) => {
                  const r = rs.find((x) => x.studentNo === s.no);
                  return (
                    <tr key={s.no} className="border-t border-line">
                      <td className="w-12 py-1.5 font-bold">{s.no}</td>
                      <td>{s.name}</td>
                      <td className="text-right tabular-nums">
                        {r ? `${r.score}/${r.total}点` : <span className="text-muted">未採点</span>}
                        {r?.writtenScore !== undefined && (
                          <span className="block text-xs">
                            <WrittenScore test={test} r={r} />
                          </span>
                        )}
                        {r && sidesOf(test).length > gradedSides(test, r).length && (
                          <span className="block text-xs text-review">
                            {sidesOf(test)
                              .filter((x) => !gradedSides(test, r).includes(x))
                              .map((x) => SIDE_LABEL[x])
                              .join("・")}
                            面 未採点
                          </span>
                        )}
                      </td>
                      {totals.map((t) => (
                        <td key={t.kanten} className="pl-3 text-right text-xs tabular-nums text-muted">
                          {r ? `${KANTEN_SHORT[t.kanten]} ${kantenScore(r, t.kanten)}/${t.points}` : ""}
                        </td>
                      ))}
                      <td className="pl-3 text-xs text-pen">
                        {r?.items
                          .filter((i) => !i.correct)
                          .map((i) => (i.earned !== undefined ? `${i.no}△` : i.no))
                          .join(" ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
};

const AnalyticsInner = () => {
  const params = useSearchParams();
  const initialTest = params.get("test") ? Number(params.get("test")) : null;
  const [tab, setTab] = useState<Tab>(initialTest ? "test" : "class");
  const students = useLiveQuery(() => db.students.orderBy("no").toArray());
  const allTests = useLiveQuery(() => db.tests.orderBy("createdAt").toArray());
  const allResults = useLiveQuery(() => db.results.toArray());
  const [subject, setSubject] = useState<Subject | "all" | null>(null);
  if (!students || !allTests || !allResults) return null;

  // 教科で絞り込む（テスト別から来たときは、そのテストの教科）
  const present = SUBJECTS.filter((x) => allTests.some((t) => subjectOf(t) === x));
  const fromTest = allTests.find((t) => t.id === initialTest);
  const current = subject ?? (fromTest ? subjectOf(fromTest) : "all");
  const tests = current === "all" ? allTests : allTests.filter((t) => subjectOf(t) === current);
  const ids = new Set(tests.map((t) => t.id));
  const results = allResults.filter((r) => ids.has(r.testId));

  const TABS: { id: Tab; label: string }[] = [
    { id: "class", label: "クラス全体" },
    { id: "student", label: "児童別" },
    { id: "test", label: "テスト別" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">分析</h1>
        {results.length > 0 && <ExcelExportButton variant="large" />}
      </div>
      {present.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm text-muted">教科：</span>
          {(["all", ...present] as const).map((x) => (
            <button
              key={x}
              onClick={() => setSubject(x)}
              className={`rounded-full border px-3 py-1 text-sm font-bold ${current === x ? "border-ink bg-ink text-white" : "border-line bg-white text-muted"}`}
            >
              {x === "all" ? "すべて" : x}
            </button>
          ))}
        </div>
      )}
      <div className="inline-flex rounded-xl border border-line bg-white p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-4 py-1.5 text-sm font-bold ${tab === t.id ? "bg-ink text-white" : "text-muted"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {results.length === 0 ? (
        <Empty />
      ) : tab === "class" ? (
        <ClassView students={students} tests={tests} results={results} />
      ) : tab === "student" ? (
        <StudentView students={students} tests={tests} results={results} />
      ) : (
        <TestView key={current} students={students} tests={tests} results={results} initial={tests.some((t) => t.id === initialTest) ? initialTest : null} />
      )}
    </div>
  );
};

const Analytics = () => (
  <Suspense fallback={null}>
    <AnalyticsInner />
  </Suspense>
);

export default Analytics;
