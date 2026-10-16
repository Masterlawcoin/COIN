(()=>{'use strict';
const ENDPOINT='https://tjyplcnvwjzpfcbctlrs.supabase.co/functions/v1/masterlawex-p2p';
const SESSION_KEY='masterlawex:p2p:session:v1';
let busy=false;
const $=id=>document.getElementById(id);
async function edge(action,payload={}){const r=await fetch(ENDPOINT,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...payload})});const j=await r.json().catch(()=>({ok:false,error:'invalid_response'}));if(!r.ok||!j?.ok)throw Error(j.error||('HTTP '+r.status));return j}
function signed(){return !!sessionStorage.getItem(SESSION_KEY)}
function setBusy(on,text){busy=on;for(const id of ['loginP2P','p2pLoginTop']){const b=$(id);if(b){b.disabled=on;if(text)b.textContent=text}}}
function humanError(e){const m=String(e?.message||e||'');if(/4001|rejected|rechaz/i.test(m))return 'Firma cancelada en MetaMask.';if(/-32002|pending/i.test(m))return 'MetaMask ya tiene una solicitud pendiente. Abre MetaMask y complétala.';if(/METAMASK_CONNECT/i.test(m))return 'No se pudo abrir MetaMask Connect. Cierra MetaMask, vuelve a MasterlawEX y reintenta.';return m}
async function login(){
  if(busy)return false;setBusy(true,'Conectando…');
  try{
    if(!window.MLX_AUTH?.isLoggedIn?.()){location.href='/login.html?return=%2Fp2p.html';return false}
    const A=window.ARCX_API;if(!A?.connect||!A?.wc)throw Error('WALLET_CORE_NOT_READY');
    const wallet=await A.connect();
    setBusy(true,'Preparando firma…');
    const challenge=await edge('challenge',{wallet});
    if(!challenge?.challenge_id||!challenge?.message)throw Error('CHALLENGE_INVALID');
    setBusy(true,'Firma en MetaMask…');
    const sig=await A.wc('personal_sign',[challenge.message,wallet]);
    if(!sig)throw Error('SIGNATURE_MISSING');
    const result=await edge('login',{challenge_id:challenge.challenge_id,signature:sig});
    if(!result?.token)throw Error('P2P_SESSION_MISSING');
    sessionStorage.setItem(SESSION_KEY,String(result.token));
    window.dispatchEvent(new CustomEvent('mlx:p2p-session',{detail:{logged_in:true,wallet}}));
    A.toast('Wallet firmada correctamente · terminando KYC…');
    sessionStorage.setItem('masterlawex:p2p:auto-bind:v1','1');
    location.reload();
    return true;
  }catch(e){window.ARCX_API?.toast?.(humanError(e));return false}
  finally{setBusy(false)}
}
async function resumeBind(){
  if(sessionStorage.getItem('masterlawex:p2p:auto-bind:v1')!=='1')return;
  sessionStorage.removeItem('masterlawex:p2p:auto-bind:v1');
  for(let i=0;i<12;i++){
    await new Promise(r=>setTimeout(r,500));
    if(!window.MLX_AUTH?.isLoggedIn?.())return;
    if(!window.ARCX_API?.account)continue;
    if(!window.MLX_P2P_GATE?.bind)continue;
    try{const ok=await window.MLX_P2P_GATE.bind();if(ok){window.ARCX_API?.toast?.('Cuenta + MetaMask + KYC verificados');return}}catch{}
  }
  window.ARCX_API?.toast?.('Wallet conectada. Toca “Validar KYC + wallet” para finalizar.');
}
function overrideButtons(){
  const a=$('loginP2P'),b=$('p2pLoginTop');
  if(a&&!signed()){a.onclick=login;a.textContent='Conectar + firmar MetaMask'}
  if(b&&!signed()){b.onclick=login;b.textContent='Conectar MetaMask'}
}
function bind(){setTimeout(overrideButtons,0);setTimeout(resumeBind,250);window.addEventListener('mlx:auth',overrideButtons);window.addEventListener('arcx:wallet',overrideButtons)}
document.addEventListener('DOMContentLoaded',bind);
window.MLX_P2P_SESSION={login,isLoggedIn:signed,getToken:()=>sessionStorage.getItem(SESSION_KEY)||''};
})();
