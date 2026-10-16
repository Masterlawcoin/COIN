(()=>{'use strict';
const A=window.ARCX_API,$=A.$;
const MASTERLAW_API='https://masterlaw-api.vercel.app';
const P2P_SESSION_KEY='masterlawex:p2p:session:v1';
const PROTECTED=new Set(['create_offer','take_offer','mark_paid','release','cancel','dispute']);
let masterlawToken='',entitlement='',expiresAt=0,boundWallet='',gatewayOnline=false,lastPolicy=null;

const validAddress=v=>/^0x[a-fA-F0-9]{40}$/.test(String(v||''));
const same=(a,b)=>String(a||'').toLowerCase()===String(b||'').toLowerCase();
const safeJson=v=>JSON.stringify(v,null,2);
function emit(){window.dispatchEvent(new CustomEvent('mlx:p2p-gate',{detail:status()}))}
function status(){return{active:isActive(),gateway_online:gatewayOnline,wallet:boundWallet||null,expires_at:expiresAt?new Date(expiresAt).toISOString():null,real_money_enabled:false}}
function isActive(){return gatewayOnline&&!!entitlement&&expiresAt>Date.now()&&validAddress(boundWallet)}
function setBadge(text,kind){const el=$('p2pMasterlawState');if(!el)return;el.textContent=text;el.className=kind||''}
function render(message){
  if(!$('p2pMasterlawOutput'))return;
  if(isActive())setBadge('KYC + WALLET · VERIFIED','good');
  else if(gatewayOnline)setBadge('MASTERLAW · BLOCKED','bad');
  else setBadge('GATEWAY · OFFLINE','warn');
  $('p2pMasterlawOutput').textContent=message||safeJson(status());
  emit();
}
function clear(reason='MASTERLAW_GATE_CLEARED'){
  masterlawToken='';entitlement='';expiresAt=0;boundWallet='';
  if($('p2pMasterlawToken'))$('p2pMasterlawToken').value='';
  render(reason+' · Las acciones protegidas quedan bloqueadas.');
}
async function refreshPolicy(){
  try{
    const [hr,pr]=await Promise.all([
      fetch(MASTERLAW_API+'/api/exchange/p2p/health',{cache:'no-store',headers:{accept:'application/json'}}),
      fetch(MASTERLAW_API+'/api/exchange/p2p/policy',{cache:'no-store',headers:{accept:'application/json'}})
    ]);
    const [h,p]=await Promise.all([hr.json(),pr.json()]);
    if(!hr.ok||!pr.ok||!h?.ok||!p?.ok)throw Error('MASTERLAW_CONTROL_PLANE_OFFLINE');
    const actions=p.enforcement_gateway?.protected_actions||[];
    const expected=[...PROTECTED];
    if(Number(h.chain_id)!==5042002||Number(p.chain?.chain_id)!==5042002)throw Error('MASTERLAW_GATEWAY_WRONG_CHAIN');
    if(h.enforcement_gateway!=='AVAILABLE_SANDBOX_ONLY'||p.enforcement_gateway?.mode!=='SANDBOX_ONLY'||p.enforcement_gateway?.path!=='/api/exchange/p2p/gateway')throw Error('MASTERLAW_GATEWAY_NOT_AVAILABLE');
    if(h.real_money_enabled!==false||p.real_money_enabled!==false||p.enforcement_gateway?.real_money_enabled!==false)throw Error('MASTERLAW_GATEWAY_SCOPE_MISMATCH');
    if(expected.some(x=>!actions.includes(x)))throw Error('MASTERLAW_GATEWAY_ACTION_SET_INCOMPLETE');
    gatewayOnline=true;lastPolicy=p;render('Gateway Masterlaw disponible · SANDBOX ONLY · KYC y wallet aún deben vincularse.');return true;
  }catch(e){gatewayOnline=false;entitlement='';expiresAt=0;boundWallet='';render('FAIL CLOSED · '+String(e.message||e));return false}
}
async function bind(){
  const token=String($('p2pMasterlawToken')?.value||'').trim();
  const p2pSession=sessionStorage.getItem(P2P_SESSION_KEY)||'';
  if(!gatewayOnline&&!(await refreshPolicy()))return false;
  if(!token){render('MASTERLAW_TOKEN_REQUIRED');return false}
  if(!p2pSession){render('P2P_SIGNED_SESSION_REQUIRED · Primero inicia sesión P2P con firma de wallet.');return false}
  try{
    const wallet=A.account||await A.connect();await A.ensureChain();
    if(!validAddress(wallet))throw Error('ARC_WALLET_REQUIRED');
    masterlawToken=token;render('Validando KYC Masterlaw + sesión P2P firmada + wallet ARC…');
    const r=await fetch(MASTERLAW_API+'/api/exchange/p2p/bind-wallet',{
      method:'POST',headers:{accept:'application/json','content-type':'application/json',authorization:'Bearer '+token},
      body:JSON.stringify({p2p_session_token:p2pSession,expected_wallet:wallet})
    });
    const j=await r.json().catch(()=>({ok:false,reason:'INVALID_RESPONSE'}));
    if(!r.ok||!j?.eligible||!j.entitlement)throw Error(j.reason||'MASTERLAW_BIND_FAILED');
    if(Number(j.chain_id)!==5042002||!same(j.wallet,wallet)||j.real_money_enabled!==false)throw Error('MASTERLAW_BIND_SCOPE_MISMATCH');
    const verify=await fetch(MASTERLAW_API+'/api/exchange/p2p/verify-entitlement',{
      method:'POST',headers:{accept:'application/json','content-type':'application/json',authorization:'Bearer '+j.entitlement},
      body:JSON.stringify({expected_wallet:wallet})
    });
    const v=await verify.json().catch(()=>({ok:false,reason:'INVALID_RESPONSE'}));
    if(!verify.ok||v.verified!==true||!same(v.wallet,wallet)||Number(v.chain_id)!==5042002||v.real_money_enabled!==false)throw Error(v.reason||'MASTERLAW_ENTITLEMENT_VERIFY_FAILED');
    entitlement=String(j.entitlement);expiresAt=Date.now()+Number(j.expires_in||0)*1000;boundWallet=String(wallet).toLowerCase();
    render(safeJson({eligible:true,kyc_status:v.kyc_status,kyc_level:v.kyc_level,wallet:boundWallet,chain_id:5042002,gateway:'SANDBOX_ONLY',entitlement:'[MEMORY_ONLY]',expires_at:new Date(expiresAt).toISOString(),real_money_enabled:false}));return true;
  }catch(e){entitlement='';expiresAt=0;boundWallet='';render('FAIL CLOSED · '+String(e.message||e));return false}
}
async function protectedApi(action,payload={},p2pSession,expectedWallet){
  const name=String(action||'').trim().toLowerCase();
  if(!PROTECTED.has(name))throw Error('MASTERLAW_GATE_ACTION_NOT_PROTECTED');
  if(!isActive())throw Error('MASTERLAW_KYC_GATE_REQUIRED');
  if(!validAddress(expectedWallet)||!same(expectedWallet,boundWallet)){clear('MASTERLAW_GATE_WALLET_MISMATCH');throw Error('MASTERLAW_GATE_WALLET_MISMATCH')}
  const session=String(p2pSession||'').trim();if(!session)throw Error('P2P_SIGNED_SESSION_REQUIRED');
  const r=await fetch(MASTERLAW_API+'/api/exchange/p2p/gateway',{
    method:'POST',
    headers:{accept:'application/json','content-type':'application/json',authorization:'Bearer '+entitlement,'X-P2P-Session':session},
    body:JSON.stringify({action:name,...payload})
  });
  const j=await r.json().catch(()=>({ok:false,reason:'INVALID_RESPONSE'}));
  if(!r.ok||!j?.ok){if(r.status===401||r.status===403){entitlement='';expiresAt=0;boundWallet='';render(j.reason||'MASTERLAW_GATE_EXPIRED')}throw Error(j.reason||j.error||('HTTP '+r.status))}
  if(j._masterlaw_gateway?.enforced!==true||j._masterlaw_gateway?.mode!=='SANDBOX_ONLY'||j._masterlaw_gateway?.real_money_enabled!==false)throw Error('MASTERLAW_GATEWAY_ATTESTATION_MISSING');
  return j;
}

document.addEventListener('DOMContentLoaded',()=>{
  if(!$('p2pMasterlawGate'))return;
  $('bindMasterlawP2P').onclick=bind;$('clearMasterlawP2P').onclick=()=>clear();
  $('p2pMasterlawToken').addEventListener('input',()=>{if(entitlement){entitlement='';expiresAt=0;boundWallet='';render('TOKEN_CHANGED · vuelve a validar KYC + wallet.')}});
  window.addEventListener('arcx:wallet',()=>{if(entitlement)clear('WALLET_CHANGED')});
  setInterval(()=>{if(entitlement&&expiresAt<=Date.now())clear('ENTITLEMENT_EXPIRED')},15000);
  refreshPolicy();
});

window.MLX_P2P_GATE={isActive,status,bind,clear,refreshPolicy,protectedApi,protectedActions:[...PROTECTED],get policy(){return lastPolicy}};
})();
