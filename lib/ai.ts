import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { type GradeItem, type KeyOutput, type MarksOutput, type ModelId, runExtractKey, runReadMarks, runTranscribe } from "./ai-core";
import type { Subject } from "./subjects";

export { ExtractRequest, GradeRequest, toUserError } from "./ai-core";

let client: Anthropic | null = null;
const getClient = () => {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("APIキーが設定されていません。.env.local に ANTHROPIC_API_KEY を書いてから再起動してください。");
  return (client ??= new Anthropic());
};

// ---- デモモード ----
// DEMO_MODE=1 のときはAIを呼ばずに固定のダミー結果を返す（画面の動作確認用。実際の採点には使わない）
const DEMO = process.env.DEMO_MODE === "1";
/** AIが使えるか（APIキーが設定されているか、デモモードか）。キーそのものは外に出さない */
export const aiAvailable = () => DEMO || !!process.env.ANTHROPIC_API_KEY;

const demoDelay = () => new Promise((r) => setTimeout(r, 800));

// 教科ごとのデモ用の模範解答（画面の動作確認用）。[問題番号, 正答, 単元, 配点, 観点]
const DEMO_ROWS: Partial<Record<Subject, { title: string; rows: [string, string, string, number, "知識・技能" | "思考・判断・表現"][] }>> = {
  算数: {
    title: "【デモ】3年 わり算",
    rows: [
      ["1(1)", "4", "わり算（九九1回）", 10, "知識・技能"],
      ["1(2)", "7", "わり算（九九1回）", 10, "知識・技能"],
      ["1(3)", "6", "わり算（九九1回）", 10, "知識・技能"],
      ["2(1)", "3あまり2", "あまりのあるわり算", 15, "知識・技能"],
      ["2(2)", "5あまり1", "あまりのあるわり算", 15, "知識・技能"],
      ["3", "8こ", "文章題（わり算）", 20, "思考・判断・表現"],
      ["4", "6日で3ページのこる", "文章題（わり算）", 20, "思考・判断・表現"],
    ],
  },
  国語: {
    title: "【デモ】3年 漢字と読み取り",
    rows: [
      ["1(1)", "海", "漢字の書き取り", 10, "知識・技能"],
      ["1(2)", "黒板", "漢字の書き取り", 10, "知識・技能"],
      ["1(3)", "はし", "漢字の読み", 10, "知識・技能"],
      ["2", "イ", "物語文の読み取り", 15, "思考・判断・表現"],
      ["3", "ちいちゃん", "物語文の読み取り", 15, "思考・判断・表現"],
      ["4", "家族と別れて、ひとりぼっちになってしまったから。", "物語文の読み取り", 20, "思考・判断・表現"],
      ["5", "主語", "ことばのきまり", 20, "知識・技能"],
    ],
  },
  社会: {
    title: "【デモ】3年 地図記号",
    rows: [
      ["1(1)", "ア", "地図記号", 10, "知識・技能"],
      ["1(2)", "ウ", "地図記号", 10, "知識・技能"],
      ["1(3)", "②", "地図記号", 10, "知識・技能"],
      ["2", "消防署", "くらしを守る仕事", 15, "知識・技能"],
      ["3", "北", "地図の見方", 15, "知識・技能"],
      ["4", "119番", "くらしを守る仕事", 20, "思考・判断・表現"],
      ["5", "火事が広がらないように、すぐに消すため。", "くらしを守る仕事", 20, "思考・判断・表現"],
    ],
  },
  外国語: {
    title: "【デモ】5年 Unit 3",
    rows: [
      ["1(1)", "A", "アルファベット（大文字）", 10, "知識・技能"],
      ["1(2)", "g", "アルファベット（小文字）", 10, "知識・技能"],
      ["2(1)", "apple", "単語（食べ物）", 10, "知識・技能"],
      ["2(2)", "Monday", "単語（曜日）", 15, "知識・技能"],
      ["3", "ア", "聞き取り", 15, "思考・判断・表現"],
      ["4", "I like soccer.", "自己紹介", 20, "思考・判断・表現"],
      ["5", "pencil", "単語（文房具）", 20, "知識・技能"],
    ],
  },
};

const demoKey = (subject: Subject): KeyOutput => {
  const { title, rows } = DEMO_ROWS[subject] ?? DEMO_ROWS.算数!;
  return {
    title,
    questions: rows.map(([no, answer, tag, points, kanten], i) => ({
      no,
      answer,
      tag,
      kanten,
      points,
      box: { x: 0.6, y: 0.17 + i * 0.1 + (i >= 5 ? 0.04 : 0), w: 0.35, h: 0.07 },
    })),
  };
};

/** デモ用：児童のよくある書き間違いをまねる */
const demoMistake = (answer: string, subject: Subject) => {
  if (/\d/.test(answer)) return answer.replace(/\d/, (d) => String((Number(d) + 1) % 10));
  if (subject === "外国語") return answer.length > 1 ? answer.slice(0, -1) : answer.toLowerCase() === answer ? answer.toUpperCase() : answer.toLowerCase();
  if (/^[ア-ン]$/.test(answer)) return "あいうえお"["アイウエオ".indexOf(answer)] ?? "エ";
  return answer.length > 1 ? answer.slice(1) : "かい";
};

export const extractKey = async (image: string, model: ModelId, subject: Subject) => {
  if (DEMO) return demoDelay().then(() => demoKey(subject));
  return runExtractKey(getClient(), image, model, subject);
};

/** 解答欄を書き写す（AIは1回だけ） */
export const transcribeAnswers = async (items: GradeItem[], model: ModelId, subject: Subject) => {
  if (DEMO) {
    await demoDelay();
    return {
      // デモ用の正答（サーバーには正答が送られないので、デモの模範解答を使う）
      answers: items.map((it) => {
        const answer = demoKey(subject).questions.find((q) => q.no === it.no)?.answer ?? "12";
        const r = Math.random();
        const wrong = r < 0.2;
        const unclear = r >= 0.2 && r < 0.3;
        return {
          no: it.no,
          text: wrong ? demoMistake(answer, subject) : answer,
          legible: !unclear,
          other_reading: unclear ? demoMistake(answer, subject) : "",
        };
      }),
    };
  }
  return runTranscribe(getClient(), items, model, subject);
};

/** 採点済みの答案から、先生の印を読み取る */
export const readMarks = async (items: GradeItem[], model: ModelId, subject: Subject): Promise<MarksOutput> => {
  if (DEMO) {
    await demoDelay();
    const marks = ["○", "○", "○", "✕", "△", "なし"] as const;
    return {
      marks: items.map((it) => {
        const mark = marks[Math.floor(Math.random() * marks.length)];
        return { no: it.no, mark, points: mark === "△" ? 1 : null, clear: Math.random() > 0.15 };
      }),
    };
  }
  return runReadMarks(getClient(), items, model, subject);
};
