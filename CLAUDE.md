# Kinto 開発ガイド

**仕様の正は `docs/SPEC.md`。** コードはその実装。以下の順序を必ず守る:

1. 機能追加・変更はまず `docs/SPEC.md` の該当セクションを更新（新機能は1段落書いてから）
2. 実装は `app/index.html` にのみ行う（単一HTML・依存ゼロ・外部CDN禁止）
3. `node test/smoke.js` を全項目PASSさせる（新機能にはテストを追加する）
4. デプロイ: **git pushだけでは本番に反映されない**。`app/`・`_redirects` をコピーした一時dirを
   `npx wrangler pages deploy <dir> --project-name kinto --branch main --commit-dirty=true`

削除済み機能の一覧が SPEC.md §11 にある。**そこに載っているものは提案・再実装しないこと。**
