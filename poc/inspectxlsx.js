const XLSX=require('xlsx');
(async()=>{
  const url='https://www.stat.go.jp/data/kouri/doukou/zuhyou/202604.xlsx';
  const r=await fetch(url); const buf=Buffer.from(await r.arrayBuffer());
  console.log('fetched',buf.length,'bytes, status',r.status);
  const wb=XLSX.read(buf,{type:'buffer'});
  console.log('sheets:',wb.SheetNames);
  const ws=wb.Sheets[wb.SheetNames[0]];
  const rows=XLSX.utils.sheet_to_json(ws,{header:1,blankrows:false});
  console.log('rows:',rows.length);
  rows.slice(0,30).forEach((r,i)=>console.log(i, JSON.stringify(r).slice(0,160)));
})();
