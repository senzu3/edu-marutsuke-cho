"use client";

import { useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { ExcelExport } from "./ExcelExport";

/** Excelファイルの小さなアイコン */
const ExcelIcon = () => (
  <svg viewBox="0 0 20 20" className="size-4 shrink-0" aria-hidden="true">
    <rect x="2.5" y="2.5" width="15" height="15" rx="2.5" fill="currentColor" />
    <path d="M7 6.5l6 7M13 6.5l-6 7" stroke="var(--color-excel)" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

/** どの画面からでも押せる「Excelに書き出す」ボタン。押すと書き出しの画面が開く */
export const ExcelExportButton = ({ variant = "header" }: { variant?: "header" | "large" }) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const resultCount = useLiveQuery(() => db.results.count());

  return (
    <>
      <button
        onClick={() => dialog.current?.showModal()}
        className={
          variant === "header"
            ? "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-excel px-2.5 py-2 text-xs font-bold text-white hover:brightness-110 sm:text-sm"
            : "btn flex items-center gap-2 bg-excel text-white hover:brightness-110"
        }
      >
        <ExcelIcon />
        {variant === "header" ? (
          <>
            <span className="sm:hidden">Excel</span>
            <span className="hidden sm:inline">Excelに書き出す</span>
          </>
        ) : (
          "Excelに書き出す"
        )}
      </button>
      <dialog
        ref={dialog}
        className="m-auto w-[min(40rem,calc(100vw-2rem))] rounded-2xl bg-transparent p-0 backdrop:bg-black/40"
        onClick={(e) => e.target === dialog.current && dialog.current?.close()}
      >
        <div className="relative">
          <button
            onClick={() => dialog.current?.close()}
            className="absolute right-3 top-3 z-10 grid size-8 place-items-center rounded-full text-muted hover:bg-line/60"
            aria-label="閉じる"
          >
            ✕
          </button>
          {resultCount === 0 ? (
            <section className="card space-y-2">
              <h2 className="font-bold">Excelに書き出す</h2>
              <p className="text-sm text-muted">まだ採点結果がありません。テストを採点すると書き出せます。</p>
            </section>
          ) : (
            <ExcelExport />
          )}
        </div>
      </dialog>
    </>
  );
};
