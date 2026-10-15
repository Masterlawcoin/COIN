const fs=require('fs'),path=require('path');
const BASE='https://arcx-exchange.vercel.app';
const files=['app.css','core.js','earn.html','earn.js','identity.html','index.html','list.html','list.js','portfolio.html','portfolio.js','protocol.html','protocol.js','registry.js','startup.html','startup.js','trade.js'];
const extras=['demo.html','demo.js','p2p.html','p2p.js','agents.html','agents.js'];
const demoCss=`.demo-network{font-size:10px;font-weight:800;letter-spacing:.08em;color:var(--yellow);border:1px solid #f0b90b55;background:#f0b90b10;border-radius:999px;padding:7px 10px;white-space:nowrap}.demo-network i{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--yellow);margin-right:6px;box-shadow:0 0 0 3px #f0b90b20}.demo-wallet{display:inline-block}.demo-banner{min-height:42px;display:flex;align-items:center;gap:14px;padding:8px 16px;background:linear-gradient(90deg,#251e08,#14120c);border-bottom:1px solid #6a541c;color:#d8c47f}.demo-banner b{color:var(--yellow2);font-size:11px;letter-spacing:.08em}.demo-banner span{font-size:10px;flex:1}.demo-banner .text-btn{white-space:nowrap}.demo-ticker{background:#0e100d}.demo-logo{border-color:#735e20;background:radial-gradient(circle at 35% 30%,#5e4b16,#17130a);color:var(--yellow2)}.demo-cta{border-color:#5c4b1d;background:#17140b}.demo-market-btn{width:100%;border:0;background:none;color:inherit;font-family:inherit;cursor:pointer;text-align:left}.demo-market-btn b{display:block;text-align:left}.demo-market-btn small{display:block;font-size:7px;color:var(--yellow);margin-top:2px;letter-spacing:.07em}.demo-history{min-height:110px;padding:8px 16px}.demo-history-row{display:grid;grid-template-columns:58px 80px 1fr 1fr 90px;gap:8px;padding:7px 0;border-bottom:1px solid var(--line2);font-size:10px}.demo-history-row span:nth-child(n+3){text-align:right}.demo-terminal .orderbar b{color:var(--yellow2)}@media(max-width:900px){.demo-banner{padding:8px 10px}.demo-banner span{display:none}.demo-wallet{font-size:9px}.demo-history-row{grid-template-columns:48px 62px 1fr 1fr}.demo-history-row span:last-child{display:none}}`;
const logo=`<a class="logo mlx-logo" href="/"><i class="mlx-mark"><span>M</span><b>X</b></i><span class="mlx-word"><strong>Masterlaw</strong><em>EX</em><small>EXCHANGE</small></span></a>`;
function brandify(s){
 s=s.replace(/\bARCX\b/g,'MasterlawEX');
 s=s.replace(/<a class="logo" href="\/\"><i><span>A<\/span><\/i>MasterlawEX<\/a>/g,logo);
 return s;
}
function patchHtml(s,name){
 s=brandify(s);
 if(!s.includes('href="/p2p.html"')) s=s.replace(/(<a[^>]*href="\/"[^>]*>Trade<\/a>)/,'$1<a class="hot" href="/p2p.html">P2P</a>');
 if(!s.includes('href="/demo.html"')) s=s.replace(/(<a[^>]*href="\/p2p\.html"[^>]*>P2P<\/a>)/,'$1<a href="/demo.html">Demo Arena</a>');
 if(!s.includes('href="/agents.html"')) s=s.replace(/(<a[^>]*href="\/demo\.html"[^>]*>Demo Arena<\/a>)/,'$1<a class="ai-link" href="/agents.html">AI Control</a>');
 if(!s.match(/bottomnav[\s\S]*href="\/p2p\.html"/)) s=s.replace(/(<nav class="bottomnav">[\s\S]*?<a[^>]*href="\/list\.html"[^>]*>Markets<\/a>)/,'$1<a href="/p2p.html">P2P</a>');
 if(!s.match(/bottomnav[\s\S]*href="\/demo\.html"/)) s=s.replace(/(<nav class="bottomnav">[\s\S]*?<a[^>]*href="\/p2p\.html"[^>]*>P2P<\/a>)/,'$1<a href="/demo.html">Demo</a>');
 if(name==='list.html'&&!s.includes('Demo Arena activa')) s=s.replace('<div class="notice" id="factoryState" style="margin:18px 0">Buscando MarketFactory V2…</div>','<div class="notice" id="factoryState" style="margin:18px 0">Buscando MarketFactory V2…</div><div class="notice" style="margin:0 0 18px"><b>Demo Arena activa</b><br>ARCQ, NOVA, PULSE, VECTOR, ORBIT y FLUX se mueven automáticamente en un simulador aislado. <a href="/demo.html">Abrir mercados demo →</a></div>');
 return s;
}
async function get(name){let r=await fetch(`${BASE}/${name}?overlay=${Date.now()}`,{headers:{'user-agent':'MasterlawEX-Build/2.0'}});if(!r.ok)throw Error(`${name}: HTTP ${r.status}`);return r.text()}
(async()=>{
 fs.rmSync('dist',{recursive:true,force:true});fs.mkdirSync('dist',{recursive:true});
 const brandCss=fs.readFileSync('brand.css','utf8');
 for(const name of files){let s=await get(name);if(name==='app.css'){if(!s.includes('.demo-network{'))s+='\n'+demoCss+'\n';if(!s.includes('.mlx-logo{'))s+='\n'+brandCss+'\n'}else if(name.endsWith('.html'))s=patchHtml(s,name);fs.writeFileSync(path.join('dist',name),s)}
 for(const name of extras){let s=fs.readFileSync(name,'utf8');if(name.endsWith('.html'))s=patchHtml(s,name);fs.writeFileSync(path.join('dist',name),s)}
 console.log('MasterlawEX overlay built',fs.readdirSync('dist').length,'files');
})().catch(e=>{console.error(e);process.exit(1)});