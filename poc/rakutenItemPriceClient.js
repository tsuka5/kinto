// Kinto PoC — 楽天市場 商品検索API クライアント（合法に取れる「実価格」）
// 背景: ネットスーパー各社の「今日の店頭価格」を返す無料公式APIは無い。
//   一方、楽天市場 商品検索API は食品の実販売価格を正規に取得できる（無料・要appId）。
//   ※注意: これは「楽天市場の通販価格（1パック単位・出店者ごとに変動）」であり、
//     近所のスーパーの今日の価格とは異なる。100gあたり換算や代表値化は別途必要。
// 取得: https://webservice.rakuten.co.jp/ でアプリID発行（楽天レシピAPIと同じappIdでOK）
// 実行: RAKUTEN_APP_ID=xxxx node rakutenItemPriceClient.js "鶏むね肉"
// 依存: Node 18+ の fetch

const BASE = "https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601";
const APP_ID = process.env.RAKUTEN_APP_ID || null;

async function searchPrice(keyword, { hits = 10 } = {}) {
  const q = new URLSearchParams({
    applicationId: APP_ID, keyword, hits: String(hits),
    sort: "+itemPrice", format: "json", // 安い順
  }).toString();
  const res = await fetch(`${BASE}?${q}`);
  return res.json();
}

// 検索結果から代表価格（最安・中央値）を返す
function summarize(json) {
  const items = (json.Items || []).map(x => x.Item).filter(Boolean);
  if (!items.length) return null;
  const prices = items.map(i => i.itemPrice).filter(p => p > 0).sort((a, b) => a - b);
  const min = prices[0], med = prices[Math.floor(prices.length / 2)];
  return { min, median: med, count: prices.length, sample: items.slice(0, 3).map(i => ({ name: i.itemName.slice(0, 40), price: i.itemPrice, url: i.itemUrl })) };
}

async function main() {
  const keyword = process.argv.slice(2).join(" ") || "鶏むね肉";
  if (!APP_ID) {
    console.error("⚠ RAKUTEN_APP_ID 未設定。https://webservice.rakuten.co.jp/ で発行（楽天レシピと共通）。");
    console.error("  RAKUTEN_APP_ID=発行ID node rakutenItemPriceClient.js \"鶏むね肉\"\n");
  }
  console.log(`[楽天市場] 商品検索 keyword="${keyword}"\n`);
  try {
    const json = await searchPrice(keyword);
    if (json.error) { console.error("APIエラー:", json.error, json.error_description || ""); return; }
    const s = summarize(json);
    if (!s) { console.log("  該当なし"); return; }
    console.log(`  最安 ¥${s.min} / 中央値 ¥${s.median}（${s.count}件）`);
    s.sample.forEach(x => console.log(`   ・¥${x.price}  ${x.name}`));
    console.log("\n→ 100gあたり換算・代表値化してアプリの相場/今日価格に反映できる（実価格）。");
  } catch (e) {
    console.error("通信失敗:", e.message);
  }
}

if (require.main === module) main();
module.exports = { searchPrice, summarize };
