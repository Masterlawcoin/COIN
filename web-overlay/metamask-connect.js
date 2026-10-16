(()=>{'use strict';
const CHAIN='0x4cef52';
const RPC='https://rpc.testnet.arc.io';
const FALLBACK='https://rpc.testnet.arc.network';
const EXPLORER='https://testnet.arcscan.app';
const SDK='https://esm.sh/@metamask/connect-evm@2.1.1?bundle';
const EDGE='https://tjyplcnvwjzpfcbctlrs.supabase.co/functions/v1/masterlawex-p2p';
const P2P_SESSION_KEY='masterlawex:p2p:session:v1';
const AUTO_BIND_KEY='masterlawex:p2p:auto-bind:v2';
let client=null,provider=null,loading=null,walletBusy=false;

function dispatchAccount(accounts){window.dispatchEvent(new CustomEvent('mlx:mm-accounts',{detail:{accounts:Array.isArray(accounts)?accounts:[]}}))}
function dispatchChain(chainId){window.dispatchEvent(new CustomEvent('mlx:mm-chain',{detail:{chainId:String(chainId||'')}}))}
function timeout(promise,ms,label){let id;return Promise.race([promise,new Promise((_,reject)=>{id=setTimeout(()=>reject(Error(label)),ms)})]).finally(()=>clearTimeout(id))}
function human(e){const m=String(e?.message||e||'');if(/4001|rejected|rechaz/i.test(m))return'Operación cancelada en MetaMask.';if(/-32002|pending/i.test(m))return'MetaMask ya tiene una solicitud pendiente. Abre MetaMask y complétala.';if(/SDK_UNAVAILABLE|Failed to fetch dynamically imported module|Importing a module script failed/i.test(m))return'No se pudo cargar MetaMask Connect. Revisa conexión a internet y reintenta.';if(/timeout/i.test(m))return'MetaMask no respondió. Abre MetaMask, vuelve a MasterlawEX y reintenta.';return m}
async function init(){
  if(window.ethereum)return{provider:window.ethereum,client:null,injected:true};
  if(provider)return{provider,client,injected:false};
  if(loading)return loading;
  loading=(async()=>{
    const mod=await timeout(import(SDK),20000,'METAMASK_CONNECT_SDK_TIMEOUT');
    if(typeof mod.createEVMClient!=='function')throw Error('METAMASK_CONNECT_SDK_UNAVAILABLE');
    client=await mod.createEVMClient({
      dapp:{name:'MasterlawEX',url:'https://arcx-exchange-v2.vercel.app',iconUrl:'https://arcx-exchange-v2.vercel.app/app-icon.svg'},
      api:{supportedNetworks:{[CHAIN]:RPC}},
      eventHandlers:{accountsChanged:accounts=>dispatchAccount(accounts),chainChanged:chainId=>dispatchChain(chainId)}
    });
    provider=client.getProvider();
    if(!provider?.request)throw Error('METAMASK_CONNECT_PROVIDER_UNAVAILABLE');
    provider.on?.('accountsChanged',accounts=>dispatchAccount(accounts));
    provider.on?.('chainChanged',chainId=>dispatchChain(chainId));
    return{provider,client,injected:false};
  })().catch(error=>{loading=null;throw error});
  return loading;
}
async function getProvider(){return(await init()).provider}
async function connect(){
  if(window.ethereum){const accounts=await window.ethereum.request({method:'eth_requestAccounts'});return{accounts,chainId:await window.ethereum.request({method:'eth_chainId'}),injected:true}}
  const s=await init();
  const result=await s.client.connect({chainIds:[CHAIN]});
  dispatchAccount(result?.accounts||[]);dispatchChain(result?.chainId||'');
  return{accounts:result?.accounts||[],chainId:result?.chainId||'',injected:false};
}
async function switchArc(){
  if(window.ethereum){
    try{return await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:CHAIN}]})}
    catch(e){if(e.code!==4902&&e.code!==-32603)throw e;return window.ethereum.request({method:'wallet_addEthereumChain',params:[{chainId:CHAIN,chainName:'Arc Testnet',nativeCurrency:{name:'USDC',symbol:'USDC',decimals:18},rpcUrls:[RPC,FALLBACK],blockExplorerUrls:[EXPLORER]}]})}
  }
  const s=await init();
  return s.client.switchChain({chainId:CHAIN,chainConfiguration:{chainName:'Arc Testnet',nativeCurrency:{name:'USDC',symbol:'USDC',decimals:18},rpcUrls:[RPC,FALLBACK],blockExplorerUrls:[EXPLORER]}});
}
function mode(){return window.ethereum?'INJECTED':provider?'METAMASK_CONNECT':'UNCONNECTED'}
async function edge(action,payload={}){const r=await fetch(EDGE,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...payload})});const j=await r.json().catch(()=>({ok:false,error:'invalid_response'}));if(!r.ok||!j?.ok)throw Error(j.error||('HTTP '+r.status));return j}
function p2pSigned(){return !!sessionStorage.getItem(P2P_SESSION_KEY)}
function setButtonBusy(on,text){walletBusy=on;for(const id of ['loginP2P','p2pLoginTop','mlxConnectFlow']){const b=document.getElementById(id);if(b){b.disabled=on;if(text)b.textContent=text}}}
async function signP2P(){
  if(walletBusy)return false;
  setButtonBusy(true,'Conectando MetaMask…');
  try{
    if(!window.MLX_AUTH?.isLoggedIn?.()){location.href='/login.html?return=%2Fp2p.html';return false}
    const A=window.ARCX_API;if(!A?.connect||!A?.wc)throw Error('WALLET_CORE_NOT_READY');
    const wallet=await A.connect();
    setButtonBusy(true,'Preparando firma…');
    const challenge=await edge('challenge',{wallet});
    if(!challenge?.challenge_id||!challenge?.message)throw Error('CHALLENGE_INVALID');
    setButtonBusy(true,'Firma en MetaMask…');
    const signature=await A.wc('personal_sign',[challenge.message,wallet]);
    if(!signature)throw Error('SIGNATURE_MISSING');
    const login=await edge('login',{challenge_id:challenge.challenge_id,signature});
    if(!login?.token)throw Error('P2P_SESSION_MISSING');
    sessionStorage.setItem(P2P_SESSION_KEY,String(login.token));
    sessionStorage.setItem(AUTO_BIND_KEY,'1');
    window.dispatchEvent(new CustomEvent('mlx:p2p-session',{detail:{logged_in:true,wallet}}));
    A.toast('Firma correcta · terminando validación KYC…');
    location.reload();
    return true;
  }catch(e){window.ARCX_API?.toast?.(human(e));return false}
  finally{setButtonBusy(false)}
}
function flowStep(){if(!window.MLX_AUTH?.isLoggedIn?.())return 1;if(!window.ARCX_API?.account)return 2;if(!p2pSigned())return 3;if(!window.MLX_P2P_GATE?.isActive?.())return 4;return 5}
function setFlowText(id,text,good=false){const el=document.getElementById(id);if(!el)return;el.textContent=text;el.className=good?'good':''}
function renderFlow(message=''){
  const A=window.ARCX_API,w=A?.account||'',s=flowStep();
  setFlowText('mlxFlow1',window.MLX_AUTH?.isLoggedIn?.()?'✓ Cuenta Masterlaw':'1 · Cuenta Masterlaw',!!window.MLX_AUTH?.isLoggedIn?.());
  setFlowText('mlxFlow2',w?'✓ MetaMask '+w.slice(0,6)+'…'+w.slice(-4):'2 · Conectar MetaMask',!!w);
  setFlowText('mlxFlow3',p2pSigned()?'✓ Firma wallet':'3 · Firmar acceso',p2pSigned());
  setFlowText('mlxFlow4',window.MLX_P2P_GATE?.isActive?.()?'✓ KYC verificado':'4 · Validar KYC',!!window.MLX_P2P_GATE?.isActive?.());
  const b=document.getElementById('mlxConnectFlow');if(b&&!walletBusy){b.disabled=s===5;b.textContent=s===1?'Iniciar sesión Masterlaw':s===2?'Conectar MetaMask':s===3?'Firmar acceso P2P':s===4?'Validar KYC + wallet':'Listo para operar'}
  const out=document.getElementById('mlxFlowOutput');if(out)out.textContent=message||(s===5?'LISTO · cuenta, wallet, firma y KYC verificados.':`Continúa con el paso ${s}.`)
}
async function runFlow(){
  const s=flowStep();
  if(s===1){location.href='/login.html?return=%2Fp2p.html';return}
  if(s===2){try{renderFlow('Abriendo MetaMask…');await window.ARCX_API.connect();renderFlow()}catch(e){renderFlow(human(e))}return}
  if(s===3){await signP2P();return}
  if(s===4){try{renderFlow('Validando KYC Masterlaw + wallet…');const ok=await window.MLX_P2P_GATE.bind();renderFlow(ok?'KYC y wallet verificados.':'No se pudo completar KYC.')}catch(e){renderFlow(human(e))}return}
}
async function resumeKyc(){
  if(sessionStorage.getItem(AUTO_BIND_KEY)!=='1')return;
  for(let i=0;i<16;i++){
    await new Promise(r=>setTimeout(r,500));
    if(!window.MLX_AUTH?.isLoggedIn?.())return;
    if(!window.ARCX_API?.account||!window.MLX_P2P_GATE?.bind)continue;
    try{const ok=await window.MLX_P2P_GATE.bind();if(ok){sessionStorage.removeItem(AUTO_BIND_KEY);window.ARCX_API?.toast?.('Cuenta + MetaMask + KYC verificados');renderFlow();return}}catch{}
  }
  sessionStorage.removeItem(AUTO_BIND_KEY);renderFlow('Wallet firmada. Toca “Validar KYC + wallet” para terminar.');
}
function installP2POverrides(){
  if(!location.pathname.endsWith('/p2p.html'))return;
  const a=document.getElementById('loginP2P'),b=document.getElementById('p2pLoginTop'),flow=document.getElementById('mlxConnectFlow');
  if(a&&!p2pSigned()){a.onclick=signP2P;a.textContent='Conectar + firmar MetaMask'}
  if(b&&!p2pSigned()){b.onclick=signP2P;b.textContent='Conectar MetaMask'}
  if(flow)flow.onclick=runFlow;
  renderFlow();resumeKyc();
}
document.addEventListener('DOMContentLoaded',()=>setTimeout(installP2POverrides,0));
window.addEventListener('arcx:wallet',()=>setTimeout(renderFlow,0));
window.addEventListener('mlx:auth',()=>setTimeout(renderFlow,0));
window.addEventListener('mlx:p2p-gate',()=>setTimeout(renderFlow,0));
window.MLX_METAMASK_CONNECT={CHAIN,RPC,SDK,init,getProvider,connect,switchArc,mode,signP2P,p2pSigned,renderFlow,runFlow};
})();
