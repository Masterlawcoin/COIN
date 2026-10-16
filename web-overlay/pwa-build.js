const fs=require('fs'),path=require('path');
const HERE=__dirname,OUT=path.join(HERE,'dist');
const assets=['login.html','auth.js','metamask-connect.js','p2p-wallet-auth.js','wallet-flow.js','manifest.webmanifest','sw.js','app-icon.svg'];
for(const name of assets){const src=path.join(HERE,name),dst=path.join(OUT,name);if(!fs.existsSync(src))throw Error(`Missing PWA asset: ${name}`);fs.copyFileSync(src,dst)}
const htmlFiles=fs.readdirSync(OUT).filter(name=>name.endsWith('.html'));
const flow=`<section class="ex-panel" id="mlxConnectionFlow" style="margin:12px 0"><div class="ex-panel-head"><h3>Conectar MasterlawEX</h3><span>UN SOLO FLUJO</span></div><div class="ex-body"><div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px"><div class="market-cta"><b id="mlxFlow1">1 · Cuenta Masterlaw</b></div><div class="market-cta"><b id="mlxFlow2">2 · Conectar MetaMask</b></div><div class="market-cta"><b id="mlxFlow3">3 · Firmar acceso</b></div><div class="market-cta"><b id="mlxFlow4">4 · Validar KYC</b></div></div><button id="mlxConnectFlow" class="ex-btn primary" style="width:100%;margin-top:10px">Continuar conexión</button><div id="mlxFlowOutput" class="sandbox-warning" style="margin-top:10px">Comprobando estado…</div></div></section>`;
for(const name of htmlFiles){
  const file=path.join(OUT,name);let s=fs.readFileSync(file,'utf8');
  if(!s.includes('rel="manifest"'))s=s.replace('</head>','<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/app-icon.svg" type="image/svg+xml"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="MasterlawEX"><meta name="mobile-web-app-capable" content="yes"></head>');
  if(s.includes('src="/core.js"')&&!s.includes('src="/metamask-connect.js"'))s=s.replace('<script src="/core.js"></script>','<script src="/metamask-connect.js"></script><script src="/core.js"></script>');
  if(name==='p2p.html'){
    s=s.replace(/<label[^>]*>Token sesión Masterlaw<input id="p2pMasterlawToken"[^>]*><\/label>/,'<input id="p2pMasterlawToken" type="hidden" autocomplete="off" aria-hidden="true">');
    if(!s.includes('id="mlxConnectionFlow"'))s=s.replace('<section class="ex-panel" id="metamaskSetup"',flow+'<section class="ex-panel" id="metamaskSetup"');
    if(!s.includes('src="/p2p-wallet-auth.js"'))s=s.replace('<script src="/auth.js"></script>','<script src="/p2p-wallet-auth.js"></script><script src="/wallet-flow.js"></script><script src="/auth.js"></script>');
  }
  if(!s.includes('src="/auth.js"'))s=s.replace('</body>','<script src="/auth.js"></script></body>');
  fs.writeFileSync(file,s);
}
console.log('MasterlawEX PWA packaging complete',assets.length,'assets',htmlFiles.length,'HTML files');
