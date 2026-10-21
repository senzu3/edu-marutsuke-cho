"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { AnswerKeyCapture } from "@/components/AnswerKeyCapture";
import { CornerEditor } from "@/components/CornerEditor";
import { GradeOverlay } from "@/components/GradeOverlay";
import { JudgeButtons } from "@/components/JudgeButtons";
import { PhotoInput } from "@/components/PhotoInput";
import { useAnswerKey } from "@/lib/answer-key";
import { allowsPartial, needsImage } from "@/lib/judge";
import { subjectOf } from "@/lib/subjects";
import { gradeDraftKey, clearDraft, loadDraft, useAutoSaveDraft } from "@/lib/drafts";
import { type ResultItem, SIDE_LABEL, type Side, type Test, calcScore, db, getSetting, gradedSides, setSetting, sheetOf, sidesOf } from "@/lib/db";
import { type PreparedSheet, type Verdict, applyVerdict, gradeSheet, isUnjudged, manualItems, prepareSheet, questionsOn, saveResult } from "@/lib/grading";
import { useGradingMode, useKeepImages, useModel } from "@/lib/settings-hooks";
import { QUALITY_MESSAGES, type Quad, type SourceImage, defaultQuad, detectQuad, encodeJpeg, loadSource } from "@/lib/warp";

type Stage = "photo" | "corners" | "quality" | "grading" | "review";
/** 裏面があるテストの採点の順番：1人ずつ表→裏 / 全員の表を先に */
type SideOrder = "student" | "side";

/** 採点の途中の状態（アプリを閉じても、この児童・この面の続きから再開する） */
type GradeDraft = {
  studentNo: number;
  side: Side;
  stage: "corners" | "review";
  source: Blob; // 撮った写真（端末内のみ。確定・やり直しで消す）
  quad: Quad;
  autoCorners: boolean;
  items: ResultItem[];
};

const Grade = () => {
  const testId = Number(useSearchParams().get("id"));
  const test = useLiveQuery(() => db.tests.get(testId), [testId]);
  const students = useLiveQuery(() => db.students.orderBy("no").toArray());
  const results = useLiveQuery(() => db.results.where("testId").equals(testId).toArray(), [testId]);
  const model = useModel();
  const keepImages = useKeepImages();
  const { mode } = useGradingMode();

  const [studentNo, setStudentNo] = useState<number | null>(null);
  const [side, setSide] = useState<Side>("front");
  const [sideOrder, setSideOrder] = useState<SideOrder>("student");
  useEffect(() => {
    getSetting("sideOrder", "student").then((v) => setSideOrder(v === "side" ? "side" : "student"));
  }, []);
  const [stage, setStage] = useState<Stage>("photo");
  const [source, setSource] = useState<SourceImage | null>(null);
  const [sourceBlob, setSourceBlob] = useState<Blob | null>(null);
  const [quad, setQuad] = useState<Quad>(defaultQuad());
  const [sheet, setSheet] = useState<PreparedSheet | null>(null);
  const [items, setItems] = useState<ResultItem[]>([]);
  const [error, setError] = useState("");
  const [autoCorners, setAutoCorners] = useState(false);
  // 教員用の解答用紙と並べて見比べるか
  const [compare, setCompare] = useState(true);
  const answerKey = useAnswerKey(test);
  // 前回の途中から再開したか（復元が終わるまでは、最初の児童を自動で選ばない）
  const [restoring, setRestoring] = useState(true);
  const [resumed, setResumed] = useState(false);
  const draftKey = gradeDraftKey(testId);

  // 前回の途中の状態を復元する
  useEffect(() => {
    if (!test || !students) return;
    let cancelled = false;
    (async () => {
      const draft = await loadDraft<GradeDraft>(draftKey);
      if (draft && students.some((s) => s.no === draft.studentNo) && sheetOf(test, draft.side)) {
        const loaded = await loadSource(draft.source);
        if (cancelled) return;
        setStudentNo(draft.studentNo);
        setSide(draft.side);
        setSource(loaded);
        setSourceBlob(draft.source);
        setQuad(draft.quad);
        setAutoCorners(draft.autoCorners);
        if (draft.stage === "review") {
          setSheet(await prepareSheet(loaded, draft.quad, test, draft.side));
          setItems(draft.items);
        }
        setStage(draft.stage);
        setResumed(true);
      }
      if (!cancelled) setRestoring(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!test, !!students, draftKey]);

  // 写真を撮ったあと〜確定までの状態を、自動で端末内に保存する
  const draftValue = useMemo<GradeDraft | null>(
    () =>
      sourceBlob && studentNo !== null && stage !== "photo"
        ? { studentNo, side, stage: stage === "review" ? "review" : "corners", source: sourceBlob, quad, autoCorners, items: stage === "review" ? items : [] }
        : null,
    [sourceBlob, studentNo, side, stage, quad, autoCorners, items],
  );
  const draftMeta = test && studentNo !== null
    ? { label: `${test.title}の採点（${studentNo}番${test.back ? `・${SIDE_LABEL[side]}面` : ""}）`, href: `/grade?id=${testId}` }
    : null;
  useAutoSaveDraft(draftKey, draftMeta, draftValue, !restoring);

  // AIなしモードで、解答欄の切り出し画像を並べて見せるためのURL
  const cropUrls = useMemo(() => new Map((sheet?.crops ?? []).map((c) => [c.no, URL.createObjectURL(c.blob)])), [sheet]);
  useEffect(() => () => cropUrls.forEach((u) => URL.revokeObjectURL(u)), [cropUrls]);

  const sides = test ? sidesOf(test) : (["front"] as Side[]);
  /** その児童の採点済みの面 */
  const doneSides = (no: number) => (test ? gradedSides(test, results?.find((r) => r.studentNo === no)) : []);
  // 全部の面を採点し終えた児童
  const gradedNos = new Set((results ?? []).filter((r) => doneSides(r.studentNo).length === sides.length).map((r) => r.studentNo));

  // 最初は未採点の一番若い番号（とその児童のまだの面）を選ぶ
  useEffect(() => {
    if (!restoring && studentNo === null && students && results && test) {
      const first = students.find((s) => !gradedNos.has(s.no)) ?? students[0];
      if (!first) return;
      setStudentNo(first.no);
      setSide(sides.find((x) => !doneSides(first.no).includes(x)) ?? "front");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, results, studentNo, test, restoring]);

  const reset = () => {
    if (source) URL.revokeObjectURL(source.url);
    if (sheet) URL.revokeObjectURL(sheet.url);
    setSource(null);
    setSourceBlob(null);
    setSheet(null);
    setItems([]);
    setError("");
    setStage("photo");
    setResumed(false);
    clearDraft(draftKey);
  };

  if (!test || !students || !results || !mode || restoring) return <p className="text-muted">読み込み中…</p>;

  if (!test.template || test.questions.some((q) => !q.box) || (questionsOn(test, "back").length > 0 && !test.back))
    return (
      <div className="card">
        このテストは答案用紙テンプレートがない古い形式です。
        <Link href="/tests/new" className="font-bold text-accent underline">
          答案用紙を登録
        </Link>
        し直してください。
      </div>
    );

  const pick = async (f: File) => {
    reset();
    const loaded = await loadSource(f);
    setSource(loaded);
    // 続きから再開できるように、縮小した写真を端末内に残しておく
    setSourceBlob((await encodeJpeg(loaded.canvas, 0.9)).blob);
    // 四すみを自動で探す。見つからなければ前の児童の位置を引き継ぐ（同じ置き方で撮れば、ほぼ合わせ直し不要）
    const detected = detectQuad(loaded.canvas);
    if (detected) setQuad(detected);
    setAutoCorners(!!detected);
    setStage("corners");
  };

  const send = async (prepared: PreparedSheet) => {
    // AIなし：全問「未判定」で丸付け画面へ
    if (mode === "manual") {
      setItems(manualItems(questionsOn(test, side)));
      setStage("review");
      return;
    }
    setStage("grading");
    try {
      setItems(await gradeSheet(prepared, questionsOn(test, side), model, subjectOf(test)));
      setStage("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "採点に失敗しました");
      setStage("corners");
    }
  };

  const grade = async () => {
    if (!source) return;
    setError("");
    const prepared = await prepareSheet(source, quad, test, side);
    if (sheet) URL.revokeObjectURL(sheet.url);
    setSheet(prepared);
    // ピンぼけ・暗いなどの写真は、AIに送る前に撮り直しをすすめる（読み間違いと料金のむだを防ぐ）
    if (prepared.issues.length > 0) setStage("quality");
    else await send(prepared);
  };

  /** 丸付けの画面から、四すみの調整に戻る（つけた○✕は消える） */
  const backToCorners = () => {
    if (items.some((i) => i.byTeacher) && !confirm("つけた○✕は消えます。四すみの調整に戻りますか？")) return;
    setItems([]);
    setError("");
    setStage("corners");
  };

  const setVerdict = (no: string, v: Verdict) => setItems((xs) => xs.map((x) => (x.no === no ? applyVerdict(x, v) : x)));
  const toggle = (no: string) => {
    const it = items.find((x) => x.no === no);
    if (it) setVerdict(no, it.correct ? { correct: false } : { correct: true });
  };

  // この面の点数と、もう一方の面（採点済みなら）と合わせた合計
  const sideQuestions = questionsOn(test, side);
  const sideScore = calcScore(items, sideQuestions);
  const currentResultForScore = results.find((r) => r.studentNo === studentNo);
  const otherItems = currentResultForScore?.items.filter((i) => !sideQuestions.some((q) => q.no === i.no)) ?? [];
  const { score, total } = calcScore([...otherItems, ...items], test.questions);
  const reviewCount = items.filter((i) => i.needsReview).length;
  const unjudgedCount = items.filter(isUnjudged).length;
  const markRestCorrect = () =>
    setItems((xs) => xs.map((x) => (isUnjudged(x) ? { ...x, correct: true, needsReview: false, byTeacher: true } : x)));
  // 漢字：正答と同じ字に読めたもの（字の形を先生が画像で確認したあと、まとめて○にする）
  const kanjiMatched = items.filter((x) => x.needsReview && x.correct && test.questions.find((q) => q.no === x.no)?.format === "kanji");
  const markKanjiCorrect = () =>
    setItems((xs) => xs.map((x) => (kanjiMatched.includes(x) ? { ...x, needsReview: false, byTeacher: true } : x)));

  const confirmResult = async () => {
    if (studentNo === null || !sheet) return;
    await saveResult(test, studentNo, side, items, sheet, keepImages);
    reset();
    const done = (no: number, x: Side) => (no === studentNo && x === side) || doneSides(no).includes(x);
    const nextStudent = (x: Side) =>
      students.find((s) => s.no > studentNo && !done(s.no, x)) ?? students.find((s) => s.no !== studentNo && !done(s.no, x));
    // 1人ずつ表→裏：同じ児童のまだの面へ。全員の表を先に：同じ面の次の児童へ（終わったら裏面の最初へ）
    if (sideOrder === "student") {
      const otherSide = sides.find((x) => !done(studentNo, x));
      if (otherSide) return setSide(otherSide);
      for (const s of [nextStudent("front"), nextStudent("back")]) {
        const x = s && sides.find((y) => !done(s.no, y));
        if (s && x) return (setStudentNo(s.no), setSide(x));
      }
    } else {
      for (const x of [side, ...sides.filter((y) => y !== side)]) {
        const s = nextStudent(x) ?? (!done(studentNo, x) ? students.find((t) => t.no === studentNo) : undefined);
        if (s) return (setStudentNo(s.no), setSide(x));
      }
    }
  };

  const current = students.find((s) => s.no === studentNo);
  const currentResult = results.find((r) => r.studentNo === studentNo);
  const pendingReview = results.reduce((n, r) => n + r.items.filter((i) => i.needsReview).length, 0);
  const questionOf = (no: string) => test.questions.find((q) => q.no === no);
  const answerOf = (no: string) => questionOf(no)?.answer ?? "";
  const isWritten = (no: string) => allowsPartial(questionOf(no)?.format);
  // AIなし・記述式は、解答欄の画像を見ながら判定する
  const showCrop = (no: string) => (mode === "manual" || needsImage(questionOf(no)?.format)) && cropUrls.has(no);
  const keyUrl = answerKey.sheets[side];
  const comparing = compare && !!keyUrl;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <Link href="/" className="text-sm text-muted hover:underline">
            ← テスト一覧
          </Link>
          <h1 className="text-2xl font-bold">{test.title}</h1>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted">
            採点済み {gradedNos.size}/{students.length}人
          </p>
          <Link href={`/grade/review?id=${testId}`} className={pendingReview > 0 ? "btn bg-review text-white" : "btn-ghost"}>
            {pendingReview > 0 ? `要確認・未判定 ${pendingReview}件をまとめて見る` : "問題ごとに見る"}
          </Link>
        </div>
      </div>

      <AnswerKeyManager test={test} sheets={answerKey.sheets} />

      {students.length === 0 ? (
        <div className="card">
          先に
          <Link href="/settings" className="font-bold text-accent underline">
            名簿
          </Link>
          を登録してください（番号だけでもOK）。
        </div>
      ) : (
        <section className="card">
          <div className="flex flex-wrap items-center gap-2">
            <p className="label mb-0">出席番号を選ぶ</p>
            {sides.length > 1 && (
              <label className="ml-auto flex items-center gap-1 text-sm text-muted">
                採点の順番
                <select
                  className="input w-auto px-1 py-0.5 text-sm"
                  value={sideOrder}
                  onChange={(e) => {
                    setSideOrder(e.target.value as SideOrder);
                    setSetting("sideOrder", e.target.value);
                  }}
                >
                  <option value="student">1人ずつ 表→裏</option>
                  <option value="side">全員の表を先に → 裏</option>
                </select>
              </label>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {students.map((s) => {
              const doneList = doneSides(s.no);
              const done = gradedNos.has(s.no);
              const partial = !done && doneList.length > 0;
              const active = s.no === studentNo;
              return (
                <button
                  key={s.no}
                  onClick={() => {
                    reset();
                    setStudentNo(s.no);
                    setSide(sides.find((x) => !doneList.includes(x)) ?? "front");
                  }}
                  title={partial ? `${doneList.map((x) => SIDE_LABEL[x]).join("・")}面だけ採点済み` : undefined}
                  className={`relative size-11 rounded-lg border text-sm font-bold transition ${
                    active
                      ? "border-accent bg-accent text-white"
                      : done
                        ? "border-ok/40 bg-ok/10 text-ok"
                        : partial
                          ? "border-dashed border-ok bg-white text-ok"
                          : "border-line bg-white"
                  }`}
                >
                  {s.no}
                  {partial && <span className="absolute -bottom-1 -right-1 rounded bg-ok px-0.5 text-[10px] leading-tight text-white">{SIDE_LABEL[doneList[0]]}</span>}
                </button>
              );
            })}
          </div>
          {sides.length > 1 && <p className="mt-2 text-xs text-muted">点線の番号は、表か裏の片方だけ採点済み（右下の字が済んだ面）です。</p>}
        </section>
      )}

      {current && (
        <section className="card space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xl font-bold">
              {current.no}番 <span className="text-base text-muted">{current.name}</span>
            </p>
            {sides.length > 1 && (
              <div className="inline-flex rounded-xl border border-line bg-white p-1">
                {sides.map((x) => (
                  <button
                    key={x}
                    onClick={() => {
                      reset();
                      setSide(x);
                    }}
                    className={`rounded-lg px-3 py-1 text-sm font-bold ${side === x ? "bg-ink text-white" : "text-muted"}`}
                  >
                    {SIDE_LABEL[x]}面{studentNo !== null && doneSides(studentNo).includes(x) && " ✓"}
                  </button>
                ))}
              </div>
            )}
            {currentResult && stage === "photo" && (
              <span className="rounded-full bg-ok/10 px-3 py-1 text-sm text-ok">
                {sides.length > 1 ? `${doneSides(currentResult.studentNo).map((x) => SIDE_LABEL[x]).join("・")}面 採点済み` : "採点済み"}：
                {currentResult.score}/{currentResult.total}点
                {studentNo !== null && doneSides(studentNo).includes(side) && "（撮り直すと上書き）"}
              </span>
            )}
            <div className="ml-auto">
              <PhotoInput
                label={source ? "撮り直す" : sides.length > 1 ? `${SIDE_LABEL[side]}面を撮影` : "答案を撮影"}
                onPick={pick}
                className={source ? "btn-ghost" : "btn-primary"}
                retake={!!source}
              />
            </div>
          </div>

          {resumed && stage !== "photo" && (
            <p className="flex flex-wrap items-center gap-2 rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">
              ↩ 前回の途中から再開しました。
              <button className="ml-auto underline" onClick={reset}>
                この答案をやめる
              </button>
            </p>
          )}

          {stage === "corners" && source && (
            <div className="space-y-3">
              <div className="mx-auto max-w-xl">
                <CornerEditor imageUrl={source.url} quad={quad} onChange={setQuad} />
              </div>
              <p className={`text-sm ${autoCorners ? "text-ok" : "text-review"}`}>
                {autoCorners
                  ? "✓ 用紙の四すみを自動で見つけました。ずれていたら丸を動かしてください。"
                  : "四すみを自動で見つけられなかったので、前の位置のままです。ずれていたら丸を動かしてください。"}
              </p>
              <p className="rounded-lg bg-accent/5 p-3 text-sm">
                {mode === "ai" ? (
                  <>
                    🔒 端末の中で名前欄を塗りつぶし、<b>解答欄だけを切り出して</b>AIに送ります。答案全体・名前・正答は送りません。
                  </>
                ) : (
                  <>
                    🔒 AIなしモード：画像はどこにも送りません。解答欄を切り出して並べるので、見ながら○✕を付けてください。
                  </>
                )}
              </p>
              {error && <p className="text-sm text-pen">{error}</p>}
              <div className="flex flex-wrap gap-2">
                <button className="btn-ghost" onClick={reset}>
                  ← 戻る（撮る前に戻る）
                </button>
                <button className="btn-pen flex-1 text-lg" onClick={grade}>
                  {mode === "ai" ? "○ AIで採点する" : "○ 解答欄を切り出して丸付けへ"}
                </button>
              </div>
            </div>
          )}

          {stage === "quality" && sheet && (
            <div className="space-y-3">
              <div className="rounded-lg border border-review bg-review/10 p-3">
                <p className="font-bold text-review">⚠ 写真の写りを確認してください</p>
                <ul className="mt-1 list-disc pl-5 text-sm">
                  {sheet.issues.map((i) => (
                    <li key={i}>{QUALITY_MESSAGES[i]}</li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-muted">このままだと{mode === "ai" ? "読み間違いが増える" : "答えが見づらい"}かもしれません。明るい場所で、真上からピントを合わせて撮り直すのがおすすめです。</p>
              </div>
              <div className="mx-auto max-w-xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sheet.url} alt="補正した答案" className="w-full rounded-xl border border-line" />
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-ghost" onClick={() => setStage("corners")}>
                  ← 四すみの調整に戻る
                </button>
                <PhotoInput label="撮り直す" onPick={pick} className="btn-primary" retake />
                <button className="btn-ghost ml-auto" onClick={() => send(sheet)}>
                  このまま採点する
                </button>
              </div>
            </div>
          )}

          {stage === "grading" && (
            <div className="grid place-items-center gap-3 py-16 text-muted">
              <span className="size-12 animate-spin rounded-full border-4 border-line border-t-pen" />
              AIが解答欄を読み取っています…
            </div>
          )}

          {stage === "review" && sheet && (
            <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
              <div className="space-y-2">
                {keyUrl && (
                  <div className="inline-flex rounded-xl border border-line bg-white p-1 text-sm">
                    <button onClick={() => setCompare(true)} className={`rounded-lg px-3 py-1 font-bold ${comparing ? "bg-ink text-white" : "text-muted"}`}>
                      解答用紙と並べる
                    </button>
                    <button onClick={() => setCompare(false)} className={`rounded-lg px-3 py-1 font-bold ${!comparing ? "bg-ink text-white" : "text-muted"}`}>
                      答案だけ
                    </button>
                  </div>
                )}
                {comparing ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="mb-1 text-xs font-bold text-muted">児童の答案</p>
                      <GradeOverlay imageUrl={sheet.url} items={items} onToggle={toggle} />
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-bold text-muted">教員用の解答用紙</p>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={keyUrl} alt="教員用の解答用紙" className="block w-full rounded-xl border border-line" />
                    </div>
                  </div>
                ) : (
                  <GradeOverlay imageUrl={sheet.url} items={items} onToggle={toggle} />
                )}
              </div>
              <div className="space-y-3">
                <button className="btn-ghost py-1 text-sm" onClick={backToCorners}>
                  ← 四すみの調整に戻る
                </button>
                <div className="flex items-baseline gap-3">
                  <span className="font-bold text-pen" style={{ fontSize: "3rem", lineHeight: 1 }}>
                    {score}
                  </span>
                  <span className="text-muted">/ {total}点</span>
                  {sides.length > 1 && (
                    <span className="text-sm text-muted">
                      （{SIDE_LABEL[side]}面 {sideScore.score}/{sideScore.total}点
                      {studentNo !== null && sides.some((x) => x !== side && !doneSides(studentNo).includes(x)) && "・もう一方の面は未採点"}）
                    </span>
                  )}
                  {unjudgedCount > 0 ? (
                    <span className="ml-auto rounded-full bg-review/15 px-3 py-1 text-sm font-bold text-review">未判定 {unjudgedCount}</span>
                  ) : (
                    reviewCount > 0 && <span className="ml-auto rounded-full bg-review/15 px-3 py-1 text-sm font-bold text-review">要確認 {reviewCount}</span>
                  )}
                </div>
                {unjudgedCount > 0 && (
                  <button className="btn-ghost w-full" onClick={markRestCorrect}>
                    ✓ 残り{unjudgedCount}問を全部○にする（✕の問題だけ先に付けておく）
                  </button>
                )}
                {kanjiMatched.length > 0 && (
                  <button className="btn-ghost w-full" onClick={markKanjiCorrect}>
                    ✓ 正答と同じ字の漢字 {kanjiMatched.length}問を○にする（字の形を画像で確認してから）
                  </button>
                )}
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {items.map((i) => (
                    <li key={i.no} className={`flex items-center gap-2 px-3 py-2 text-sm ${i.needsReview ? "bg-review/10" : ""}`}>
                      <span className="w-12 font-bold text-muted">{i.no}</span>
                      <span className="min-w-0 flex-1">
                        {comparing && cropUrls.has(i.no) && answerKey.crops.has(i.no) ? (
                          <>
                            <span className="grid grid-cols-2 gap-1.5">
                              <span>
                                <span className="block text-[10px] font-bold text-muted">児童</span>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={cropUrls.get(i.no)} alt={`${i.no}の児童の答え`} className="max-h-24 w-full rounded border border-line bg-white object-contain" />
                              </span>
                              <span>
                                <span className="block text-[10px] font-bold text-muted">解答</span>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={answerKey.crops.get(i.no)} alt={`${i.no}の解答`} className="max-h-24 w-full rounded border border-pen/40 bg-white object-contain" />
                              </span>
                            </span>
                            {mode === "ai" && <span className="block text-xs">読み取り：{i.studentAnswer || "（空欄）"}</span>}
                          </>
                        ) : showCrop(i.no) ? (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={cropUrls.get(i.no)} alt={`${i.no}の解答欄`} className="max-h-24 w-full rounded border border-line object-contain" />
                            {mode === "ai" && i.studentAnswer && <span className="block text-xs">読み取り：{i.studentAnswer}</span>}
                            <span className="block text-xs text-muted">
                              {questionOf(i.no)?.format === "essay" ? "模範解答" : "正答"} {answerOf(i.no)}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="font-bold">{i.studentAnswer || "（空欄）"}</span>
                            {!i.correct && <span className="ml-2 text-xs text-muted">正答 {answerOf(i.no)}</span>}
                          </>
                        )}
                        {i.needsReview && !isUnjudged(i) && i.reasons?.map((r) => <span key={r} className="block text-xs text-review">⚠ {r}</span>)}
                        {!i.needsReview && !i.correct && i.errorType && <span className="block text-xs text-pen">{i.errorType}</span>}
                      </span>
                      <JudgeButtons
                        size="sm"
                        item={i}
                        points={questionOf(i.no)?.points ?? 1}
                        allowPartial={isWritten(i.no)}
                        onVerdict={(v) => setVerdict(i.no, v)}
                      />
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted">
                  {mode === "manual"
                    ? "画像の？か ○✕ ボタンをタップして判定します。未判定のまま確定すると、あとで「問題ごとに並べる」画面で全員分をまとめて丸付けできます。"
                    : null}
                  {mode === "ai" && "黄色は「字が読みにくい」「2通りに読める」「答えの形に合わない」などの理由で先生の確認が必要な問題です。いま直さなくても、あとで「要確認をまとめて見る」から確認できます。"}
                </p>
                <button className="btn-pen w-full text-lg" onClick={confirmResult}>
                  {sides.length > 1 && sideOrder === "student" && studentNo !== null && sides.some((x) => x !== side && !doneSides(studentNo).includes(x))
                    ? `確定して${SIDE_LABEL[sides.find((x) => x !== side)!]}面へ →`
                    : "確定して次へ →"}
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
};

// URL は /grade?id=5 の形（サーバーなしの公開版でも動くように）
const Page = () => (
  <Suspense fallback={<p className="text-muted">読み込み中…</p>}>
    <Grade />
  </Suspense>
);

export default Page;

/** 教員用の解答用紙（赤刷りなど）の登録・撮り直し。答案用紙と同じ大きさにそろえて保存する */
const AnswerKeyManager = ({ test, sheets }: { test: Test; sheets: Partial<Record<Side, string>> }) => {
  const sides = sidesOf(test);
  const registered = sides.filter((x) => test.answerKeys?.[x]);
  const save = async (side: Side, blob: Blob | null) => {
    const { [side]: _old, ...rest } = test.answerKeys ?? {};
    await db.tests.update(test.id!, { answerKeys: blob ? { ...rest, [side]: blob } : rest });
  };
  return (
    <details className="card group">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-bold">
        <span className="text-muted transition group-open:rotate-90">▶</span>
        教員用の解答用紙
        <span className={`rounded-full px-2 py-0.5 text-xs ${registered.length ? "bg-ok/10 text-ok" : "bg-line/60 text-muted"}`}>
          {registered.length === 0
            ? "未登録"
            : sides.length > 1
              ? `${registered.map((x) => SIDE_LABEL[x]).join("・")}面 登録済み`
              : "登録済み"}
        </span>
        <span className="ml-auto text-xs font-normal text-muted">登録すると、答案と並べて見比べながら採点できます</span>
      </summary>
      <div className="mt-3 space-y-4">
        <p className="text-sm text-muted">教師用の解答（赤刷りなど）を撮影します。端末の中だけに保存し、AIには送りません。</p>
        {sides.map((side) => {
          const s = sheetOf(test, side);
          if (!s) return null;
          return (
            <div key={side} className="space-y-2">
              {sides.length > 1 && <p className="text-sm font-bold">{SIDE_LABEL[side]}面</p>}
              <AnswerKeyCapture
                width={s.template.width}
                height={s.template.height}
                currentUrl={sheets[side]}
                onCapture={(blob) => save(side, blob)}
                onRemove={() => confirm("この解答用紙の登録を外しますか？") && save(side, null)}
              />
            </div>
          );
        })}
      </div>
    </details>
  );
};
