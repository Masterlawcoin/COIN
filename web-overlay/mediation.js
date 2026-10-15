(()=>{'use strict';
const A=window.ARCX_API,$=A.$,ABI=window.MLX_P2P_V14_ABI;
const MASTERLAW_API='https://masterlaw-api.vercel.app';
const ORDER_DOMAIN='0xa8e22b39121058b75ab1c64c27412cd473a621f194cb1636443b2662dc0f8f66';
const ZERO32='0x'+'0'.repeat(64);
const STATES=['None','Funded','PaymentMarked','Released','Cancelled','Disputed','Refunded','Settled'];
let masterlawToken='',verifiedEscrow=null,lastSafePayload=null;

function strip(x){return String(x||'').replace(/^0x/,'')}
function word(v){return BigInt(v).toString(16).padStart(64,'0')}
function boolWord(v){return (v?1n:0n).toString(16).padStart(64,'0')}
function bytesWord(v,label){const x=String(v||'').trim();if(!/^0x[0-9a-fA-F]{64}$/.test(x)||x.toLowerCase()===ZERO32)throw Error(`${label} debe ser bytes32 no-cero`);return strip(x).toLowerCase()}
function validAddress(v){return /^0x[0-9a-fA-F]{40}$/.test(String(v||''))}
function same(a,b){return String(a||'').toLowerCase()===String(b||'').toLowerCase()}
function selector(sig){const raw=ABI?.methods?.[sig];if(!raw||!/^[0-9a-fA-F]{8}$/.test(raw))throw Error(`ABI V1.4 sin selector ${sig}`);return '0x'+raw.toLowerCase()}
function decodeAddress(data){const h=strip(data);if(h.length<64)throw Error('ABI address inválido');return '0x'+h.slice(24,64)}
function decodeUint(data){const h=strip(data);if(h.length<64)throw Error('ABI uint inválido');return BigInt('0x'+h.slice(0,64))}
function decodeBool(data){return decodeUint(data)!==0n}
function decodeBytes32(data){const h=strip(data);if(h.length<64)throw Error('ABI bytes32 inválido');return '0x'+h.slice(0,64).toLowerCase()}
function decodeString(data){const h=strip(data);if(h.length<128)throw Error('ABI string inválido');const off=Number(BigInt('0x'+h.slice(0,64)))*2;if(!Number.isSafeInteger(off)||off+64>h.length)throw Error('ABI string offset inválido');const len=Number(BigInt('0x'+h.slice(off,off+64))),start=off+64,end=start+len*2;if(!Number.isSafeInteger(len)||end>h.length)throw Error('ABI string largo inválido');const bytes=new Uint8Array((h.slice(start,end).match(/.{1,2}/g)||[]).map(x=>parseInt(x,16)));return new TextDecoder().decode(bytes)}
function decodeTrade(data){const h=strip(data);if(h.length<64*7)throw Error('ABI trades incompleto');const w=Array.from({length:7},(_,i)=>h.slice(i*64,(i+1)*64));return{seller:'0x'+w[0].slice(24),buyer:'0x'+w[1].slice(24),amount:BigInt('0x'+w[2]),createdAt:BigInt('0x'+w[3]),deadline:BigInt('0x'+w[4]),state:Number(BigInt('0x'+w[5])),orderRef:'0x'+w[6].toLowerCase()}}
function setStatus(id,text,kind){const el=$(id);el.textContent=text;el.className='med-status '+kind}
function safeJson(v){return JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x,2)}
function tradeId(){const raw=$('tradeId').value.trim();if(!/^\d+$/.test(raw)||BigInt(raw)<=0n)throw Error('Trade ID debe ser entero mayor que 0');return BigInt(raw)}
function currentEscrow(){const e=$('escrowAddress').value.trim();if(!validAddress(e))throw Error('Dirección escrow V1.4 inválida');return e}

async function refreshMasterlawHealth(){
  try{
    const [h,p]=await Promise.all([
      fetch(MASTERLAW_API+'/api/exchange/p2p/health',{headers:{accept:'application/json'}}),
      fetch(MASTERLAW_API+'/api/exchange/p2p/policy',{headers:{accept:'application/json'}})
    ]);
    const hj=await h.json().catch(()=>null),pj=await p.json().catch(()=>null);
    if(!h.ok||!hj?.ok||!p.ok||!pj?.ok)throw Error('control plane no publicado');
    if(Number(hj.chain_id)!==5042002||Number(pj.chain?.chain_id)!==5042002)throw Error('Masterlaw control plane fuera de ARC');
    setStatus('apiHealth','API · ONLINE','good');
    setStatus('moneyState','REAL MONEY · OFF','bad');
    $('kycOutput').textContent=safeJson({health:hj,policy:pj,note:'KYC individual requiere token Masterlaw y vínculo wallet ARC.'});
  }catch(e){
    setStatus('apiHealth','API · NOT DEPLOYED','warn');
    setStatus('moneyState','REAL MONEY · OFF','bad');
    $('kycOutput').textContent='FAIL CLOSED · '+String(e.message||e)+'\nEl código Masterlaw está en main, pero esta API todavía no está visible en producción.';
  }
}

async function checkKyc(){
  const token=$('masterlawToken').value.trim();masterlawToken=token;
  if(!token){setStatus('kycState','KYC · BLOCKED','bad');$('kycOutput').textContent='MASTERLAW_TOKEN_REQUIRED';return}
  $('kycOutput').textContent='Consultando identidad Masterlaw…';
  try{
    const r=await fetch(MASTERLAW_API+'/api/exchange/p2p/access',{headers:{accept:'application/json',authorization:'Bearer '+token}});
    const j=await r.json().catch(()=>({ok:false,eligible:false,reason:'INVALID_RESPONSE'}));
    if(!r.ok||!j.eligible){setStatus('kycState','KYC · BLOCKED','bad');$('kycOutput').textContent=safeJson(j);return}
    setStatus('kycState','KYC · VERIFIED','good');
    setStatus('moneyState','REAL MONEY · OFF','bad');
    $('kycOutput').textContent=safeJson({...j,note:'KYC aprobado. Aún falta BIND_ARC_WALLET y real_money_enabled continúa false.'});
  }catch(e){setStatus('kycState','KYC · BLOCKED','bad');$('kycOutput').textContent='FAIL CLOSED · '+String(e.message||e)}
}

async function verifyEscrow(){
  if(!ABI?.methods)throw Error('mediation-abi.js no cargado');
  const escrow=currentEscrow();
  const chain=String(await A.rpc('eth_chainId')).toLowerCase();if(chain!==A.C.chain)throw Error('RPC fuera de Arc Testnet 5042002');
  const code=await A.rpc('eth_getCode',[escrow,'latest']);if(!code||code==='0x')throw Error('Escrow sin bytecode');
  const [versionRaw,assetRaw,arbiterRaw,orderRaw,splitRaw]=await Promise.all([
    A.call(escrow,selector('VERSION()')),
    A.call(escrow,selector('asset()')),
    A.call(escrow,selector('arbiter()')),
    A.call(escrow,selector('ORDER_REF_DOMAIN()')),
    A.call(escrow,selector('SPLIT_DOMAIN()'))
  ]);
  const version=decodeString(versionRaw),asset=decodeAddress(assetRaw),arbiter=decodeAddress(arbiterRaw),orderDomain=decodeBytes32(orderRaw),splitDomain=decodeBytes32(splitRaw);
  if(version!==ABI.version)throw Error(`VERSION()=${version}, esperado ${ABI.version}`);
  if(!same(asset,A.C.usdc))throw Error('asset() no es USDC ARC canónico');
  if(orderDomain!==ORDER_DOMAIN)throw Error('ORDER_REF_DOMAIN() no coincide');
  if(splitDomain===ZERO32)throw Error('SPLIT_DOMAIN() inválido');
  verifiedEscrow={escrow,version,asset,arbiter,orderDomain,splitDomain,buildId:ABI.buildId,sourceHash:ABI.sourceHash};
  $('escrowExplorer').href=A.C.explorer+'/address/'+escrow;
  return verifiedEscrow;
}

async function inspect(){
  $('tradeOutput').textContent='Verificando ARC V1.4…';
  try{
    const runtime=await verifyEscrow(),id=tradeId();
    const [tradeRaw,caseRaw,resRaw,proposalRaw,buyerAmtRaw,sellerOkRaw,buyerOkRaw]=await Promise.all([
      A.call(runtime.escrow,selector('trades(uint256)')+word(id)),
      A.call(runtime.escrow,selector('caseHashByTrade(uint256)')+word(id)),
      A.call(runtime.escrow,selector('resolutionHashByTrade(uint256)')+word(id)),
      A.call(runtime.escrow,selector('splitProposalHashByTrade(uint256)')+word(id)),
      A.call(runtime.escrow,selector('splitBuyerAmountByTrade(uint256)')+word(id)),
      A.call(runtime.escrow,selector('splitSellerApproved(uint256)')+word(id)),
      A.call(runtime.escrow,selector('splitBuyerApproved(uint256)')+word(id))
    ]);
    const t=decodeTrade(tradeRaw);if(t.state===0)throw Error(`trade ${id} no existe`);
    $('tradeOutput').textContent=safeJson({network:'Arc Testnet',chainId:5042002,...runtime,tradeId:id,state:STATES[t.state]||`Unknown(${t.state})`,seller:t.seller,buyer:t.buyer,amountUSDC:A.fmt(t.amount,6,6),amountBaseUnits:t.amount,createdAt:new Date(Number(t.createdAt)*1000).toISOString(),deadline:new Date(Number(t.deadline)*1000).toISOString(),orderRef:t.orderRef,caseHash:decodeBytes32(caseRaw),resolutionHash:decodeBytes32(resRaw),mutualSplit:{proposalHash:decodeBytes32(proposalRaw),buyerAmountBaseUnits:decodeUint(buyerAmtRaw),sellerApproved:decodeBool(sellerOkRaw),buyerApproved:decodeBool(buyerOkRaw)},readOnly:true});
  }catch(e){verifiedEscrow=null;$('tradeOutput').textContent='FAIL CLOSED · '+String(e.message||e)}
}

async function ensureVerified(){const escrow=currentEscrow();if(!verifiedEscrow||!same(verifiedEscrow.escrow,escrow))return verifyEscrow();return verifiedEscrow}
async function prepareFreeze(){
  try{const r=await ensureVerified(),id=tradeId(),caseHash=bytesWord($('caseHash').value,'Case hash');const data=selector('openDisputeByArbiter(uint256,bytes32)')+word(id)+caseHash;showSafe('freeze',r,id,data,{caseHash:'0x'+caseHash})}catch(e){$('safeOutput').textContent='FAIL CLOSED · '+String(e.message||e)}
}
async function prepareResolve(){
  try{const r=await ensureVerified(),id=tradeId(),decision=$('resolutionDecision').value,resHash=bytesWord($('resolutionHash').value,'Resolution hash');const data=selector('resolveDispute(uint256,bool,bytes32)')+word(id)+boolWord(decision==='buyer')+resHash;showSafe('resolve',r,id,data,{decision,resolutionHash:'0x'+resHash})}catch(e){$('safeOutput').textContent='FAIL CLOSED · '+String(e.message||e)}
}
function showSafe(action,r,id,data,meta){
  lastSafePayload={network:'Arc Testnet',chainId:5042002,action,tradeId:id.toString(),arbiter:r.arbiter,safeTransaction:{to:r.escrow,value:'0',data,operation:0},meta,reviewRequired:true,broadcastByBrowser:false};
  $('safeOutput').textContent=safeJson(lastSafePayload);$('copySafe').disabled=false;
}
async function copySafe(){if(!lastSafePayload)return;try{await navigator.clipboard.writeText(safeJson(lastSafePayload));A.toast('Payload copiado')}catch{A.toast('No se pudo copiar automáticamente')}}
function clearKyc(){masterlawToken='';$('masterlawToken').value='';setStatus('kycState','KYC · BLOCKED','bad');$('kycOutput').textContent='Token eliminado. Acceso P2P real bloqueado.'}

document.addEventListener('DOMContentLoaded',()=>{
  $('checkKyc').onclick=checkKyc;$('clearKyc').onclick=clearKyc;$('inspectEscrow').onclick=inspect;$('prepareFreeze').onclick=prepareFreeze;$('prepareResolve').onclick=prepareResolve;$('copySafe').onclick=copySafe;
  refreshMasterlawHealth();
});
})();
