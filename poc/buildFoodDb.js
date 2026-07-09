// Kinto PoC — 文科省「日本食品標準成分表(八訂)」→ アプリ用栄養DB(JSON)への変換
// 出典: 日本食品標準成分表2020年版(八訂)（文部科学省, 公的オープンデータ・二次利用可）
//   公式: https://www.mext.go.jp/a_menu/syokuhinseibun/mext_01110.html
//   JSON化: github.com/katoharu432/standards-tables-of-food-composition-in-japan（八訂をJSON化）
// 実行: node buildFoodDb.js  → app/foods.full.json を生成
// 依存: Node 18+ の fetch（外部パッケージ不要）
//
// 注意: 本表(エネルギー・たんぱく質・脂質・炭水化物・Ca・Fe・ビタミンD)は揃うが、
//   オメガ3(n-3系)は「脂肪酸成分表編」(別ファイル)にあり本表に無い → omega3は0で出力。
//   価格も成分表に無い → コスト計算は価格を持つ食材のみ（自分の料理計算では栄養が主目的）。

const fs = require("fs");
const path = require("path");
const RAW = [
  "https://raw.githubusercontent.com/katoharu432/standards-tables-of-food-composition-in-japan/master/data.json",
  "https://raw.githubusercontent.com/katoharu432/standards-tables-of-food-composition-in-japan/main/data.json",
];
const OUT = path.join(__dirname, "..", "app", "foods.full.json");

// "Tr"(微量)・"-"・"(0)"・""・null を 0 に、"1,234" や "(12)" を数値に
function num(v) {
  if (v == null) return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const s = String(v).replace(/[(),\s]/g, "");
  if (s === "" || s === "Tr" || s === "-" || /^[^0-9.\-]/.test(s)) return 0;
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

async function fetchJson() {
  for (const url of RAW) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch (e) { /* try next */ }
  }
  throw new Error("data.json を取得できませんでした（ネットワーク制限の可能性）");
}

(async () => {
  console.log("[buildFoodDb] 八訂 data.json を取得中...");
  const rows = await fetchJson();
  const arr = Array.isArray(rows) ? rows : (rows.data || []);
  const foods = arr.map((r, i) => ({
    id: "fdb" + i,
    name: r.foodName || r.name || ("食品" + i),
    n: {
      protein: num(r.prot != null ? r.prot : r.protcaa),
      fat: num(r.fat),
      carb: num(r.choavl != null && r.choavl !== "-" ? r.choavl : (r.chocdf != null ? r.chocdf : 0)),
      omega3: 0,            // 本表に無い（脂肪酸成分表編が別途必要）
      calcium: num(r.ca),
      iron: num(r.fe),
      vitD: num(r.vitD != null ? r.vitD : r.vitd),
      kcal: num(r.enercKcal != null ? r.enercKcal : r.enerc),
    },
  })).filter(f => f.name && f.n.kcal >= 0);

  const out = { _source: "日本食品標準成分表2020年版(八訂)から引用（文部科学省）", count: foods.length, foods };
  fs.writeFileSync(OUT, JSON.stringify(out), "utf8");
  console.log(`[buildFoodDb] ${foods.length} 食品を ${OUT} に出力しました。`);
  // サンプル表示
  ["鶏","さけ","ほうれん草","ごはん"].forEach(q => {
    const hit = foods.find(f => f.name.includes(q));
    if (hit) console.log(`  例) ${hit.name}: ${hit.n.kcal}kcal P${hit.n.protein} 脂${hit.n.fat} 炭${hit.n.carb} Ca${hit.n.calcium} Fe${hit.n.iron}`);
  });
})().catch(e => { console.error("失敗:", e.message); process.exit(1); });
