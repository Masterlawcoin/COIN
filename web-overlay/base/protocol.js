(()=>{'use strict';
const A=window.ARCX_API,$=A.$,USDC='0x3600000000000000000000000000000000000000';
const BUILD='3f7189532c2c5a72abbba84e30290565e1f62174';
const BUILD_ID='0x2101ac90dc7c4ad4499c7cda96ffe1b802e3b7aa7f86fe3559a21220550c9b09';
const ARCX_SOURCE_SHA256='0xbc474c2389c2e4e34f6ad43cc9733be8f59be4b2da817353b575eb77a77637d6';
const ART=`https://raw.githubusercontent.com/Masterlawcoin/COIN/${BUILD}/build/artifacts.json`;
let state=JSON.parse(localStorage.getItem('arcx:v2:deploy')||'{}'),artifacts=null,busy=false;
const addrWord=a=>String(a||'').replace(/^0x/,'').toLowerCase().padStart(64,'0');
const valid=a=>/^0x[a-fA-F0-9]{40}$/.test(a||'');
function save(){localStorage.setItem('arcx:v2:deploy',JSON.stringify(state));render()}
function link(a){return valid(a)?`<a target="_blank" rel="noreferrer" href="${A.C.explorer}/address/${a}">${a}</a>`:'No desplegado'}
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
  $('exportCore').textContent=JSON.stringify({chainId:A.C.chain,usdc:USDC,build:BUILD,buildId:BUILD_ID,sourceSha256:ARCX_SOURCE_SHA256,...state},null,2);
}
async function loadArtifacts(){
  if(artifacts)return artifacts;
  $('artifactState').textContent='Cargando artefacto CI atestado…';
  const r=await fetch(ART,{cache:'no-store'});if(!r.ok)throw Error('No se pudo cargar el artefacto compilado');
  const candidate=await r.json();
  const meta=candidate?._meta;
  if(meta?.schema!==2)throw Error('Artefacto sin metadata reproducible');
  if(meta.buildId!==BUILD_ID)throw Error('Build ID no coincide con el artefacto fijado');
  if(meta.sourceHashes?.['contracts/ARCXV2.sol']!==ARCX_SOURCE_SHA256)throw Error('Hash de ARCXV2.sol no coincide');
  if(!String(meta.compiler||'').startsWith('0.8.24+'))throw Error('Compilador Solidity inesperado');
  if(meta.optimizer?.enabled!==true||meta.optimizer?.runs!==200)throw Error('Configuración optimizer inesperada');
  for(const k of ['ARCXTokenFactory','ARCXMarketFactory','ARCXRouter']){
    if(candidate[k]?.source!=='contracts/ARCXV2.sol'||!candidate[k]?.bytecode?.startsWith('0x')||!candidate[k]?.bytecodeSha256?.startsWith('0x'))throw Error('Artefacto CI incompleto');
  }
  artifacts=candidate;
  $('artifactState').innerHTML=`CI PASS · reproducible · build <code>${BUILD.slice(0,10)}…</code> · id <code>${BUILD_ID.slice(0,14)}…</code>`;
  return artifacts;
}
async function deploy(kind,artifactName,args=''){
  if(busy)return;busy=true;render();
  try{
    const a=await loadArtifacts(),acct=await A.connect(); await A.ensureChain();
    const data=a[artifactName].bytecode+args;
    const hash=await window.ethereum.request({method:'eth_sendTransaction',params:[{from:acct,data}]});
    A.toast(`Deploy ${kind} enviado`,`${A.C.explorer}/tx/${hash}`);
    $('lastDeploy').innerHTML=`Esperando ${kind}: <a target="_blank" rel="noreferrer" href="${A.C.explorer}/tx/${hash}">${hash.slice(0,14)}…</a>`;
    const receipt=await A.wait(hash);
    if(!valid(receipt.contractAddress))throw Error('Receipt confirmado sin contractAddress');
    state[kind]=receipt.contractAddress; state[kind+'Tx']=hash; state.build=BUILD; state.buildId=BUILD_ID; save();
    $('lastDeploy').innerHTML=`${kind} confirmado: ${link(receipt.contractAddress)}`;
    A.toast(`${kind} desplegado`,`${A.C.explorer}/address/${receipt.contractAddress}`);
  }catch(e){A.toast(e.message);$('lastDeploy').textContent='Deploy detenido: '+e.message}
  finally{busy=false;render()}
}
async function deployAll(){
  if(!state.tokenFactory)await deploy('tokenFactory','ARCXTokenFactory');
  if(!state.marketFactory)await deploy('marketFactory','ARCXMarketFactory',addrWord(USDC));
  if(!state.router&&state.marketFactory)await deploy('router','ARCXRouter',addrWord(state.marketFactory));
}
document.addEventListener('DOMContentLoaded',()=>{
  render();loadArtifacts().catch(e=>{$('artifactState').textContent='Artefacto rechazado: '+e.message});
  $('deployTokenFactory').onclick=()=>deploy('tokenFactory','ARCXTokenFactory');
  $('deployMarketFactory').onclick=()=>deploy('marketFactory','ARCXMarketFactory',addrWord(USDC));
  $('deployRouter').onclick=()=>state.marketFactory?deploy('router','ARCXRouter',addrWord(state.marketFactory)):A.toast('Primero despliega MarketFactory');
  $('deployAll').onclick=deployAll;
  $('copyCore').onclick=()=>navigator.clipboard.writeText($('exportCore').textContent).then(()=>A.toast('Configuración V2 copiada'));
  $('clearCore').onclick=()=>{if(confirm('Esto sólo borra las direcciones guardadas en este navegador. No elimina contratos on-chain.')){state={};save()}};
});
})();