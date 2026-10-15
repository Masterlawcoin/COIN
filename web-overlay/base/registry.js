(()=>{'use strict';
const A=window.ARCX_API,C=A.C;
const S={count:'0xec979082',all:'0x634282af',market:'0x8e8f294b',name:'0x06fdde03',symbol:'0x95d89b41',decimals:'0x313ce567',rU:C.s.rU,rT:'0xf4325d67',spot:C.s.spot};
let cache=null,cacheAt=0;
const valid=a=>/^0x[a-fA-F0-9]{40}$/.test(a||'');
function localCore(){try{return JSON.parse(localStorage.getItem('arcx:v2:deploy')||'{}')}catch{return{}}}
function config(){let x=localCore();return{tokenFactory:C.v2TokenFactory||x.tokenFactory||null,marketFactory:C.v2MarketFactory||x.marketFactory||null,router:C.v2Router||x.router||null}}
function word(h,i){h=String(h||'').replace(/^0x/,'');return h.slice(i*64,(i+1)*64)}
function addr(h,i=0){let w=word(h,i);return w?`0x${w.slice(-40)}`:null}
function abiString(h){try{h=String(h||'').replace(/^0x/,'');if(!h)return'';if(h.length===64){let b=[];for(let i=0;i<64;i+=2){let n=parseInt(h.slice(i,i+2),16);if(n)b.push(n)}return new TextDecoder().decode(new Uint8Array(b)).trim()}let off=Number(BigInt('0x'+h.slice(0,64)))*2,len=Number(BigInt('0x'+h.slice(off,off+64))),hex=h.slice(off+64,off+64+len*2),b=new Uint8Array((hex.match(/../g)||[]).map(x=>parseInt(x,16)));return new TextDecoder().decode(b)}catch{return''}}
function marketTuple(h){try{h=String(h||'').replace(/^0x/,'');if(h.length<320)return null;let pair='0x'+word(h,0).slice(-40),creator='0x'+word(h,1).slice(-40),verified=BigInt('0x'+word(h,2))!==0n,active=BigInt('0x'+word(h,3))!==0n,off=Number(BigInt('0x'+word(h,4)))*2,uri='';if(off>=0&&h.length>=off+64){let len=Number(BigInt('0x'+h.slice(off,off+64))),hex=h.slice(off+64,off+64+len*2);uri=new TextDecoder().decode(new Uint8Array((hex.match(/../g)||[]).map(x=>parseInt(x,16))))}return{pair,creator,verified,active,metadataURI:uri}}catch{return null}}
async function safe(to,data){try{return await A.call(to,data)}catch{return null}}
function localMarkets(){try{return JSON.parse(localStorage.getItem('arcx:v2:markets')||'[]').map(x=>({...x,active:x.active!==false,verified:!!x.verified,source:'local'}))}catch{return[]}}
async function hydrate(factory,token,router){let raw=await safe(factory,A.enc(S.market,[token]));let m=marketTuple(raw);if(!m||!valid(m.pair))return null;let[sym,name,dec,p,u,n]=await Promise.all([safe(token,S.symbol),safe(token,S.name),safe(token,S.decimals),safe(m.pair,S.spot),safe(m.pair,S.rU),safe(m.pair,S.rT)]);let decimals=dec?Number(A.bi(dec)):18;return{token,pair:m.pair,creator:m.creator,verified:m.verified,active:m.active,metadataURI:m.metadataURI,symbol:abiString(sym)||token.slice(2,6).toUpperCase(),name:abiString(name)||'Token',decimals,price:p?Number(A.bi(p))/1e6:0,reserveUSDC:u?A.bi(u):0n,reserveToken:n?A.bi(n):0n,marketFactory:factory,router,source:'chain'}}
async function discover(force=false){
 if(!force&&cache&&Date.now()-cacheAt<15000)return cache;
 let cfg=config(),factory=cfg.marketFactory;
 if(!valid(factory)){cache=localMarkets();cacheAt=Date.now();return cache}
 try{
   let code=await A.rpc('eth_getCode',[factory,'latest']);if(!code||code==='0x')throw Error('Factory sin bytecode');
   let count=Number(A.bi(await A.call(factory,S.count)));if(!Number.isFinite(count)||count<0||count>500)throw Error('marketCount fuera de rango');
   let tokens=[];for(let i=0;i<count;i+=20){let batch=[];for(let j=i;j<Math.min(count,i+20);j++)batch.push(A.call(factory,A.enc(S.all,[BigInt(j)])));let rs=await Promise.all(batch);tokens.push(...rs.map(x=>addr(x,0)).filter(valid))}
   let out=[];for(let i=0;i<tokens.length;i+=10){let batch=tokens.slice(i,i+10).map(t=>hydrate(factory,t,cfg.router));out.push(...(await Promise.all(batch)).filter(Boolean))}
   cache=out;cacheAt=Date.now();
   try{localStorage.setItem('arcx:v2:markets',JSON.stringify(out.map(x=>({...x,reserveUSDC:String(x.reserveUSDC),reserveToken:String(x.reserveToken)}))))}catch{}
   return out;
 }catch(e){console.warn('ARCX registry',e);cache=localMarkets();cacheAt=Date.now();return cache}
}
async function find(token){let all=await discover();return all.find(x=>String(x.token).toLowerCase()===String(token).toLowerCase())||null}
function invalidate(){cache=null;cacheAt=0}
window.ARCX_REGISTRY={config,discover,find,invalidate,abiString,marketTuple,valid};
})();