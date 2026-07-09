// Kinto PoC — 楽天レシピ API クライアント（実在レシピの合法な取得）
// 目的: クックパッドはAPI非公開・規約で複製禁止のため使えない。代わりに公式APIのある
//       「楽天レシピ」から、実在レシピのタイトル・材料・URL・調理時間・費用目安を正規取得する。
// 料金: 無料。ただし applicationId（アプリID）の登録が必須。
//   取得: https://webservice.rakuten.co.jp/ → アプリID発行
//   実行: RAKUTEN_APP_ID=xxxx node rakutenRecipeClient.js [categoryId]
// 依存: Node 18+ のグローバル fetch
//
// 注意: このAPIは「カテゴリ別ランキング」方式。任意キーワード検索ではなく、
//   カテゴリID（大/中/小の3階層）ごとの人気レシピ上位4件を返す。
//   → 「鮭水煮缶を使うレシピ」のような食材ピンポイント検索は公式APIにはない。
//      食材→レシピは、ユーザーを楽天レシピ/クックパッドの検索ページに遷移させる方式が現実的。

const BASE = "https://app.rakuten.co.jp/services/api/Recipe";
const APP_ID = process.env.RAKUTEN_APP_ID || null;

async function categoryList() {
  const url = `${BASE}/CategoryList/20170426?applicationId=${APP_ID}&format=json`;
  return (await fetch(url)).json();
}
// categoryId 例: "30" (大カテゴリ) や "30-100" (中) など。CategoryListで確認。
async function categoryRanking(categoryId) {
  const url = `${BASE}/CategoryRanking/20170426?applicationId=${APP_ID}&categoryId=${encodeURIComponent(categoryId)}&format=json`;
  return (await fetch(url)).json();
}

function printRecipes(json) {
  const list = json.result || [];
  if (!list.length) { console.log("  レシピなし（categoryId・appIdを確認）"); return; }
  list.forEach((r) => {
    console.log(`  [${r.rank}位] ${r.recipeTitle}`);
    console.log(`     材料: ${(r.recipeMaterial || []).join("、")}`);
    console.log(`     調理時間: ${r.recipeIndication || "-"} / 費用目安: ${r.recipeCost || "-"}`);
    console.log(`     ${r.recipeUrl}\n`);
  });
  console.log(`取得 ${list.length} 件。タイトル・材料・URL・時間・費用が実データ。`);
}

async function main() {
  const categoryId = process.argv[2] || "30"; // 例: 人気メニュー系の大カテゴリ
  if (!APP_ID) {
    console.error("⚠ RAKUTEN_APP_ID が未設定です。");
    console.error("  1) https://webservice.rakuten.co.jp/ でアプリID発行（無料）");
    console.error("  2) RAKUTEN_APP_ID=発行ID node rakutenRecipeClient.js [categoryId]\n");
  }
  console.log(`[楽天レシピ] CategoryRanking categoryId=${categoryId}\n`);
  try {
    const json = await categoryRanking(categoryId);
    if (json.error) { console.error("APIエラー:", json.error, json.error_description || ""); return; }
    printRecipes(json);
  } catch (e) {
    console.error("通信失敗:", e.message);
  }
}

if (require.main === module) main();
module.exports = { categoryList, categoryRanking };
