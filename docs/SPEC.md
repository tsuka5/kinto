# Kinto 仕様書

**このファイルが仕様の正であり、コードはその実装である。**
機能の追加・変更は「①この仕様書を更新 → ②実装 → ③`node test/smoke.js` 全項目PASS」の順で行うこと。

- 本番: https://kinto-f5c.pages.dev/ （Cloudflare Pages・商用利用可）
- リポジトリ: https://github.com/tsuka5/kinto （main ブランチ）
- 売り文句: **「安く賢く健康的に」**（meta / manifest の description も同文言に統一）

---

## 1. プロダクト概要

Kinto は「努力ゼロの生産性インフラ」構想を検証する N=1 自己実験 PWA。
食材の価格（相場）と栄養データをもとに、「今日買うべき安くて栄養的に等価な食材」を提案する。

ロードマップ: アフィリエイト → 投げ銭 → Pro サブスク（要 Supabase 等）→ B2B。

## 2. 技術方針（変更しないこと）

- **単一 HTML・依存ゼロ**。オフライン PWA 要件のため**外部 CDN 禁止**。
- `app/` が正（ライトテーマ）。`poc/` はデータ取得 PoC。
  - `app-dynamic/`（ダークネオン別スキン）は 2026-07-16 に削除済み。再作成しない。
- 状態は `localStorage` キー `kinto_state_v3`。
  **初期化は `withDefaults()` に集約**（リセット時もこれを通す。直接 `S.xxx=` で初期化するとクラッシュが再発する）。
- 栄養データは同梱 `foods.full.json`（2,478品）で足りる。**DB 化は不要と判断済み**
  （ボトルネックは相場対応＝e-Stat 調査品目約130が上限）。

## 3. 画面構成

ナビは **5タブ**: 今日の一手（home）/ 安い？（check）/ コスパ（deals）/ 値動き（trend）/ 設定。

### ナビゲーション・履歴
- 画面履歴あり（`currentView` / `navDepth` / `histPush` / `applyView` / `handlePop`）。
- 戻るボタンは**左上常駐の半透明フローティング**（`.backfab #backBtn`。戻り先なし時は `.off` でさらに薄く無効化）。ヘッダー内配置は「分かりにくい」とのユーザー指摘で廃止。
- `popstate`（スマホの戻る）対応。モーダルは `showModal` で履歴に積み、戻る操作で閉じる
  （`closeModal`＝履歴同期、`hideModal`＝プログラム用サイレント）。
- 安い？タブの `chkSelect` は `histPush({view:"check",chk:true})` で履歴を積む（戻ると食材リストへ）。「←別の食材を選ぶ」も `goBack()` 経由。
- `goToSetting(cardId)` で設定タブの `#aiKeyCard` / `#estatCard` へ直接ジャンプ。
- 全画面ボタン（`.fsfab #fsBtn` 右上常駐・⛶）: Fullscreen API で URL バー非表示化。iOS Safari 非対応→ホーム画面追加を案内。PWA(standalone) 起動時は自動非表示。body は `min-height:calc(100vh+1px)` で常にスクロール可。
- viewport-fit=cover 対策で body/backfab/fsfab/nav に `env(safe-area-inset-*)` 適用済み。

## 4. 今日の一手（home）

1. 検索付きピッカーで食材を選択 → 栄養カード（食材詳細と同じ **1食目安バー形式**）＋「◯◯にする（決定）」→ ランキングへ自動スクロール。
2. 候補は「相場より−%」ではなく「**栄養マッチ%バー**（`rkm-fl teal`）＋おトク額」を表示（「相場より」バーは削除済み）。
3. 決定（これにする / にする / 詳細モーダルの `modalAdopt` / 安い？の `chkAdopt`）→「**◯◯に決定！**」`#decidedCard` へ自動スクロール（レシピはその直下）。
4. **最安級の食材でも「それが最適です」は出さない**。必ず類似食材を提案する（ユーザー指示）。
5. 決定済み画面は `S.decidedPick` で制御: 決定直後〜選び直すまでだけ表示。「採用記録があるだけで決定画面になる」のはバグ（修正済み・回帰テストあり）。同日同食材の複数決定は最新を表示、取り消しも最新から。
6. 詳細モーダル: 単価計算 UI は削除済み（安い？タブに一本化）、「◯◯にする（決定）」ボタンあり。

## 5. 栄養ロジック

### 栄養マッチ（代替ランキング）
- `nutriMatch` ＝ **コサイン類似度（方向）× 量カバー率**。コサイン単独は「量が1/4でも100%」になる見当外れを起こすため廃止。**カバー率 0.55 未満は除外**。
- **評価軸はカテゴリ別**（`ROLE_NK` / `nkOf`）:
  - main: protein / omega3 / iron / vitD / calcium
  - veg: vitC / vitA / fiber / folate / iron / calcium
  - carb: carb / fiber / protein
  - dairy: calcium / protein / vitD
  - fruit: 🍎 果物ロール（banana / apple / mikan / kiwi）
- 詳細バーのその他栄養素 = `otherKeysOf()`、コスパの選択肢 = `COSPA_NUTS_ROLE`（**veg の既定は vitC**）。

### 栄養目安（カロミル方式・ユーザー指定）
- ①1日の目標カロリー → ②PFC 比率%（合計100必須）→ ③1日の食数（1〜6、`MEALS_N` / `S.mealsPerDay`）。
- `deriveFromKcal()` でグラム換算＋微量栄養素をエネルギー比で自動導出（標準 2080kcal 基準）。
- 1食の目安は `mealRef(k) = REF[k] / MEALS_N`（旧・固定 /3 は全廃）。**新しい基準依存コードは `mealRef()` / `MEAL_KCAL` を実行時参照すること**。
- fiber 21g / vitC 100mg / vitA 850µg / folate 240µg は `REF_DEFAULT` 内の**固定目安**（設定 UI 非表示・`deriveFromKcal` 対象外＝カスタム PFC 適用でも維持。意図的判断）。
- PFC 設定は %⇄g 双方向入力（`refSync`: 片方入力でもう片方自動計算。直近編集2要素を固定し残り1要素が合計100%を吸収＝`refEditOrder`。kcal 変更は `refSyncKcal` で%維持 g 再計算）。
- 名前付きプリセット（`S.refPresets`、食数込み）で保存/復元。`S.refCustom` で再起動後も維持。

### 栄養表記
- 食材の自然な単位で表示（`UNIT` 定数: 卵1個50g・納豆1パック45g・食パン6枚切り1枚60g 等。無い食材は 100g）。
- `unitG` / `unitLabel` / `unitN` 経由で `foodNutritionHTML`・`nutriBalCard`・`pfcCompare` が単位換算表示。
- **栄養データ (`n`) 自体は 100g あたりのまま**。栄養マッチ計算も従来通り 100g 基準。
- レーダーチャートは「基準が分かりにくい」との指摘で廃止済み。**再導入しない**。

## 6. 価格・相場

- 価格はすべて **`marketOf`（相場）基準に統一**。`priceOf`（通常価格）と混在させると表示金額が矛盾する。
- 地域は IP 判定（ipwho.is の region_code=JIS コード優先、ipapi.co はレート制限が多いのでフォールバック）→ `PREF_CAPITAL` で県庁所在市の価格を取得。

### e-Stat 自動更新
- e-Stat API をブラウザから直接叩く。**共有キー内蔵**: `ESTAT_SHARED_APP_ID`（ユーザー取得キー）で全ユーザー設定不要。appId 優先順位 = `S.estatAppId` > 共有キー（`effectiveAppId()`）。
- 月替わりに自動更新 → `S.marketData{month, area, prices, prev, timeCode, areaCode, codes}`、`S.marketMeta` に直近13か月 times 保持。
- **e-Stat の重要な学び（E2E 確認済み 2026-07-12）**:
  - 品目辞書は cat 系のうち**クラス数最大の次元**（cat02 銘柄872件。cat01 は「データの種別」1件で誤爆する）。
  - 東京の調査名は「**特別区部**」（「東京都区部」ではない。全国系列は無い）。
  - 豆腐/ピーマン/もやしの調査単位は **1kg**（`ESTAT_MAP` g:1000）。
  - **「外食」品目は誤マッチ防止で byName 構築時に除外**（中華そば(外食)にそばが誤マッチした教訓）。
  - みかん/さんまは季節品目、そばは家庭用品目なし→内蔵目安。
- e-Stat 実データは 51 品目マッピング・48 品目実取得確認済み。

### 値動きタブ（📉 trend）
- `renderTrend()` で値下がり（`momDrop>0`・▼ティール）と値上がり（▲赤）を別カード表示。実データがあれば実値、無ければ `momPct()` のデモ値＋e-Stat 連携誘導。
- **値動き%は実データ同士の前月比のみ**（「でたらめ」とのユーザー指摘で修正）: `updateMarket` が最新月＋前月の2回取得し `prev`=前月実データ。内蔵目安とのフォールバック比較は廃止。前月データの無い品目は%非表示。旧データは起動時に自動再取得。
- 月別機能: `estatFetchMonth` / `estatMapPrices` に分割。月セレクタ → `trendPickMonth`（`TREND_CACHE` でメモリキャッシュ・前月比計算）。食材タップ → `openTrendChart`＝12か月分取得し `.pchart` バー表示（平均比の買いどき判定つき）。codes の無い食材は `openFoodModal` にフォールバック。

### 電光掲示板（.ledbar）
- 値下がり食材が流れる（無限ループ用に2周分・タップで詳細）。相場データなしなら非表示。
- **ライト版はガラス基調のさわやかデザイン**（黒背景 LED 風はユーザー指示で廃止）。
- 自動送りは JS scrollLeft 方式（`ledPos` を浮動小数で自前管理＝整数丸めブラウザ対策。触り終わって2.5〜3秒で必ず再開）。手動スクロール可（overflow-x:auto）。

### 安い？タブ（check）
- 検索 → 食材選択 → 値札の数字（値段＋内容量）入力 → 即時デカ文字判定（安い！買い / 相場どおり / 相場より高い）→ 決定・価格記録・レシピに直結。
- マイ価格メモ: `chkRecord` で `S.priceLog` に記録 → 食材詳細に「最安 ¥x / 直近 ¥y」（`myPriceLine`）。

## 7. 食材・レシピデータ

- 食材 **71品**・レシピ **145品**。鶏むね/ももは皮なし・皮つき両方あり。
- **`FOODS` 配列はカテゴリ内で使用頻度順**（ピッカー/安い？の表示順。メイン先頭=鶏卵、野菜先頭=玉ねぎ。「サーモンが先頭は不自然」というユーザー指摘由来＝**順序を崩さない**）。
- 玉ねぎ・ねぎ等は `PANTRY` と同 id。`ALL` 構築は「FOODS が優先、PANTRY は未定義のみ」。
- ピッカーと安い？はサブカテゴリ小見出し表示（`subgroupOf` / `VEG_SUB`。検索中はフラット）。
- レシピは `{time:分, steps:[手順配列], tip:コツ}` 形式。表示は `stepsHTML` / `stepsText` / `timeLabel` 経由。新レシピは steps 配列＋time 必須（smoke.js が検証）。
- 検索は `foodMatch(q, name, yomi)`＝ひらがな/カタカナ/漢字対応（`YOMI` 読みマップ＋`KANA_ALIAS` 言い換え展開＋非連続分割照合）。

### 新食材追加チェックリスト
1. `FOODS`（**カテゴリ内の使用頻度順の位置に挿入**）
2. `YOMI`（読み）
3. `UNIT`（自然な単位があれば）
4. `CONCERNS`
5. `FDB_MAP`（foods.full.json 対応）
6. `ESTAT_MAP`（相場対応可能なら）
7. 専用レシピ **2品**
8. `VEG_SUB`（野菜ならサブカテゴリ）
9. 新ロール新設時は `ROLES` / `ROLE_NK` / `COSPA_NUTS_ROLE` / `DEF_NUT` の**4箇所すべて**に軸を足す

## 8. AI レシピ（Claude API）

- `S.aiKey`（設定タブで登録）で `aiFetchRecipes` → claude-opus-4-8＋web_search をブラウザから fetch 直叩き（`anthropic-dangerous-direct-browser-access` ヘッダー、pause_turn 継続対応）。
- 1日3回制限（`AI_DAILY_LIMIT` / `S.aiUses`）。結果は `S.aiRecipes`（上限60件）に蓄積し、決定後画面とレシピモーダルに一覧表示。
- キー未登録時のボタンは `goToSetting('aiKeyCard')` に配線。
- 実 API での E2E 確認は未実施（キー未登録）。

## 9. チュートリアル

- `TUT_STEPS` 6枚・`S.tutorialDone` で初回のみ自動表示。`applyView(step.view)` で説明タブを背後に実表示。
- **`.tut` は pointer-events:none / `.tut-card` のみ auto ＝背面を実際に操作できる**。step の `waitFor`（"pick"/"check"/"cospa"）を `tutEvent()` フック（`setPick`/`chkJudge`/`setCospaNut` 内）が受けて自動で次へ。
- 設定の「📖 チュートリアルを見る」で再表示。

## 10. マネタイズ

- 方針: **ユーザーの得になる文脈でのみ広告**。
- アフィリエイト実装済み（`AFF` 定数の amazonTag / rakutenAfl。未設定でも素リンクで動作。`affRakuten` / `affAmazon` / `shopLinksHTML` / `SHOP_KW` / `SHELF_IDS`）。
- 表示箇所は2つだけ: ①食材詳細（日持ち品=まとめ買い 楽天市場+Amazon、生鮮=楽天西友ネットスーパー）②安い？の「**高い」判定時のみ**（安い判定に広告を出さない）。
- 全リンク「広告」pr-tag＋`rel="noopener sponsored"`＋設定タブに開示文（ステマ規制対応）。
- 楽天アフィリエイト ID 設定済み（収益有効）。Amazon アソシエイトは審査制のため利用者が増えてから申請予定。

## 11. 削除済み機能（再追加しないこと）

いずれもユーザー指示による削除。**再追加禁止**（smoke.js が一部を回帰検証）:

- カーソル追従チルト、ヘッダーの3D回転キューブ、🔥継続バッジ
- 脳コンディション記録
- 「最近選んだ」チップ
- 楽天レシピへの外部リンク（外部レシピはクックパッドに一本化）
- **実績タブ**（累計節約・週間チャート・月間目標・採用履歴ごと削除。値動きタブが代替）
- **料理計算タブ**（`searchFoods` / `renderCalc` / `savedMeals` 等ごと削除）
- 設定の CSV/JSON 書き出し・JSON 復元カード（**リセットは残す**）
- ランキング行の「相場より」バー（栄養マッチバーとおトク額表記は残す）
- レーダーチャート（栄養カードは1食目安バー形式）
- 詳細モーダルの単価計算 UI（安い？タブに一本化）
- 黒背景 LED 風の電光掲示板（ライト版はガラス基調）
- `app-dynamic/`（ダークネオン別スキン。2026-07-16削除）

## 12. 文言

- 採用後のカードは「◯◯（食材名）に決定！」（旧「これを購入！」）。
- 売り文句は「安く賢く健康的に」（初代「賢い一手で、脳をフル稼働。」→2代目「同じ栄養を、もっと安く。」→現行）。

## 13. 開発ワークフロー

1. **仕様先行**: 機能追加・変更はまずこの SPEC.md の該当セクションを更新する（新機能なら1段落書く）。
2. **実装**: `app/index.html` にのみ行う。
3. **検証**: `node test/smoke.js` 全項目 PASS（新機能にはテストを追加）。
   仕上げ確認はヘッドレス Chrome（`--force-prefers-reduced-motion` で最終レイアウト撮影。最小幅 482px に勝手にクランプされる仕様に注意＝狭い `--window-size` 指定で右が切れるのは実バグではない）。
4. **デプロイ**: **git push だけでは本番に反映されない**。
   `app/`・`_redirects` だけをコピーした一時ディレクトリを
   `npx wrangler pages deploy <dir> --project-name kinto --branch main --commit-dirty=true`
   でアップロード（リポジトリ直デプロイは poc/node_modules が混入するので不可）。
   コード変更時は **push と wrangler デプロイの両方**を実行すること。
5. 実験的変更は 1 コミットにまとめる（「ダメだったら戻したい」→ `git revert` で戻せる状態を保つ）。

### インフラ
- Cloudflare Pages（プロジェクト名 kinto・wrangler 直接アップロード方式・git 連携ではない）。
- 旧 Vercel URL も生きているが商用不可のため案内は Cloudflare へ（`vercel.json` は旧 URL 用に併存）。
- アイコンは配色連動の K+若葉デザイン。
