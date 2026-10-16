(()=>{'use strict';
const A=window.ARCX_API,$=A.$,USDC=A.C.usdc;
const V14_ARTIFACT_COMMIT='fd389c42b556b777e62323f18f0c4d153deb6dff';
const V14_BUILD_ID='0x8fe3cc299c7910be4dc7f680dd4f1f497d19967785ae064ff47f3178f73c11d2';
const V14_SOURCE_SHA256='0x63278c19167b96373a3d1428fd24a9b550abd6841d93de3881d4aae73d10cecd';
const V14_VERSION='1.4.0-testnet';
const ORDER_DOMAIN='0xa8e22b39121058b75ab1c64c27412cd473a621f194cb1636443b2662dc0f8f66';
const SPLIT_DOMAIN='0x5a24e9a5ebbc980e5c204e554b45b6227d4d9f46d3aa01165b4b6f8f885e5e4d';
const STORAGE_KEY='masterlawex:p2p:v14:deploy:v1';
const ART=`https://raw.githubusercontent.com/Masterlawcoin/COIN/${V14_ARTIFACT_COMMIT}/build/artifacts.json`;
const ZERO32='0x'+'0'.repeat(64);
let artifactBundle=null,busy=false,ready=false,state=loadState();

function loadState(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')||{}}catch{return{}}}
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state));render()}
const strip=x=>String(x||'').replace(/^0x/,'');
const word=x=>BigInt(x).toString(16).padStart(64,'0');
const addrWord=a=>strip(a).toLowerCase().padStart(64,'0');
const validAddress=a=>/^0x[a-fA-F0-9]{40}$/.test(String(a||''));
const same=(a,b)=>String(a||'').toLowerCase()===String(b||'').toLowerCase();
const validBytes32=x=>/^0x[0-9a-fA-F]{64}$/.test(String(x||''))&&String(x).toLowerCase()!==ZERO32;
function decodeAddress(data){const h=strip(data);if(h.length<64)throw Error('ABI address inválido');return '0x'+h.slice(24,64)}
function decodeBytes32(data){const h=strip(data);if(h.length<64)throw Error('ABI bytes32 inválido');return '0x'+h.slice(0,64).toLowerCase()}
function decodeString(data){const h=strip(data);if(h.length<128)throw Error('ABI string inválido');const off=Number(BigInt('0x'+h.slice(0,64)))*2;if(!Number.isSafeInteger(off)||off+64>h.length)throw Error('ABI string offset inválido');const len=Number(BigInt('0x'+h.slice(off,off+64))),start=off+64,end=start+len*2;if(!Number.isSafeInteger(len)||end>h.length)throw Error('ABI string largo inválido');const bytes=new Uint8Array((h.slice(start,end).match(/.{1,2}/g)||[]).map(x=>parseInt(x,16)));return new TextDecoder().decode(bytes)}
function selector(p,sig){const s=p?.methodIdentifiers?.[sig];if(!/^[0-9a-fA-F]{8}$/.test(String(s||'')))throw Error(`ABI V1.4 sin selector ${sig}`);return '0x'+s.toLowerCase()}
function link(a){return validAddress(a)?`<a target="_blank" rel="noreferrer" href="${A.C.explorer}/address/${a}">${a}</a>`:'No desplegado'}
function expectedIdentity(arbiter){return{schema:1,network:'Arc Testnet',chainId:A.C.chain,asset:USDC,arbiter,artifactCommit:V14_ARTIFACT_COMMIT,buildId:V14_BUILD_ID,sourceSha256:V14_SOURCE_SHA256,expectedVersion:V14_VERSION,expectedOrderDomain:ORDER_DOMAIN,expectedSplitDomain:SPLIT_DOMAIN}}
function identityOk(d,verified=false){
  if(!d||d.schema!==1||d.network!=='Arc Testnet'||String(d.chainId||'').toLowerCase()!==A.C.chain)return false;
  if(!same(d.asset,USDC)||!validAddress(d.arbiter)||d.artifactCommit!==V14_ARTIFACT_COMMIT||d.buildId!==V14_BUILD_ID||d.sourceSha256!==V14_SOURCE_SHA256)return false;
  if(d.expectedVersion!==V14_VERSION||String(d.expectedOrderDomain||'').toLowerCase()!==ORDER_DOMAIN||String(d.expectedSplitDomain||'').toLowerCase()!==SPLIT_DOMAIN)return false;
  if(verified&&(!validAddress(d.escrow)||d.verifiedVersion!==V14_VERSION||String(d.verifiedOrderDomain||'').toLowerCase()!==ORDER_DOMAIN||String(d.verifiedSplitDomain||'').toLowerCase()!==SPLIT_DOMAIN))return false;
  return true;
}
function render(){
  if(!$('v14EscrowAddr'))return;
  const trusted=identityOk(state,true),candidate=state.escrow||state.candidate;
  $('v14EscrowAddr').innerHTML=trusted?`Escrow V1.4 verificado: ${link(state.escrow)}`:(candidate?`Candidato NO confiable: ${link(candidate)}`:'Escrow V1.4: no desplegado');
  $('v14Preflight').disabled=busy||trusted;
  $('deployP2PV14').disabled=busy||!ready||trusted;
  $('deployP2PV14').textContent=trusted?'Escrow V1.4 verificado':(busy?'Procesando…':'Desplegar Escrow V1.4 en ARC');
  if(trusted)$('v14PreflightState').textContent='VERIFIED ON-CHAIN · V1.4 · MEDIATION ENABLED · ARC 5042002';
  else if(ready)$('v14PreflightState').textContent='PREFLIGHT PASS · ARC + USDC + artefacto + multisig verificados';
  else if(candidate)$('v14PreflightState').textContent='LOCAL CANDIDATE UNTRUSTED · FAIL CLOSED';
}
async function loadArtifact(){
  if(artifactBundle)return artifactBundle;
  $('v14ArtifactState').textContent='Cargando artefacto V1.4 fijado…';
  const r=await fetch(ART,{cache:'no-store'});if(!r.ok)throw Error('No se pudo cargar artefacto V1.4 fijado');
  const a=await r.json(),meta=a?._meta,p=a?.MasterlawEXP2PEscrowV14;
  if(meta?.schema!==2||meta.buildId!==V14_BUILD_ID)throw Error('Build V1.4 no coincide');
  if(meta.sourceHashes?.['contracts/MasterlawEXP2PEscrowV14.sol']!==V14_SOURCE_SHA256)throw Error('Hash fuente V1.4 no coincide');
  if(!String(meta.compiler||'').startsWith('0.8.24+')||meta.optimizer?.enabled!==true||meta.optimizer?.runs!==200)throw Error('Toolchain V1.4 inesperado');
  if(p?.source!=='contracts/MasterlawEXP2PEscrowV14.sol'||!Array.isArray(p.abi)||!p.bytecode?.startsWith('0x')||!p.bytecodeSha256?.startsWith('0x')||!p.methodIdentifiers)throw Error('Artefacto V1.4 incompleto');
  const names=p.abi.filter(x=>x.type==='function').map(x=>x.name);
  for(const forbidden of ['withdraw','sweep','emergencyWithdraw','adminWithdraw'])if(names.includes(forbidden))throw Error(`Superficie admin prohibida detectada: ${forbidden}`);
  for(const required of ['openDisputeByArbiter','resolveDispute','proposeMutualSplit','approveMutualSplit','computeOrderRef','computeSplitProposalHash'])if(!names.includes(required))throw Error(`ABI V1.4 sin ${required}`);
  for(const sig of ['VERSION()','asset()','arbiter()','ORDER_REF_DOMAIN()','SPLIT_DOMAIN()','computeOrderRef(bytes32)','computeSplitProposalHash(uint256,uint256,bytes32)','openDisputeByArbiter(uint256,bytes32)','resolveDispute(uint256,bool,bytes32)','proposeMutualSplit(uint256,uint256,bytes32)','approveMutualSplit(uint256,uint256,bytes32)'])selector(p,sig);
  artifactBundle=a;
  $('v14ArtifactState').innerHTML=`V1.4 CI PASS · build <code>${V14_BUILD_ID.slice(0,14)}…</code> · source <code>${V14_SOURCE_SHA256.slice(0,14)}…</code>`;
  return a;
}
async function preflight(){
  if(busy)return false;busy=true;ready=false;render();$('v14PreflightState').textContent='Validando ARC, artefacto, USDC y árbitro…';
  try{
    const a=await loadArtifact(),p=a.MasterlawEXP2PEscrowV14,acct=await A.connect();await A.ensureChain();
    const rpcChain=String(await A.rpc('eth_chainId')).toLowerCase(),walletChain=String(await window.ethereum.request({method:'eth_chainId'})).toLowerCase();
    if(rpcChain!==A.C.chain||walletChain!==A.C.chain)throw Error('RPC y wallet deben estar en Arc Testnet 5042002');
    const gas=A.bi(await A.rpc('eth_getBalance',[acct,'latest']));if(gas===0n)throw Error('Wallet sin gas nativo en Arc Testnet');
    const assetCode=await A.rpc('eth_getCode',[USDC,'latest']);if(!assetCode||assetCode==='0x')throw Error('USDC ARC no responde como contrato');
    const decimals=A.bi(await A.call(USDC,'0x313ce567'));if(decimals!==6n)throw Error(`USDC ARC debe tener 6 decimales; RPC=${decimals}`);
    $('v14AssetState').textContent=`${USDC} · 6 decimals · VERIFIED`;
    const arb=$('v14Arbiter').value.trim();if(!validAddress(arb))throw Error('Ingresa dirección válida de Safe/multisig');if(same(arb,USDC))throw Error('Árbitro no puede ser USDC');
    const arbCode=await A.rpc('eth_getCode',[arb,'latest']);if(!arbCode||arbCode==='0x')throw Error('Árbitro bloqueado: V1.4 exige contrato/multisig, no EOA');
    Object.assign(state,expectedIdentity(arb),{artifactBytecodeSha256:p.bytecodeSha256});
    delete state.verifiedVersion;delete state.verifiedOrderDomain;delete state.verifiedSplitDomain;delete state.verifiedAt;delete state.escrow;
    ready=true;save();$('v14ArbiterState').textContent=`VERIFIED CONTRACT · ${arb.slice(0,10)}…${arb.slice(-6)}`;A.toast('V1.4 preflight ARC aprobado');return true;
  }catch(e){$('v14PreflightState').textContent='PREFLIGHT BLOCKED · '+e.message;$('v14ArbiterState').textContent='No validado';A.toast(e.message);return false}finally{busy=false;render()}
}
async function verifyRuntime(address,arb,p){
  const code=await A.rpc('eth_getCode',[address,'latest']);if(!code||code==='0x')throw Error('Contrato V1.4 sin bytecode on-chain');
  const [assetRaw,arbRaw,verRaw,orderRaw,splitRaw]=await Promise.all([
    A.call(address,selector(p,'asset()')),
    A.call(address,selector(p,'arbiter()')),
    A.call(address,selector(p,'VERSION()')),
    A.call(address,selector(p,'ORDER_REF_DOMAIN()')),
    A.call(address,selector(p,'SPLIT_DOMAIN()'))
  ]);
  const asset=decodeAddress(assetRaw),arbiter=decodeAddress(arbRaw),version=decodeString(verRaw),order=decodeBytes32(orderRaw),split=decodeBytes32(splitRaw);
  if(!same(asset,USDC))throw Error('asset() no es USDC ARC');if(!same(arbiter,arb))throw Error('arbiter() no coincide');if(version!==V14_VERSION)throw Error(`VERSION()=${version}`);if(order!==ORDER_DOMAIN)throw Error('ORDER_REF_DOMAIN() no coincide');if(split!==SPLIT_DOMAIN)throw Error('SPLIT_DOMAIN() no coincide');
  const orderProbe='0x'+'11'.repeat(32),agreementProbe='0x'+'22'.repeat(32);
  const orderHash=decodeBytes32(await A.call(address,selector(p,'computeOrderRef(bytes32)')+strip(orderProbe)));
  const splitHash=decodeBytes32(await A.call(address,selector(p,'computeSplitProposalHash(uint256,uint256,bytes32)')+word(1)+word(1)+strip(agreementProbe)));
  if(!validBytes32(orderHash)||!validBytes32(splitHash))throw Error('Funciones de dominio V1.4 no respondieron correctamente');
  return{asset,arbiter,version,orderDomain:order,splitDomain:split,orderProbeHash:orderHash,splitProbeHash:splitHash};
}
async function deploy(){
  if(busy||identityOk(state,true))return;if(!ready&&!(await preflight()))return;busy=true;render();
  try{
    if(!identityOk(state,false))throw Error('Registro V1.4 de preflight inválido');
    const a=await loadArtifact(),p=a.MasterlawEXP2PEscrowV14,acct=A.account||await A.connect();await A.ensureChain();const arb=state.arbiter;
    const data=p.bytecode+addrWord(USDC)+addrWord(arb);
    const estimate=A.bi(await window.ethereum.request({method:'eth_estimateGas',params:[{from:acct,data}]}));if(estimate===0n)throw Error('eth_estimateGas devolvió 0');
    const gas='0x'+((estimate*120n)/100n).toString(16);
    const hash=await window.ethereum.request({method:'eth_sendTransaction',params:[{from:acct,data,gas}]});
    state.deployTx=hash;save();$('v14LastDeploy').innerHTML=`Esperando deploy V1.4: <a target="_blank" rel="noreferrer" href="${A.C.explorer}/tx/${hash}">${hash.slice(0,14)}…</a>`;A.toast('Deploy V1.4 enviado',`${A.C.explorer}/tx/${hash}`);
    const receipt=await A.wait(hash);if(!validAddress(receipt.contractAddress))throw Error('Receipt V1.4 sin contractAddress');
    state.candidate=receipt.contractAddress;save();
    const verified=await verifyRuntime(receipt.contractAddress,arb,p);
    Object.assign(state,{escrow:receipt.contractAddress,candidate:receipt.contractAddress,verifiedVersion:verified.version,verifiedOrderDomain:verified.orderDomain,verifiedSplitDomain:verified.splitDomain,verifiedAsset:verified.asset,verifiedArbiter:verified.arbiter,verifiedOrderProbeHash:verified.orderProbeHash,verifiedSplitProbeHash:verified.splitProbeHash,verifiedAt:new Date().toISOString(),blockNumber:receipt.blockNumber});
    save();$('v14LastDeploy').innerHTML=`V1.4 confirmado y verificado: ${link(receipt.contractAddress)}`;A.toast('Escrow V1.4 verificado on-chain',`${A.C.explorer}/address/${receipt.contractAddress}`);
  }catch(e){$('v14LastDeploy').textContent='Deploy V1.4 detenido: '+e.message;A.toast(e.message)}finally{busy=false;render()}
}
function copyRecord(){navigator.clipboard.writeText(JSON.stringify(state,null,2)).then(()=>A.toast('Registro V1.4 copiado')).catch(()=>A.toast('No se pudo copiar'))}
function clearRecord(){if(!confirm('¿Borrar sólo el registro local V1.4 de este navegador? No afecta contratos on-chain.'))return;localStorage.removeItem(STORAGE_KEY);state={};ready=false;render();$('v14PreflightState').textContent='PRE-DEPLOY · FAIL CLOSED';$('v14LastDeploy').textContent='Registro local V1.4 borrado.'}

document.addEventListener('DOMContentLoaded',()=>{
  if(!$('p2pEscrowV14Lab'))return;
  $('v14Preflight').onclick=preflight;$('deployP2PV14').onclick=deploy;$('copyV14Record').onclick=copyRecord;$('clearV14Record').onclick=clearRecord;
  render();loadArtifact().catch(e=>{$('v14ArtifactState').textContent='V1.4 ARTIFACT BLOCKED · '+e.message;$('v14PreflightState').textContent='FAIL CLOSED';});
});
})();