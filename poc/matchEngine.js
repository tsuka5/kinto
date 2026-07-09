// Kinto PoC — 代替品マッチングエンジン
// 思想:「栄養 × コスト × 手間ゼロ」の交差点で"格上の代替"を提案する。
// ロジック概要:
//   1) 各食品の主要栄養素を「100kcalあたり」に正規化し、栄養効率ベクトルを作る
//      （量で薄める/濃縮する効果を排除し、"栄養の質"を比較するため）
//   2) 元食品とのコサイン類似度で「栄養プロファイルが近い」候補を抽出
//   3) score = 栄養類似度 × 価格メリット × 手間メリット で総合評価
//   4) 上位を「節約額・栄養差分・誠実な根拠」付きで返す
//
// 本番では foods は文科省 食品成分DB API、price は e-Stat / EC連携で動的に取得する。

const fs = require("fs");
const path = require("path");

// スコア計算で使う栄養素（脳パフォーマンス/健康に効く主要素）
const NUTRIENT_KEYS = ["protein_g", "omega3_g", "calcium_mg", "iron_mg", "vitD_ug"];

// --- ユーティリティ ---
function toPer100kcalVector(food) {
  // 100kcalあたりに正規化（kcal=0は安全側で1扱い）
  const kcal = food.nutrients.kcal > 0 ? food.nutrients.kcal : 1;
  return NUTRIENT_KEYS.map((k) => (food.nutrients[k] || 0) * (100 / kcal));
}

function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// --- 誠実な根拠文の生成（本番はLLM=Claudeで自然文化する。ここはルールベースの簡易版）---
function buildRationale(origin, cand) {
  const ups = [];   // 元より優れる点
  const downs = []; // 元より劣る点
  const note = { calcium_mg: "缶詰は骨ごと/冷凍は損失が少ないため", omega3_g: "", iron_mg: "", protein_g: "" };
  const fmt = (k, label) => {
    const o = origin.nutrients[k] || 0;
    const c = cand.nutrients[k] || 0;
    if (o === 0 && c === 0) return;
    const ratio = o === 0 ? Infinity : c / o;
    if (ratio >= 1.3) {
      const mag = ratio === Infinity ? "大幅に多く" : `約${ratio.toFixed(1)}倍`;
      ups.push(`${label}が${mag}${note[k] ? `（${note[k]}）` : ""}`);
    } else if (ratio <= 0.7) {
      downs.push(`${label}はやや少なめ`);
    }
  };
  ["calcium_mg", "iron_mg", "omega3_g", "protein_g"].forEach((k) =>
    fmt(k, { calcium_mg: "カルシウム", iron_mg: "鉄分", omega3_g: "オメガ3", protein_g: "たんぱく質" }[k])
  );

  const saving = origin.price_yen_per_100g - cand.price_yen_per_100g;
  const effortMsg = cand.effort < origin.effort ? "下処理の手間もより少なく" : "";
  const head = saving > 0
    ? `価格は100gあたり約${saving}円安く${effortMsg ? "、" + effortMsg : ""}`
    : `価格はほぼ同等${effortMsg ? "、" + effortMsg : ""}`;
  let body;
  if (ups.length && downs.length) body = `栄養面では${ups.join("、")}。一方で${downs.join("、")}。`;
  else if (ups.length) body = `栄養面ではむしろ${ups.join("、")}。`;
  else if (downs.length) body = `栄養面では${downs.join("、")}が、主要素はおおむね同等。`;
  else body = `栄養はほぼ同等。`;
  return `${head}。${body}「妥協」ではなく賢いアップグレードです。`;
}

// --- メイン: 代替候補の算出 ---
function suggestAlternatives(foods, originId, opts = {}) {
  const { topN = 3, sameCategoryOnly = false, minSimilarity = 0.6 } = opts;
  const origin = foods.find((f) => f.id === originId);
  if (!origin) throw new Error(`food not found: ${originId}`);

  const originVec = toPer100kcalVector(origin);
  const maxPrice = Math.max(...foods.map((f) => f.price_yen_per_100g));

  const scored = foods
    .filter((f) => f.id !== origin.id)
    .filter((f) => (sameCategoryOnly ? f.category === origin.category : true))
    .map((f) => {
      const sim = cosineSimilarity(originVec, toPer100kcalVector(f));
      // 価格メリット: 元より安いほど高得点（1.0=無料に近い, 0=同額以上）
      const priceMerit = Math.max(0, (origin.price_yen_per_100g - f.price_yen_per_100g) / maxPrice);
      // 手間メリット: 手間が少ないほど高得点（effort 1..5 を 0..1 に）
      const effortMerit = Math.max(0, (origin.effort - f.effort) / 4);
      // 総合: 栄養類似度を主軸に、コスト・手間の改善を加点
      const score = sim * (1 + 0.8 * priceMerit + 0.4 * effortMerit);
      return {
        id: f.id, name: f.name, similarity: sim, priceMerit, effortMerit, score,
        saving_yen_per_100g: origin.price_yen_per_100g - f.price_yen_per_100g,
        rationale: buildRationale(origin, f), food: f,
      };
    })
    .filter((r) => r.similarity >= minSimilarity)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  return { origin, suggestions: scored };
}

// --- CLI 実行 ---
if (require.main === module) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, "foods.sample.json"), "utf8"));
  const foods = data.foods;
  const targets = process.argv[2] ? [process.argv[2]] : ["salmon_raw", "spinach_raw", "beef_loin"];

  for (const t of targets) {
    const { origin, suggestions } = suggestAlternatives(foods, t, { topN: 3, minSimilarity: 0.5 });
    console.log("\n==================================================");
    console.log(`【元の食品】${origin.name}  (¥${origin.price_yen_per_100g}/100g, 手間${origin.effort})`);
    console.log("--------------------------------------------------");
    if (suggestions.length === 0) { console.log("  代替候補なし"); continue; }
    suggestions.forEach((s, i) => {
      const save = s.saving_yen_per_100g;
      console.log(`  ${i + 1}. ${s.name}  (¥${s.food.price_yen_per_100g}/100g, 手間${s.food.effort})`);
      console.log(`     栄養類似度: ${(s.similarity * 100).toFixed(0)}%  / 節約: ${save >= 0 ? "−¥" + save : "+¥" + (-save)}/100g  / 総合スコア: ${s.score.toFixed(3)}`);
      console.log(`     💡 ${s.rationale}`);
    });
  }
  console.log("\n（注）価格・手間はPoC用ダミー。栄養は食品成分表の代表値ベース。本番はAPI連携で動的化。\n");
}

module.exports = { suggestAlternatives, cosineSimilarity, toPer100kcalVector };
