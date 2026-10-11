import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { ExcelExportButton } from "@/components/ExcelExportButton";
import { BASE_PATH, STATIC_EDITION } from "@/lib/edition";
import "./globals.css";

export const metadata: Metadata = {
  title: "まるつけ帳",
  description: "テストの写真から丸付けと得意・不得意の分析を手伝うアプリ（データは端末内に保存）",
  appleWebApp: { capable: true, title: "まるつけ帳", statusBarStyle: "default" },
  icons: { icon: `${BASE_PATH}/icon.svg`, apple: `${BASE_PATH}/icon.svg` },
};

export const viewport: Viewport = { themeColor: "#fbf8f1", width: "device-width", initialScale: 1 };

const NAV = [
  { href: "/", label: "ホーム" },
  { href: "/tests/new", label: "テスト登録" },
  { href: "/analytics", label: "分析" },
  { href: "/settings", label: "名簿・設定" },
];

const RootLayout = ({ children }: { children: React.ReactNode }) => (
  <html lang="ja">
    <body className="min-h-dvh font-sans antialiased">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3">
          <Link href="/" className="flex shrink-0 items-center gap-2 whitespace-nowrap text-lg font-bold">
            <span className="hidden size-8 place-items-center sm:grid rounded-full border-[3px] border-pen text-pen">○</span>
            まるつけ帳
          </Link>
          <nav className="ml-auto flex min-w-0 overflow-x-auto text-xs sm:gap-1 sm:text-sm">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-lg px-2 py-2 font-bold sm:px-3 text-muted hover:bg-white hover:text-ink">
                {n.label}
              </Link>
            ))}
          </nav>
          <ExcelExportButton />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-muted">
        {STATIC_EDITION
          ? "🔒 公開版：名簿・答案の画像・採点結果は、この端末のブラウザ内だけに保存されます。どこにも送信しません（自分のAPIキーでAIを使う設定にしたときだけ、名前欄を塗りつぶした解答欄の画像をAIに送ります）。"
          : "🔒 名簿・採点結果はこの端末のブラウザ内だけに保存されます。AIには、名前欄を塗りつぶしたうえで切り出した「解答欄の画像」だけを送ります（名前・正答は送りません）。"}
      </footer>
    </body>
  </html>
);

export default RootLayout;
