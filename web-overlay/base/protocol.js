(()=>{'use strict';
const A=window.ARCX_API,$=A.$,USDC=A.C.usdc;
const BUILD='3f7189532c2c5a72abbba84e30290565e1f62174';
const BUILD_ID='0x2101ac90dc7c4ad4499c7cda96ffe1b802e3b7aa7f86fe3559a21220550c9b09';
const ARCX_SOURCE_SHA256='0xbc474c2389c2e4e34f6ad43cc9733be8f59be4b2da817353b575eb77a77637d6';
const ART=`https://raw.githubusercontent.com/Masterlawcoin/COIN/${BUILD}/build/artifacts.json`;
const P2P_BUILD='83cdc85310add7e791b955bb63dfbfea0976eb6e';
const P2P_BUILD_ID='0x762d93a9ce52445a9beced69f6aba33aa60734f6c7ca0242b594ad505ad7ed86';
const P2P_SOURCE_SHA256='0x9956d1668036b7e265f8e05d89d1ad71463dc7799d70d6e268e8f080ab319773';
const P2P_VERSION='1.3.0-testnet';
const P2P_ORDER_REF_DOMAIN='0xa8e22b39121058b75ab1c64c27412cd473a621f194cb1636443b2662dc0f8f66';
const P2P_RECORD_SCHEMA=3;
const P2P_ART=`https://raw.githubusercontent.com/Masterlawcoin/COIN/${P2P_BUILD}/build/artifacts.json`;
const SEL={asset:'0x38d52e0f',arbiter:'0xfe25e00a',version:'0xffa1ad74',domain:'0xb30dc2a9',decimals:'0x313ce567',symbol:'0x95d89b41'};
function loadState(){try{return JSON.parse(localStorage.getItem('arcx:v2:deploy')||'{}')||{}}catch{return{}}}
let state=loadState(),artifacts=null,p2pArtifacts=null,busy=false,p2pBusy=false,p2pReady=false;
const strip=x=>String(x||'').replace(/^0x/,'');
const addrWord=a=>strip(a).toLowerCase().padStart(64,'0');
const valid=a=>/^0x[a-fA-F0-9]{40}$/.test(a||'');
const sameAddr=(a,b)=>String(a||'').toLowerCase()===String(b||'').toLowerCase();
function expectedRecordFields(arbiter){return{p2pSchema:P2P_RECORD_SCHEMA,p2pNetwork:'Arc Testnet',p2pChainId:A.C.chain,p2pAsset:USDC,p2pArbiter:arbiter,p2pBuild:P2P_BUILD,p2pBuildId:P2P_BUILD_ID,p2pSourceSha256:P2P_SOURCE_SHA256,p2pExpectedVersion:P2P_VERSION,p2pExpectedDomain:P2P_ORDER_REF_DOMAIN}}
function recordIdentityOk(d,requireVerified=false){
  if(!d||d.p2pSchema!==P2P_RECORD_SCHEMA||d.p2pNetwork!=='Arc Testnet'||String(d.p2pChainId||'').toLowerCase()!==A.C.chain)return false;
  if(!sameAddr(d.p2pAsset,USDC)||!valid(d.p2pArbiter)||d.p2pBuild!==P2P_BUILD||d.p2pBuildId!==P2P_BUILD_ID||d.p2pSourceSha256!==P2P_SOURCE_SHA256)return false;
  if(d.p2pExpectedVersion!==P2P_VERSION||String(d.p2pExpectedDomain||'').toLowerCase()!==P2P_ORDER_REF_DOMAIN)return false;
  if(requireVerified&&(d.p2pVerifiedVersion!==P2P_VERSION||String(d.p2pVerifiedDomain||'').toLowerCase()!==P2P_ORDER_REF_DOMAIN||!valid(d.p2pEscrow)))return false;
  return true;
}
function save(){localStorage.setItem('arcx:v2:deploy',JSON.stringify(state));render()}
function link(a){return valid(a)?`<a target="_blank" rel="noreferrer" href="${A.C.explorer}/address/${a}">${a}</a>`:'No desplegado'}
function decodeAddress(data){const h=strip(data);if(h.length<64)throw Error('Respuesta address inválida');return '0x'+h.slice(24,64)}
function decodeString(data){const h=strip(data);if(h.length<128)throw Error('Respuesta string inválida');const offset=Number(BigInt('0x'+h.slice(0,64)))*2;if(!Number.isSafeInteger(offset)||offset+64>h.length)throw Error('Offset ABI inválido');const len=Number(BigInt('0x'+h.slice(offset,offset+64)));const start=offset+64,end=start+len*2;if(!Number.isSafeInteger(len)||end>h.length)throw Error('String ABI inválido');const bytes=new Uint8Array((h.slice(start,end).match(/.{1,2}/g)||[]).map(x=>parseInt(x,16)));return new TextDecoder().decode(bytes)}
function render(){
  $('tokenFactoryAddr').innerHTML=link(state.tokenFactory);
  $('marketFactoryAddr').innerHTML=link(state.marketFactory);
  $('routerAddr').innerHTML=link(state.router);
  $('deployTokenFactory').disabled=busy||!!state.tokenFactory;
  $('deployMarketFactory').disabled=busy||!!state.marketFactory;
  $('deployRouter').disabled=busy||!state.marketFactory||!!state.router;
  $('deployTokenFactory').textContent=state.tokenFactory?'TokenFactory desplegado':'Desplegar TokenFactory';
  $('deployMarketFactory').textContent=state.marketFactory?'MarketFactory desplegado':'Desplegar MarketFactory';
  $('deployRouter').textContent=state.router?'Router desplegado':'Desplegar Router';
  $('deployProgress').textContent=`${[state.tokenFactory,state.marketFactory,state.router].filter(Boolean).length}/3 contratos V2 registrados en este navegador`;
  $('exportCore').textContent=JSON.stringify({network:'Arc Testnet',chainId:A.C.chain,usdc:USDC,build:BUILD,buildId:BUILD_ID,sourceSha256:ARCX_SOURCE_SHA256,p2pBuild:P2P_BUILD,p2pBuildId:P2P_BUILD_ID,p2pSourceSha256:P2P_SOURCE_SHA256,...state},null,2);
  const trusted=recordIdentityOk(state,true),rawEscrow=state.p2pEscrow,p2pAddr=rawEscrow||state.p2pCandidate;
  $('p2pEscrowAddr').innerHTML=trusted?`Escrow verificado: ${link(rawEscrow)}`:(p2pAddr?`Registro/candidato NO confiable: ${link(p2pAddr)}`:'Escrow: no desplegado');
  $('p2pPreflight').disabled=p2pBusy||trusted;
  $('deployP2PEscrow').disabled=p2pBusy||!p2pReady||trusted;
  $('deployP2PEscrow').textContent=trusted?'Escrow V1.3 verificado':(p2pBusy?'Procesando…':'Desplegar Escrow V1.3 en ARC');
  if(trusted)$('p2pPreflightState').textContent=`VERIFIED ON-CHAIN · ${P2P_VERSION} · ARC 5042002 · RECORD V${P2P_RECORD_SCHEMA}`;
  else if(p2pReady)$('p2pPreflightState').textContent='PREFLIGHT PASS · identidad ARC/build fijada · listo para firma de wallet';
  else if(p2pAddr)$('p2pPreflightState').textContent='LOCAL RECORD UNTRUSTED · requiere preflight/verificación · FAIL CLOSED';
}
async function loadArtifacts(){
  if(artifacts)return artifacts;$('artifactState').textContent='Cargando artefacto CI atestado…';
  const r=await fetch(ART,{cache:'no-store'});if(!r.ok)throw Error('No se pudo cargar el artefacto compilado');
  const candidate=await r.json(),meta=candidate?._meta;
  if(meta?.schema!==2)throw Error('Artefacto sin metadata reproducible');
  if(meta.buildId!==BUILD_ID)throw Error('Build ID no coincide con el artefacto fijado');
  if(meta.sourceHashes?.['contracts/ARCXV2.sol']!==ARCX_SOURCE_SHA256)throw Error('Hash de ARCXV2.sol no coincide');
  if(!String(meta.compiler||'').startsWith('0.8.24+'))throw Error('Compilador Solidity inesperado');
  if(meta.optimizer?.enabled!==true||meta.optimizer?.runs!==200)throw Error('Configuración optimizer inesperada');
  for(const k of ['ARCXTokenFactory','ARCXMarketFactory','ARCXRouter'])if(candidate[k]?.source!=='contracts/ARCXV2.sol'||!candidate[k]?.bytecode?.startsWith('0x')||!candidate[k]?.bytecodeSha256?.startsWith('0x'))throw Error('Artefacto CI incompleto');
  artifacts=candidate;$('artifactState').innerHTML=`CI PASS · reproducible · build <code>${BUILD.slice(0,10)}…</code> · id <code>${BUILD_ID.slice(0,14)}…</code>`;return artifacts;
}
async function loadP2PArtifact(){
  if(p2pArtifacts)return p2pArtifacts;$('p2pArtifactState').textContent='Cargando artefacto P2P CI atestado…';
  const r=await fetch(P2P_ART,{cache:'no-store'});if(!r.ok)throw Error('No se pudo cargar artefacto P2P V1.3');
  const candidate=await r.json(),meta=candidate?._meta,p=candidate?.MasterlawEXP2PEscrow;
  if(meta?.schema!==2||meta.buildId!==P2P_BUILD_ID)throw Error('Build P2P no coincide con el artefacto fijado');
  if(meta.sourceHashes?.['contracts/MasterlawEXP2PEscrow.sol']!==P2P_SOURCE_SHA256)throw Error('Hash fuente P2P no coincide');
  if(!String(meta.compiler||'').startsWith('0.8.24+')||meta.optimizer?.enabled!==true||meta.optimizer?.runs!==200)throw Error('Toolchain P2P inesperado');
  if(p?.source!=='contracts/MasterlawEXP2PEscrow.sol'||!Array.isArray(p.abi)||!p.bytecode?.startsWith('0x')||!p.bytecodeSha256?.startsWith('0x'))throw Error('Artefacto P2P incompleto');
  p2pArtifacts=candidate;$('p2pArtifactState').innerHTML=`P2P CI PASS · V1.3 reproducible · build <code>${P2P_BUILD.slice(0,10)}…</code> · id <code>${P2P_BUILD_ID.slice(0,14)}…</code>`;return candidate;
}
async function deploy(kind,artifactName,args=''){
  if(busy)return;busy=true;render();
  try{const a=await loadArtifacts(),acct=await A.connect();await A.ensureChain();const data=a[artifactName].bytecode+args;const hash=await window.ethereum.request({method:'eth_sendTransaction',params:[{from:acct,data}]});A.toast(`Deploy ${kind} enviado`,`${A.C.explorer}/tx/${hash}`);$('lastDeploy').innerHTML=`Esperando ${kind}: <a target="_blank" rel="noreferrer" href="${A.C.explorer}/tx/${hash}">${hash.slice(0,14)}…</a>`;const receipt=await A.wait(hash);if(!valid(receipt.contractAddress))throw Error('Receipt confirmado sin contractAddress');state[kind]=receipt.contractAddress;state[kind+'Tx']=hash;state.build=BUILD;state.buildId=BUILD_ID;save();$('lastDeploy').innerHTML=`${kind} confirmado: ${link(receipt.contractAddress)}`;A.toast(`${kind} desplegado`,`${A.C.explorer}/address/${receipt.contractAddress}`)}catch(e){A.toast(e.message);$('lastDeploy').textContent='Deploy detenido: '+e.message}finally{busy=false;render()}
}
async function deployAll(){if(!state.tokenFactory)await deploy('tokenFactory','ARCXTokenFactory');if(!state.marketFactory)await deploy('marketFactory','ARCXMarketFactory',addrWord(USDC));if(!state.router&&state.marketFactory)await deploy('router','ARCXRouter',addrWord(state.marketFactory))}
async function p2pPreflight(){
  if(p2pBusy)return false;p2pBusy=true;p2pReady=false;render();$('p2pPreflightState').textContent='Validando ARC, artefacto, USDC y árbitro…';
  try{
    await loadP2PArtifact();const acct=await A.connect();await A.ensureChain();
    const rpcChain=String(await A.rpc('eth_chainId')).toLowerCase(),walletChain=String(await window.ethereum.request({method:'eth_chainId'})).toLowerCase();
    if(rpcChain!==A.C.chain||walletChain!==A.C.chain)throw Error('Red inválida: RPC y wallet deben estar en Arc Testnet 5042002');
    const gasBalance=A.bi(await A.rpc('eth_getBalance',[acct,'latest']));if(gasBalance===0n)throw Error('La wallet no tiene USDC nativo para gas en Arc Testnet');
    const assetCode=await A.rpc('eth_getCode',[USDC,'latest']);if(!assetCode||assetCode==='0x')throw Error('USDC ARC no responde como contrato/precompile ERC-20');
    const decimals=A.bi(await A.call(USDC,SEL.decimals));if(decimals!==6n)throw Error(`USDC ARC debe tener 6 decimales; RPC devolvió ${decimals}`);
    let symbol='USDC';try{symbol=decodeString(await A.call(USDC,SEL.symbol))||'USDC'}catch{}
    $('p2pAssetState').textContent=`${USDC} · ${symbol} · 6 decimals · VERIFIED`;
    const arb=$('p2pArbiter').value.trim();if(!valid(arb))throw Error('Ingresa una dirección válida de árbitro multisig/smart-account');if(sameAddr(arb,USDC))throw Error('El árbitro no puede ser el contrato USDC');
    const arbCode=await A.rpc('eth_getCode',[arb,'latest']);if(!arbCode||arbCode==='0x')throw Error('Árbitro bloqueado: debe ser contrato/multisig desplegado en ARC, no EOA');
    Object.assign(state,expectedRecordFields(arb));delete state.p2pVerifiedVersion;delete state.p2pVerifiedDomain;delete state.p2pVerifiedAt;p2pReady=true;save();
    $('p2pArbiterState').textContent=`VERIFIED CONTRACT · ${arb.slice(0,10)}…${arb.slice(-6)}`;A.toast('P2P preflight ARC aprobado');return true;
  }catch(e){$('p2pPreflightState').textContent='PREFLIGHT BLOCKED · '+e.message;$('p2pArbiterState').textContent='No validado';A.toast(e.message);return false}finally{p2pBusy=false;render()}
}
async function verifyEscrow(address,arbiter){
  const code=await A.rpc('eth_getCode',[address,'latest']);if(!code||code==='0x')throw Error('Contrato desplegado sin bytecode on-chain');
  const onAsset=decodeAddress(await A.call(address,SEL.asset)),onArbiter=decodeAddress(await A.call(address,SEL.arbiter));
  const version=decodeString(await A.call(address,SEL.version));const domain=String(await A.call(address,SEL.domain)).toLowerCase();
  if(!sameAddr(onAsset,USDC))throw Error('Verificación falló: asset() no es USDC ARC');
  if(!sameAddr(onArbiter,arbiter))throw Error('Verificación falló: arbiter() no coincide');
  if(version!==P2P_VERSION)throw Error(`Verificación falló: VERSION()=${version}`);
  if(domain!==P2P_ORDER_REF_DOMAIN)throw Error('Verificación falló: ORDER_REF_DOMAIN() no coincide');
  return{asset:onAsset,arbiter:onArbiter,version,domain};
}
async function deployP2P(){
  if(p2pBusy||recordIdentityOk(state,true))return;if(!p2pReady&&!(await p2pPreflight()))return;p2pBusy=true;render();
  try{
    if(!recordIdentityOk(state,false))throw Error('Registro de preflight ARC/build inválido');
    const a=await loadP2PArtifact(),acct=A.account||await A.connect();await A.ensureChain();const arb=state.p2pArbiter;if(!valid(arb))throw Error('Árbitro P2P no validado');
    const data=a.MasterlawEXP2PEscrow.bytecode+addrWord(USDC)+addrWord(arb);
    await window.ethereum.request({method:'eth_estimateGas',params:[{from:acct,data}]});
    const hash=await window.ethereum.request({method:'eth_sendTransaction',params:[{from:acct,data}]});state.p2pCandidateTx=hash;save();
    $('p2pLastDeploy').innerHTML=`Deploy P2P enviado: <a target="_blank" rel="noreferrer" href="${A.C.explorer}/tx/${hash}">${hash.slice(0,18)}…</a> · esperando receipt`;
    A.toast('Deploy P2P ARC enviado',`${A.C.explorer}/tx/${hash}`);const receipt=await A.wait(hash);if(!valid(receipt.contractAddress))throw Error('Receipt P2P confirmado sin contractAddress');state.p2pCandidate=receipt.contractAddress;save();
    $('p2pLastDeploy').textContent='Receipt confirmado. Verificando runtime on-chain…';const verified=await verifyEscrow(receipt.contractAddress,arb);
    Object.assign(state,expectedRecordFields(arb),{p2pEscrow:receipt.contractAddress,p2pEscrowTx:hash,p2pVerifiedVersion:verified.version,p2pVerifiedDomain:verified.domain,p2pVerifiedAt:new Date().toISOString()});delete state.p2pCandidate;delete state.p2pCandidateTx;save();
    if(!recordIdentityOk(state,true))throw Error('Registro de deployment no superó la verificación local final');
    $('p2pLastDeploy').innerHTML=`VERIFIED · ${link(state.p2pEscrow)} · <a target="_blank" rel="noreferrer" href="${A.C.explorer}/tx/${hash}">tx ↗</a>`;A.toast('Escrow P2P V1.3 verificado en ARC',`${A.C.explorer}/address/${state.p2pEscrow}`);
  }catch(e){$('p2pPreflightState').textContent='FAIL CLOSED · '+e.message;$('p2pLastDeploy').textContent='Deploy/verificación detenida: '+e.message;A.toast(e.message)}finally{p2pBusy=false;p2pReady=false;render()}
}
document.addEventListener('DOMContentLoaded',()=>{
  if(state.p2pArbiter)$('p2pArbiter').value=state.p2pArbiter;render();
  loadArtifacts().catch(e=>{$('artifactState').textContent='Artefacto rechazado: '+e.message});loadP2PArtifact().catch(e=>{$('p2pArtifactState').textContent='Artefacto P2P rechazado: '+e.message});
  $('deployTokenFactory').onclick=()=>deploy('tokenFactory','ARCXTokenFactory');$('deployMarketFactory').onclick=()=>deploy('marketFactory','ARCXMarketFactory',addrWord(USDC));$('deployRouter').onclick=()=>state.marketFactory?deploy('router','ARCXRouter',addrWord(state.marketFactory)):A.toast('Primero despliega MarketFactory');$('deployAll').onclick=deployAll;
  $('p2pPreflight').onclick=p2pPreflight;$('deployP2PEscrow').onclick=deployP2P;$('p2pArbiter').oninput=()=>{p2pReady=false;$('p2pArbiterState').textContent='Cambió la dirección: ejecuta preflight otra vez';render()};
  $('copyCore').onclick=()=>navigator.clipboard.writeText($('exportCore').textContent).then(()=>A.toast('Configuración ARC copiada'));
  $('clearCore').onclick=()=>{if(confirm('Esto sólo borra las direcciones guardadas en este navegador. No elimina contratos on-chain.')){state={};p2pReady=false;$('p2pArbiter').value='';save()}};
});
})();