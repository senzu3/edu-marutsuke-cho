import type { Workbook, Worksheet } from "exceljs";
import { type AbcThresholds, abcOf, kantenStats, kantenTotals, loadAbc, tagStats } from "./analytics";
import { KANTEN_SHORT, type Result, type Student, type Test, db, gradedSides, itemPoints, sidesOf } from "./db";
import { SUBJECTS, type Subject, subjectOf } from "./subjects";
import { isUnjudged } from "./grading";

// Excelファイルは端末内で作り、そのままダウンロードする（サーバーには送らない）。
// 「前のExcelに追加」では、同じ名前のシート（タブ）だけ作り直し、それ以外のシートはそのまま残す。

/** 教科ごとのまとめのシート名 */
export const summarySheet = (subject: Subject) => `単元別（${subject}）`;
export const kantenSheet = (subject: Subject) => `観点別（${subject}）`;
const SUMMARY_NAMES = new Set(SUBJECTS.flatMap((x) => [summarySheet(x), kantenSheet(x)]).map((n) => n.toLowerCase()));

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEBE6" } } as const;
const RED = { argb: "FFC8322B" };
const ORANGE = { argb: "FFB86E00" };
const GRAY = { argb: "FF8A857C" };

/** Excelのシート名に使えない文字を除き、31文字以内にする */
const toSheetName = (s: string) => s.replace(/[[\]:*?/\\]/g, "_").replace(/^'+|'+$/g, "").trim().slice(0, 31) || "テスト";

/** テストごとのシート名（同じ名前のテストが2つあるときは番号を付けて区別する） */
export const testSheetNames = (tests: Test[]) => {
  const names = new Map<number, string>();
  const used = new Set(SUMMARY_NAMES);
  for (const t of tests) {
    let name = toSheetName(t.title);
    if (used.has(name.toLowerCase())) name = toSheetName(`${t.title.slice(0, 24)}_${t.id}`);
    used.add(name.toLowerCase());
    names.set(t.id!, name);
  }
  return names;
};

const date = (ms: number) => new Date(ms).toLocaleDateString("ja-JP");

/** 1問の印：○ / △(点) / ✕ / 要確認 */
const mark = (item: Result["items"][number] | undefined) => {
  if (!item) return { text: "未採点", color: GRAY };
  if (isUnjudged(item)) return { text: "未判定", color: GRAY };
  if (item.needsReview) return { text: "要確認", color: ORANGE };
  if (item.correct) return { text: "○", color: RED };
  if (item.earned !== undefined) return { text: `△${item.earned}`, color: RED };
  return { text: "✕", color: { argb: "FF1F1D1A" } };
};

/** ExcelJSの型定義にはないが、シートの並び順を持つ */
type Ordered = Worksheet & { orderNo: number };
const order = (ws: Worksheet) => ws as Ordered;

/** シートを用意する。前のファイルに同じ名前のシートがあれば、同じ位置に作り直す */
const freshSheet = (wb: Workbook, name: string): Worksheet => {
  const old = wb.worksheets.find((w) => w.name.toLowerCase() === name.toLowerCase());
  if (!old) return wb.addWorksheet(name);
  const orderNo = order(old).orderNo;
  wb.removeWorksheet(old.id);
  const ws = wb.addWorksheet(name);
  order(ws).orderNo = orderNo;
  return ws;
};

const styleHeader = (ws: Worksheet, rowNo: number) => {
  const row = ws.getRow(rowNo);
  row.font = { bold: true };
  row.eachCell((c) => {
    c.fill = HEADER_FILL;
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
};

const writeTestSheet = (ws: Worksheet, test: Test, students: Student[], results: Result[], withNames: boolean) => {
  const qs = test.questions;
  const totals = kantenTotals(qs);
  // 丸付け済みの答案から合計点を読み取った児童がいれば、「答案の合計点」の列を入れる
  const hasWritten = results.some((r) => r.writtenScore !== undefined);
  const mismatch = (r: Result) =>
    r.writtenScore !== undefined && gradedSides(test, r).length === sidesOf(test).length && r.writtenScore !== r.score;
  const lead = [
    ...(withNames ? ["番号", "氏名", "得点", "満点", "得点率"] : ["番号", "得点", "満点", "得点率"]),
    ...(hasWritten ? ["答案の合計点"] : []),
    ...totals.map((t) => `${KANTEN_SHORT[t.kanten]}（${t.points}点）`),
  ];
  const first = lead.length + 1; // 問題の列が始まる位置（1始まり）

  ws.addRow([test.title, `${subjectOf(test)}・登録日 ${date(test.createdAt)}`]).font = { bold: true, size: 13 };
  const info = (label: string, values: (string | number)[]) => {
    const row = ws.addRow([...Array(lead.length - 1).fill(""), label, ...values]);
    row.getCell(lead.length).font = { bold: true, color: GRAY };
    row.alignment = { horizontal: "center" };
  };
  info("単元", qs.map((q) => q.tag));
  if (totals.length) info("観点", qs.map((q) => (q.kanten ? KANTEN_SHORT[q.kanten] : "")));
  if (test.back) info("面", qs.map((q) => (q.side === "back" ? "裏" : "表")));
  info("正答", qs.map((q) => q.answer));
  info("配点", qs.map((q) => q.points));

  const headerRow = ws.addRow([...lead, ...qs.map((q) => q.no)]).number;
  styleHeader(ws, headerRow);

  for (const s of students) {
    const r = results.find((x) => x.studentNo === s.no);
    const base = withNames ? [s.no, s.name] : [s.no];
    if (!r) {
      const row = ws.addRow([...base, "未採点"]);
      row.getCell(base.length + 1).font = { color: GRAY };
      continue;
    }
    const kantenScores = totals.map((t) =>
      r.items.reduce((sum, i) => {
        const q = qs.find((x) => x.no === i.no);
        return q?.kanten === t.kanten ? sum + itemPoints(i, q.points) : sum;
      }, 0),
    );
    const row = ws.addRow([
      ...base,
      r.score,
      r.total,
      r.total ? r.score / r.total : 0,
      ...(hasWritten ? [r.writtenScore ?? ""] : []),
      ...kantenScores,
    ]);
    row.getCell(base.length + 3).numFmt = "0%";
    // 書かれた合計点が、○✕から計算した得点と合わないときは赤字にする
    if (mismatch(r)) {
      const c = row.getCell(base.length + 4);
      c.font = { bold: true, color: RED };
      c.note = `○✕から計算した得点（${r.score}点）と合いません`;
    }
    qs.forEach((q, i) => {
      const m = mark(r.items.find((x) => x.no === q.no));
      const cell = row.getCell(first + i);
      cell.value = m.text;
      cell.font = { bold: true, color: m.color };
      cell.alignment = { horizontal: "center" };
    });
  }

  // 問題ごとの正答率（部分点は割合で数える）
  const graded = results.filter((r) => students.some((s) => s.no === r.studentNo));
  const avg = graded.length ? graded.reduce((s, r) => s + (r.total ? r.score / r.total : 0), 0) / graded.length : 0;
  const rateCol = (withNames ? 2 : 1) + 3; // 「得点率」の列
  const kantenAvg = totals.map((t) => {
    const sums = graded.map((r) =>
      r.items.reduce((sum, i) => {
        const q = qs.find((x) => x.no === i.no);
        return q?.kanten === t.kanten ? sum + itemPoints(i, q.points) : sum;
      }, 0),
    );
    return sums.length ? Math.round((sums.reduce((x, y) => x + y, 0) / sums.length) * 10) / 10 : "";
  });
  const rateRow = ws.addRow([
    ...Array(rateCol - 2).fill(""),
    "正答率・平均",
    avg,
    ...(hasWritten ? [""] : []),
    ...kantenAvg,
    ...qs.map((q) => {
      const items = graded.flatMap((r) => r.items.filter((i) => i.no === q.no));
      return items.length ? items.reduce((s, i) => s + itemPoints(i, q.points || 1) / (q.points || 1), 0) / items.length : "";
    }),
  ]);
  rateRow.font = { bold: true };
  rateRow.eachCell((c, col) => {
    if (col === rateCol || col >= first) c.numFmt = "0%";
    c.fill = HEADER_FILL;
    c.alignment = { horizontal: "center" };
  });
  rateRow.getCell(rateCol - 1).alignment = { horizontal: "right" };

  if (hasWritten) {
    const off = graded.filter(mismatch).map((r) => `${r.studentNo}番`);
    ws.addRow([]);
    ws.addRow([
      off.length
        ? `赤字の「答案の合計点」は、○✕から計算した得点と合いません（${off.join("、")}）。○✕△と配点を確認してください。`
        : "「答案の合計点」は、丸付け済みの答案に先生が書いた合計点を読み取ったものです。",
    ]).font = { color: off.length ? RED : GRAY };
  }

  ws.getColumn(1).width = 6;
  if (withNames) ws.getColumn(2).width = 14;
  for (let c = withNames ? 3 : 2; c <= lead.length; c++) ws.getColumn(c).width = c > lead.length - totals.length ? 14 : 8;
  if (hasWritten) ws.getColumn(rateCol + 1).width = 13;
  qs.forEach((q, i) => (ws.getColumn(first + i).width = Math.min(18, Math.max(7, q.tag.length * 1.8, q.answer.length * 1.4))));
  ws.views = [{ state: "frozen", xSplit: withNames ? 2 : 1, ySplit: headerRow }];
};

const writeSummarySheet = (ws: Worksheet, subject: Subject, tests: Test[], students: Student[], results: Result[], withNames: boolean) => {
  const overall = tagStats(results, tests);
  const lead = withNames ? ["番号", "氏名"] : ["番号"];
  ws.addRow([`単元ごとの正答率（${subject}）`, `書き出し日 ${date(Date.now())}`]).font = { bold: true, size: 13 };
  const headerRow = ws.addRow([...lead, ...overall.map((s) => s.tag)]).number;
  styleHeader(ws, headerRow);

  for (const s of students) {
    const mine = new Map(tagStats(results.filter((r) => r.studentNo === s.no), tests).map((x) => [x.tag, x.rate]));
    const row = ws.addRow([...(withNames ? [s.no, s.name] : [s.no]), ...overall.map((o) => mine.get(o.tag) ?? "")]);
    overall.forEach((o, i) => {
      const cell = row.getCell(lead.length + 1 + i);
      cell.numFmt = "0%";
      cell.alignment = { horizontal: "center" };
      if (typeof cell.value === "number" && cell.value < 0.7) cell.font = { bold: true, color: RED };
    });
  }
  const classRow = ws.addRow([...Array(lead.length - 1).fill(""), "クラス", ...overall.map((o) => o.rate)]);
  classRow.font = { bold: true };
  classRow.eachCell((c, col) => {
    c.fill = HEADER_FILL;
    c.alignment = { horizontal: "center" };
    if (col > lead.length) c.numFmt = "0%";
  });
  ws.addRow([]);
  ws.addRow(["赤字は正答率70%未満（苦手かもしれない単元）。部分点（△）は得点の割合で数えています。"]).font = { color: GRAY };

  ws.getColumn(1).width = 6;
  if (withNames) ws.getColumn(2).width = 14;
  overall.forEach((o, i) => (ws.getColumn(lead.length + 1 + i).width = Math.min(20, Math.max(9, o.tag.length * 2))));
  ws.views = [{ state: "frozen", xSplit: lead.length, ySplit: headerRow }];
};

/** 児童 × 観点の得点率と A・B・C の目安 */
const writeKantenSheet = (ws: Worksheet, subject: Subject, tests: Test[], students: Student[], results: Result[], withNames: boolean, abc: AbcThresholds) => {
  const overall = kantenStats(results, tests);
  const lead = withNames ? ["番号", "氏名"] : ["番号"];
  ws.addRow([`観点別の得点率と評価の目安（${subject}）`, `書き出し日 ${date(Date.now())}`]).font = { bold: true, size: 13 };
  const headerRow = ws.addRow([...lead, ...overall.flatMap((k) => [`${k.kanten}`, "得点", "目安"])]).number;
  styleHeader(ws, headerRow);

  for (const s of students) {
    const mine = new Map(kantenStats(results.filter((r) => r.studentNo === s.no), tests).map((k) => [k.kanten, k]));
    const row = ws.addRow([
      ...(withNames ? [s.no, s.name] : [s.no]),
      ...overall.flatMap((o) => {
        const k = mine.get(o.kanten);
        return k ? [k.rate, `${k.earned}/${k.points}`, abcOf(k.rate, abc)] : ["", "", ""];
      }),
    ]);
    overall.forEach((_, i) => {
      const c = lead.length + 1 + i * 3;
      row.getCell(c).numFmt = "0%";
      [c, c + 1, c + 2].forEach((x) => (row.getCell(x).alignment = { horizontal: "center" }));
      const g = row.getCell(c + 2);
      g.font = { bold: true, color: g.value === "C" ? RED : g.value === "A" ? { argb: "FF2E7D4F" } : undefined };
    });
  }
  const classRow = ws.addRow([...Array(lead.length - 1).fill(""), "クラス", ...overall.flatMap((o) => [o.rate, "", ""])]);
  classRow.font = { bold: true };
  classRow.eachCell((c, col) => {
    c.fill = HEADER_FILL;
    c.alignment = { horizontal: "center" };
    if (col > lead.length && (col - lead.length - 1) % 3 === 0) c.numFmt = "0%";
  });
  ws.addRow([]);
  ws.addRow([`目安：A ${abc.a}%以上／B ${abc.c}%以上 ${abc.a}%未満／C ${abc.c}%未満。得点率＝その観点の得点の合計 ÷ 採点した問題の配点の合計。`]).font = { color: GRAY };
  ws.addRow(["あくまで目安です。最終的な評価は、テスト以外の学習の様子もふまえて先生が決めてください。"]).font = { color: GRAY };

  ws.getColumn(1).width = 6;
  if (withNames) ws.getColumn(2).width = 14;
  overall.forEach((_, i) => {
    const c = lead.length + 1 + i * 3;
    ws.getColumn(c).width = 18;
    ws.getColumn(c + 1).width = 9;
    ws.getColumn(c + 2).width = 6;
  });
  ws.views = [{ state: "frozen", xSplit: lead.length, ySplit: headerRow }];
};

/**
 * 採点結果をExcelにする。
 * base を渡すと、そのファイルに「単元別まとめ」と各テストのシートを書き足す（同じ名前のシートは最新の内容で上書き）。
 */
export const buildExcel = async ({ withNames, base }: { withNames: boolean; base?: File }) => {
  const ExcelJS = (await import("exceljs")).default;
  const [students, tests, results] = await Promise.all([
    db.students.orderBy("no").toArray(),
    db.tests.orderBy("createdAt").toArray(),
    db.results.toArray(),
  ]);

  const wb = new ExcelJS.Workbook();
  if (base) {
    try {
      await wb.xlsx.load(await base.arrayBuffer());
    } catch {
      throw new Error("このファイルは読み込めませんでした。まるつけ帳で書き出した .xlsx ファイルを選んでください。");
    }
  }
  wb.creator = "まるつけ帳";

  const before = new Set(wb.worksheets.map((w) => w.name.toLowerCase()));
  const abc = await loadAbc();
  // 新しく作るまとめのシートは、ファイルの先頭に教科の順で並べる（前からあるシートは元の位置のまま）
  let nextFront = Math.min(0, ...wb.worksheets.map((w) => order(w).orderNo)) - 1000;
  const place = (ws: Worksheet, name: string) => {
    if (!before.has(name.toLowerCase())) order(ws).orderNo = nextFront++;
    return ws;
  };

  // 教科ごとに「単元別」「観点別（観点が設定されていれば）」のまとめを作る
  for (const subject of SUBJECTS) {
    const ts = tests.filter((t) => subjectOf(t) === subject);
    const ids = new Set(ts.map((t) => t.id));
    const rs = results.filter((r) => ids.has(r.testId));
    if (rs.length === 0) continue;
    writeSummarySheet(place(freshSheet(wb, summarySheet(subject)), summarySheet(subject)), subject, ts, students, rs, withNames);
    if (kantenStats(rs, ts).length > 0)
      writeKantenSheet(place(freshSheet(wb, kantenSheet(subject)), kantenSheet(subject)), subject, ts, students, rs, withNames, abc);
  }

  const names = testSheetNames(tests);
  const added: string[] = [];
  const updated: string[] = [];
  // テストのシートは教科ごと・登録順に並べる
  const ordered = [...tests].sort((a, b) => SUBJECTS.indexOf(subjectOf(a)) - SUBJECTS.indexOf(subjectOf(b)) || a.createdAt - b.createdAt);
  for (const t of ordered) {
    const rs = results.filter((r) => r.testId === t.id);
    if (rs.length === 0) continue; // まだ採点していないテストは書き出さない
    const name = names.get(t.id!)!;
    (before.has(name.toLowerCase()) ? updated : added).push(name);
    writeTestSheet(freshSheet(wb, name), t, students, rs, withNames);
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const summaries = wb.worksheets.filter((w) => SUMMARY_NAMES.has(w.name.toLowerCase())).length;
  return { blob, added, updated, kept: wb.worksheets.length - added.length - updated.length - summaries };
};
