// Kinto index.html のインラインスクリプトを最小DOMスタブで実行するスモークテスト
const fs = require("fs");
const html = fs.readFileSync(process.argv[2] || require("path").join(__dirname, "..", "app", "index.html"), "utf8");
const src = html.match(/<script>([\s\S]*)<\/script>/)[1];

function makeEl(id) {
  const cls = new Set();
  return {
    id, innerHTML: "", textContent: "", value: "", style: {}, dataset: {},
    classList: {
      add(c) { cls.add(c); }, remove(c) { cls.delete(c); },
      toggle(c, f) { if (f === undefined) { cls.has(c) ? cls.delete(c) : cls.add(c); } else { f ? cls.add(c) : cls.delete(c); } },
      contains(c) { return cls.has(c); },
    },
    onclick: null, onchange: null, oninput: null,
    querySelectorAll() { return []; },
    querySelector() { return makeEl(); },
    appendChild(){}, click(){}, remove(){}, scrollIntoView(){}, focus(){}, setAttribute(){}, scrollTop: 0,
  };
}
const els = {};
global.document = {
  getElementById(id) { return els[id] || (els[id] = makeEl(id)); },
  querySelectorAll() { return []; },
  querySelector() { return makeEl(); },
  createElement() { return makeEl(); },
};
global.window = { scrollTo(){} };
global.location = { protocol: "https:" };
global.navigator = {};
const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
global.fetch = () => Promise.reject(new Error("offline test"));
global.confirm = () => true;
global.prompt = () => "テスト朝食";
global.FileReader = class { readAsText(){} };
global.URL = { createObjectURL: () => "blob:x", revokeObjectURL(){} };
global.Blob = class {};
global.setTimeout = (fn) => 0;
// reduced-motion を有効扱いにして 3D演出系は早期return させる（クラッシュしないことだけ確認）
global.matchMedia = (q) => ({ matches: q.includes("prefers-reduced-motion") });
global.history = { pushState() {}, replaceState() {}, back() { global.history.backCalls = (global.history.backCalls || 0) + 1; }, backCalls: 0 };
global.addEventListener = () => {};
global.performance = { now: () => 0 };
global.requestAnimationFrame = () => 0;
global.innerWidth = 400; global.innerHeight = 880;
document.body = makeEl("body");
document.getElementById("modal").classList.add("hidden"); // HTMLの初期状態を再現

let failed = 0;
function check(name, fn) {
  try { fn(); console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name, "-", e.message); }
}

// スクリプト全体を実行（初期 renderAll / loadFullDb / detectRegion 含む）
const ctx = require("vm");
ctx.runInThisContext(src, { filename: "inline.js" });

check("初期レンダリングが完了している", () => {
  if (!els["catBar"].innerHTML) throw new Error("catBar empty");
});

check("suggest: 高い食材に安い代替が出る", () => {
  const r = suggest("beef_loin", { topN: 3 });
  if (!r.length) throw new Error("no suggestions");
  if (!(r[0].saving > 0)) throw new Error("saving not positive");
});

check("saving が相場(marketOf)ベースで画面表示と一致", () => {
  const r = suggest("beef_loin", { topN: 5 });
  for (const s of r) {
    const expected = marketOf("beef_loin") - marketOf(s.f.id);
    if (s.saving !== expected) throw new Error(`saving ${s.saving} != 相場差 ${expected} (${s.f.id})`);
    if (!s.why.includes(String(expected))) throw new Error("根拠文の金額が不一致: " + s.why);
  }
});

check("栄養マッチ: 量が大きく違う食品で100%にならない", () => {
  const m = nutriMatch(ALL.beef_loin, ALL.chicken_breast);
  if (m.pct >= 95) throw new Error("beef→chicken が " + m.pct + "%（量の差が無視されている）");
  if (m.pct <= 30) throw new Error("beef→chicken が " + m.pct + "%（低すぎ）");
  // ほぼ同等の食品は高マッチのまま
  const m2 = nutriMatch(ALL.spinach_raw, ALL.komatsuna);
  if (m2.pct < 60) throw new Error("spinach→komatsuna が " + m2.pct + "%（近い食品まで下がりすぎ）");
});

check("栄養マッチ: 見当外れな代替（ほうれん草→白米）は弾かれる", () => {
  const m = nutriMatch(ALL.spinach_raw, ALL.rice_bowl);
  if (m.cov >= 0.55) throw new Error("cov=" + m.cov.toFixed(2) + " でフィルタを通過してしまう");
});

check("rationale: 微量栄養素の『大幅に多く』を主張しない", () => {
  // 牛(vitD 0)→豚(vitD 0.1µg) : 1食目安2.8µgの4%しか無いのに「新たにとれ」と言わないこと
  const why = rationale(ALL.beef_loin, ALL.pork_loin);
  if (why.includes("ビタミンD")) throw new Error("微量のビタミンDを誇張: " + why);
});

check("picker検索: 全カテゴリ横断で見つかり、選ぶとカテゴリ追従", () => {
  S.roles = ["veg"]; save(S);
  onPickSearch("さば");
  const chips = pickerChipsHTML();
  if (!chips.includes("さば水煮缶")) throw new Error("検索でさば缶が出ない");
  setPick("saba_can");
  if (!S.roles.includes("main")) throw new Error("カテゴリが追従していない: " + S.roles);
  if (S.pick !== "saba_can") throw new Error("pickが設定されない");
});

check("picker検索: 該当なしメッセージ", () => {
  onPickSearch("存在しない食材xyz");
  if (!pickerChipsHTML().includes("該当する食材がありません")) throw new Error("該当なし表示が出ない");
  onPickSearch("");
});

check("recipeCost が相場ベース", () => {
  const rec = recipeFor("chicken_breast");
  const expected = Math.round(rec.ing.reduce((s, i) => s + marketOf(i.id) * i.g / 100, 0));
  if (recipeCost(rec) !== expected) throw new Error("recipeCost mismatch");
});

check("celebrate が reduced-motion 相当で安全に動く", () => {
  celebrate(); // matchMedia スタブ次第だが例外を出さないこと
});

check("カテゴリ選択→食材pick→renderHome", () => {
  S.roles = ["main"]; S.pick = "beef_loin"; save(S);
  renderHome();
  if (!els["homeCard"].innerHTML.includes("候補")) throw new Error("no ranking rendered");
});

check("adoptSwap→undoTodayAdoption", () => {
  adoptSwap("beef_loin", "chicken_breast", 480);
  if (S.adoptions.length !== 1) throw new Error("adoption not recorded");
  undoTodayAdoption("beef_loin");
  if (S.adoptions.length !== 0) throw new Error("undo failed");
});

check("決定後の画面に「この一手で作るなら」レシピが含まれる", () => {
  S.roles = ["main"]; S.pick = "beef_loin"; save(S);
  adoptSwap("beef_loin", "chicken_breast", 480);
  const html = document.getElementById("homeCard").innerHTML;
  if (!html.includes('id="recipeCard"') || !html.includes("この一手で作るなら")) throw new Error("レシピカードがない");
  if (html.includes('id="nutriBalCard"')) throw new Error("採用済み画面に栄養カードが出ている");
  undoTodayAdoption("beef_loin");
});

check("リセット後に renderAll がクラッシュしない", () => {
  S.cospaNut.main = "protein"; save(S);
  document.getElementById("resetBtn").onclick();  // confirm は true
  if (S.priceLog === undefined || S.cospaNut === undefined) throw new Error("defaults missing");
});

check("詳細モーダル: 単価計算なし・決定ボタンあり", () => {
  openFoodModal("chicken_breast");
  const html = els["modalBody"].innerHTML;
  if (html.includes("相場と比べる") || html.includes("pcPrice")) throw new Error("単価計算UIが残っている");
  if (!html.includes("鶏むね肉(皮なし) にする（決定）")) throw new Error("決定ボタンがない");
  if (!html.includes("modalAdopt")) throw new Error("決定ボタンが未配線");
});

check("modalAdopt: 詳細から決定→ホームの決定画面へ", () => {
  const before = S.adoptions.length;
  modalAdopt("chicken_breast");
  if (S.adoptions.length !== before + 1) throw new Error("決定が記録されない");
  if (S.pick !== "chicken_breast" || !S.roles.includes("main")) throw new Error("pick/rolesが追従しない");
  const html = document.getElementById("homeCard").innerHTML;
  if (!html.includes('id="decidedCard"') || !html.includes("に決定！")) throw new Error("決定画面が出ない");
  undoTodayAdoption("chicken_breast");
});

check("決定済み食材を選び直しても勝手に決定画面にならない（回帰）", () => {
  S.roles = ["main"]; S.pick = "beef_loin"; save(S);
  adoptSwap("beef_loin", "chicken_breast", 500); // 決定直後は決定画面
  if (!document.getElementById("homeCard").innerHTML.includes('id="decidedCard"')) throw new Error("決定直後に決定画面が出ない");
  setPick("pork_loin");   // 別の食材を選ぶ
  setPick("beef_loin");   // もう一度同じ食材を選び直す
  const html = document.getElementById("homeCard").innerHTML;
  if (html.includes('id="decidedCard"')) throw new Error("選び直したのに決定済み画面になる（バグ再発）");
  if (!html.includes('id="nutriBalCard"') || !html.includes('id="rankCard"')) throw new Error("通常フローが表示されない");
  if (!S.adoptions.some(a => a.originId === "beef_loin")) throw new Error("履歴（実績）が消えている");
  // 選び直してから再決定すると、決定画面には最新の内容が出る
  adoptSwap("beef_loin", "chicken_thigh", 470);
  const h2 = document.getElementById("homeCard").innerHTML;
  if (!h2.includes('id="decidedCard"') || !h2.includes("鶏もも肉(皮なし)")) throw new Error("再決定で最新の決定が表示されない");
  // 取り消しは直近の1件だけ消える
  const n = S.adoptions.length;
  undoTodayAdoption("beef_loin");
  if (S.adoptions.length !== n - 1) throw new Error("取り消し件数が違う");
  if (!S.adoptions.some(a => a.altId === "chicken_breast")) throw new Error("古い方の履歴まで消えた");
  undoTodayAdoption("beef_loin");
});

check("決定時のスクロール先は decidedCard（◯◯に決定！画面）", () => {
  S.roles = ["main"]; S.pick = "beef_loin"; save(S);
  let target = "";
  document.getElementById("decidedCard").scrollIntoView = () => { target = "decided"; };
  document.getElementById("recipeCard").scrollIntoView = () => { target = "recipe"; };
  adoptSwap("beef_loin", "chicken_thigh", 470);
  if (target !== "decided") throw new Error("スクロール先が違う: " + target);
  undoTodayAdoption("beef_loin");
});

check("AIレシピ: パース・回数制限・カード表示", () => {
  // パース（コードフェンス・前置きに耐性）
  const parsed = aiParseRecipes('前置きです```json\n{"recipes":[{"name":"鶏むねのねぎ塩レモン","time_min":12,"ingredients":["鶏むね肉 300g","長ねぎ 1本"],"steps":["そぎ切りにする","炒めてねぎ塩だれgovを絡める"],"tip":"レモンは最後","source":"https://example.com/r/1"}]}\n```');
  if (parsed.length !== 1 || parsed[0].name !== "鶏むねのねぎ塩レモン") throw new Error("パース失敗: " + JSON.stringify(parsed));
  if (parsed[0].time !== 12 || parsed[0].steps.length !== 2) throw new Error("フィールド変換失敗");
  if (aiParseRecipes("JSONじゃないテキスト").length !== 0) throw new Error("不正入力で空にならない");
  // 回数制限
  S.aiUses = { date: "", count: 0 }; save(S);
  if (aiRemaining() !== AI_DAILY_LIMIT) throw new Error("初期回数が違う");
  aiRecordUse(); aiRecordUse();
  if (aiRemaining() !== AI_DAILY_LIMIT - 2) throw new Error("残回数が減らない");
  S.aiUses = { date: "2000-01-01", count: 3 }; save(S);
  if (aiRemaining() !== AI_DAILY_LIMIT) throw new Error("日付が変わってもリセットされない");
  // 蓄積の表示（その日の気分で選べる一覧）
  S.aiRecipes = [{ food: "chicken_breast", name: "テスト人気レシピ", time: 10, ingredients: [], steps: ["焼く", "食べる"], tip: "", source: "", date: todayStr() }]; save(S);
  const card = aiRecipesCardHTML("chicken_breast", "home");
  if (!card.includes("テスト人気レシピ")) throw new Error("ためたレシピが表示されない");
  if (!card.includes("aiRecipeModal(0)")) throw new Error("タップ導線がない");
  // 決定後画面（この一手で作るなら）にAIカードが出る
  S.roles = ["main"]; S.pick = "chicken_breast"; save(S);
  adoptSwap("chicken_breast", "chicken_breast", 0);
  if (!document.getElementById("homeCard").innerHTML.includes("AIで探した人気レシピ")) throw new Error("決定後画面にAIカードなし");
  undoTodayAdoption("chicken_breast");
  S.aiRecipes = []; S.aiUses = { date: "", count: 0 }; save(S);
});

check("renderDealsFull / renderTrend がクラッシュしない", () => {
  renderDealsFull(); renderTrend();
});

check("recipeNutrition / complementCard", () => {
  const rec = recipeFor("chicken_breast");
  const t = recipeNutrition(rec);
  if (!(t.kcal > 0)) throw new Error("no kcal");
  complementCard(rec); // 落ちなければOK
});

check("レシピ品質: 全レシピに手順(2step以上)・時間・実在食材IDがある", () => {
  const bad = [];
  RECIPES.forEach(r => {
    if (!Array.isArray(r.steps) || r.steps.length < 2) {
      // 超簡単レシピ（卵かけご飯等）は2step、盛るだけ系は1stepを許容
      if (!(Array.isArray(r.steps) && r.steps.length >= 1 && r.time <= 4)) bad.push(r.name + ":steps");
    }
    if (!(r.time > 0)) bad.push(r.name + ":time");
    r.ing.forEach(i => { if (!ALL[i.id]) bad.push(r.name + ":ing:" + i.id); });
    if (!RECIPES.every(x => x.steps.every ? true : false)) {}
  });
  if (bad.length) throw new Error(bad.join(", "));
  if (RECIPES.length < 59) throw new Error("レシピ数が減っている: " + RECIPES.length);
});

check("レシピ表示: 番号付き手順・時間・コツがHTMLに出る", () => {
  const rec = RECIPES.find(r => r.name === "サーモンの塩焼き定食");
  const html = recipeHTML(rec);
  if (!html.includes("<ol class=\"rsteps\">")) throw new Error("手順リストなし");
  if (!html.includes("⏱ 約15分")) throw new Error("時間なし");
  if (!html.includes("💡")) throw new Error("コツなし");
  // 旧文字列steps（フォールバック）でも壊れない
  const fb = recipeFor("mayo");
  if (!stepsHTML(fb).includes("<li>")) throw new Error("フォールバックが壊れた");
  if (!stepsText(rec).includes(" → ")) throw new Error("stepsTextが壊れた");
});

check("実績タブが削除され、値動きページに置き換わっている", () => {
  if (typeof renderStats !== "undefined") throw new Error("renderStats が残っている");
  if (html.includes('data-view="stats"')) throw new Error("navに実績タブが残っている");
  if (!html.includes('data-view="trend"')) throw new Error("navに値動きタブがない");
});

check("値動き: デモ値で値下がり・値上がりの両方が出る", () => {
  S.marketData = null; save(S);
  renderTrend();
  const t = document.getElementById("trendCard").innerHTML;
  if (!t.includes("安くなっている食材")) throw new Error("値下がりカードなし");
  if (!t.includes("高くなっている食材")) throw new Error("値上がりカードなし");
  if (!t.includes("▼") || !t.includes("▲")) throw new Error("▼/▲表示なし");
  if (!t.includes("goToSetting('estatCard')")) throw new Error("e-Stat誘導リンクなし");
});

check("値動き: 前月の実データ同士の比較で%が出る（内蔵目安とは比べない）", () => {
  S.marketData = { month: "2026年6月", prevMonth: "2026年5月", area: "特別区部",
    prices: { beef_loin: 540, chicken_breast: 110, moyashi: 18 },
    prev: { beef_loin: 600, chicken_breast: 100 } }; // もやしは前月データなし
  save(S);
  renderTrend();
  const t = document.getElementById("trendCard").innerHTML;
  if (!t.includes("値下がりした食材")) throw new Error("値下がりカードなし");
  if (!t.includes("▼10%")) throw new Error("牛ロース▼10%（600→540実データ比）が出ない: " + (t.match(/▼\d+%/g) || []).join(","));
  if (!t.includes("▲10%")) throw new Error("鶏むね▲10%が出ない");
  if (!t.includes("2026年5月")) throw new Error("比較基準の前月名が明記されない");
  // 前月データが無い食材は%を出さない（内蔵目安と比較してでたらめな%を出さない）
  const rows = t.match(/もやし[\s\S]{0,120}?%/);
  if (rows && /もやし[\s\S]{0,80}?[▼▲]\d+%/.test(t)) throw new Error("前月データなしのもやしに%が付いている");
  if (momDrop("moyashi") !== 0) throw new Error("momDropが目安と比較している: " + momDrop("moyashi"));
  // 検索で絞り込み（かな漢字対応）
  document.getElementById("trendSearch").value = "ぎゅうろーす";
  renderTrend();
  const t2 = document.getElementById("trendCard").innerHTML;
  if (!t2.includes("牛ロース")) throw new Error("検索で牛ロースが出ない");
  if (t2.includes("鶏むね肉")) throw new Error("検索で他の食材が消えない");
  document.getElementById("trendSearch").value = "";
  S.marketData = null; save(S);
  renderTrend();
});

check("カテゴリ別軸: 野菜はビタミン・食物繊維で評価される", () => {
  const veg = nkOf(ALL.tomato), main = nkOf(ALL.beef_loin);
  if (!veg.includes("vitC") || !veg.includes("fiber") || veg.includes("omega3")) throw new Error("野菜の軸が違う: " + veg);
  if (!main.includes("protein") || !main.includes("omega3") || main.includes("vitC")) throw new Error("メインの軸が違う: " + main);
  const t = foodNutritionHTML(ALL.tomato);
  if (!t.includes("ビタミンC") || !t.includes("食物繊維") || !t.includes("葉酸")) throw new Error("野菜詳細にビタミン・繊維バーがない");
  if (t.includes("オメガ3")) throw new Error("野菜詳細にオメガ3が残っている");
  if (!t.includes("この食材の本領")) throw new Error("野菜用の見出しになっていない");
  if (!foodNutritionHTML(ALL.banana).includes("この食材の本領")) throw new Error("果物がビタミン見出しでない");
  const b = foodNutritionHTML(ALL.beef_loin);
  if (!b.includes("オメガ3") || !b.includes("ビタミンD")) throw new Error("メイン詳細の軸が変わってしまった");
});

check("カテゴリ別軸: 栄養マッチが野菜軸で妥当（トマト⇔ピーマン高・トマト→米は弾く）", () => {
  const m = nutriMatch(ALL.tomato, ALL.piman);
  if (m.pct < 50) throw new Error("トマト→ピーマンが " + m.pct + "%（ビタミン軸なら近いはず）");
  const bad = nutriMatch(ALL.tomato, ALL.rice_bowl);
  if (bad.cov >= 0.55) throw new Error("トマト→白米ごはんが弾かれない: cov=" + bad.cov.toFixed(2));
});

check("コスパ: 野菜のデフォルトが金額あたりビタミンCになり、チップも野菜軸", () => {
  S.cospaNut = {}; save(S);
  renderDealsFull();
  const h = document.getElementById("dealsFull").innerHTML;
  if (!h.includes("金額あたりの<b>ビタミンC</b>")) throw new Error("野菜のデフォルトがビタミンCでない");
  if (!h.includes("setCospaNut('veg','fiber')")) throw new Error("野菜チップに食物繊維がない");
  if (h.includes("setCospaNut('veg','protein')")) throw new Error("野菜チップにたんぱく質が残っている");
  if (!h.includes("setCospaNut('main','omega3')")) throw new Error("メインチップにオメガ3がない");
});

check("固定目安: カスタムPFC適用後もビタミン・繊維の目安が維持される", () => {
  applyRef(deriveFromKcal(2000, 30, 20, 50), 4);
  if (REF.fiber !== 21 || REF.vitC !== 100 || REF.folate !== 240) throw new Error("固定目安が消えた: " + REF.fiber + "/" + REF.vitC);
  if (Math.abs(mealRef("vitC") - 25) > 0.01) throw new Error("mealRef(vitC)が食数で割られない: " + mealRef("vitC"));
  refReset();
});

check("栄養表記: 納豆は1パック・卵は1個あたりで計算される", () => {
  const nattoHtml = foodNutritionHTML(ALL.natto);
  if (!nattoHtml.includes("1パック・約45g")) throw new Error("納豆が1パック表記でない");
  if (!nattoHtml.includes("7.4g")) throw new Error("納豆Pが1パック換算(16.5×0.45=7.4g)でない");
  const eggHtml = foodNutritionHTML(ALL.egg);
  if (!eggHtml.includes("1個・約50g")) throw new Error("卵が1個表記でない");
  if (!eggHtml.includes(">71<")) throw new Error("卵kcalが1個換算(142×0.5=71)でない");
  // 単位が無い食材は従来どおり100gあたり
  const beefHtml = foodNutritionHTML(ALL.beef_loin);
  if (!beefHtml.includes("100gあたり")) throw new Error("牛ロースが100g表記でない");
  if (!beefHtml.includes("16.5g")) throw new Error("牛ロースPが100g値でない");
});

check("最近選んだ機能が削除されている", () => {
  setPick("saba_can");
  if (typeof S.recentPicks !== "undefined" && S.recentPicks !== null && Array.isArray(S.recentPicks) && S.recentPicks.length)
    throw new Error("recentPicksがまだ記録されている");
  if (pickerCardHTML().includes("最近選んだ")) throw new Error("最近選んだ行が残っている");
});

check("マイ価格メモ: 安い？ページで記録→食材詳細に最安表示", () => {
  const $ = (id) => document.getElementById(id);
  chkSelect("chicken_breast");
  $("chkPrice").value = "80"; $("chkGram").value = "100";
  chkRecord();
  $("chkPrice").value = "120"; chkRecord();
  const logs = S.priceLog.filter(l => l.id === "chicken_breast");
  if (logs.length < 2) throw new Error("priceLogに記録されない");
  const best = Math.min(...logs.map(l => l.per100));
  const line = myPriceLine("chicken_breast");
  if (!line.includes("最安 ") || !line.includes("¥" + best)) throw new Error("最安が出ない: " + line);
  if (!line.includes("直近 ¥120")) throw new Error("直近が出ない: " + line);
});

check("料理計算タブが削除されている", () => {
  if (typeof renderCalc !== "undefined" || typeof saveMeal !== "undefined") throw new Error("料理計算の関数が残っている");
  if (html.includes('data-view="calc"')) throw new Error("navに料理計算タブが残っている");
});

check("書き出し・復元カードが削除され、リセットは残っている", () => {
  if (html.includes('id="exportCsv"') || html.includes('id="importBtn"')) throw new Error("書き出し/復元UIが残っている");
  if (typeof download !== "undefined") throw new Error("download関数が残っている");
  if (!html.includes('id="resetBtn"')) throw new Error("リセットが消えている");
});

check("ランキング: 栄養マッチバーがあり「相場より」バーは削除済み", () => {
  S.roles = ["main"]; S.pick = "beef_loin"; save(S);
  renderHome();
  const html = document.getElementById("homeCard").innerHTML;
  if (!html.includes('id="rankCard"')) throw new Error("rankCard idなし");
  if (!html.includes("rkm-fl teal")) throw new Error("栄養マッチバーなし");
  if (html.includes("相場より</span>") || html.includes("rkm-fl gold")) throw new Error("相場よりバーが残っている");
  if (!html.includes("おトク")) throw new Error("おトク表示なし");
});

check("栄養カード: 1食目安バー（PFC＋その他）と決定ボタンがランキングの前に出る", () => {
  S.roles = ["main"]; S.pick = "beef_loin"; save(S);
  renderHome();
  const html = document.getElementById("homeCard").innerHTML;
  if (!html.includes('id="nutriBalCard"')) throw new Error("栄養カードなし");
  if (html.includes("<svg") && html.includes("レーダー")) throw new Error("多角形が残っている");
  if (!html.includes("PFCバランス（100gあたり vs 1食目安）")) throw new Error("PFCバー見出しなし");
  if (!html.includes("その他の栄養素")) throw new Error("その他栄養バーなし");
  if (!html.includes("1食目安")) throw new Error("1食目安基準の表示なし");
  if (!html.includes("cmprow")) throw new Error("バー表示なし");
  if (!html.includes("牛ロース(生) にする（決定）")) throw new Error("決定ボタンなし");
  if (html.indexOf("nutriBalCard") > html.indexOf('id="rankCard"')) throw new Error("ランキングより後に表示されている");
  if (!html.includes(`adoptSwap('beef_loin','beef_loin',0)`)) throw new Error("決定ボタンの動作が違う");
  if (typeof globalThis.radarSVG !== "undefined") throw new Error("radarSVGが残っている");
});

check("最安級でも「それが最適です」を出さず類似食材を提案する", () => {
  S.roles = ["main"]; S.pick = "egg"; save(S);  // 卵は最安級（安い乗り換え先なし）
  renderHome();
  const h = document.getElementById("homeCard").innerHTML;
  if (h.includes("それが最適です")) throw new Error("旧文言が残っている");
  if (!h.includes("最安級です")) throw new Error("最安級の判定が出ない");
  if (!h.includes("鶏卵 にする（決定）")) throw new Error("決定ボタンがない");
  if (!h.includes("これにする")) throw new Error("類似候補の乗り換えボタンがない");
  if (!h.includes("rkm-fl teal")) throw new Error("類似候補に栄養マッチバーがない");
  if (!h.includes("高め")) throw new Error("相場が高い候補の表示がない");
  S.pick = "beef_loin"; save(S); renderHome();
});

check("setPick で栄養バランス（→ランキング）へスクロール", () => {
  let scrolled = false;
  const el = document.getElementById("nutriBalCard");
  el.scrollIntoView = () => { scrolled = true; };
  setPick("beef_loin");
  if (!scrolled) throw new Error("scrollIntoView が呼ばれない");
});

check("withDefaults: 部分データから新フィールドを補完する", () => {
  const restored = withDefaults(JSON.parse('{"adoptions":[]}'));
  if (!restored.priceLog || !restored.refPresets || !restored.aiRecipes) throw new Error("withDefaultsが新フィールドを補完しない");
});

check("チュートリアル: 全ステップ進めて完了→再表示も可能", () => {
  if (!html.includes('id="tutorial"')) throw new Error("チュートリアルのHTMLがない");
  if (!html.includes("showTutorial(0)")) throw new Error("設定に再表示ボタンがない");
  S.tutorialDone = false; save(S);
  showTutorial(0);
  const tut = document.getElementById("tutorial"), card = document.getElementById("tutCard");
  if (tut.classList.contains("hidden")) throw new Error("表示されない");
  if (!card.innerHTML.includes("ようこそ")) throw new Error("1枚目がようこそでない");
  if (!card.innerHTML.includes("スキップ")) throw new Error("スキップがない");
  for (let i = 0; i < TUT_STEPS.length - 1; i++) tutNext();
  if (!card.innerHTML.includes("はじめる")) throw new Error("最終ステップに「はじめる」がない");
  tutNext(); // 末尾で押しても落ちない
  tutPrev(); tutNext();
  tutFinish();
  if (!tut.classList.contains("hidden")) throw new Error("完了で閉じない");
  if (S.tutorialDone !== true) throw new Error("完了フラグが保存されない");
  if (withDefaults(JSON.parse('{"adoptions":[]}')).tutorialDone !== false) throw new Error("withDefaultsに初期値がない");
  showTutorial(0); // 設定からの再表示
  if (tut.classList.contains("hidden")) throw new Error("再表示できない");
  tutFinish();
});

check("チュートリアル: 操作可能（透過）＋実操作で自動進行", () => {
  if (!/\.tut\{[^}]*pointer-events:none/.test(html)) throw new Error("背面が操作できない（コンテナが透過でない）");
  if (!/\.tut-card\{[^}]*pointer-events:auto/.test(html)) throw new Error("カードが操作できない");
  S.tutorialDone = false; save(S);
  showTutorial(1); // ①今日の一手（waitFor:"pick"）
  if (!document.getElementById("tutCard").innerHTML.includes("やってみよう")) throw new Error("実践ガイドがない");
  const oldTimeout = global.setTimeout;
  global.setTimeout = (fn) => { fn(); return 0; }; // 自動進行を即時実行
  setPick("egg"); // 実際に食材を選ぶ → 自動で次のステップへ
  global.setTimeout = oldTimeout;
  if (tutIdx !== 2) throw new Error("操作しても次に進まない: step=" + tutIdx);
  tutFinish();
});

check("値動き: 月セレクタが出て、月別チャートは実データなし食材で詳細にフォールバック", () => {
  S.marketData = { month: "2026年5月", timeCode: "2026000505", area: "特別区部", areaCode: "13100",
    prices: { beef_loin: 540 }, codes: { beef_loin: "01201" }, prev: {} };
  S.marketMeta = { times: [{ code: "2026000404", name: "2026年4月" }, { code: "2026000505", name: "2026年5月" }] };
  save(S);
  trendMonthSel = null;
  renderTrend();
  const t = document.getElementById("trendCard").innerHTML;
  if (!t.includes('id="trendMonth"')) throw new Error("月セレクタがない");
  if (!t.includes("2026年4月") || !t.includes("2026年5月")) throw new Error("月の選択肢が足りない");
  openTrendChart("egg"); // codesに無い → openFoodModalへフォールバック
  if (!els["modalBody"].innerHTML.includes("鶏卵")) throw new Error("チャート非対応食材が詳細にフォールバックしない");
  hideModal();
  S.marketData = null; S.marketMeta = null; save(S); renderTrend();
});

check("値動きタブ切替 switchView('trend')", () => {
  switchView("trend"); // 落ちなければOK
  switchView("home");
});

check("戻る機能: 画面履歴・←ボタン表示・popstateで戻る", () => {
  switchView("home");
  const back = document.getElementById("backBtn");
  switchView("deals");
  if (back.classList.contains("off")) throw new Error("履歴があるのに←が薄いまま（off）");
  // popstate（ブラウザ/Android戻る相当）で前の画面へ
  window.onpopstate({ state: { view: "home" } });
  if (!document.getElementById("view-home").classList) throw new Error("home適用失敗");
  // モーダルを開くと履歴が積まれ、goBackはhistory.back()経由で閉じる
  const before = global.history.backCalls;
  openFoodModal("egg");
  goBack();
  if (global.history.backCalls !== before + 1) throw new Error("モーダルからの戻るがhistory.backを呼ばない");
  window.onpopstate({ state: { view: "home" } }); // popstate到来でモーダルが閉じる
  hideModal();
});

check("栄養目安（カロミル方式）: カロリー×PFC比率×食数で全画面の基準が変わる", () => {
  // deriveFromKcal: 2000kcal・P20/F25/C55 → P100g/F56g/C275g、微量栄養素はエネルギー比
  const d = deriveFromKcal(2000, 20, 25, 55);
  if (d.protein !== Math.round(2000 * 0.20 / 4)) throw new Error("Pグラム換算が違う: " + d.protein);
  if (d.fat !== Math.round(2000 * 0.25 / 9)) throw new Error("Fグラム換算が違う: " + d.fat);
  if (d.carb !== Math.round(2000 * 0.55 / 4)) throw new Error("Cグラム換算が違う: " + d.carb);
  const factor = 2000 / REF_DEFAULT_KCAL;
  if (d.calcium !== Math.round(700 * factor)) throw new Error("カルシウムが比例しない: " + d.calcium);
  // 食数4で適用 → 1食目安が1日÷4に
  applyRef(d, 4);
  if (MEALS_N !== 4 || S.mealsPerDay !== 4) throw new Error("食数が反映されない");
  const expKcal = Math.round((d.protein * 4 + d.fat * 9 + d.carb * 4) / 4);
  if (MEAL_KCAL !== expKcal) throw new Error("1食kcalが食数で割られない: " + MEAL_KCAL);
  // バーの1食目安 = P100g/4食 = 25.0g
  if (!foodNutritionHTML(ALL.egg).includes("25.0g")) throw new Error("バーの1食目安が変わらない");
  if (Math.abs(mealRef("protein") - 25) > 0.01) throw new Error("mealRefが違う");
  refReset();
  if (REF.protein !== 65 || MEALS_N !== 3 || S.refCustom !== null) throw new Error("標準に戻らない");
});

check("栄養目安の入力検証: PFC合計100%・カロリー範囲・食数", () => {
  renderRefCard();
  const set = (id, v) => { document.getElementById(id).value = String(v); };
  set("ref_kcal", 2200); set("ref_p", 20); set("ref_f", 25); set("ref_c", 55); set("ref_meals", 4);
  const r = readRefInputs();
  if (!r || r.meals !== 4 || r.meta.kcal !== 2200) throw new Error("正常入力が通らない");
  set("ref_c", 50); // 合計95%
  if (readRefInputs() !== null) throw new Error("合計100%未満が弾かれない");
  set("ref_c", 55); set("ref_kcal", 500); // 範囲外
  if (readRefInputs() !== null) throw new Error("カロリー範囲外が弾かれない");
  set("ref_kcal", 2200);
});

check("全画面ボタン: HTMLに存在し、非対応環境でも落ちずに案内する", () => {
  if (!html.includes('id="fsBtn"')) throw new Error("fsBtn がHTMLにない");
  toggleFullscreen(); // スタブは Fullscreen API 非対応 → toast案内（クラッシュしないこと）
  updateFsBtn();
});

check("PFC入力: %を入れるとgが自動計算される", () => {
  renderRefCard(); // refEditOrder がリセットされる
  const set = (id, v) => { document.getElementById(id).value = String(v); };
  const get = (id) => parseFloat(document.getElementById(id).value);
  set("ref_kcal", 2000); set("ref_p", 20); set("ref_f", 25); set("ref_c", 55);
  refSync("p", "pct"); // P20% × 2000kcal → 100g
  if (get("ref_pg") !== 100) throw new Error("P20%→" + get("ref_pg") + "g（期待100g）");
});

check("PFC入力: gを入れると%が自動計算される", () => {
  renderRefCard();
  const set = (id, v) => { document.getElementById(id).value = String(v); };
  const get = (id) => parseFloat(document.getElementById(id).value);
  set("ref_kcal", 2000); set("ref_p", 20); set("ref_f", 25); set("ref_c", 55);
  set("ref_pg", 150);
  refSync("p", "g"); // 150g × 4kcal ÷ 2000kcal → 30%
  if (get("ref_p") !== 30) throw new Error("P150g→" + get("ref_p") + "%（期待30%）");
});

check("PFC入力: 2つ入力すると残り1つが合計100%に自動で埋まる", () => {
  renderRefCard();
  const set = (id, v) => { document.getElementById(id).value = String(v); };
  const get = (id) => parseFloat(document.getElementById(id).value);
  set("ref_kcal", 2000); set("ref_p", 30); set("ref_f", 25); set("ref_c", 55);
  refSync("p", "pct"); // P編集 → 未編集のC(優先)が吸収: C=100-30-25=45
  if (get("ref_c") !== 45) throw new Error("C自動調整が " + get("ref_c") + "%（期待45%）");
  set("ref_f", 20);
  refSync("f", "pct"); // P・F編集済み → C=100-30-20=50, g=2000×50%÷4=250g
  if (get("ref_c") !== 50) throw new Error("C再調整が " + get("ref_c") + "%（期待50%）");
  if (get("ref_cg") !== 250) throw new Error("Cのgが " + get("ref_cg") + "（期待250g）");
  if (readRefInputs() === null) throw new Error("自動補完後の入力が検証を通らない");
  // カロリー変更 → 比率維持でgだけ再計算
  set("ref_kcal", 1000);
  refSyncKcal();
  if (get("ref_pg") !== 75) throw new Error("kcal変更後のPが " + get("ref_pg") + "g（期待75g）");
});

check("栄養目安プリセット: 名前を付けて保存→戻す→削除（食数込み）", () => {
  renderRefCard();
  const set = (id, v) => { document.getElementById(id).value = String(v); };
  set("ref_kcal", 1800); set("ref_p", 30); set("ref_f", 20); set("ref_c", 50); set("ref_meals", 5);
  refSavePreset(); // prompt スタブ → 「テスト朝食」
  if (!S.refPresets.length || S.refPresets[0].name !== "テスト朝食") throw new Error("プリセットが保存されない");
  if (S.refPresets[0].meals !== 5) throw new Error("食数が保存されない");
  if (REF.protein !== Math.round(1800 * 0.30 / 4) || MEALS_N !== 5) throw new Error("保存時に適用されない");
  refReset();
  if (REF.protein !== 65 || MEALS_N !== 3) throw new Error("リセット失敗");
  refLoadPreset(0); // 過去の設定に戻す（食数ごと）
  if (REF.protein !== 135 || MEALS_N !== 5) throw new Error("プリセット適用で戻らない");
  refDeletePreset(0);
  if (S.refPresets.length !== 0) throw new Error("削除されない");
  refReset();
});

check("API設定へジャンプ: goToSetting がカードへスクロール", () => {
  let hit = "";
  document.getElementById("aiKeyCard").scrollIntoView = () => { hit = "ai"; };
  document.getElementById("estatCard").scrollIntoView = () => { hit = "estat"; };
  goToSetting("aiKeyCard");
  if (hit !== "ai") throw new Error("AIカードへ飛ばない");
  goToSetting("estatCard");
  if (hit !== "estat") throw new Error("e-Statカードへ飛ばない");
  // キー未登録時のAIボタンは goToSetting に配線される
  S.aiKey = null; save(S);
  const card = aiRecipesCardHTML("chicken_breast", "home");
  if (!card.includes("goToSetting('aiKeyCard')")) throw new Error("未登録時のボタンがAPI設定に飛ばない");
  if (!card.includes("API設定を開いて")) throw new Error("文言が違う");
  switchView("home");
});

check("アフィリエイト: 文脈に合うリンクと広告表記（ステマ規制対応）", () => {
  // 日持ち品（さば缶）→ まとめ買い（楽天市場/Amazon）
  const canned = shopLinksHTML("saba_can");
  if (!canned.includes("まとめ買い")) throw new Error("日持ち品にまとめ買い提案がない");
  if (!canned.includes("search.rakuten.co.jp") || !canned.includes("amazon.co.jp")) throw new Error("まとめ買いリンク先が違う");
  if (!canned.includes("広告")) throw new Error("広告表記がない");
  if (!canned.includes('rel="noopener sponsored"')) throw new Error("rel=sponsoredがない");
  // 生鮮（トマト）→ ネットスーパー
  const fresh = shopLinksHTML("tomato");
  if (!fresh.includes("sm.rakuten.co.jp")) throw new Error("生鮮にネットスーパーリンクがない");
  // 食材詳細モーダルに出る
  openFoodModal("saba_can");
  if (!els["modalBody"].innerHTML.includes("ネットの価格も見る")) throw new Error("詳細モーダルにリンクカードがない");
  hideModal();
  // 安い？の「高い」判定時のみ比較リンク
  chkSelect("tomato");
  document.getElementById("chkPrice").value = "300"; document.getElementById("chkGram").value = "100"; // 相場より高い
  chkJudge();
  if (!document.getElementById("chkVerdict").innerHTML.includes("ネットスーパーの価格も見てみる")) throw new Error("高い判定に比較リンクがない");
  document.getElementById("chkPrice").value = "40"; // 安い
  chkJudge();
  if (document.getElementById("chkVerdict").innerHTML.includes("ネットスーパーの価格も見てみる")) throw new Error("安い判定にも広告が出ている");
  // 設定に開示カード・キーワードの()除去
  if (!html.includes("アフィリエイト広告を含みます")) throw new Error("設定に広告開示がない");
  if (shopKeyword("chicken_breast") !== "鶏むね肉") throw new Error("キーワードの()除去が効かない: " + shopKeyword("chicken_breast"));
  handlePop({ state: { view: "check" } }); switchView("home");
});

check("相場データ: e-Stat実データが marketOf/momDrop に反映される", () => {
  S.marketData = { month: "2026年7月", area: "東京都区部", fetchedAt: todayStr(),
    prices: { chicken_breast: 88, beef_loin: 650 }, prev: { chicken_breast: 100, beef_loin: 600 } };
  save(S);
  if (marketOf("chicken_breast") !== 88) throw new Error("marketOfが実データを使わない: " + marketOf("chicken_breast"));
  if (marketOf("egg") !== 30) throw new Error("未取得食材は内蔵目安のはず");
  if (momDrop("chicken_breast") !== 12) throw new Error("momDrop: " + momDrop("chicken_breast"));
  if (momDrop("beef_loin") >= 0) throw new Error("値上がりは負のはず: " + momDrop("beef_loin"));
  // ランキングの節約額も実データ基準に追従
  const r = suggest("beef_loin", { topN: 1 })[0];
  if (r.saving !== 650 - marketOf(r.f.id)) throw new Error("suggestが実データに追従しない");
});

check("電光掲示板: 値下がり食材が流れる（2周分・タップで詳細）", () => {
  renderLed();
  const bar = document.getElementById("ledbar"), track = document.getElementById("ledTrack");
  if (bar.style.display === "none") throw new Error("表示されない");
  if (!track.innerHTML.includes("▼12%")) throw new Error("値下がり%が出ない: " + track.innerHTML.slice(0, 200));
  if (!track.innerHTML.includes("openFoodModal")) throw new Error("タップ導線なし");
  const halves = track.innerHTML.split("安くなった食材").length - 1;
  if (halves !== 2) throw new Error("無限ループ用の2周分になっていない: " + halves);
});

check("掲示板: 手動スクロール対応（overflow-x:auto）＋自動送りが安全に動く", () => {
  if (!/\.ledbar\{[^}]*overflow-x:auto/.test(html)) throw new Error("ledbarが手動スクロール可能でない");
  if (/led-track\{[^}]*animation:ledMove/.test(html)) throw new Error("旧CSSアニメーションが残っている");
  if (typeof startLedFlow !== "function") throw new Error("startLedFlowがない");
  startLedFlow(); // スタブ環境（addEventListener無し・reduced-motion）でも落ちない
});

check("相場データなしなら電光掲示板は非表示・コスパには値動きタブへの誘導が出る", () => {
  S.marketData = null; save(S);
  renderLed();
  if (document.getElementById("ledbar").style.display !== "none") throw new Error("非表示にならない");
  renderDealsFull();
  if (!document.getElementById("dealsFull").innerHTML.includes("switchView('trend')")) throw new Error("値動きタブへの誘導がない");
});

check("updateMarket: 共有キー内蔵でappId未設定でも取得が始まる", () => {
  S.estatAppId = null; save(S);
  if (!ESTAT_SHARED_APP_ID) throw new Error("共有キーが空");
  updateMarket(true); // fetchスタブは失敗するが、同期部分で「取得中」表示に入る＝共有キーで走っている
  if (!document.getElementById("mkStatus").innerHTML.includes("取得中")) throw new Error("共有キーで取得が開始されない");
});

check("検索: ひらがな⇔漢字⇔カタカナのどれでもヒット", () => {
  // ひらがな → 漢字名（FOODS）
  if (!foodMatch("とりむね", "鶏むね肉(皮なし)", YOMI.chicken_breast)) throw new Error("とりむね→鶏むね肉");
  if (!foodMatch("たまご", "鶏卵", YOMI.egg)) throw new Error("たまご→鶏卵");
  if (!foodMatch("ぎゅうにゅう", "牛乳", YOMI.milk)) throw new Error("ぎゅうにゅう→牛乳");
  // 漢字 → ひらがな主体の公式名（FULLDB形式・読みなし）
  if (!foodMatch("鶏むね", "にわとり　［若どり・主品目］　むね　皮なし　生")) throw new Error("鶏むね→にわとり…むね");
  if (!foodMatch("食パン", "こむぎ　［パン類］　角形食パン　食パン")) throw new Error("食パン→公式名");
  if (!foodMatch("ほうれん草", "ほうれんそう　葉　通年平均　生")) throw new Error("ほうれん草→ほうれんそう");
  if (!foodMatch("卵", "鶏卵　全卵　生", YOMI.egg)) throw new Error("卵→鶏卵");
  // カタカナ⇔ひらがな
  if (!foodMatch("ぶろっこりー", "ブロッコリー(生)")) throw new Error("ぶろっこりー→ブロッコリー");
  // 一致しないものはヒットしない
  if (foodMatch("さば", "鶏むね肉(皮なし)", YOMI.chicken_breast)) throw new Error("誤ヒット");
});

check("検索UI: ピッカーがかな漢字対応", () => {
  onPickSearch("とりむね");
  if (!pickerChipsHTML().includes("鶏むね肉")) throw new Error("ピッカーでとりむねが出ない");
  onPickSearch("");
});

check("野菜の追加: 検索・レシピ・PANTRY非破壊", () => {
  onPickSearch("もやし");
  if (!pickerChipsHTML().includes("もやし")) throw new Error("もやしが検索できない");
  onPickSearch("だいこん");
  if (!pickerChipsHTML().includes("大根")) throw new Error("大根がひらがなで検索できない");
  onPickSearch("");
  if (FOODS.filter(f => f.cat === "veg").length < 15) throw new Error("野菜が15品未満");
  if (!ALL.onion.cat || ALL.onion.effort == null) throw new Error("玉ねぎがPANTRY版に上書きされている");
  ["moyashi","onion","cabbage","carrot","tomato","hakusai","piman","kabocha","daikon","maitake",
   "nasu","kyuri","lettuce","potato","negi","pork_belly","pork_komagire","mince_mix","sasami"].forEach(id => {
    const rec = recipeFor(id);
    if (!rec || rec.name.includes("簡単メニュー")) throw new Error(id + " の専用レシピがない");
  });
  if (unitLabel("moyashi") !== "1袋・約200g") throw new Error("もやしの単位表記が違う");
});

check("サブカテゴリ: ピッカーが小見出しでまとまり、検索中はフラット", () => {
  S.roles = ["main"]; S.pick = null; pickQuery = ""; save(S);
  const h = pickerChipsHTML();
  if (!h.includes("🍖 肉") || !h.includes("🥚 卵・大豆") || !h.includes("🐟 魚・缶詰")) throw new Error("メインのサブカテゴリがない");
  S.roles = ["veg"]; save(S);
  const v = pickerChipsHTML();
  if (!v.includes("🧺 定番野菜") || !v.includes("🍅 実もの・サラダ") || !v.includes("🍄 きのこ")) throw new Error("野菜のサブカテゴリがない");
  onPickSearch("とり");
  if (pickerChipsHTML().includes("chipgrp-lab")) throw new Error("検索中もグループ表示になっている");
  onPickSearch("");
  renderCheckList("");
  if (!document.getElementById("chkBody").innerHTML.includes("🍚 主食")) throw new Error("安い？に主食の見出しがない");
  S.roles = ["main"]; save(S);
});

check("皮つき鶏肉: データ・並び・栄養差", () => {
  if (!ALL.chicken_breast_skin || !ALL.chicken_thigh_skin) throw new Error("皮つきがない");
  if (!(ALL.chicken_breast_skin.n.fat > ALL.chicken_breast.n.fat)) throw new Error("皮つきむねの脂質が皮なし以下");
  if (!(ALL.chicken_thigh_skin.n.kcal > ALL.chicken_thigh.n.kcal)) throw new Error("皮つきももが低カロリー");
  const mains = roleFoods(["main"]).map(f => f.id);
  if (mains.indexOf("chicken_breast_skin") !== mains.indexOf("chicken_breast") + 1) throw new Error("皮つきむねが皮なしの直後でない");
  const rec = recipeFor("chicken_thigh_skin");
  if (rec.name.includes("簡単メニュー")) throw new Error("皮つきももの専用レシピがない");
});

check("果物カテゴリ新設＋魚・加工肉・きのこ等11品の追加", () => {
  if (!ROLES.fruit) throw new Error("果物ロールがない");
  if (foodRole(ALL.banana) !== "fruit") throw new Error("バナナのロールが違う");
  const fk = nkOf(ALL.banana);
  if (!fk.includes("vitC") || !fk.includes("fiber") || fk.includes("protein")) throw new Error("果物の評価軸が違う: " + fk);
  ["banana","apple","mikan","kiwi","buri","aji","ham","sausage","plain_yogurt","enoki","shiitake"].forEach(id => {
    if (!ALL[id]) throw new Error(id + " がない");
    const rec = recipeFor(id);
    if (rec.name.includes("簡単メニュー")) throw new Error(id + " の専用レシピがない");
  });
  const m = nutriMatch(ALL.mikan, ALL.kiwi);
  if (m.pct < 40) throw new Error("みかん→キウイのマッチが低すぎ: " + m.pct + "%");
  if (unitLabel("banana") !== "1本・約90g") throw new Error("バナナの単位が違う");
  if (subgroupOf(ALL.enoki) !== "🍄 きのこ") throw new Error("えのきがきのこグループでない");
  // コスパの果物カードが出る
  S.cospaNut = {}; save(S); renderDealsFull();
  if (!document.getElementById("dealsFull").innerHTML.includes("🍎 果物")) throw new Error("コスパに果物カードがない");
});

check("第3弾追加: 輸入牛・ベーコン・さんま・いか・ちくわ・木綿豆腐・根菜・麺類", () => {
  const ids = ["beef_imported","bacon","sanma","ika","chikuwa","momen_tofu","gobo","renkon","satoimo","udon","soba"];
  ids.forEach(id => {
    if (!ALL[id]) throw new Error(id + " がない");
    const rec = recipeFor(id);
    if (rec.name.includes("簡単メニュー")) throw new Error(id + " の専用レシピがない");
  });
  if (subgroupOf(ALL.gobo) !== "🧺 定番野菜") throw new Error("ごぼうが定番野菜グループでない");
  if (foodRole(ALL.udon) !== "carb" || foodRole(ALL.chikuwa) !== "main") throw new Error("ロールが違う");
  if (!(ALL.momen_tofu.n.protein > ALL.tofu.n.protein)) throw new Error("木綿のPが絹以下");
  if (unitLabel("udon") !== "1玉・約200g") throw new Error("うどんの単位が違う");
  if (!foodMatch("ごぼう", ALL.gobo.name, YOMI.gobo) || !foodMatch("牛蒡", ALL.gobo.name, YOMI.gobo)) throw new Error("ごぼうの検索が効かない");
  if (FOODS.length < 71) throw new Error("食材が71品未満: " + FOODS.length);
});

check("代表食材の追加と使用頻度順の並び（サーモンが先頭に来ない）", () => {
  ["nasu","kyuri","lettuce","potato","pork_belly","pork_komagire","mince_mix","sasami"].forEach(id => {
    if (!ALL[id] || !ALL[id].cat) throw new Error(id + " が追加されていない");
  });
  if (!ALL.negi.cat || ALL.negi.effort == null) throw new Error("長ねぎがFOODSに昇格していない");
  const mains = roleFoods(["main"]);
  if (mains[0].id !== "egg") throw new Error("メインの先頭が鶏卵でない: " + mains[0].id);
  if (mains.findIndex(f => f.id === "salmon_raw") < 5) throw new Error("サーモンが先頭付近に残っている");
  const vegs = roleFoods(["veg"]);
  if (vegs[0].id !== "onion") throw new Error("野菜の先頭が玉ねぎでない: " + vegs[0].id);
  if (FOODS.filter(f => f.cat === "veg").length < 20) throw new Error("野菜が20品未満");
  if (foodRole(ALL.pork_belly) !== "main") throw new Error("豚バラのロールが違う");
});

check("安い？: 食材選択が履歴に積まれ、戻ると食材リストに戻る", () => {
  switchView("check");
  const before = navDepth;
  chkSelect("natto");
  if (navDepth !== before + 1) throw new Error("chkSelectが履歴を積まない");
  if (!document.getElementById("chkBody").innerHTML.includes("goBack()")) throw new Error("「←別の食材を選ぶ」がgoBack未配線");
  handlePop({ state: { view: "check" } }); // スマホの戻る/←ボタン相当
  if (!document.getElementById("chkBody").innerHTML.includes("chkSelect(")) throw new Error("戻っても食材リストに戻らない");
  switchView("home");
});

check("e-Stat共有キー: effectiveAppId の優先順位", () => {
  S.estatAppId = null; save(S);
  if (effectiveAppId() !== ESTAT_SHARED_APP_ID) throw new Error("共有キーが効かない");
  S.estatAppId = "my-key"; save(S);
  if (effectiveAppId() !== "my-key") throw new Error("自分のキーが優先されない");
  S.estatAppId = null; save(S);
});

check("相場チェックページ: 検索→選択→即時判定（安い/普通/高い）", () => {
  const $ = (id) => document.getElementById(id);
  $("chkSearch").value = "とりむね";
  renderCheck();
  if (!$("chkBody").innerHTML.includes("鶏むね肉")) throw new Error("かな検索で出ない");
  $("chkSearch").value = "";
  chkSelect("chicken_breast");
  if (!$("chkBody").innerHTML.includes("値札の数字")) throw new Error("入力UIが出ない");
  $("chkPrice").value = "88"; $("chkGram").value = "100";  // 相場100 → 安い
  chkJudge();
  if (!$("chkVerdict").innerHTML.includes("安い！買い")) throw new Error("安い判定が出ない: " + $("chkVerdict").innerHTML.slice(0, 120));
  $("chkPrice").value = "300";  // 高い
  chkJudge();
  if (!$("chkVerdict").innerHTML.includes("相場より高い")) throw new Error("高い判定が出ない");
  $("chkPrice").value = "100";  // 相場どおり
  chkJudge();
  if (!$("chkVerdict").innerHTML.includes("相場どおり")) throw new Error("普通判定が出ない");
});

check("相場チェック: 価格記録と「これに決定」", () => {
  const $ = (id) => document.getElementById(id);
  const before = S.priceLog.length;
  $("chkPrice").value = "95"; $("chkGram").value = "100";
  chkRecord();
  if (S.priceLog.length !== before + 1) throw new Error("価格が記録されない");
  const beforeAdopt = S.adoptions.length;
  chkAdopt();
  if (S.adoptions.length !== beforeAdopt + 1) throw new Error("決定が記録されない");
  if (S.pick !== "chicken_breast" || !S.roles.includes("main")) throw new Error("pick/rolesが追従しない");
  undoTodayAdoption("chicken_breast");
});

check("地域: 都道府県→県庁所在市の対応と再判定関数", () => {
  if (PREF_CAPITAL["東京都"] !== "特別区部") throw new Error("東京都の対応が違う（調査上の名称は「特別区部」）");
  if (PREF_CAPITAL["愛知県"] !== "名古屋市") throw new Error("愛知県の対応が違う");
  if (Object.keys(PREF_CAPITAL).length !== 47) throw new Error("47都道府県そろっていない: " + Object.keys(PREF_CAPITAL).length);
  if (PREFS[12] !== "東京都") throw new Error("JISコード13→東京都のはず");
  detectRegion(); // fetch失敗でも例外を出さない
});

process.exit(failed ? 1 : 0);
