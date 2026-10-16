(()=>{'use strict';
const A=window.ARCX_API,$=A.$,ABI=window.MLX_P2P_V14_ABI;
const STORAGE_KEY='masterlawex:p2p:v14:deploy:v1';
const ARTIFACT_COMMIT='fd389c42b556b777e62323f18f0c4d153deb6dff';
const BUILD_ID='0x8fe3cc299c7910be4dc7f680dd4f1f497d19967785ae064ff47f3178f73c11d2';
const SOURCE_SHA256='0x63278c19167b96373a3d1428fd24a9b550abd6841d93de3881d4aae73d10cecd';
const VERSION='1.4.0-testnet';
const ORDER_DOMAIN='0xa8e22b39121058b75ab1c64c27412cd473a621f194cb1636443b2662dc0f8f66';
const SPLIT_DOMAIN='0xbaa52ef9e8b423282f954f0253b95e496fdcc34017570f67b7365c0a5efa5f9d';
const ZERO32='0x'+'0'.repeat(64);
const STATES=['None','Funded','PaymentMarked','Released','Cancelled','Disputed','Refunded','Settled'];
let verified=null;

const strip=x=>String(x||'').replace(/^0x/,'');
const word=v=>BigInt(v).toString(16).padStart(64,'0');
const validAddress=v=>/^0x[a-fA-F0-9]{40}$/.test(String(v||''));
const same=(a,b)=>String(a||'').toLowerCase()===String(b||'').toLowerCase();
const isBytes32=v=>/^0x[0-9a-fA-F]{64}$/.test(String(v||''));
function selector(sig){const raw=ABI?.methods?.[sig];if(!/^[0-9a-fA-F]{8}$/.test(String(raw||'')))throw Error(`ABI V1.4 sin selector ${sig}`);return '0x'+raw.toLowerCase()}
function decodeAddress(data){const h=strip(data);if(h.length<64)throw Error('ABI address inválido');return '0x'+h.slice(24,64)}
function decodeUint(data){const h=strip(data);if(h.length<64)throw Error('ABI uint inválido');return BigInt('0x'+h.slice(0,64))}
function decodeBool(data){return decodeUint(data)!==0n}
function decodeBytes32(data){const h=strip(data);if(h.length<64)throw Error('ABI bytes32 inválido');return '0x'+h.slice(0,64).toLowerCase()}
function decodeString(data){const h=strip(data);if(h.length<128)throw Error('ABI string inválido');const off=Number(BigInt('0x'+h.slice(0,64)))*2;if(!Number.isSafeInteger(off)||off+64>h.length)throw Error('ABI string offset inválido');const len=Number(BigInt('0x'+h.slice(off,off+64))),start=off+64,end=start+len*2;if(!Number.isSafeInteger(len)||end>h.length)throw Error('ABI string largo inválido');const bytes=new Uint8Array((h.slice(start,end).match(/.{1,2}/g)||[]).map(x=>parseInt(x,16)));return new TextDecoder().decode(bytes)}
function decodeTrade(data){const h=strip(data);if(h.length<64*7)throw Error('ABI trades incompleto');const w=Array.from({length:7},(_,i)=>h.slice(i*64,(i+1)*64));return{seller:'0x'+w[0].slice(24),buyer:'0x'+w[1].slice(24),amount:BigInt('0x'+w[2]),createdAt:BigInt('0x'+w[3]),deadline:BigInt('0x'+w[4]),state:Number(BigInt('0x'+w[5])),orderRef:'0x'+w[6].toLowerCase()}}
function readRecord(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')||{}}catch{throw Error('registro V1.4 local corrupto')}}
function identityOk(d){return !!d&&d.schema===1&&d.network==='Arc Testnet'&&String(d.chainId||'').toLowerCase()===A.C.chain&&same(d.asset,A.C.usdc)&&validAddress(d.arbiter)&&validAddress(d.escrow)&&d.artifactCommit===ARTIFACT_COMMIT&&d.buildId===BUILD_ID&&d.sourceSha256===SOURCE_SHA256&&d.expectedVersion===VERSION&&String(d.expectedOrderDomain||'').toLowerCase()===ORDER_DOMAIN&&String(d.expectedSplitDomain||'').toLowerCase()===SPLIT_DOMAIN&&d.verifiedVersion===VERSION&&String(d.verifiedOrderDomain||'').toLowerCase()===ORDER_DOMAIN&&String(d.verifiedSplitDomain||'').toLowerCase()===SPLIT_DOMAIN&&same(d.verifiedAsset,A.C.usdc)&&same(d.verifiedArbiter,d.arbiter)}
function setStatus(text,kind){const el=$('v14StatusKpi');if(el){el.textContent=text;el.className=kind||''}}
function predeploy(){verified=null;setStatus('V1.4 · PRE-DEPLOY','warn');$('v14OfficialTitle').textContent='V1.4 · PENDIENTE';$('v14OfficialText').textContent='No existe un escrow V1.4 verificado en el registro local de este navegador.';$('v14OfficialMode').textContent='MASTERLAW MEDIATION · PRE-DEPLOY'}
function blocked(msg){verified=null;setStatus('V1.4 · BLOCKED','bad');$('v14OfficialTitle').textContent='V1.4 · FAIL CLOSED';$('v14OfficialText').textContent='No verificable: '+String(msg||'registro/runtime inválido');$('v14OfficialMode').textContent='MASTERLAW MEDIATION · BLOCKED'}
async function verifyRuntime(){
  if(!ABI?.methods||ABI.version!==VERSION||ABI.buildId!==BUILD_ID||ABI.sourceHash!==SOURCE_SHA256)throw Error('mediation ABI no corresponde al build V1.4 canónico');
  const d=readRecord();
  if(!d.escrow&&!d.arbiter){predeploy();return null}
  if(!identityOk(d))throw Error('registro local V1.4 no coincide con identidad canónica');
  const chain=String(await A.rpc('eth_chainId')).toLowerCase();if(chain!==A.C.chain)throw Error('RPC fuera de Arc Testnet 5042002');
  const code=await A.rpc('eth_getCode',[d.escrow,'latest']);if(!code||code==='0x')throw Error('escrow V1.4 sin bytecode');
  const [assetRaw,arbRaw,verRaw,orderRaw,splitRaw]=await Promise.all([A.call(d.escrow,selector('asset()')),A.call(d.escrow,selector('arbiter()')),A.call(d.escrow,selector('VERSION()')),A.call(d.escrow,selector('ORDER_REF_DOMAIN()')),A.call(d.escrow,selector('SPLIT_DOMAIN()'))]);
  const asset=decodeAddress(assetRaw),arbiter=decodeAddress(arbRaw),version=decodeString(verRaw),order=decodeBytes32(orderRaw),split=decodeBytes32(splitRaw);
  if(!same(asset,A.C.usdc))throw Error('asset() no es USDC ARC');
  if(!same(arbiter,d.arbiter))throw Error('arbiter() no coincide con el Safe/multisig registrado');
  if(version!==VERSION)throw Error('VERSION() no coincide');
  if(order!==ORDER_DOMAIN)throw Error('ORDER_REF_DOMAIN() no coincide');
  if(split!==SPLIT_DOMAIN)throw Error('SPLIT_DOMAIN() no coincide');
  verified={escrow:d.escrow,arbiter,asset,version,orderDomain:order,splitDomain:split,record:d};
  setStatus('V1.4 · VERIFIED','good');
  $('v14OfficialTitle').textContent='V1.4 · VERIFIED ON-CHAIN';
  $('v14OfficialText').innerHTML=`${d.escrow.slice(0,10)}…${d.escrow.slice(-6)} · USDC + Safe/multisig + dominios V1.4 verificados. <a target="_blank" rel="noreferrer" href="${A.C.explorer}/address/${d.escrow}">Ver contrato ↗</a>`;
  $('v14OfficialMode').textContent='MASTERLAW MEDIATION · V1.4 VERIFIED · PRE-REAL-MONEY';
  return verified;
}
async function refresh(){try{await verifyRuntime()}catch(e){blocked(e.message)}}
async function inspect(){
  const out=$('v14TradeResult');out.textContent='Consultando V1.4 en ARC…';
  try{
    const runtime=verified||await verifyRuntime();if(!runtime)throw Error('ESCROW_V1_4_NOT_VERIFIED');
    const raw=$('v14TradeId').value.trim();if(!/^\d+$/.test(raw)||BigInt(raw)<=0n)throw Error('Trade ID debe ser entero mayor que 0');const id=BigInt(raw);
    const tradeRaw=await A.call(runtime.escrow,selector('trades(uint256)')+word(id));
    const t=decodeTrade(tradeRaw);if(t.state===0)throw Error(`tradeId ${id} no existe`);
    const [caseRaw,resRaw,proposalRaw,buyerAmtRaw,sellerOkRaw,buyerOkRaw,reverseRaw]=await Promise.all([
      A.call(runtime.escrow,selector('caseHashByTrade(uint256)')+word(id)),
      A.call(runtime.escrow,selector('resolutionHashByTrade(uint256)')+word(id)),
      A.call(runtime.escrow,selector('splitProposalHashByTrade(uint256)')+word(id)),
      A.call(runtime.escrow,selector('splitBuyerAmountByTrade(uint256)')+word(id)),
      A.call(runtime.escrow,selector('splitSellerApproved(uint256)')+word(id)),
      A.call(runtime.escrow,selector('splitBuyerApproved(uint256)')+word(id)),
      A.call(runtime.escrow,selector('tradeIdByReference(bytes32)')+strip(t.orderRef))
    ]);
    const reverse=decodeUint(reverseRaw);if(reverse!==id)throw Error(`orderRef reverse lookup=${reverse}, esperado ${id}`);
    const caseHash=decodeBytes32(caseRaw),resolutionHash=decodeBytes32(resRaw),proposalHash=decodeBytes32(proposalRaw);
    out.textContent=JSON.stringify({network:'Arc Testnet',chainId:5042002,escrow:runtime.escrow,version:runtime.version,tradeId:id.toString(),state:STATES[t.state]||`Unknown(${t.state})`,seller:t.seller,buyer:t.buyer,amountUSDC:A.fmt(t.amount,6,6),amountBaseUnits:t.amount.toString(),createdAt:new Date(Number(t.createdAt)*1000).toISOString(),deadline:new Date(Number(t.deadline)*1000).toISOString(),orderRef:t.orderRef,reverseLookup:reverse.toString(),reverseLookupMatches:true,caseHash:isBytes32(caseHash)&&caseHash!==ZERO32?caseHash:null,resolutionHash:isBytes32(resolutionHash)&&resolutionHash!==ZERO32?resolutionHash:null,mutualSplit:{proposalHash:isBytes32(proposalHash)&&proposalHash!==ZERO32?proposalHash:null,buyerAmountBaseUnits:decodeUint(buyerAmtRaw).toString(),sellerApproved:decodeBool(sellerOkRaw),buyerApproved:decodeBool(buyerOkRaw)},readOnly:true,mediation:'MASTERLAW_V1_4'},null,2);
  }catch(e){out.textContent='FAIL CLOSED · '+String(e.message||e)}
}

document.addEventListener('DOMContentLoaded',()=>{if(!$('v14OfficialCard'))return;$('refreshV14Status').onclick=refresh;$('inspectTradeV14').onclick=inspect;$('v14TradeId').onkeydown=e=>{if(e.key==='Enter')inspect()};refresh();setInterval(refresh,30000)});
window.MLX_P2P_V14_STATUS={refresh,verifyRuntime,get verified(){return verified}};
})();