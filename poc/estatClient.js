// Kinto PoC — e-Stat（政府統計）API クライアント：小売物価統計の全国平均価格を取得
// 目的: アプリの「相場（全国平均）」を、政府の実データで更新する。
// 料金: 無料。ただし appId（アプリケーションID）の登録が必須。
//   取得: https://www.e-stat.go.jp/api/ → ユーザー登録 → appId発行
//   実行: ESTAT_APP_ID=xxxx node estatClient.js <statsDataId>
// 依存: Node 18+ のグローバル fetch（外部パッケージ不要）
//
// 小売物価統計調査（動向編 主要品目の毎月の小売価格）の統計表IDを statsDataId に指定する。
// 例として既定IDを置くが、最新の statsDataId は e-Stat の「API」→該当統計表で確認・更新すること。

const BASE = "https://api.e-stat.go.jp/rest/3.0/app/json";
const APP_ID = process.env.ESTAT_APP_ID || null;
// 小売物価統計調査（小売価格）の統計表ID。必要に応じて差し替え。
const DEFAULT_STATS_DATA_ID = process.env.ESTAT_STATS_ID || "0003421913";

// 統計表メタ情報（品目コード一覧など）を取得
async function getMetaInfo(statsDataId) {
  const url = `${BASE}/getMetaInfo?appId=${APP_ID}&statsDataId=${statsDataId}`;
  const res = await fetch(url);
  return res.json();
}

// 統計データ本体を取得（品目×時点の小売価格）
async function getStatsData(statsDataId, params = {}) {
  const q = new URLSearchParams({ appId: APP_ID, statsDataId, ...params }).toString();
  const res = await fetch(`${BASE}/getStatsData?${q}`);
  return res.json();
}

// レスポンスから {品目名: 価格} を抽出（最新時点）
function extractLatestPrices(json) {
  const out = [];
  try {
    const obj = json.GET_STATS_DATA.STATISTICAL_DATA;
    const classObj = obj.CLASS_INF.CLASS_OBJ;
    // 品目分類（@id が cat01 等）の code→name 辞書を作る
    const dicts = {};
    classObj.forEach((c) => {
      const items = Array.isArray(c.CLASS) ? c.CLASS : [c.CLASS];
      dicts[c["@id"]] = Object.fromEntries(items.map((i) => [i["@code"], i["@name"]]));
    });
    const values = obj.DATA_INF.VALUE;
    const rows = Array.isArray(values) ? values : [values];
    // 最新時点（@time 最大）のみ抽出
    const latestTime = rows.map((r) => r["@time"]).sort().slice(-1)[0];
    rows.filter((r) => r["@time"] === latestTime).forEach((r) => {
      const catKey = Object.keys(r).find((k) => k.startsWith("@cat"));
      const itemName = catKey ? dicts[catKey.slice(1)]?.[r[catKey]] : r["@cat01"];
      out.push({ item: itemName || "(不明)", time: r["@time"], value: r["$"], unit: r["@unit"] });
    });
  } catch (e) {
    return { error: "解析に失敗: レスポンス構造を確認してください", detail: e.message };
  }
  return out;
}

async function main() {
  const statsDataId = process.argv[2] || DEFAULT_STATS_DATA_ID;
  if (!APP_ID) {
    console.error("⚠ ESTAT_APP_ID が未設定です。");
    console.error("  1) https://www.e-stat.go.jp/api/ で無料のappIdを発行");
    console.error("  2) ESTAT_APP_ID=発行されたID node estatClient.js [statsDataId]");
    console.error("  （appId未設定のためAPIは認証エラーを返します）\n");
  }
  console.log(`[e-Stat] getStatsData statsDataId=${statsDataId}\n`);
  try {
    const json = await getStatsData(statsDataId, { limit: "100" });
    if (json.GET_STATS_DATA?.RESULT?.STATUS !== 0) {
      console.error("APIエラー:", json.GET_STATS_DATA?.RESULT?.ERROR_MSG || JSON.stringify(json).slice(0, 300));
      return;
    }
    const prices = extractLatestPrices(json);
    if (prices.error) { console.error(prices.error, prices.detail); return; }
    prices.slice(0, 40).forEach((p) => console.log(`  ${p.item}: ${p.value} ${p.unit || ""}（${p.time}）`));
    console.log(`\n取得 ${prices.length} 品目。これを app/index.html の MARKET（円/100g換算）に反映する。`);
  } catch (e) {
    console.error("通信失敗:", e.message);
  }
}

if (require.main === module) main();
module.exports = { getMetaInfo, getStatsData, extractLatestPrices };
