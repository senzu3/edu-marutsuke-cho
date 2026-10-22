import Dexie, { type EntityTable } from "dexie";

// すべてのデータは先生の端末内ブラウザ(IndexedDB)だけに保存される。
// サーバーやAIには送信しない。

/** 画像内の位置（0〜1の正規化座標） */
export type Rect = { x: number; y: number; w: number; h: number };

export type Student = {
  no: number; // 出席番号（主キー）
  name: string; // 氏名：端末内のみ。AIには送らない
};

/** 答えの形：number=数字だけ / remainder=○あまり○ / unit=数字と単位 / choice=記号 / kanji=漢字の書き取り（字の形は先生が確認） / english=英語 / text=ことば・式 / essay=記述（先生が判定） */
export type AnswerFormat = "number" | "remainder" | "unit" | "choice" | "kanji" | "english" | "text" | "essay";

/** 答案用紙の面。front=表、back=裏 */
export type Side = "front" | "back";
export const SIDE_LABEL: Record<Side, string> = { front: "表", back: "裏" };

/** 評価の3観点 */
export const KANTEN = ["知識・技能", "思考・判断・表現", "主体的に学習に取り組む態度"] as const;
export type Kanten = (typeof KANTEN)[number];
export const KANTEN_SHORT: Record<Kanten, string> = {
  "知識・技能": "知識・技能",
  "思考・判断・表現": "思考・判断・表現",
  "主体的に学習に取り組む態度": "主体的態度",
};

export type Question = {
  no: string; // 問題番号 例: "1(1)"
  answer: string; // 正答
  format?: AnswerFormat; // 答えの形（AIへのヒントと、読み取り結果の確認に使う）
  unit?: string; // format が unit のときの単位 例: "cm"
  alternatives?: string[]; // 別解（先生が○にした答えを自動で覚える）
  tag: string; // 単元タグ 例: "くり上がりのたし算"
  kanten?: Kanten; // 評価の観点（未設定なら観点別の集計に入れない）
  points: number; // 配点
  side?: Side; // どちらの面にあるか（未設定は表）
  box?: Rect; // その面のテンプレート上の解答欄の位置
};

export const sideOf = (q: Question): Side => q.side ?? "front";

/** 答案用紙テンプレート：まっすぐに補正した模範解答の画像（児童の情報は含まない） */
export type Template = { width: number; height: number; image: Blob };

export type Test = {
  id?: number;
  title: string;
  subject?: string;
  createdAt: number;
  questions: Question[];
  masks: Rect[]; // 黒塗りする範囲（名前欄など。表面のテンプレート上の位置）
  template?: Template; // 表面
  back?: { template: Template; masks: Rect[] }; // 裏面（ある場合だけ）
  /** 教員用の解答用紙（赤刷りなど）。答案用紙と同じ大きさにまっすぐ補正した画像。端末内だけに保存し、AIには送らない */
  answerKeys?: Partial<Record<Side, Blob>>;
  /** 点数欄の位置（丸付け済みの答案から、先生が書いた合計点を読み取るため。名前欄と同じく補正後の用紙上の位置） */
  scoreBox?: { side: Side; rect: Rect };
};

/** テストのある面の答案用紙と黒塗り範囲 */
export const sheetOf = (test: Test, side: Side) =>
  side === "back" ? test.back : test.template ? { template: test.template, masks: test.masks } : undefined;

/** テストにある面（裏面がなければ表だけ） */
export const sidesOf = (test: Test): Side[] => (test.back ? ["front", "back"] : ["front"]);

/** 結果の中で、採点済みの面 */
export const gradedSides = (test: Test, result: Result | undefined): Side[] =>
  result ? sidesOf(test).filter((side) => test.questions.some((q) => sideOf(q) === side && result.items.some((i) => i.no === q.no))) : [];

export type ResultItem = {
  no: string;
  studentAnswer: string; // AIが書き写した答え
  otherReading?: string; // 字が2通りに読める場合のもう一方の読み
  correct: boolean;
  earned?: number; // 部分点（△）のときの得点。○✕のときは使わない
  confidence: number; // 0〜1
  needsReview: boolean;
  reasons?: string[]; // 要確認になった理由
  byTeacher?: boolean; // 先生が判定した
  x: number | null; // ○×を描く位置（正規化座標）
  y: number | null;
  errorType: string; // 誤答の傾向（AIの推定）
  teacherMark?: string; // 丸付け済みの答案から読み取った先生の印（○✕△なし）
};

/** 解答欄の切り出し画像（問題ごとの横並び採点用。採点完了時に削除できる） */
export type Crop = { id?: number; testId: number; studentNo: number; no: string; blob: Blob };

export type Result = {
  id?: number;
  testId: number;
  studentNo: number;
  createdAt: number;
  items: ResultItem[];
  score: number;
  total: number;
  image?: Blob; // 表面の答案。設定で「画像を保存する」がONのときだけ
  backImage?: Blob; // 裏面の答案（同上）
  writtenScore?: number; // 丸付け済みの答案に先生が書いた合計点（読み取れたとき）
};

export type Setting = { key: string; value: string };

/**
 * 作業の途中の状態（アプリを閉じても続きから再開するため）。端末の中だけに保存し、バックアップには含めない。
 * key は "grade:テストのID" または "newTest"
 */
export type Draft = { key: string; label: string; href: string; updatedAt: number; data: unknown };

export const db = new Dexie("marutsuke") as Dexie & {
  students: EntityTable<Student, "no">;
  tests: EntityTable<Test, "id">;
  results: EntityTable<Result, "id">;
  settings: EntityTable<Setting, "key">;
  crops: EntityTable<Crop, "id">;
  drafts: EntityTable<Draft, "key">;
};

db.version(1).stores({
  students: "no",
  tests: "++id, createdAt",
  results: "++id, testId, studentNo, [testId+studentNo]",
  settings: "key",
});

db.version(2).stores({
  crops: "++id, testId, [testId+studentNo], [testId+no]",
});

db.version(3).stores({
  drafts: "key",
});

export const MODELS = [
  { id: "claude-opus-5-5", label: "高精度（Claude Opus 5.5）" },
  { id: "claude-sonnet-5-5", label: "低コスト（Claude Sonnet 5.5）" },
] as const;

export type ModelId = (typeof MODELS)[number]["id"];

export const getSetting = async (key: string, fallback: string) =>
  (await db.settings.get(key))?.value ?? fallback;

export const setSetting = (key: string, value: string) => db.settings.put({ key, value });

/** 1問の得点（○=配点、△=部分点、✕=0） */
export const itemPoints = (item: ResultItem, points: number) => (item.earned !== undefined ? item.earned : item.correct ? points : 0);

export const calcScore = (items: ResultItem[], questions: Question[]) => {
  const pointsOf = (no: string) => questions.find((q) => q.no === no)?.points ?? 1;
  const score = items.reduce((s, i) => s + itemPoints(i, pointsOf(i.no)), 0);
  const total = questions.reduce((s, q) => s + q.points, 0);
  return { score, total };
};

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

type BackupTemplate = Omit<Template, "image"> & { image: string };
type BackupTest = Omit<Test, "template" | "back" | "answerKeys"> & {
  template?: BackupTemplate;
  back?: { template: BackupTemplate; masks: Rect[] };
  answerKeys?: Partial<Record<Side, string>>;
};

const templateToBackup = async (t: Template): Promise<BackupTemplate> => ({ ...t, image: await blobToDataUrl(t.image) });
const templateFromBackup = async (t: BackupTemplate): Promise<Template> => ({ ...t, image: await (await fetch(t.image)).blob() });

/** バックアップ用。答案の画像は含めない（テンプレート＝模範解答の画像だけ含める） */
export const exportAll = async () => ({
  version: 2,
  exportedAt: new Date().toISOString(),
  students: await db.students.toArray(),
  tests: await Promise.all(
    (await db.tests.toArray()).map(
      async ({ template, back, answerKeys, ...t }): Promise<BackupTest> => ({
        ...t,
        ...(answerKeys
          ? { answerKeys: Object.fromEntries(await Promise.all(Object.entries(answerKeys).map(async ([k, b]) => [k, await blobToDataUrl(b)]))) }
          : {}),
        ...(template ? { template: await templateToBackup(template) } : {}),
        ...(back ? { back: { ...back, template: await templateToBackup(back.template) } } : {}),
      }),
    ),
  ),
  results: (await db.results.toArray()).map(({ image: _image, backImage: _back, ...r }) => r),
});

export const importAll = async (data: Awaited<ReturnType<typeof exportAll>>) => {
  const tests: Test[] = await Promise.all(
    data.tests.map(async ({ template, back, answerKeys, ...t }) => ({
      ...t,
      ...(answerKeys
        ? { answerKeys: Object.fromEntries(await Promise.all(Object.entries(answerKeys).map(async ([k, u]) => [k, await (await fetch(u)).blob()]))) }
        : {}),
      ...(template ? { template: await templateFromBackup(template) } : {}),
      ...(back ? { back: { ...back, template: await templateFromBackup(back.template) } } : {}),
    })),
  );
  await db.transaction("rw", [db.students, db.tests, db.results, db.crops, db.drafts], async () => {
    await Promise.all([db.students.clear(), db.tests.clear(), db.results.clear(), db.crops.clear(), db.drafts.clear()]);
    await db.students.bulkPut(data.students);
    await db.tests.bulkPut(tests);
    await db.results.bulkPut(data.results);
  });
};

export const deleteAll = () =>
  db.transaction("rw", [db.students, db.tests, db.results, db.settings, db.crops, db.drafts], () =>
    Promise.all([db.students.clear(), db.tests.clear(), db.results.clear(), db.settings.clear(), db.crops.clear(), db.drafts.clear()]),
  );
