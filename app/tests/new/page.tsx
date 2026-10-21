"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnswerKeyCapture } from "@/components/AnswerKeyCapture";
import { CornerEditor } from "@/components/CornerEditor";
import { PhotoInput } from "@/components/PhotoInput";
import { type LabeledRect, RectEditor } from "@/components/RectEditor";
import { kantenTotals } from "@/lib/analytics";
import { requestExtractKey } from "@/lib/api-client";
import { NEW_TEST_DRAFT_KEY, clearDraft, loadDraft, useAutoSaveDraft } from "@/lib/drafts";
import { type AnswerFormat, getSetting, setSetting, KANTEN, KANTEN_SHORT, type Kanten, type Question, type Rect, SIDE_LABEL, type Side, db, sideOf } from "@/lib/db";
import { FORMATS, inferFormat } from "@/lib/judge";
import { SUBJECTS, type Subject } from "@/lib/subjects";
import { useGradingMode, useModel } from "@/lib/settings-hooks";
import {
  type Quad,
  type SourceImage,
  TEMPLATE_WIDTH,
  blackout,
  defaultQuad,
  detectQuad,
  encodeJpeg,
  estimateHeight,
  loadSource,
  warp,
} from "@/lib/warp";

/** 1つの面（表・裏）の登録の状態 */
type SideState = {
  stage: "photo" | "corners" | "ready";
  source: SourceImage | null;
  sourceBlob: Blob | null; // 続きから再開するために端末内に残す写真（縮小済み）
  quad: Quad;
  autoCorners: boolean;
  sheet: { canvas: HTMLCanvasElement; url: string } | null; // まっすぐに補正した模範解答
  masks: Rect[]; // 黒塗りする範囲
};
type Draw = { kind: "mask" } | { kind: "box"; index: number } | null;

const emptySide = (): SideState => ({ stage: "photo", source: null, sourceBlob: null, quad: defaultQuad(), autoCorners: false, sheet: null, masks: [] });

/** 登録の途中の状態（アプリを閉じても続きから再開する） */
type SideDraft = Pick<SideState, "stage" | "sourceBlob" | "quad" | "autoCorners" | "masks">;
type NewTestDraft = {
  subject: Subject;
  title: string;
  questions: Question[];
  active: Side;
  answerKeys: Partial<Record<Side, Blob>>;
  sides: Record<Side, SideDraft | null>;
};

/** 写真と四すみの位置から、まっすぐに補正した模範解答を作る */
const makeSheet = (source: SourceImage, quad: Quad) =>
  new Promise<{ canvas: HTMLCanvasElement; url: string }>((resolve, reject) => {
    const canvas = warp(source.canvas, quad, TEMPLATE_WIDTH, estimateHeight(quad, source.canvas.width, source.canvas.height));
    canvas.toBlob((b) => (b ? resolve({ canvas, url: URL.createObjectURL(b) }) : reject(new Error("画像を作れませんでした"))), "image/jpeg", 0.9);
  });

/** 保存しておいた途中の状態から、その面を作り直す */
const restoreSide = async (d: SideDraft | null): Promise<SideState | null> => {
  if (!d) return null;
  if (!d.sourceBlob) return { ...emptySide(), masks: d.masks };
  const source = await loadSource(d.sourceBlob);
  const sheet = d.stage === "ready" ? await makeSheet(source, d.quad) : null;
  return { ...d, stage: sheet ? "ready" : d.stage === "ready" ? "corners" : d.stage, source, sheet };
};

/** 名前欄を黒塗りした模範解答画像 */
const maskedImage = (s: SideState) => {
  const c = document.createElement("canvas");
  c.width = s.sheet!.canvas.width;
  c.height = s.sheet!.canvas.height;
  c.getContext("2d")!.drawImage(s.sheet!.canvas, 0, 0);
  blackout(c, s.masks);
  return encodeJpeg(c);
};

const NewTest = () => {
  const router = useRouter();
  const model = useModel();
  const { mode } = useGradingMode();
  const [sides, setSides] = useState<Record<Side, SideState | null>>({ front: emptySide(), back: null });
  const [active, setActive] = useState<Side>("front");
  const [title, setTitle] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [draw, setDraw] = useState<Draw>({ kind: "mask" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [subject, setSubject] = useState<Subject>("算数");
  // 前回の途中の状態があれば、そこから再開する。なければ前回選んだ教科から始める
  const [restoring, setRestoring] = useState(true);
  const [resumed, setResumed] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  useEffect(() => {
    (async () => {
      const draft = await loadDraft<NewTestDraft>(NEW_TEST_DRAFT_KEY);
      if (draft) {
        try {
          const [front, back] = await Promise.all([restoreSide(draft.sides.front), restoreSide(draft.sides.back)]);
          setSides({ front: front ?? emptySide(), back });
          setSubject(draft.subject);
          setTitle(draft.title);
          setQuestions(draft.questions);
          setAnswerKeys(draft.answerKeys);
          const act = draft.active === "back" && back ? "back" : "front";
          setActive(act);
          // 表面の名前欄がまだなら、名前欄を囲むところから
          const a = act === "back" ? back : front;
          setDraw(a?.stage === "ready" && a.masks.length === 0 && act === "front" ? { kind: "mask" } : null);
          setResumed(true);
        } catch {
          await clearDraft(NEW_TEST_DRAFT_KEY);
        }
      } else {
        const v = await getSetting("lastSubject", "算数");
        if ((SUBJECTS as readonly string[]).includes(v)) setSubject(v as Subject);
      }
      setRestoring(false);
    })();
  }, []);
  const changeSubject = (next: Subject) => {
    // 自動で決めた答えの形は、新しい教科に合わせて決め直す（先生が手で選んだ形はそのまま）
    setQuestions((qs) => qs.map((q) => (q.format === undefined || q.format === inferFormat(q.answer, subject).format ? { ...q, ...inferFormat(q.answer, next) } : q)));
    setSubject(next);
    setSetting("lastSubject", next);
  };
  // 教員用の解答用紙（任意）
  const [answerKeys, setAnswerKeys] = useState<Partial<Record<Side, Blob>>>({});
  const answerKeyUrls = useMemo(
    () => Object.fromEntries(Object.entries(answerKeys).map(([k, b]) => [k, URL.createObjectURL(b)])) as Partial<Record<Side, string>>,
    [answerKeys],
  );
  useEffect(() => () => Object.values(answerKeyUrls).forEach((u) => u && URL.revokeObjectURL(u)), [answerKeyUrls]);

  // 登録の途中の状態を、自動で端末内に保存する（撮影も問題の入力もまだなら保存しない）
  const draftValue = useMemo<NewTestDraft | null>(() => {
    if (sides.front?.stage === "photo" && !sides.back && questions.length === 0) return null;
    const toDraft = (x: SideState | null): SideDraft | null =>
      x && { stage: x.stage, sourceBlob: x.sourceBlob, quad: x.quad, autoCorners: x.autoCorners, masks: x.masks };
    return { subject, title, questions, active, answerKeys, sides: { front: toDraft(sides.front), back: toDraft(sides.back) } };
  }, [subject, title, questions, active, answerKeys, sides]);
  useAutoSaveDraft(
    NEW_TEST_DRAFT_KEY,
    { label: `答案用紙の登録（${subject}${title.trim() ? `・${title.trim()}` : ""}）`, href: "/tests/new" },
    draftValue,
    !restoring && !discarding,
  );

  const startOver = async () => {
    if (!confirm("登録の途中の内容を消して、最初からやり直しますか？")) return;
    setDiscarding(true);
    await clearDraft(NEW_TEST_DRAFT_KEY);
    window.location.reload();
  };

  const cur = sides[active];
  const patchSide = (side: Side, patch: Partial<SideState>) => setSides((s) => ({ ...s, [side]: { ...s[side]!, ...patch } }));
  const hasBack = sides.back !== null;
  const onSide = (side: Side) => questions.filter((q) => sideOf(q) === side);

  const switchSide = (side: Side) => {
    setActive(side);
    setError("");
    const s = sides[side];
    // 名前欄がまだなければ、まず名前欄を囲むところから（裏面は名前欄がなければ囲まなくてよい）
    setDraw(s?.stage === "ready" && s.masks.length === 0 && (side === "front" || onSide(side).length === 0) ? { kind: "mask" } : null);
  };

  const pick = async (f: File) => {
    // まっすぐにしたあと（名前欄や解答欄の枠を描いたあと）に撮り直すと、その面の枠は描き直しになる
    const drawn = (cur?.masks.length ?? 0) + onSide(active).filter((q) => q.box).length;
    if (cur?.stage === "ready" && drawn > 0 && !confirm(`${SIDE_LABEL[active]}面を撮り直すと、名前欄と解答欄の枠は描き直しになります（正答などの入力はそのまま残ります）。撮り直しますか？`)) return;
    if (cur?.source) URL.revokeObjectURL(cur.source.url);
    if (cur?.sheet) URL.revokeObjectURL(cur.sheet.url);
    const loaded = await loadSource(f);
    const detected = detectQuad(loaded.canvas);
    const { blob: sourceBlob } = await encodeJpeg(loaded.canvas, 0.9);
    patchSide(active, { source: loaded, sourceBlob, sheet: null, quad: detected ?? defaultQuad(), autoCorners: !!detected, stage: "corners", masks: [] });
    // 用紙を撮り直すと大きさが変わるので、その面の解答用紙も登録し直してもらう
    setAnswerKeys(({ [active]: _drop, ...rest }) => rest);
    // 撮り直した面の解答欄の枠は位置が変わるので消す
    setQuestions((qs) => qs.map((q) => (sideOf(q) === active ? { ...q, box: undefined } : q)));
    setError("");
  };

  const straighten = async () => {
    if (!cur?.source) return;
    if (cur.sheet) URL.revokeObjectURL(cur.sheet.url);
    const side = active;
    patchSide(side, { sheet: await makeSheet(cur.source, cur.quad), stage: "ready" });
    setDraw(cur.masks.length === 0 ? { kind: "mask" } : null);
  };

  /** 四すみの調整から戻る：まっすぐにしたことがあればその画面へ、なければ撮る前へ */
  const backFromCorners = () => {
    if (!cur) return;
    if (cur.sheet) return patchSide(active, { stage: "ready" });
    if (cur.source) URL.revokeObjectURL(cur.source.url);
    patchSide(active, { stage: "photo", source: null, sourceBlob: null });
  };

  const extract = async () => {
    if (!cur?.sheet) return;
    setLoading(true);
    setError("");
    try {
      const key = await requestExtractKey((await maskedImage(cur)).base64, model, subject);
      if (!title && key.title) setTitle(key.title);
      const read: Question[] = key.questions.map((q) => ({
        no: q.no,
        answer: q.answer,
        ...inferFormat(q.answer, subject),
        tag: q.tag,
        ...(q.kanten ? { kanten: q.kanten } : {}),
        points: q.points > 0 ? q.points : 1,
        side: active,
        alternatives: [],
        box: q.box ?? undefined,
      }));
      // 表の問題を先、裏の問題をあとに並べる
      const next = [...questions.filter((q) => sideOf(q) !== active), ...read].sort((a, b) => Number(sideOf(a) === "back") - Number(sideOf(b) === "back"));
      setQuestions(next);
      const firstMissing = next.findIndex((q) => sideOf(q) === active && !q.box);
      setDraw(firstMissing >= 0 ? { kind: "box", index: firstMissing } : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み取りに失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const addQuestion = (side: Side) => {
    const last = questions.at(-1);
    const q: Question = { no: String(questions.length + 1), answer: "", tag: last?.tag ?? "", ...(last?.kanten ? { kanten: last.kanten } : {}), points: 1, side, alternatives: [] };
    const next = [...questions, q].sort((a, b) => Number(sideOf(a) === "back") - Number(sideOf(b) === "back"));
    setQuestions(next);
    setActive(side);
    setDraw({ kind: "box", index: next.indexOf(q) });
  };

  const update = (i: number, patch: Partial<Question>) => setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));

  const onDraw = (rect: Rect) => {
    if (draw?.kind === "mask") patchSide(active, { masks: [...cur!.masks, rect] });
    if (draw?.kind === "box") {
      update(draw.index, { box: rect, side: active });
      // 同じ面の、次の「枠なし」の問題へ自動で進む
      const next = questions.findIndex((q, j) => j > draw.index && !q.box && sideOf(q) === active);
      setDraw(next >= 0 ? { kind: "box", index: next } : null);
    }
  };

  /** 枠を描く問題を選ぶ（その問題の面に切り替える） */
  const selectBox = (i: number) => {
    const side = sideOf(questions[i]);
    if (sides[side]?.stage !== "ready") {
      setError(`${SIDE_LABEL[side]}面の答案用紙を先に撮影して、まっすぐにしてください。`);
      return;
    }
    setActive(side);
    setDraw({ kind: "box", index: i });
  };

  const addBack = () => {
    setSides((s) => ({ ...s, back: emptySide() }));
    setActive("back");
    setDraw(null);
  };

  const removeBack = () => {
    if (onSide("back").length > 0 && !confirm(`裏面の問題 ${onSide("back").length}問も一覧から消えます。裏面をなくしますか？`)) return;
    if (sides.back?.source) URL.revokeObjectURL(sides.back.source.url);
    if (sides.back?.sheet) URL.revokeObjectURL(sides.back.sheet.url);
    setSides((s) => ({ ...s, back: null }));
    setQuestions((qs) => qs.filter((q) => sideOf(q) !== "back"));
    setAnswerKeys(({ back: _drop, ...rest }) => rest);
    switchSide("front");
  };

  const setKantenFor = (side: Side, kanten: Kanten | "") =>
    setQuestions((qs) =>
      qs.map((q) => {
        if (sideOf(q) !== side) return q;
        const { kanten: _old, ...rest } = q;
        return kanten ? { ...rest, kanten } : rest;
      }),
    );

  const save = async () => {
    const cleaned = questions.filter((q) => q.no.trim() && q.answer.trim());
    const front = sides.front!;
    const back = sides.back;
    const useBack = back?.sheet && cleaned.some((q) => sideOf(q) === "back");
    const id = await db.tests.add({
      title: title.trim() || `${subject}テスト`,
      subject,
      createdAt: Date.now(),
      questions: cleaned.map((q) => (sideOf(q) === "back" ? q : (({ side: _s, ...rest }) => rest)(q))),
      masks: front.masks,
      template: { width: front.sheet!.canvas.width, height: front.sheet!.canvas.height, image: (await maskedImage(front)).blob },
      ...(Object.keys(answerKeys).length ? { answerKeys: useBack ? answerKeys : { front: answerKeys.front } } : {}),
      ...(useBack
        ? { back: { masks: back.masks, template: { width: back.sheet!.canvas.width, height: back.sheet!.canvas.height, image: (await maskedImage(back)).blob } } }
        : {}),
    });
    setDiscarding(true);
    await clearDraft(NEW_TEST_DRAFT_KEY);
    router.push(`/grade?id=${id}`);
  };

  const rects: LabeledRect[] = cur
    ? [
        ...cur.masks.map((rect) => ({ rect, kind: "mask" as const })),
        ...questions.flatMap((q, i) =>
          q.box && sideOf(q) === active
            ? [{ rect: q.box, label: q.no, kind: draw?.kind === "box" && draw.index === i ? ("active" as const) : ("box" as const) }]
            : [],
        ),
      ]
    : [];
  const missingBoxes = questions.filter((q) => !q.box).length;
  const tags = [...new Set(questions.map((q) => q.tag).filter(Boolean))];
  const needsMask = active === "front" && (cur?.masks.length ?? 0) === 0;
  const totals = kantenTotals(questions);
  const total = questions.reduce((s, q) => s + q.points, 0);
  const sidesReady = (["front", "back"] as const).filter((s) => sides[s]?.stage === "ready");

  if (restoring) return <p className="text-muted">読み込み中…</p>;

  return (
    <div className="space-y-6">
      {resumed && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">
          ↩ 前回の登録の途中から再開しました。
          <button className="ml-auto underline" onClick={startOver}>
            最初からやり直す
          </button>
        </p>
      )}
      <div>
        <h1 className="text-2xl font-bold">答案用紙を登録</h1>
        <p className="text-sm text-muted">最初に1回登録すれば、あとは児童の答案を撮るだけで、解答欄ごとに切り出して採点します。裏面があるテストは、表と裏の両方を登録します。</p>
      </div>

      <section className="card space-y-2">
        <h2 className="font-bold">教科</h2>
        <div className="flex flex-wrap gap-1.5">
          {SUBJECTS.map((x) => (
            <button
              key={x}
              onClick={() => changeSubject(x)}
              className={`rounded-lg border px-4 py-1.5 text-sm font-bold ${subject === x ? "border-accent bg-accent text-white" : "border-line bg-white"}`}
            >
              {x}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">
          {subject === "国語" && "縦書きの解答欄にも対応します。漢字の書き取りは、字の形（とめ・はね・はらい）を必ず先生が確認します。"}
          {subject === "算数" && "数字・あまり・単位つきの答えは自動で判定します。"}
          {subject === "理科" && "語句・記号・単位つきの答え（℃、g など）に対応します。"}
          {subject === "社会" && "記号（ア・イ・ウ）や語句の答えに対応します。漢字指定の問題は「漢字」の形にしてください。"}
          {subject === "外国語" && "英語のつづり・大文字小文字を区別して判定します。英文は正答と違えば先生の確認に回します。"}
          {subject === "その他" && "記号・語句・記述の答えに対応します。"}
        </p>
      </section>

      <section className="card space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-line bg-white p-1">
            {(["front", "back"] as const).map((side) =>
              sides[side] ? (
                <button
                  key={side}
                  onClick={() => switchSide(side)}
                  className={`rounded-lg px-4 py-1.5 text-sm font-bold ${active === side ? "bg-ink text-white" : "text-muted"}`}
                >
                  {SIDE_LABEL[side]}面{onSide(side).length > 0 && <span className="ml-1 font-normal">（{onSide(side).length}問）</span>}
                </button>
              ) : null,
            )}
          </div>
          {hasBack ? (
            <button className="btn-ghost py-1 text-sm" onClick={removeBack}>
              裏面をなくす
            </button>
          ) : (
            <button className="btn-ghost py-1 text-sm" onClick={addBack} disabled={sides.front?.stage !== "ready"}>
              ＋ 裏面もある
            </button>
          )}
          {cur?.stage === "ready" && (
            <span className="ml-auto flex flex-wrap gap-2">
              <button className="btn-ghost py-1 text-sm" onClick={() => patchSide(active, { stage: "corners" })}>
                四すみを合わせ直す
              </button>
              <PhotoInput label="撮り直す" onPick={pick} className="btn-ghost py-1 text-sm" retake />
            </span>
          )}
        </div>

        {cur && (
          <>
            {cur.stage === "photo" && (
              <div className="space-y-2">
                <h2 className="font-bold">{SIDE_LABEL[active]}面の模範解答（答えを書き込んだテスト）を撮影</h2>
                <p className="text-sm text-muted">用紙全体が写るように、なるべく真上から撮ってください。</p>
                <PhotoInput label="カメラで撮る" onPick={pick} className="btn-primary" />
              </div>
            )}

            {cur.stage === "corners" && cur.source && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-bold">{SIDE_LABEL[active]}面：用紙の四すみを合わせる</h2>
                  <PhotoInput label="撮り直す" onPick={pick} className="btn-ghost py-1 text-sm" retake wrapClassName="ml-auto" />
                </div>
                <div className="mx-auto max-w-xl">
                  <CornerEditor imageUrl={cur.source.url} quad={cur.quad} onChange={(quad) => patchSide(active, { quad })} />
                </div>
                <p className={`text-sm ${cur.autoCorners ? "text-ok" : "text-review"}`}>
                  {cur.autoCorners ? "✓ 用紙の四すみを自動で見つけました。ずれていたら丸を動かしてください。" : "用紙の四すみを自動で見つけられませんでした。丸を動かして合わせてください。"}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button className="btn-ghost" onClick={backFromCorners}>
                    ← 戻る
                  </button>
                  <button className="btn-primary" onClick={straighten}>
                    まっすぐにする →
                  </button>
                </div>
              </div>
            )}

            {cur.stage === "ready" && cur.sheet && (
              <div className={onSide(active).length === 0 ? "grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]" : "mx-auto max-w-2xl"}>
                <div className="space-y-2">
                  <RectEditor
                    imageUrl={cur.sheet.url}
                    rects={rects}
                    onDraw={draw ? onDraw : null}
                    onSelect={(label) => {
                      const index = questions.findIndex((q) => q.no === label && sideOf(q) === active);
                      if (index >= 0) setDraw({ kind: "box", index });
                    }}
                  />
                  <p className="rounded-lg bg-accent/5 p-2 text-sm">
                    {draw?.kind === "mask" &&
                      (active === "front"
                        ? "名前欄の上を指でなぞって囲んでください。黒い部分は毎回、端末の中で塗りつぶされます。"
                        : "裏面にも名前欄があれば、なぞって囲んでください。なければ囲まなくてかまいません。")}
                    {draw?.kind === "box" && (
                      <>
                        <b className="text-pen">{questions[draw.index]?.no}</b> の解答欄（児童が答えを書く場所）をなぞって囲んでください。
                      </>
                    )}
                    {!draw && "青い枠が解答欄です。ずれている枠は、右の表の「枠」ボタンか、枠の番号をタップして描き直せます。"}
                  </p>
                  <div className="flex flex-wrap gap-2 text-sm">
                    <button className={`btn-ghost py-1 text-sm ${draw?.kind === "mask" ? "border-pen text-pen" : ""}`} onClick={() => setDraw({ kind: "mask" })}>
                      名前欄を{cur.masks.length > 0 ? "追加で" : ""}囲む
                    </button>
                    {cur.masks.length > 0 && (
                      <button className="btn-ghost py-1 text-sm" onClick={() => patchSide(active, { masks: cur.masks.slice(0, -1) })}>
                        黒塗りをひとつ戻す
                      </button>
                    )}
                  </div>
                </div>

                {onSide(active).length === 0 && (
                  <div className="space-y-3">
                    <div className="space-y-3 rounded-xl border border-line p-3">
                      <p className="font-bold">{SIDE_LABEL[active]}面の問題を登録</p>
                      {mode === "ai" ? (
                        <>
                          <p className="text-sm">
                            {needsMask ? "名前欄を囲んだら、" : ""}AIが{SIDE_LABEL[active]}面の問題番号・正答・解答欄の位置を読み取ります。
                          </p>
                          <button className="btn-primary w-full" onClick={extract} disabled={loading || needsMask}>
                            {loading ? "AIが読み取り中…（数十秒かかることがあります）" : needsMask ? "先に名前欄を囲んでください" : `${SIDE_LABEL[active]}面の問題をAIで読み取る`}
                          </button>
                        </>
                      ) : (
                        <p className="rounded-lg bg-accent/5 p-3 text-sm">AIなしモードです。問題ごとに解答欄を指で囲み、正答を入力してください（1枚につき1回だけの作業です）。</p>
                      )}
                      <button className={`${mode === "ai" ? "btn-ghost" : "btn-primary"} w-full`} disabled={needsMask} onClick={() => addQuestion(active)}>
                        {needsMask ? "先に名前欄を囲んでください" : mode === "ai" ? "AIを使わず自分で入力する" : "解答欄と正答を入力する →"}
                      </button>
                      {error && <p className="text-sm text-pen">{error}</p>}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {cur?.stage === "ready" && cur.sheet && (
        <section className="card space-y-3">
          <h2 className="font-bold">
            {hasBack ? `${SIDE_LABEL[active]}面の` : ""}教員用の解答用紙（任意）
          </h2>
          <p className="text-sm text-muted">
            教師用の解答（赤刷りなど）を撮影しておくと、採点のときに児童の答案と並べて見比べられます。この画像は端末の中だけに保存し、AIには送りません。あとから採点画面で登録することもできます。
          </p>
          <AnswerKeyCapture
            width={cur.sheet.canvas.width}
            height={cur.sheet.canvas.height}
            currentUrl={answerKeyUrls[active]}
            onCapture={(blob) => setAnswerKeys((k) => ({ ...k, [active]: blob }))}
            onRemove={() => setAnswerKeys(({ [active]: _drop, ...rest }) => rest)}
          />
        </section>
      )}

      {questions.length > 0 && (
        <section className="card space-y-3">
          <h2 className="font-bold">問題・正答・観点を確認</h2>
          <div>
            <label className="label" htmlFor="title">
              テスト名
            </label>
            <input id="title" className="input max-w-md" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`例：3年 ${subject === "国語" ? "漢字と読み取り" : subject === "算数" ? "わり算" : subject === "理科" ? "電気の通り道" : subject === "社会" ? "地図記号" : subject === "外国語" ? "Unit 3" : "テスト"}`} />
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-accent/5 p-2 text-sm">
            <span className="font-bold">観点をまとめて設定：</span>
            {(hasBack ? (["front", "back"] as const) : (["front"] as const)).map((side) => (
              <label key={side} className="flex items-center gap-1">
                {hasBack ? `${SIDE_LABEL[side]}面の問題を` : "全部の問題を"}
                <select className="input w-auto px-1 py-0.5" value="" onChange={(e) => setKantenFor(side, e.target.value as Kanten | "")}>
                  <option value="" disabled>
                    選ぶ
                  </option>
                  {KANTEN.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                  <option value="">（観点なし）</option>
                </select>
              </label>
            ))}
          </div>

          <datalist id="tags">
            {tags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-left text-muted">
                <tr>
                  {hasBack && <th className="w-14 py-1">面</th>}
                  <th className="w-16 py-1">問題</th>
                  <th className="py-1">正答</th>
                  <th className="w-28 py-1">答えの形</th>
                  <th className="py-1">単元</th>
                  <th className="w-36 py-1">観点</th>
                  <th className="w-16 py-1">配点</th>
                  <th className="w-14 py-1">枠</th>
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody>
                {questions.map((q, i) => {
                  const isActive = draw?.kind === "box" && draw.index === i;
                  return (
                    <tr key={i} className={`border-t border-line ${isActive ? "bg-pen/5" : ""}`}>
                      {hasBack && (
                        <td className="py-1 pr-1">
                          <select
                            className="input px-1 py-1"
                            value={sideOf(q)}
                            onChange={(e) => update(i, { side: e.target.value as Side, box: undefined })}
                            aria-label="面"
                          >
                            <option value="front">表</option>
                            <option value="back">裏</option>
                          </select>
                        </td>
                      )}
                      <td className="py-1 pr-1">
                        <input className="input px-2 py-1" value={q.no} onChange={(e) => update(i, { no: e.target.value })} />
                      </td>
                      <td className="py-1 pr-1">
                        <input
                          className="input px-2 py-1 font-bold"
                          placeholder={q.format === "essay" ? "模範解答・採点のポイント" : ""}
                          value={q.answer}
                          onChange={(e) => {
                            // 先生が手で選んだ形（自動推定と違う形）は上書きしない
                            const chosenByHand = q.format !== undefined && q.format !== inferFormat(q.answer, subject).format;
                            update(i, { answer: e.target.value, ...(chosenByHand ? {} : inferFormat(e.target.value, subject)) });
                          }}
                        />
                      </td>
                      <td className="py-1 pr-1">
                        <select className="input px-1 py-1" value={q.format ?? "text"} onChange={(e) => update(i, { format: e.target.value as AnswerFormat })}>
                          {FORMATS.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                        {q.format === "unit" && (
                          <input className="input mt-1 px-2 py-0.5 text-xs" placeholder="単位 例: cm" value={q.unit ?? ""} onChange={(e) => update(i, { unit: e.target.value })} />
                        )}
                      </td>
                      <td className="py-1 pr-1">
                        <input className="input px-2 py-1" list="tags" value={q.tag} onChange={(e) => update(i, { tag: e.target.value })} />
                      </td>
                      <td className="py-1 pr-1">
                        <select
                          className="input px-1 py-1"
                          value={q.kanten ?? ""}
                          onChange={(e) => {
                            const { kanten: _old, ...rest } = q;
                            setQuestions((qs) => qs.map((x, j) => (j === i ? (e.target.value ? { ...rest, kanten: e.target.value as Kanten } : rest) : x)));
                          }}
                        >
                          <option value="">—</option>
                          {KANTEN.map((k) => (
                            <option key={k} value={k}>
                              {KANTEN_SHORT[k]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1 pr-1">
                        <input type="number" min={0} className="input px-2 py-1" value={q.points} onChange={(e) => update(i, { points: Number(e.target.value) })} />
                      </td>
                      <td className="py-1">
                        <button
                          onClick={() => selectBox(i)}
                          className={`w-full rounded-lg border px-1 py-1 text-xs font-bold ${
                            isActive ? "border-pen bg-pen text-white" : q.box ? "border-accent/40 text-accent" : "border-review bg-review/10 text-review"
                          }`}
                        >
                          {isActive ? "描画中" : q.box ? "描き直す" : "未設定"}
                        </button>
                      </td>
                      <td>
                        <button className="text-muted hover:text-pen" aria-label="この行を削除" onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">
            「答えの形」はAIが読み取るときのヒントになり、判定のしかたも決まります。形に合わない答え（数字の欄に文字など）は「要確認」、「あまり」や単位の書き忘れ、漢字の問題をひらがなで書いた答えは自動で✕。「記号」はア・(ア)・ｱを同じとみなし、ひらがなの「あ」は要確認。「漢字」は字の形を必ず先生が確認。「英語」は大文字・小文字も区別します。「ことば・式」「英語の文」は正答と違えば要確認、「記述」は必ず先生が判定し、△（部分点）もつけられます。
            「観点」を設定すると、分析とExcelで観点別の得点率とA・B・Cの目安が出ます。
          </p>
          {error && <p className="text-sm text-pen">{error}</p>}
          <div className="flex flex-wrap gap-2">
            {sidesReady.map((side) => (
              <button key={side} className="btn-ghost text-sm" onClick={() => addQuestion(side)}>
                ＋ {hasBack ? `${SIDE_LABEL[side]}面に` : ""}問題を追加
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3">
            <span className="text-sm text-muted">
              合計 {total} 点 / {questions.length}問
              {hasBack && `（表 ${onSide("front").length}問・裏 ${onSide("back").length}問）`}
            </span>
            {totals.length > 0 && (
              <span className="text-sm text-muted">
                {totals.map((t) => `${KANTEN_SHORT[t.kanten]} ${t.points}点`).join("／")}
                {totals.reduce((s, t) => s + t.points, 0) < total && `／観点なし ${total - totals.reduce((s, t) => s + t.points, 0)}点`}
              </span>
            )}
            {missingBoxes > 0 && <span className="text-sm font-bold text-review">解答欄の枠が未設定：{missingBoxes}問</span>}
            <button className="btn-pen ml-auto" onClick={save} disabled={missingBoxes > 0 || questions.length === 0}>
              保存して採点へ →
            </button>
          </div>
        </section>
      )}
    </div>
  );
};

export default NewTest;
