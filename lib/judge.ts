import type { AnswerFormat, Question, ResultItem } from "./db";
import type { Subject } from "./subjects";

// AIは「書いてある通りに書き写す」だけ。正誤はこのファイルの処理で、端末内で決める。
// 正答をAIに見せないので、正答に引きずられた読み間違い（書いていない答えを読んでしまう）が起きにくい。

/** 表記ゆれをそろえる（全角→半角、空白除去、「余り」「…」→「あまり」など） */
export const normalize = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/余り|ｱﾏﾘ|アマリ|…|・・・|\.\.\./g, "あまり")
    .replace(/(\d),(?=\d{3}(\D|$))/g, "$1")
    .replace(/[−ー―‐](?=\d)/g, "-")
    .toLowerCase();

/** 先頭の数（整数・小数・分数）と、そのあとの文字（単位など）に分ける */
const splitNumber = (s: string) => {
  const m = s.match(/^(-?\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?(.*)$/);
  if (!m) return null;
  const value = m[2] ? Number(m[1]) / Number(m[2]) : Number(m[1]);
  return Number.isFinite(value) ? { value, rest: m[3] } : null;
};

/** 2つの答えが同じか（"0.50"="0.5"、"１２ｃｍ"="12cm"、"3 余り 2"="3あまり2"、"1/2"="0.5" など） */
export const sameAnswer = (a: string, b: string) => {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return true;
  const pa = splitNumber(na);
  const pb = splitNumber(nb);
  return !!pa && !!pb && Math.abs(pa.value - pb.value) < 1e-9 && pa.rest === pb.rest;
};

/** 記号の答えをそろえる（「(ア)」「ア」「ｱ」を同じに、①は1に） */
const normChoice = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[\s()（）「」『』\[\]【】.。、]/g, "")
    .toUpperCase();

/** 英語の答えをそろえる（前後と連続する空白、引用符の形だけ。大文字・小文字とつづりはそのまま） */
const normEnglish = (s: string) => s.normalize("NFKC").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

const hasKanji = (s: string) => /\p{Script=Han}/u.test(s);
const hiraToKata = (s: string) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

/** 答えの形に合わせて、2つの答えが同じか */
const matches = (a: string, b: string, format: AnswerFormat | undefined) => {
  if (format === "choice") return normChoice(a) === normChoice(b);
  if (format === "english") return normEnglish(a) === normEnglish(b);
  return sameAnswer(a, b);
};

/** 正答または登録済みの別解と一致するか */
export const isAccepted = (answer: string, q: Question) =>
  normalize(answer) !== "" && [q.answer, ...(q.alternatives ?? [])].some((x) => matches(answer, x, q.format));

/** 同じ答えか（別解の自動判定で、答えの形に合わせて比べる） */
export const sameAs = (a: string, b: string, q: Question) => matches(a, b, q.format);

// ---- 答えの形 ----

export const FORMATS: { id: AnswerFormat; label: string; hint: string }[] = [
  { id: "number", label: "数字", hint: "数字だけ（整数・小数・分数）" },
  { id: "remainder", label: "あまり", hint: "「○あまり○」の形" },
  { id: "unit", label: "単位つき", hint: "数字と単位" },
  { id: "choice", label: "記号", hint: "記号（ア・イ・ウ、①②、A・B など）1つ" },
  { id: "kanji", label: "漢字", hint: "漢字（書き取り）。字の形は直さずそのまま" },
  { id: "english", label: "英語", hint: "英語。つづり・大文字小文字・空白をそのまま" },
  { id: "text", label: "ことば・式", hint: "ことばや式" },
  { id: "essay", label: "記述", hint: "文章（記述式）。書かれている文をそのまま" },
];

/** 先生が判定するときに△（部分点）を出す形 */
export const allowsPartial = (format: AnswerFormat | undefined) => format === "essay" || format === "text" || format === "english";

/** 解答欄の画像を見ながら判定したい形（字の形を見る・文章を読む） */
export const needsImage = (format: AnswerFormat | undefined) => format === "essay" || format === "kanji";

/** 正答から答えの形を推定する（登録時の初期値。先生が変えられる） */
export const inferFormat = (answer: string, subject: Subject = "算数"): { format: AnswerFormat; unit?: string } => {
  const raw = answer.trim();
  // 記号：ア・イ・ウ、①②、(A) など1文字（外国語のアルファベットの問題は英語として扱う）
  if (/^[(（]?([ア-ン]|[①-⑳]|[Ａ-Ｚa-zA-Z])[)）]?$/.test(raw) && !(subject === "外国語" && /^[a-zA-Z]$/.test(raw))) return { format: "choice" };
  if (subject === "外国語" && /^[A-Za-z][A-Za-z .,'’!?-]*$/.test(raw)) return { format: "english" };
  const n = normalize(answer);
  if (/^-?\d+(\.\d+)?(\/\d+)?$/.test(n)) return { format: "number" };
  if (subject === "算数" && /^\d+あまり\d+$/.test(n)) return { format: "remainder" };
  if (subject === "算数" || subject === "理科") {
    const m = n.match(/^-?\d+(?:\.\d+)?(?:\/\d+)?([a-zぁ-んァ-ン㎝㎜㎞㎡²³%℃°円個本人枚日時分秒こさいページ]+)$/);
    if (m) return { format: "unit", unit: m[1] };
  }
  // 長い答えや句読点のある答えは記述式とみなす
  if (n.length > 15 || /[。、,.]/.test(n)) return { format: "essay" };
  // 国語の短い漢字の答えは書き取りとみなす
  if (subject === "国語" && hasKanji(raw)) return { format: "kanji" };
  return { format: "text" };
};

export const formatHint = (q: Question) => {
  const f = FORMATS.find((x) => x.id === (q.format ?? "text"))!;
  return q.format === "unit" && q.unit ? `数字と単位（${q.unit}）` : f.hint;
};

type FormatCheck = { ok: true } | { ok: false; review: boolean; reason: string };

/** 読み取った答えが登録した形に合っているか。明らかな書き忘れは「不正解」、読み間違いの疑いは「要確認」 */
const checkFormat = (text: string, q: Question): FormatCheck => {
  const n = normalize(text);
  if (n === "") return { ok: true };
  const isNumber = /^-?\d+(\.\d+)?(\/\d+)?$/.test(n);
  switch (q.format) {
    case "number":
      return isNumber ? { ok: true } : { ok: false, review: true, reason: "数字以外の文字が読み取られた（読み間違いの可能性）" };
    case "remainder":
      if (/^\d+あまり\d+$/.test(n)) return { ok: true };
      if (isNumber) return { ok: false, review: false, reason: "あまりの書き忘れ" };
      return { ok: false, review: true, reason: "「○あまり○」の形に読めない" };
    case "choice":
      if (/^[ぁ-ん]$/.test(n) && isAccepted(hiraToKata(n), q)) return { ok: false, review: true, reason: `記号をひらがなで書いている（「${n}」→「${hiraToKata(n)}」）` };
      return normChoice(text).length === 1 ? { ok: true } : { ok: false, review: true, reason: "記号1つに読めない" };
    case "kanji":
      return hasKanji(q.answer) && !hasKanji(text) ? { ok: false, review: false, reason: "漢字で書いていない" } : { ok: true };
    case "english":
      if (!isAccepted(text, q) && [q.answer, ...(q.alternatives ?? [])].some((x) => normEnglish(x).toLowerCase() === normEnglish(text).toLowerCase()))
        return { ok: false, review: true, reason: "大文字・小文字が違う" };
      return { ok: true };
    case "unit": {
      const p = splitNumber(n);
      if (!p) return { ok: false, review: true, reason: "数字が読み取れない" };
      if (p.rest === "") return { ok: false, review: false, reason: "単位の書き忘れ" };
      if (q.unit && p.rest !== normalize(q.unit)) return { ok: false, review: false, reason: "単位のまちがい" };
      return { ok: true };
    }
    default:
      return { ok: true };
  }
};

/** 不正解のときの誤りの傾向（端末内での簡単な推定） */
const guessError = (text: string, q: Question) => {
  const n = normalize(text);
  if (n === "") return "無回答";
  if (q.format === "choice") return "記号のまちがい";
  if (q.format === "kanji") return "漢字のまちがい";
  if (q.format === "english") return "つづりのまちがい";
  const a = normalize(q.answer);
  const rem = (s: string) => s.match(/^(\d+)あまり(\d+)$/);
  const ra = rem(a);
  const rn = rem(n);
  if (ra && rn) return ra[1] === rn[1] ? "あまりの計算ミス" : "商のまちがい";
  const pn = splitNumber(n);
  const pa = splitNumber(a);
  if (pn && pa && pn.rest === pa.rest) {
    const ratio = pn.value / pa.value;
    if ([10, 100, 0.1, 0.01].some((r) => Math.abs(ratio - r) < 1e-9)) return "位取りのミス";
    if (Number.isInteger(pa.value) && Math.abs(pn.value - pa.value) % 10 === 0) return "くり上がり・くり下がりのミス";
    return "計算ミス";
  }
  return "答えのまちがい";
};

/** AIの書き写し結果 */
export type Transcription = { no: string; text: string; legible: boolean; other_reading: string };

/** 1問分の判定 */
export const judge = (question: Question, t: Transcription | undefined, pos: { x: number; y: number } | null): ResultItem => {
  // 答えの形が未設定の古いテストは、正答から推定する
  const q = question.format ? question : { ...question, ...inferFormat(question.answer) };
  const text = t?.text ?? "";
  const blank = normalize(text) === "";
  const accepted = isAccepted(text, q);
  const format = checkFormat(text, q);

  const reasons: string[] = [];
  if (!t) reasons.push("AIが読み取れなかった");
  else if (!blank && q.format === "essay") {
    // 記述式は、書き方が人それぞれなので必ず先生が判定する（AIは読みやすく書き写すだけ）
    if (!accepted) reasons.push("記述式：先生が判定");
  } else if (!blank) {
    if (!t.legible) reasons.push("字が読みにくい");
    const other = t.other_reading.trim();
    if (other && normalize(other) !== normalize(text) && isAccepted(other, q) !== accepted)
      reasons.push(`2通りに読める（「${text}」か「${other}」）`);
    if (!format.ok && format.review) reasons.push(format.reason);
    // ことば・式の答えは書き方が何通りもあるので、正答と一致しなくても✕にせず先生に回す
    if (!accepted && q.format === "text") reasons.push("正答と書き方が違う（内容が合っていれば○に）");
    // 英文（単語が2つ以上）は言い方が何通りもあるので、先生に回す
    if (!accepted && q.format === "english" && format.ok && /\s/.test(q.answer.trim())) reasons.push("正答と英文が違う（内容が合っていれば○に）");
    // 漢字は、とめ・はね・はらいなど字の形をAIでは判断しきれないので、必ず先生が確認する
    if (q.format === "kanji" && format.ok) reasons.push(accepted ? "漢字：字の形（とめ・はね・はらい）を確認" : "漢字：先生が判定");
  }

  return {
    no: q.no,
    studentAnswer: text,
    otherReading: t?.other_reading || undefined,
    correct: accepted,
    confidence: t?.legible ? 1 : 0.4,
    needsReview: reasons.length > 0,
    reasons,
    x: pos?.x ?? null,
    y: pos?.y ?? null,
    errorType: accepted ? "" : !format.ok && !format.review ? format.reason : q.format === "essay" && !blank ? "" : guessError(text, q),
  };
};

/** ○×の印を描く位置：解答欄の右寄り中央 */
export const markPosition = (q: Question) =>
  q.box ? { x: Math.min(0.97, q.box.x + q.box.w * 0.8), y: q.box.y + q.box.h / 2 } : null;
