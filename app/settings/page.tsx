"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { MODELS, db, deleteAll, exportAll, getSetting, importAll, setSetting } from "@/lib/db";
import { OwnApiKey } from "@/components/OwnApiKey";
import { STATIC_EDITION } from "@/lib/edition";
import { useAbc, useGradingMode } from "@/lib/settings-hooks";

const parseRoster = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)[\s,、.．:：\t]*(.*)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ no: Number(m[1]), name: m[2].trim() }));

const Settings = () => {
  const students = useLiveQuery(() => db.students.orderBy("no").toArray());
  const [bulk, setBulk] = useState("");
  const [model, setModel] = useState<string>(MODELS[0].id);
  const [keepImages, setKeepImages] = useState(false);
  const [message, setMessage] = useState("");
  const { mode, aiAvailable } = useGradingMode();

  useEffect(() => {
    getSetting("model", MODELS[0].id).then(setModel);
    getSetting("keepImages", "false").then((v) => setKeepImages(v === "true"));
  }, []);

  const addBulk = async () => {
    const rows = parseRoster(bulk);
    if (rows.length === 0) return setMessage("「1 山田花子」のように、行の先頭に出席番号を書いてください。");
    await db.students.bulkPut(rows);
    setBulk("");
    setMessage(`${rows.length}人を登録しました。`);
  };

  const addNumbersOnly = async () => {
    const count = Number(prompt("何人分の出席番号を作りますか？（名前は空欄のまま）", "30"));
    if (!count || count < 1 || count > 60) return;
    const existing = new Set((students ?? []).map((s) => s.no));
    const rows = Array.from({ length: count }, (_, i) => i + 1)
      .filter((no) => !existing.has(no))
      .map((no) => ({ no, name: "" }));
    await db.students.bulkPut(rows);
  };

  const downloadBackup = async () => {
    const data = await exportAll();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `marutsuke-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const restoreBackup = async (file: File) => {
    if (!confirm("現在のデータを、バックアップの内容で置き換えます。よろしいですか？")) return;
    try {
      await importAll(JSON.parse(await file.text()));
      setMessage("バックアップから復元しました。");
    } catch {
      setMessage("バックアップファイルを読み込めませんでした。");
    }
  };

  const wipe = async () => {
    if (!confirm("名簿・テスト・採点結果をすべて削除します。元に戻せません。よろしいですか？")) return;
    if (!confirm("本当に削除しますか？（先にバックアップを取ることをおすすめします）")) return;
    await deleteAll();
    setMessage("すべてのデータを削除しました。");
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">名簿・設定</h1>
      {message && <p className="rounded-lg bg-accent/10 px-4 py-2 text-sm text-accent">{message}</p>}

      <section className="card space-y-3">
        <h2 className="text-lg font-bold">🔒 個人情報の取り扱い</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
          <li>名簿・採点結果・分析はすべて<b>この端末のブラウザ内</b>に保存されます。サーバーには保存しません。</li>
          {STATIC_EDITION ? (
            <>
              <li>
                この公開版は、ふだんは<b>AIを使いません</b>。答案の写真・切り出し画像・名簿を含め、<b>どこにも送信しません</b>（画面の部品を読み込むだけで、データを受け取るサーバーはありません）。
              </li>
              <li>
                下の「自分のAPIキーでAIを使う」でキーを登録したときだけ、名前欄を塗りつぶした画像・切り出した解答欄を、この端末から<b>直接</b> Anthropic社のAIに送ります。氏名・出席番号・正答は送りません。
              </li>
            </>
          ) : (
            <>
          <li>
            AI（Anthropic社のClaude）に送るのは、端末内で名前欄を塗りつぶしたうえで<b>切り出した解答欄の画像</b>と、「数字」「あまり」などの<b>答えの形のヒント</b>だけです。答案全体・氏名・出席番号・正答は送りません（正誤の判定は端末内で行います）。
          </li>
          <li>Anthropic社のAPIに送ったデータは、標準ではAIの学習に使われません（同社の商用利用規約による）。</li>
            </>
          )}
          <li>作業の途中でアプリを閉じても続きから再開できるように、撮影中の写真と入力内容を<b>この端末の中だけ</b>に一時保存します。確定したとき・やめたときに削除され、バックアップにも含めません。</li>
          <li>答案全体の画像は採点確定後に破棄されます（下の設定で保存も可能）。解答欄の切り出し画像は「問題ごとに並べる」確認のため端末内に残り、確認画面のボタンで削除できます。</li>
          <li>ブラウザの「履歴とサイトデータの削除」をするとデータが消えます。定期的にバックアップを取ってください。</li>
          <li>
            iPadのSafariは、しばらく開かなかったサイトのデータを自動で消すことがあります。<b>共有ボタン →「ホーム画面に追加」</b>して、ホーム画面のアイコンから使ってください。
          </li>
        </ul>
        <p className="rounded-lg bg-review/10 p-3 text-sm">
          ⚠️ 実際の児童の答案で使う前に、勤務校・自治体の<b>情報セキュリティポリシー</b>（私物端末の利用可否、外部サービスへの送信可否など）を確認してください。
        </p>
      </section>

      <section className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">クラス名簿（{students?.length ?? 0}人）</h2>
          <button className="btn-ghost text-sm" onClick={addNumbersOnly}>
            番号だけ作る
          </button>
        </div>
        <div>
          <label className="label" htmlFor="bulk">
            まとめて登録（1行に「出席番号 名前」。Excelからの貼り付けも可）
          </label>
          <textarea
            id="bulk"
            className="input h-28 font-mono"
            placeholder={"1 青木 さくら\n2 石井 はると\n3 上田 ゆい"}
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
          />
          <button className="btn-primary mt-2" onClick={addBulk} disabled={!bulk.trim()}>
            登録する
          </button>
        </div>
        {students && students.length > 0 && (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {students.map((s) => (
              <li key={s.no} className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5">
                <span className="w-8 text-right font-bold text-muted">{s.no}</span>
                <input
                  className="min-w-0 flex-1 bg-transparent outline-none"
                  defaultValue={s.name}
                  placeholder="（名前なし）"
                  onBlur={(e) => db.students.update(s.no, { name: e.target.value })}
                />
                <button
                  className="text-muted hover:text-pen"
                  aria-label={`${s.no}番を削除`}
                  onClick={() => confirm(`${s.no}番を名簿から削除しますか？`) && db.students.delete(s.no)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-4">
        <h2 className="text-lg font-bold">採点の設定</h2>
        {STATIC_EDITION && <OwnApiKey />}
        {STATIC_EDITION && aiAvailable === false ? (
          <p className="rounded-lg bg-accent/5 p-3 text-sm">
            いまは<b>AIなし（先生が○✕）</b>で動いています。解答欄を切り出して並べるので、見ながらタップで○✕をつけてください。画像はどこにも送らず、費用もかかりません。
          </p>
        ) : (
          <>
        <fieldset className="space-y-2">
          <legend className="label">採点のしかた</legend>
          {[
            { id: "ai", title: "AIで読み取る", desc: "AIが答えを書き写し、正誤を自動で判定。先生は「要確認」だけ見ればよい（APIキーが必要・少額の利用料がかかる）" },
            { id: "manual", title: "AIなし（先生が○✕）", desc: "解答欄を切り出して並べ、先生がタップで○✕。画像はどこにも送らない・費用なし" },
          ].map((o) => (
            <label
              key={o.id}
              className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${mode === o.id ? "border-accent bg-accent/5" : "border-line"} ${o.id === "ai" && !aiAvailable ? "opacity-50" : ""}`}
            >
              <input
                type="radio"
                name="mode"
                className="mt-1 size-4"
                checked={mode === o.id}
                disabled={o.id === "ai" && !aiAvailable}
                onChange={() => setSetting("mode", o.id)}
              />
              <span>
                <b>{o.title}</b>
                <span className="block text-xs text-muted">{o.desc}</span>
              </span>
            </label>
          ))}
          {aiAvailable === false && !STATIC_EDITION && (
            <p className="text-xs text-review">APIキーが設定されていないため、AIなしで動いています。キーの設定方法は README.md の「セットアップ」を見てください。</p>
          )}
        </fieldset>
        <div className={mode === "manual" ? "hidden" : ""}>
          <label className="label" htmlFor="model">
            AIモデル
          </label>
          <select
            id="model"
            className="input"
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              setSetting("model", e.target.value);
            }}
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
          </>
        )}
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            className="size-5"
            checked={keepImages}
            onChange={(e) => {
              setKeepImages(e.target.checked);
              setSetting("keepImages", String(e.target.checked));
            }}
          />
          <span>
            補正・黒塗り済みの答案全体の画像を端末内に保存する
            <span className="block text-xs text-muted">OFF（おすすめ）なら、採点確定後に画像は破棄され、結果の数値だけが残ります。</span>
          </span>
        </label>
      </section>

      <AbcSettings />

      <section className="card space-y-3">
        <h2 className="text-lg font-bold">バックアップ・削除</h2>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={downloadBackup}>
            ⬇ バックアップを保存
          </button>
          <label className="btn-ghost cursor-pointer">
            ⬆ バックアップから復元
            <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && restoreBackup(e.target.files[0])} />
          </label>
          <button className="btn ml-auto border border-pen/40 text-pen hover:bg-pen/5" onClick={wipe}>
            すべてのデータを削除
          </button>
        </div>
        <p className="text-xs text-muted">バックアップには児童の名前が含まれます。校務用の安全な場所に保存してください（画像は含まれません）。</p>
      </section>
    </div>
  );
};

export default Settings;

/** 観点別の A・B・C の目安の基準 */
const AbcSettings = () => {
  const abc = useAbc();
  const save = (key: "abcA" | "abcC", raw: string) => {
    const n = Math.round(Number(raw.normalize("NFKC")));
    if (Number.isFinite(n) && n >= 0 && n <= 100) setSetting(key, String(n));
  };
  return (
    <section className="card space-y-3">
      <h2 className="text-lg font-bold">観点別評価の目安（A・B・C）</h2>
      <p className="text-sm text-muted">観点ごとの得点率（得点の合計 ÷ 配点の合計）から、分析画面とExcelに目安を表示します。基準は学校の決まりに合わせて変えてください。</p>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <label className="flex items-center gap-2">
          <b className="text-lg">A</b>
          <input key={`a${abc.a}`} type="number" min={0} max={100} className="input w-20" defaultValue={abc.a} onBlur={(e) => save("abcA", e.target.value)} />
          % 以上
        </label>
        <label className="flex items-center gap-2">
          <b className="text-lg">C</b>
          <input key={`c${abc.c}`} type="number" min={0} max={100} className="input w-20" defaultValue={abc.c} onBlur={(e) => save("abcC", e.target.value)} />
          % 未満
        </label>
        <span className="text-sm text-muted">
          B：{abc.c}% 以上 {abc.a}% 未満
        </span>
      </div>
      {abc.c > abc.a && <p className="text-sm text-pen">C の基準が A の基準より大きくなっています。</p>}
      <p className="text-xs text-muted">あくまで目安です。最終的な評価は、テスト以外の学習の様子もふまえて先生が決めてください。</p>
    </section>
  );
};
