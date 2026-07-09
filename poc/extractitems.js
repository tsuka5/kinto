const XLSX=require('xlsx');
(async()=>{
  const r=await fetch('https://www.stat.go.jp/data/kouri/doukou/zuhyou/202604.xlsx');
  const wb=XLSX.read(Buffer.from(await r.arrayBuffer()),{type:'buffer'});
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,blankrows:false});
  const want=["うるち米","食パン","スパゲッティ","まぐろ","さけ","さば","いわし","牛肉","豚肉","鶏肉","鶏卵","牛乳","ヨーグルト","チーズ","ほうれんそう","ブロッコリー","こまつな","小松菜","ほうれん草","納豆","豆腐","油揚げ","生揚げ","さつまいも"," オートミール","シリアル"];
  rows.forEach(r=>{const code=r[0],name=r[1],unit=r[5];
    if(typeof code==="number"&&name&&want.some(w=>String(name).includes(w.trim())))
      console.log(code, name, '／単位:', unit);
  });
})();
