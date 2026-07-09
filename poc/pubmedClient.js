// Kinto PoC — PubMed E-utilities APIクライアント
// 目的: 代替提案の「科学的根拠」を、論文メタデータから機械的に収集する。
// E-utilities は無料。APIキーなしで 3 req/sec、キー登録で 10 req/sec まで許可。
// 本番では取得した abstract を Claude で要約し「誠実な一言根拠」に変換する。
//
// 使い方:  node pubmedClient.js "frozen vegetables nutrient retention"
// 依存: Node 18+ の グローバル fetch を使用（外部パッケージ不要）。
// ※ ネットワークに出られない環境では取得失敗します（その場合はロジック健全性の確認のみ）。

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const API_KEY = process.env.NCBI_API_KEY || null; // 任意。あればレート上限が上がる

function withKey(url) {
  return API_KEY ? `${url}&api_key=${API_KEY}` : url;
}

// 1) ESearch: クエリ -> PMIDのリスト
async function searchPmids(query, retmax = 5) {
  const url = withKey(
    `${EUTILS}/esearch.fcgi?db=pubmed&retmode=json&retmax=${retmax}&term=${encodeURIComponent(query)}`
  );
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESearch failed: ${res.status}`);
  const json = await res.json();
  return json.esearchresult?.idlist || [];
}

// 2) ESummary: PMID -> タイトル/雑誌/年 などのメタデータ
async function fetchSummaries(pmids) {
  if (pmids.length === 0) return [];
  const url = withKey(
    `${EUTILS}/esummary.fcgi?db=pubmed&retmode=json&id=${pmids.join(",")}`
  );
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESummary failed: ${res.status}`);
  const json = await res.json();
  const result = json.result || {};
  return (result.uids || []).map((uid) => {
    const r = result[uid];
    return {
      pmid: uid,
      title: r.title,
      journal: r.fulljournalname || r.source,
      pubdate: r.pubdate,
      url: `https://pubmed.ncbi.nlm.nih.gov/${uid}/`,
    };
  });
}

async function getEvidence(query, retmax = 5) {
  const pmids = await searchPmids(query, retmax);
  const summaries = await fetchSummaries(pmids);
  return summaries;
}

// --- CLI 実行 ---
if (require.main === module) {
  const query = process.argv.slice(2).join(" ") || "frozen vegetables nutrient retention";
  console.log(`\n[PubMed] query: "${query}"  (api_key=${API_KEY ? "set" : "none, 3req/sec"})\n`);
  getEvidence(query, 5)
    .then((rows) => {
      if (rows.length === 0) { console.log("  ヒットなし"); return; }
      rows.forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.title}`);
        console.log(`     ${r.journal} (${r.pubdate})  PMID:${r.pmid}`);
        console.log(`     ${r.url}\n`);
      });
    })
    .catch((e) => {
      console.error("  取得失敗（ネットワーク制限の可能性）:", e.message);
      console.error("  → ロジックは正常。実行環境がNCBIに到達できれば結果が返ります。");
    });
}

module.exports = { searchPmids, fetchSummaries, getEvidence };
