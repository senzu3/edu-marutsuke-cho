"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, setSetting } from "@/lib/db";

/** 公開版で、先生が自分のAPIキーを登録してAIを使うための欄（注意書きつき） */
export const OwnApiKey = () => {
  const savedKey = useLiveQuery(async () => (await db.settings.get("apiKey"))?.value ?? "", []);
  const [input, setInput] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const check = async (key: string) => {
    const { checkKey } = await import("@/lib/ai-browser");
    await checkKey(key);
  };

  const register = async () => {
    const key = input.trim();
    if (!key.startsWith("sk-ant-")) return setStatus({ ok: false, text: "Anthropic社のAPIキー（sk-ant- で始まる文字列）を貼り付けてください。" });
    setBusy(true);
    setStatus(null);
    try {
      await check(key);
      await setSetting("apiKey", key);
      setInput("");
      setAgreed(false);
      setStatus({ ok: true, text: "キーを確認して登録しました。採点のしかたで「AIで読み取る」を選べます。" });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : "キーを確認できませんでした。" });
    } finally {
      setBusy(false);
    }
  };

  const recheck = async () => {
    if (!savedKey) return;
    setBusy(true);
    setStatus(null);
    try {
      await check(savedKey);
      setStatus({ ok: true, text: "このキーは使えます。" });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : "キーを確認できませんでした。" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm("この端末からAPIキーを削除し、AIなし（先生が○✕）に戻します。よろしいですか？")) return;
    await db.settings.delete("apiKey");
    await setSetting("mode", "manual");
    setStatus({ ok: true, text: "キーを削除しました。キーそのものを無効にするには、Anthropic社の管理画面（Console）でも削除してください。" });
  };

  if (savedKey === undefined) return null;

  return (
    <div className="space-y-3 rounded-xl border border-line p-4">
      <h3 className="font-bold">自分のAPIキーでAIを使う（任意）</h3>
      <p className="text-sm text-muted">
        AIに答えを読み取らせたい先生だけが使う機能です。使わなくても、AIなし（先生が○✕）ですべての機能が使えます。
      </p>

      <div className="space-y-2 rounded-lg bg-review/10 p-3 text-sm leading-relaxed">
        <p className="font-bold">⚠️ 使う前に必ずお読みください</p>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            <b>学校・自治体の許可が必要です。</b>
            名前欄を塗りつぶしているとはいえ、児童の答案の画像を外部のAIサービス（米国 Anthropic社）に送ることになります。勤務校・自治体の情報セキュリティポリシーで認められているか、管理職などに確認してから使ってください。
          </li>
          <li>
            <b>費用は、キーを発行した先生ご自身の負担です。</b>
            使った分だけ料金がかかる仕組み（従量課金）です。Anthropic社の管理画面（Console）で、月の利用上限額を設定しておくことを強くおすすめします。
          </li>
          <li>
            <b>送るのは、名前欄を塗りつぶした画像だけです。</b>
            テスト登録時の模範解答の写真と、児童の答案から切り出した解答欄の画像、「数字」「記号」などの答えの形のヒントだけを、この端末から直接 Anthropic社へ送ります。氏名・出席番号・正答は送りません。このサイトの作者や GitHub には何も送られません。
          </li>
          <li>
            Anthropic社のAPIに送ったデータは、標準ではAIの学習に使われません。ただし、不正利用の確認などのために、同社で一定期間保存されることがあります（最新の扱いは同社の規約を確認してください）。
          </li>
          <li>
            <b>キーはこの端末のブラウザの中だけに保存します。</b>
            バックアップファイルにも含めません。キーは他の人に教えないでください。<b>共用の端末では登録しないでください。</b>使わなくなったら、下の「キーを削除」と、Console でのキーの削除の両方を行ってください。
          </li>
          <li>
            AIの読み取りはまちがうことがあります。<b>採点結果は必ず先生が確認してください。</b>
          </li>
        </ol>
        <p className="text-xs text-muted">
          必要なのは、Anthropic社の管理画面（console.anthropic.com）で発行する「APIキー」（sk-ant- で始まる文字列）です。チャットサービス（claude.ai など）のアカウントや、他社のAIのキーでは使えません。
        </p>
      </div>

      {savedKey ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-ok">✓ キーを登録済み（末尾 …{savedKey.slice(-4)}）</span>
          <button className="btn-ghost text-sm" onClick={recheck} disabled={busy}>
            {busy ? "確認中…" : "キーが使えるか確かめる"}
          </button>
          <button className="btn ml-auto border border-pen/40 text-sm text-pen hover:bg-pen/5" onClick={remove}>
            キーを削除
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>上の注意をすべて読み、勤務校・自治体で外部AIの利用が認められていることを確認しました。</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              type="password"
              className="input min-w-0 flex-1 font-mono"
              placeholder="sk-ant-…"
              autoComplete="off"
              spellCheck={false}
              value={input}
              disabled={!agreed}
              onChange={(e) => setInput(e.target.value)}
              aria-label="APIキー"
            />
            <button className="btn-primary" onClick={register} disabled={!agreed || !input.trim() || busy}>
              {busy ? "確認中…" : "確かめて登録"}
            </button>
          </div>
          <p className="text-xs text-muted">登録するとき、キーが使えるかだけを Anthropic社に確かめます（画像は送らず、費用もかかりません）。</p>
        </div>
      )}

      {status && <p className={`text-sm ${status.ok ? "text-ok" : "text-pen"}`}>{status.text}</p>}
    </div>
  );
};
