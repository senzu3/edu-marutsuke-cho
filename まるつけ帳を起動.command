#!/bin/bash
# まるつけ帳を起動して、ブラウザで開く。ダブルクリックで実行。
# このウィンドウを閉じるとアプリも止まります。

cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

URL="http://localhost:3000"

echo "======================================"
echo "  まるつけ帳"
echo "======================================"

if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js が見つかりません。インストールしてから、もう一度開いてください。"
  read -r -p "Enterキーで閉じます"
  exit 1
fi

# すでに起動している場合は、ブラウザを開くだけ
if curl -s -o /dev/null --max-time 2 "$URL"; then
  echo "すでに起動しています。ブラウザで開きます。"
  open "$URL"
  exit 0
fi

# 初回だけ、必要な部品をインストール
if [ ! -d node_modules ]; then
  echo "初回の準備をしています（数分かかることがあります）…"
  npm install || { read -r -p "準備に失敗しました。Enterキーで閉じます"; exit 1; }
fi

if [ ! -f .env.local ]; then
  echo "⚠ .env.local がありません。README.md の「セットアップ」を見て、APIキーを設定してください。"
fi

echo "起動しています…"
npm run dev &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT

# 起動するまで待ってから、ブラウザで開く（最大60秒）
for _ in $(seq 1 60); do
  if curl -s -o /dev/null --max-time 2 "$URL"; then
    open "$URL"
    echo ""
    echo "✓ 起動しました：$URL"
    echo "  iPad・スマホからは、同じWi-Fiで http://$(scutil --get LocalHostName 2>/dev/null || echo 'Macの名前').local:3000"
    echo "  使い終わったら、このウィンドウを閉じてください。"
    break
  fi
  sleep 1
done

wait $SERVER_PID
