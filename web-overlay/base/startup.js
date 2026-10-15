(()=>{'use strict';
const A=window.ARCX_API,$=A.$,ZERO='0x0000000000000000000000000000000000000000';
const SEL={createToken:'0x34f359f9',createMarket:'0x23d6723e',addLiquidity:'0xb576468e'};
const TOPIC={token:'0x567699dbf7c5f63a51a42fd451f5e065bca0dfc723adf2cc498bbb7cfb780b90',market:'0x694fad971c045d376e4ae7269f1020cd3331dd58c15910b8c51bea368a5cc138'};
let core=JSON.parse(localStorage.getItem('arcx:v2:deploy')||'{}'),draft=JSON.parse(localStorage.getItem('arcx:v2:startup')||'{}'),busy=false;
const word=n=>BigInt(n).toString(16).padStart(64,'0'),address=a=>String(a||ZERO).replace(/^0x/,'').toLowerCase().padStart(64,'0');
function dyn(s){let b=new TextEncoder().encode(String(s||'')),h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');return word(b.length)+h.padEnd(Math.ceil(h.length/64)*64,'0')}
function encCreateToken(n,s,supply,to){let a=dyn(n),b=dyn(s),offA=128,offB=128+a.length/2;return SEL.createToken+word(offA)+word(offB)+word(supply)+address(to)+a+b}
function encCreateMarket(token,uri){let d=dyn(uri);return SEL.createMarket+address(token)+word(64)+d}
function encAdd(u,t,min,to){return SEL.addLiquidity+word(u)+word(t)+word(min)+address(to)}
function eventAddress(receipt,topic,index){let l=(receipt.logs||[]).find(x=>String(x.topics?.[0]).toLowerCase()===topic.toLowerCase());return l&&l.topics?.[index]?`0x${l.topics[index].slice(-40)}`:null}
function save(){localStorage.setItem('arcx:v2:startup',JSON.stringify(draft));render()}
function short(a){return /^0x[0-9a-f]{40}$/i.test(a||'')?a.slice(0,8)+'…'+a.slice(-6):'—'}
function render(){
 core=JSON.parse(localStorage.getItem('arcx:v2:deploy')||'{}');
 $('v2Status').innerHTML=`TokenFactory <b>${short(core.tokenFactory)}</b> · MarketFactory <b>${short(core.marketFactory)}</b> · Router <b>${short(core.router)}</b>`;
 $('createdToken').textContent=draft.token||'No creado'; $('createdPair').textContent=draft.pair||'No creado';
 $('createTokenBtn').disabled=busy||!core.tokenFactory||!!draft.token;
 $('createMarketBtn').disabled=busy||!core.marketFactory||!draft.token||!!draft.pair;
 $('addInitialLiquidity').disabled=busy||!draft.pair||draft.liquidity===true;
 $('launchState').textContent=draft.liquidity?'MERCADO V2 CON LIQUIDEZ':draft.pair?'PAIR CREADO · FALTA LIQUIDEZ':draft.token?'TOKEN CREADO · FALTA MERCADO':'LISTO PARA CREAR TOKEN';
 if(draft.symbol&&!$('s').value)$('s').value=draft.symbol;if(draft.name&&!$('n').value)$('n').value=draft.name;
}
async function tx(to,data,label){let acct=await A.connect();await A.ensureChain();let h=await window.ethereum.request({method:'eth_sendTransaction',params:[{from:acct,to,data}]});A.toast(label+' enviado',`${A.C.explorer}/tx/${h}`);let r=await A.wait(h);A.toast(label+' confirmado',`${A.C.explorer}/tx/${h}`);return r}
async function createToken(){if(busy)return;busy=true;render();try{let acct=await A.connect(),n=$('n').value.trim(),s=$('s').value.trim().toUpperCase(),sup=$('sup').value.trim(),tre=$('tre').value.trim();if(!n||!s||!/^\d+$/.test(sup)||BigInt(sup)<=0n)throw Error('Nombre, símbolo y supply son obligatorios');if(tre&&!/^0x[a-fA-F0-9]{40}$/.test(tre))throw Error('Treasury inválida');let r=await tx(core.tokenFactory,encCreateToken(n,s,BigInt(sup),tre||acct),'Create Token');let token=eventAddress(r,TOPIC.token,2);if(!token)throw Error('TokenCreated no encontrado en receipt');draft={name:n,symbol:s,supply:sup,treasury:tre||acct,token,tokenTx:r.transactionHash||null};save();$('launchLog').innerHTML=`Token creado: <a target="_blank" href="${A.C.explorer}/address/${token}">${token}</a>`}catch(e){A.toast(e.message)}finally{busy=false;render()}}
async function createMarket(){if(busy)return;busy=true;render();try{let uri=$('metadataURI').value.trim();let r=await tx(core.marketFactory,encCreateMarket(draft.token,uri),'Create Market');let pair=eventAddress(r,TOPIC.market,2);if(!pair)throw Error('MarketCreated no encontrado en receipt');draft.pair=pair;draft.metadataURI=uri;draft.marketTx=r.transactionHash||null;save();$('launchLog').innerHTML=`Pair creado: <a target="_blank" href="${A.C.explorer}/address/${pair}">${pair}</a>`}catch(e){A.toast(e.message)}finally{busy=false;render()}}
async function addLiquidity(){if(busy)return;busy=true;render();try{let acct=await A.connect(),u=A.parse($('initUSDC').value,6),t=A.parse($('initToken').value,18);if(!u||!t)throw Error('Ingresa USDC y token iniciales');$('launchLog').textContent='Aprobando USDC…';await A.approveIfNeeded(A.C.usdc,draft.pair,u);$('launchLog').textContent='Aprobando token…';await A.approveIfNeeded(draft.token,draft.pair,t);let r=await tx(draft.pair,encAdd(u,t,0n,acct),'Add Liquidity V2');draft.liquidity=true;draft.liquidityTx=r.transactionHash||null;save();let arr=JSON.parse(localStorage.getItem('arcx:v2:markets')||'[]');if(!arr.some(x=>x.token?.toLowerCase()===draft.token.toLowerCase()))arr.push({name:draft.name,symbol:draft.symbol,token:draft.token,pair:draft.pair,marketFactory:core.marketFactory,router:core.router,createdAt:Date.now()});localStorage.setItem('arcx:v2:markets',JSON.stringify(arr));$('launchLog').innerHTML=`Liquidez confirmada. Mercado ${A.escapeHtml(draft.symbol)}/USDC listo para indexación.`}catch(e){A.toast(e.message)}finally{busy=false;render()}}
function reset(){if(confirm('¿Iniciar otro borrador? Esto no elimina contratos ni fondos on-chain.')){draft={};localStorage.removeItem('arcx:v2:startup');render()}}
document.addEventListener('DOMContentLoaded',()=>{render();$('createTokenBtn').onclick=createToken;$('createMarketBtn').onclick=createMarket;$('addInitialLiquidity').onclick=addLiquidity;$('resetLaunch').onclick=reset;window.addEventListener('storage',render)});
})();