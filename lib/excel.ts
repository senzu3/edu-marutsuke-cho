import type { Cell, Workbook, Worksheet } from "exceljs";
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

/** テストのシートのどこに何を書いたか（先生が書き足したメモを、作り直したあとも同じ場所に戻すため） */
type TestSheetLayout = {
  lastCol: number; // 表のいちばん右の列
  topRows: Map<string, number>; // 表の上の行（題名・単元・正答・配点など）
  headerRow: number;
  studentRows: Map<number, number>; // 出席番号 → 行
  rateRow: number; // 「正答率・平均」の行
  endRow: number; // アプリが書いたいちばん下の行
};

const writeTestSheet = (ws: Worksheet, test: Test, students: Student[], results: Result[], withNames: boolean): TestSheetLayout => {
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

  const topRows = new Map<string, number>();
  const studentRows = new Map<number, number>();
  const titleRow = ws.addRow([test.title, `${subjectOf(test)}・登録日 ${date(test.createdAt)}`]);
  titleRow.font = { bold: true, size: 13 };
  topRows.set(TITLE_KEY, titleRow.number);
  const info = (label: string, values: (string | number)[]) => {
    const row = ws.addRow([...Array(lead.length - 1).fill(""), label, ...values]);
    topRows.set(label, row.number);
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
      studentRows.set(s.no, row.number);
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
    studentRows.set(s.no, row.number);
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

  let endRow = rateRow.number;
  if (hasWritten) {
    const off = graded.filter(mismatch).map((r) => `${r.studentNo}番`);
    ws.addRow([]);
    endRow = ws.addRow([
      off.length
        ? `赤字の「答案の合計点」は、○✕から計算した得点と合いません（${off.join("、")}）。○✕△と配点を確認してください。`
        : WRITTEN_NOTE,
    ]).number;
    ws.getRow(endRow).font = { color: off.length ? RED : GRAY };
  }

  ws.getColumn(1).width = 6;
  if (withNames) ws.getColumn(2).width = 14;
  for (let c = withNames ? 3 : 2; c <= lead.length; c++) ws.getColumn(c).width = c > lead.length - totals.length ? 14 : 8;
  if (hasWritten) ws.getColumn(rateCol + 1).width = 13;
  qs.forEach((q, i) => (ws.getColumn(first + i).width = Math.min(18, Math.max(7, q.tag.length * 1.8, q.answer.length * 1.4))));
  ws.views = [{ state: "frozen", xSplit: withNames ? 2 : 1, ySplit: headerRow }];
  return { lastCol: first + qs.length - 1, topRows, headerRow, studentRows, rateRow: rateRow.number, endRow };
};

// ---- 先生がテストのシートに書き足したメモを残す ----

const TITLE_KEY = "__title";
const WRITTEN_NOTE = "「答案の合計点」は、丸付け済みの答案に先生が書いた合計点を読み取ったものです。";
const WRITTEN_WARN = "赤字の「答案の合計点」は";

type CellSnap = { col: number; value: Cell["value"]; style: Cell["style"]; note?: Cell["note"] };
/** 前のファイルのテストのシートから取り出した、先生が書き足した部分 */
type KeptNotes = {
  rows: Map<string, CellSnap[]>; // 表の右側（col は表の右端からいくつ目か）。題名の行だけは列の位置そのまま
  below: { offset: number; cells: CellSnap[] }[]; // 表の下（offset は表の下端から何行目か。col は列の位置そのまま）
  widths: Map<number, number>; // 表の右側の列幅（右端からいくつ目か → 幅）
};

const text = (c: Cell) => (c.value === null || c.value === undefined ? "" : String(c.text ?? "").trim());
const snap = (c: Cell, col: number): CellSnap => ({
  col,
  value: c.value,
  style: JSON.parse(JSON.stringify(c.style ?? {})),
  ...(c.note ? { note: c.note } : {}),
});
const cellsOf = (ws: Worksheet, rowNo: number, fromCol: number, toCol = Infinity) => {
  const out: Cell[] = [];
  ws.getRow(rowNo).eachCell({ includeEmpty: false }, (c, col) => {
    if (col >= fromCol && col <= toCol && (text(c) || c.note)) out.push(c);
  });
  return out;
};

/** 前のファイルのテストのシートから、先生が書き足したセル（表の右側・表の下・題名の横）を取り出す */
const keepTeacherNotes = (ws: Worksheet): KeptNotes | null => {
  let headerRow = 0;
  for (let r = 1; r <= Math.min(ws.rowCount, 40) && !headerRow; r++) if (text(ws.getCell(r, 1)) === "番号") headerRow = r;
  if (!headerRow) return null;
  // 表の右端：アプリが色を付けた見出しのいちばん右（先生が見出しを書き足しても、色がなければ表の外とみなす）
  let lastCol = 0;
  ws.getRow(headerRow).eachCell({ includeEmpty: false }, (c, col) => {
    const fill = c.fill as { fgColor?: { argb?: string } } | undefined;
    if (fill?.fgColor?.argb === HEADER_FILL.fgColor.argb) lastCol = Math.max(lastCol, col);
  });
  if (!lastCol) return null;

  const rows = new Map<string, CellSnap[]>();
  const add = (key: string, cells: CellSnap[]) => cells.length && rows.set(key, [...(rows.get(key) ?? []), ...cells]);
  // 表の上の行：題名の行は3列目から、ほかは表の右側
  for (let r = 1; r < headerRow; r++) {
    if (r === 1) add(TITLE_KEY, cellsOf(ws, 1, 3).map((c) => snap(c, Number(c.col))));
    else {
      const label = cellsOf(ws, r, 1, lastCol).map(text)[0];
      if (label) add(`top:${label}`, cellsOf(ws, r, lastCol + 1).map((c) => snap(c, Number(c.col) - lastCol)));
    }
  }
  add("header", cellsOf(ws, headerRow, lastCol + 1).map((c) => snap(c, Number(c.col) - lastCol)));

  // 児童の行（出席番号で対応させる）と、「正答率・平均」の行
  let rateRow = 0;
  for (let r = headerRow + 1; r <= ws.rowCount && !rateRow; r++) {
    const inTable = cellsOf(ws, r, 1, lastCol).map(text);
    if (inTable.includes("正答率・平均")) rateRow = r;
    const no = Number(text(ws.getCell(r, 1)));
    const key = rateRow ? "rate" : Number.isInteger(no) && no > 0 && text(ws.getCell(r, 1)) !== "" ? `s:${no}` : null;
    if (key) add(key, cellsOf(ws, r, lastCol + 1).map((c) => snap(c, Number(c.col) - lastCol)));
  }
  if (!rateRow) return null;
  // アプリが書いた説明の行（答案の合計点）までを表とみなし、その下は先生が書いたものとして残す
  let endRow = rateRow;
  const noteRow = text(ws.getCell(rateRow + 2, 1));
  if (noteRow.startsWith(WRITTEN_WARN) || noteRow === WRITTEN_NOTE) endRow = rateRow + 2;
  const below: KeptNotes["below"] = [];
  for (let r = endRow + 1; r <= ws.rowCount; r++) {
    const cells = cellsOf(ws, r, 1).map((c) => snap(c, Number(c.col)));
    if (cells.length) below.push({ offset: r - endRow, cells });
  }

  const widths = new Map<number, number>();
  for (let c = lastCol + 1; c <= ws.columnCount; c++) {
    const w = ws.getColumn(c).width;
    if (w) widths.set(c - lastCol, w);
  }
  return { rows, below, widths };
};

/** 取り出しておいたメモを、作り直したシートの同じ場所（同じ児童の行・表の右側・表の下）に戻す */
const restoreTeacherNotes = (ws: Worksheet, kept: KeptNotes, layout: TestSheetLayout) => {
  const put = (row: number, col: number, s: CellSnap) => {
    const c = ws.getCell(row, col);
    c.value = s.value;
    c.style = s.style;
    if (s.note) c.note = s.note;
  };
  const rowOf = (key: string) => {
    if (key === TITLE_KEY) return layout.topRows.get(TITLE_KEY);
    if (key === "header") return layout.headerRow;
    if (key === "rate") return layout.rateRow;
    if (key.startsWith("top:")) return layout.topRows.get(key.slice(4));
    if (key.startsWith("s:")) return layout.studentRows.get(Number(key.slice(2)));
  };
  const orphans: CellSnap[][] = []; // 名簿から外れた児童の行のメモ（表の下に残す）
  for (const [key, cells] of kept.rows) {
    const row = rowOf(key);
    if (!row) {
      orphans.push(cells);
      continue;
    }
    for (const s of cells) put(row, key === TITLE_KEY ? s.col : layout.lastCol + s.col, s);
  }
  let last = layout.endRow;
  for (const b of kept.below) {
    last = layout.endRow + b.offset;
    for (const s of b.cells) put(last, s.col, s);
  }
  for (const cells of orphans) {
    last += 1;
    for (const s of cells) put(last, layout.lastCol + s.col, s);
  }
  for (const [offset, w] of kept.widths) ws.getColumn(layout.lastCol + offset).width = w;
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
    // 前のファイルの同じテストのシートに先生が書き足したメモは、作り直したあとも残す
    const old = wb.worksheets.find((w) => w.name.toLowerCase() === name.toLowerCase());
    const kept = old ? keepTeacherNotes(old) : null;
    const ws = freshSheet(wb, name);
    const layout = writeTestSheet(ws, t, students, rs, withNames);
    if (kept) restoreTeacherNotes(ws, kept, layout);
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const summaries = wb.worksheets.filter((w) => SUMMARY_NAMES.has(w.name.toLowerCase())).length;
  return { blob, added, updated, kept: wb.worksheets.length - added.length - updated.length - summaries };
};
