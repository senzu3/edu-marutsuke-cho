import { requestGrade } from "./api-client";
import { type ModelId, type Question, type ResultItem, type Side, type Test, calcScore, db, sheetOf, sideOf } from "./db";
import { formatHint, isAccepted, judge, markPosition, sameAs } from "./judge";
import type { Subject } from "./subjects";
import { type QualityIssue, type Quad, type SourceImage, assessQuality, blackout, cropBox, encodeJpeg, enhanceCrop, warp } from "./warp";

export type PreparedSheet = {
  url: string; // 補正・黒塗り済みの答案（画面表示用）
  blob: Blob;
  crops: { no: string; base64: string; blob: Blob }[]; // base64=AIに送る読みやすく整えた画像、blob=確認画面用の元の画像
  issues: QualityIssue[]; // 写真の品質の問題（ピンぼけなど）
};

/** その面にある問題 */
export const questionsOn = (test: Test, side: Side) => test.questions.filter((q) => sideOf(q) === side);

/** 答案写真（表または裏）をテンプレートに合わせて補正し、名前欄を塗りつぶしてから、その面の解答欄ごとに切り出す */
export const prepareSheet = async (source: SourceImage, quad: Quad, test: Test, side: Side): Promise<PreparedSheet> => {
  const { template, masks } = sheetOf(test, side)!;
  const canvas = warp(source.canvas, quad, template.width, template.height);
  blackout(canvas, masks); // 切り出しより先に塗る：解答欄が名前欄に重なっていても名前は出ない
  const crops = await Promise.all(
    questionsOn(test, side).map(async (q) => {
      const crop = cropBox(canvas, q.box!);
      const { blob } = await encodeJpeg(crop, 0.9);
      const { base64 } = await encodeJpeg(enhanceCrop(crop), 0.9);
      return { no: q.no, base64, blob };
    }),
  );
  const { blob } = await encodeJpeg(canvas);
  return { url: URL.createObjectURL(blob), blob, crops, issues: assessQuality(canvas) };
};

/** AIに解答欄を書き写させ（1回）、端末内で正答表と照合する */
export const gradeSheet = async (sheet: PreparedSheet, questions: Question[], model: ModelId, subject: Subject): Promise<ResultItem[]> => {
  const res = await requestGrade(
    questions.map((q) => ({ no: q.no, image: sheet.crops.find((c) => c.no === q.no)!.base64, hint: formatHint(q) })),
    model,
    subject,
  );
  const byNo = new Map(res.answers.map((a) => [a.no, a]));
  return questions.map((q) => judge(q, byNo.get(q.no), markPosition(q)));
};

export const UNJUDGED = "未判定";

/** AIなしモード：全問「未判定」から始め、先生が○✕を付ける */
export const manualItems = (questions: Question[]): ResultItem[] =>
  questions.map((q) => ({
    no: q.no,
    studentAnswer: "",
    correct: false,
    confidence: 0,
    needsReview: true,
    reasons: [UNJUDGED],
    ...(markPosition(q) ?? { x: null, y: null }),
    errorType: "",
  }));

/** AIなしモードで採点した答え（AIの読み取りがない） */
export const isManual = (item: ResultItem) => !!item.reasons?.includes(UNJUDGED);
export const isUnjudged = (item: ResultItem) => item.needsReview && isManual(item);

/**
 * 1つの面の採点結果を保存する。同じ児童のその面の結果は上書きし、もう一方の面の結果は残す（表と裏を別々に撮れる）。
 * 切り出し画像は横並び採点用に端末内に残す
 */
export const saveResult = async (test: Test, studentNo: number, side: Side, sideItems: ResultItem[], sheet: PreparedSheet, keepImage: boolean) => {
  const testId = test.id!;
  const sideNos = new Set(questionsOn(test, side).map((q) => q.no));
  await db.transaction("rw", [db.results, db.crops, db.tests], async () => {
    const existing = await db.results.where({ testId, studentNo }).first();
    // 問題の順番どおりに、もう一方の面の結果とまとめる
    const merged = [...(existing?.items.filter((i) => !sideNos.has(i.no)) ?? []), ...sideItems];
    const items = test.questions.flatMap((q) => merged.filter((i) => i.no === q.no));
    const { score, total } = calcScore(items, test.questions);
    const { image: _front, backImage: _back, ...kept } = existing ?? {};
    await db.results.put({
      ...kept,
      testId,
      studentNo,
      createdAt: Date.now(),
      items,
      score,
      total,
      ...(existing?.image && side !== "front" ? { image: existing.image } : {}),
      ...(existing?.backImage && side !== "back" ? { backImage: existing.backImage } : {}),
      ...(keepImage ? { [side === "back" ? "backImage" : "image"]: sheet.blob } : {}),
    });
    await db.crops.where({ testId, studentNo }).filter((c) => sideNos.has(c.no)).delete();
    await db.crops.bulkAdd(sheet.crops.map((c) => ({ testId, studentNo, no: c.no, blob: c.blob })));
  });
  // 先生がこの答案で○にした別表記を、別解として覚える
  for (const item of sideItems) if (item.byTeacher && item.correct) await learnAlternative(testId, item.no, item.studentAnswer);
};

/**
 * 先生が○にした答えを別解として登録し、同じ答えで「要確認」になっている他の児童も自動で○にする。
 * 戻り値：自動で○にした件数
 */
export const learnAlternative = async (testId: number, no: string, answer: string) => {
  const test = await db.tests.get(testId);
  const q = test?.questions.find((x) => x.no === no);
  // 記述式は答えが人それぞれ、漢字は1人ずつ字の形を見る必要があるので、別解としては覚えない
  if (!test || !q || q.format === "essay" || q.format === "kanji" || !answer.trim() || isAccepted(answer, q)) return 0;

  const questions = test.questions.map((x) => (x.no === no ? { ...x, alternatives: [...(x.alternatives ?? []), answer] } : x));
  await db.tests.update(testId, { questions });

  let resolved = 0;
  const results = await db.results.where("testId").equals(testId).toArray();
  for (const r of results) {
    let changed = false;
    const items = r.items.map((i) => {
      if (i.no !== no || !i.needsReview || !sameAs(i.studentAnswer, answer, q)) return i;
      changed = true;
      resolved++;
      return { ...i, correct: true, needsReview: false, errorType: "" };
    });
    if (changed) await db.results.update(r.id!, { items, ...calcScore(items, questions) });
  }
  return resolved;
};

/** 判定：○ / ✕ / △（部分点） */
export type Verdict = { correct: true } | { correct: false; earned?: number };

/** 判定を1問に反映する（○✕のときは部分点を消す） */
export const applyVerdict = (item: ResultItem, v: Verdict): ResultItem => {
  const { earned: _old, ...rest } = item;
  return {
    ...rest,
    correct: v.correct,
    ...(!v.correct && v.earned !== undefined ? { earned: v.earned } : {}),
    needsReview: false,
    byTeacher: true,
    errorType: v.correct || v.earned !== undefined ? "" : item.errorType,
  };
};

/** △のときの部分点をたずねる。キャンセルなら null */
export const askPartial = (points: number, current?: number) => {
  const input = prompt(`部分点（△）は何点にしますか？（${points}点中）`, String(current ?? Math.floor(points / 2)));
  if (input === null) return null;
  const n = Number(input.normalize("NFKC"));
  return Number.isFinite(n) && n >= 0 && n <= points ? n : null;
};

/** 保存済みの結果の1問を先生が判定する */
export const judgeItem = async (resultId: number, no: string, verdict: Verdict | boolean) => {
  const v: Verdict = typeof verdict === "boolean" ? (verdict ? { correct: true } : { correct: false }) : verdict;
  const correct = v.correct;
  const r = await db.results.get(resultId);
  const test = r && (await db.tests.get(r.testId));
  if (!r || !test) return 0;
  const items = r.items.map((i) => (i.no === no ? applyVerdict(i, v) : i));
  await db.results.update(resultId, { items, ...calcScore(items, test.questions) });
  const item = items.find((i) => i.no === no)!;
  return correct ? learnAlternative(r.testId, no, item.studentAnswer) : 0;
};
