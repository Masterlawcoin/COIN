const fs=require('fs'),path=require('path');
const HERE=__dirname,OUT=path.join(HERE,'dist');
const assets=['login.html','auth.js','manifest.webmanifest','sw.js','app-icon.svg'];
for(const name of assets){const src=path.join(HERE,name),dst=path.join(OUT,name);if(!fs.existsSync(src))throw Error(`Missing PWA asset: ${name}`);fs.copyFileSync(src,dst)}
const htmlFiles=fs.readdirSync(OUT).filter(name=>name.endsWith('.html'));
for(const name of htmlFiles){
  const file=path.join(OUT,name);let s=fs.readFileSync(file,'utf8');
  if(!s.includes('rel="manifest"'))s=s.replace('</head>','<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/app-icon.svg" type="image/svg+xml"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="MasterlawEX"><meta name="mobile-web-app-capable" content="yes"></head>');
  if(!s.includes('src="/auth.js"'))s=s.replace('</body>','<script src="/auth.js"></script></body>');
  fs.writeFileSync(file,s);
}
console.log('MasterlawEX PWA packaging complete',assets.length,'assets',htmlFiles.length,'HTML files');
