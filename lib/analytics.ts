import { KANTEN, type Kanten, type Question, type Result, type Test, getSetting, itemPoints } from "./db";

export type TagStat = { tag: string; correct: number; total: number; rate: number };

const UNTAGGED = "（単元未設定）";
const round1 = (n: number) => Math.round(n * 10) / 10;

/** 結果の一覧を単元タグごとの正答率に集計する */
export const tagStats = (results: Result[], tests: Test[]): TagStat[] => {
  const testById = new Map(tests.map((t) => [t.id!, t]));
  const acc = new Map<string, { correct: number; total: number }>();
  for (const r of results) {
    const test = testById.get(r.testId);
    if (!test) continue;
    for (const item of r.items) {
      const q = test.questions.find((x) => x.no === item.no);
      const tag = q?.tag || UNTAGGED;
      const a = acc.get(tag) ?? { correct: 0, total: 0 };
      a.total += 1;
      // 部分点（△）は得点の割合で数える（10点中5点なら0.5問分）
      const points = q?.points || 1;
      a.correct += itemPoints(item, points) / points;
      acc.set(tag, a);
    }
  }
  return [...acc.entries()]
    .map(([tag, a]) => ({ tag, total: a.total, correct: round1(a.correct), rate: a.correct / a.total }))
    .sort((a, b) => a.tag.localeCompare(b.tag, "ja"));
};

/** 誤答の傾向（AIが推定した error_type）を多い順に */
export const errorTypes = (results: Result[]) => {
  const count = new Map<string, number>();
  for (const r of results)
    for (const i of r.items) if (!i.correct && i.errorType) count.set(i.errorType, (count.get(i.errorType) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]);
};

/** テストの問題ごとの正答率（クラス全体） */
export const questionStats = (results: Result[], test: Test) =>
  test.questions.map((q) => {
    const answered = results.flatMap((r) => r.items.filter((i) => i.no === q.no));
    const correct = answered.reduce((s, i) => s + itemPoints(i, q.points || 1) / (q.points || 1), 0);
    return { ...q, correct: round1(correct), total: answered.length, rate: answered.length ? correct / answered.length : 0 };
  });

export const pct = (rate: number) => `${Math.round(rate * 100)}%`;

// ---- 観点別 ----

export type KantenStat = { kanten: Kanten; earned: number; points: number; rate: number };

/** 観点ごとの得点率（配点で重みづけ：得点の合計 ÷ 採点した問題の配点の合計）。観点が未設定の問題は数えない */
export const kantenStats = (results: Result[], tests: Test[]): KantenStat[] => {
  const testById = new Map(tests.map((t) => [t.id!, t]));
  const acc = new Map<Kanten, { earned: number; points: number }>();
  for (const r of results) {
    const test = testById.get(r.testId);
    if (!test) continue;
    for (const item of r.items) {
      const q = test.questions.find((x) => x.no === item.no);
      if (!q?.kanten) continue;
      const a = acc.get(q.kanten) ?? { earned: 0, points: 0 };
      a.earned += itemPoints(item, q.points);
      a.points += q.points;
      acc.set(q.kanten, a);
    }
  }
  return KANTEN.flatMap((kanten) => {
    const a = acc.get(kanten);
    return a && a.points > 0 ? [{ kanten, earned: round1(a.earned), points: a.points, rate: a.earned / a.points }] : [];
  });
};

/** テスト1つの観点別の満点 */
export const kantenTotals = (questions: Question[]) =>
  KANTEN.flatMap((kanten) => {
    const points = questions.filter((q) => q.kanten === kanten).reduce((s, q) => s + q.points, 0);
    return points > 0 ? [{ kanten, points }] : [];
  });

// ---- A・B・C の目安 ----

/** A：この割合（%）以上、C：この割合（%）未満、その間がB */
export type AbcThresholds = { a: number; c: number };
export const DEFAULT_ABC: AbcThresholds = { a: 80, c: 50 };

export const loadAbc = async (): Promise<AbcThresholds> => ({
  a: Number(await getSetting("abcA", String(DEFAULT_ABC.a))),
  c: Number(await getSetting("abcC", String(DEFAULT_ABC.c))),
});

export const abcOf = (rate: number, t: AbcThresholds) => {
  const p = rate * 100;
  return p >= t.a ? "A" : p < t.c ? "C" : "B";
};
