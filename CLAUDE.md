## 概要

プログラマー・ナレッジワーカーに対して、一時的なメモを重要だと錯覚して捨てられないデジタル負債を解決する、フォルダ分けも保存ボタンもなく放置すれば勝手に消える『忘れるための裏紙』アプリを開発しています。

現状の詳しい仕様は `README.md` を参照してください。


## 技術スタック

- TypeScript + Vite + Canvas API（フレームワークなし）
- サーバー・DB・認証・外部API通信なし
- 永続化は `localStorage`（キー `"memos"`）のみ

## 使い方

```bash
npm install
npm run dev       # 開発サーバー
npm run build     # 型チェック + 本番ビルド（dist/ に静的ファイル出力）
npm run preview   # dist/ をローカルで確認
npm run test      # vitest（フェード計算・ヒット判定・ストアのユニットテスト）
```

`dist/` の中身はそのまま Vercel / Netlify / GitHub Pages 等の静的ホスティングに配置できる。
