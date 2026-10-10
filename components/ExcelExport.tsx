"use client";

import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, setSetting } from "@/lib/db";

const download = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
};

/** 採点結果をExcelに書き出す。前に書き出したファイルを選ぶと、そのファイルにシート（タブ）を書き足す */
export const ExcelExport = () => {
  const withNames = useLiveQuery(() => db.settings.get("excelNames"))?.value !== "false";
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const baseInput = useRef<HTMLInputElement>(null);

  const run = async (base?: File) => {
    setBusy(true);
    setMessage(null);
    try {
      const { buildExcel } = await import("@/lib/excel");
      const { blob, added, updated, kept } = await buildExcel({ withNames, base });
      download(blob, base ? base.name.replace(/(_\d{8})?\.xlsx$/i, "") + `_${today()}.xlsx` : `まるつけ帳_成績_${today()}.xlsx`);
      const parts = [
        added.length ? `新しいタブ：${added.join("、")}` : "",
        updated.length ? `上書きしたタブ：${updated.join("、")}` : "",
        base && kept > 0 ? `そのまま残したタブ：${kept}枚` : "",
      ].filter(Boolean);
      setMessage({ ok: true, text: `書き出しました。${parts.join("／")}` });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "書き出しに失敗しました" });
    } finally {
      setBusy(false);
      if (baseInput.current) baseInput.current.value = "";
    }
  };

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 pr-10">
        <h2 className="font-bold">Excelに書き出す</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={withNames} onChange={(e) => setSetting("excelNames", String(e.target.checked))} />
          氏名も入れる
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={busy} onClick={() => run()}>
          {busy ? "作成中…" : "新しいExcelファイルを作る"}
        </button>
        <button className="btn-ghost" disabled={busy} onClick={() => baseInput.current?.click()}>
          前のExcelファイルに追加する
        </button>
        <input
          ref={baseInput}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && run(e.target.files[0])}
        />
      </div>
      {message && <p className={`text-sm ${message.ok ? "text-ok" : "text-pen"}`}>{message.text}</p>}
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">
        <li>最初に教科ごとの「単元別（算数）」「観点別（算数）」のようなまとめのタブ（観点別はA・B・Cの目安つき）、そのあとにテストごとのタブが並びます。</li>
        <li>「前のExcelファイルに追加する」：新しいテストは新しいタブとして足し、同じテストのタブは最新の結果で上書きします。先生が自分で作ったタブはそのまま残します。</li>
        <li>元のファイルは書き換えず、更新したファイルを新しく保存します。</li>
        <li>{withNames ? "氏名が入ったファイルは個人情報です。" : "出席番号だけのファイルです。"}保存場所に気をつけ、学校のルールに従って扱ってください。</li>
      </ul>
    </section>
  );
};
