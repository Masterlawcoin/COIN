(()=>{'use strict';
const A=window.ARCX_API,$=A.$;
const MASTERLAW_API='https://masterlaw-api.vercel.app';
const ARC_CHAIN='0x4cef52',ARC_USDC='0x3600000000000000000000000000000000000000';
let adminReady=false,preparedCaseHash='',evidenceManifestHashes=[],lastReadiness=null;

function safeJson(v){return JSON.stringify(v,null,2)}
function validBytes32(v){return /^0x[0-9a-fA-F]{64}$/.test(String(v||''))}
function same(a,b){return String(a||'').toLowerCase()===String(b||'').toLowerCase()}
function setStatus(id,text,kind){const el=$(id);if(!el)return;el.textContent=text;el.className='med-status '+kind}
function token(){return String($('masterlawToken')?.value||'').trim()}
function setAdminButtons(enabled){['prepareAdminCase','prepareAdminEvidence','prepareAdminResolution'].forEach(id=>{const el=$(id);if(el)el.disabled=!enabled})}
function resetAdmin(reason='ADMIN_ROLE_REQUIRED'){
  adminReady=false;preparedCaseHash='';evidenceManifestHashes=[];setAdminButtons(false);setStatus('adminState','ADMIN · LOCKED','bad');
  if($('adminCaseOutput'))$('adminCaseOutput').textContent=reason;
  renderReadiness();
}
async function adminFetch(path,{method='GET',body}={}){
  const t=token();if(!t)throw Error('MASTERLAW_TOKEN_REQUIRED');
  const r=await fetch(MASTERLAW_API+path,{method,headers:{accept:'application/json','content-type':'application/json',authorization:'Bearer '+t},body:body===undefined?undefined:JSON.stringify(body)});
  const j=await r.json().catch(()=>({ok:false,reason:'INVALID_RESPONSE'}));
  if(!r.ok||!j.ok)throw Error(j.reason||('HTTP '+r.status));
  if(j.database_mutation!==false||j.real_money_enabled!==false)throw Error('ADMIN_CONTROL_PLANE_SCOPE_MISMATCH');
  return j;
}
function tradeSnapshot(){
  try{const j=JSON.parse($('tradeOutput')?.textContent||'');return j&&j.readOnly===true?j:null}catch{return null}
}
function riskSignals(){return String($('adminRiskSignals').value||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean)}
function isGood(id){const el=$(id);return !!el&&el.classList.contains('good')}
function escrowReady(){
  const snap=tradeSnapshot();
  return !!snap&&Number(snap.chainId)===5042002&&snap.readOnly===true&&snap.version==='1.4.0-testnet'&&same(snap.asset,ARC_USDC)&&/^0x[0-9a-fA-F]{40}$/.test(String(snap.escrow||''));
}
function buildReadinessUI(){
  if($('activationReadiness'))return;
  const banner=document.querySelector('.med-banner');if(!banner)return;
  const section=document.createElement('section');section.id='activationReadiness';section.className='med-card';section.style.marginBottom='12px';
  section.innerHTML=`<div class="med-actions" style="justify-content:space-between;align-items:center"><div><h2>P2P Activation Readiness</h2><p>Chequeo fail-closed. No activa fondos: sólo separa lo listo de lo todavía bloqueado.</p></div><div class="med-actions"><span id="readinessOverall" class="med-status bad">REAL P2P · BLOCKED</span><button id="refreshReadiness" class="med-btn">Actualizar</button><button id="copyReadiness" class="med-btn">Copiar reporte</button></div></div><div class="med-divider"></div><div class="med-actions"><span id="readyFrontend" class="med-status good">FRONTEND · LOADED</span><span id="readyArc" class="med-status good">ARC · LOCKED</span><span id="readyApi" class="med-status bad">CONTROL PLANE · OFF</span><span id="readyKyc" class="med-status bad">KYC · BLOCKED</span><span id="readyWallet" class="med-status bad">WALLET · UNBOUND</span><span id="readyAdmin" class="med-status bad">ADMIN · LOCKED</span><span id="readyEscrow" class="med-status bad">ESCROW V1.4 · UNVERIFIED</span><span id="readyEnforcement" class="med-status bad">SERVER ENFORCEMENT · BLOCKED</span><span id="readyPersistence" class="med-status bad">CASE STORE · BLOCKED</span></div><pre id="readinessOutput" class="med-output" style="margin-top:10px">Calculando readiness…</pre>`;
  banner.insertAdjacentElement('afterend',section);
  $('refreshReadiness').onclick=renderReadiness;
  $('copyReadiness').onclick=copyReadiness;
}
function readinessSnapshot(){
  const arcLocked=String(A?.C?.chain||'').toLowerCase()===ARC_CHAIN&&same(A?.C?.usdc,ARC_USDC);
  const apiOnline=isGood('apiHealth'),kycVerified=isGood('kycState'),walletAttested=isGood('walletState'),adminVerified=isGood('adminState'),escrowVerified=escrowReady();
  const caseHashPrepared=validBytes32($('caseHash')?.value),resolutionHashPrepared=validBytes32($('resolutionHash')?.value);
  const serverEntitlementEnforced=false;
  const casePersistenceEnabled=false;
  const realMoneyEnabled=false;
  const critical={arc_locked:arcLocked,control_plane_online:apiOnline,kyc_verified:kycVerified,wallet_attested:walletAttested,admin_verified:adminVerified,escrow_v14_verified:escrowVerified,server_entitlement_enforced:serverEntitlementEnforced,case_persistence_enabled:casePersistenceEnabled};
  return{
    schema:'MASTERLAWEX_P2P_ACTIVATION_READINESS_V1',
    network:'Arc Testnet',chain_id:5042002,asset:ARC_USDC,
    critical,
    workflow:{case_hash_prepared:caseHashPrepared,resolution_hash_prepared:resolutionHashPrepared},
    blockers:[
      ...(!serverEntitlementEnforced?['SERVER_SIDE_ENTITLEMENT_ENFORCEMENT_NOT_ENABLED']:[]),
      ...(!casePersistenceEnabled?['P2P_CASE_PERSISTENCE_NOT_ENABLED']:[]),
      ...(!escrowVerified?['ESCROW_V1_4_NOT_VERIFIED_ONCHAIN']:[]),
      ...(!apiOnline?['MASTERLAW_CONTROL_PLANE_NOT_LIVE']:[])
    ],
    policy:{supabase_mutation_performed:false,real_money_enabled:realMoneyEnabled,browser_arbitration_broadcast:false},
    ready_for_real_money:Object.values(critical).every(Boolean)&&realMoneyEnabled
  };
}
function renderReadiness(){
  if(!$('activationReadiness'))return;
  lastReadiness=readinessSnapshot();const c=lastReadiness.critical;
  setStatus('readyFrontend','FRONTEND · LOADED','good');setStatus('readyArc',c.arc_locked?'ARC · LOCKED':'ARC · BLOCKED',c.arc_locked?'good':'bad');
  setStatus('readyApi',c.control_plane_online?'CONTROL PLANE · ONLINE':'CONTROL PLANE · OFF',c.control_plane_online?'good':'bad');
  setStatus('readyKyc',c.kyc_verified?'KYC · VERIFIED':'KYC · BLOCKED',c.kyc_verified?'good':'bad');
  setStatus('readyWallet',c.wallet_attested?'WALLET · ATTESTED':'WALLET · UNBOUND',c.wallet_attested?'good':'bad');
  setStatus('readyAdmin',c.admin_verified?'ADMIN · VERIFIED':'ADMIN · LOCKED',c.admin_verified?'good':'bad');
  setStatus('readyEscrow',c.escrow_v14_verified?'ESCROW V1.4 · VERIFIED':'ESCROW V1.4 · UNVERIFIED',c.escrow_v14_verified?'good':'bad');
  setStatus('readyEnforcement','SERVER ENFORCEMENT · BLOCKED','bad');setStatus('readyPersistence','CASE STORE · BLOCKED','bad');
  setStatus('readinessOverall',lastReadiness.ready_for_real_money?'REAL P2P · READY':'REAL P2P · BLOCKED',lastReadiness.ready_for_real_money?'good':'bad');
  $('readinessOutput').textContent=safeJson(lastReadiness);
}
async function copyReadiness(){
  lastReadiness=readinessSnapshot();
  try{await navigator.clipboard.writeText(safeJson(lastReadiness));A.toast('Readiness copiado')}catch{A.toast('No se pudo copiar automáticamente')}
}

async function loadAdminState(){
  try{
    const j=await adminFetch('/api/exchange/p2p/admin/state-machine');
    if(Number(j.chain_id)!==5042002||j.browser_broadcast_allowed!==false)throw Error('ADMIN_STATE_SCOPE_MISMATCH');
    adminReady=true;setAdminButtons(true);setStatus('adminState','ADMIN · VERIFIED','good');
    $('adminCaseOutput').textContent=safeJson({actor:j.actor,chain_id:j.chain_id,states:j.states,prepare_only:true,database_mutation:false,real_money_enabled:false});
  }catch(e){resetAdmin('FAIL CLOSED · '+String(e.message||e))}
  renderReadiness();
}

async function prepareAdminCase(){
  if(!adminReady)return resetAdmin();
  const snap=tradeSnapshot();
  const body={
    case_number:$('adminCaseNumber').value,
    external_trade_id:$('adminExternalTrade').value,
    buyer_wallet:$('adminBuyerWallet').value||snap?.buyer,
    seller_wallet:$('adminSellerWallet').value||snap?.seller,
    chain_id:5042002,
    escrow_address:$('escrowAddress').value||snap?.escrow||null,
    escrow_trade_id:$('tradeId').value||snap?.tradeId||null,
    order_ref:snap?.orderRef||null,
    crypto_amount_base_units:$('adminCryptoAmount').value||snap?.amountBaseUnits,
    fiat_currency:$('adminFiat').value,
    status:'OPENED',
    risk_snapshot:{level:$('adminRiskLevel').value,source:'MASTERLAW_ADMIN_WORKSPACE',signals:riskSignals()}
  };
  $('adminCaseOutput').textContent='Preparando expediente determinístico…';
  try{
    const j=await adminFetch('/api/exchange/p2p/admin/prepare-case',{method:'POST',body});
    if(!validBytes32(j.case_hash)||j.onchain_commitment?.pii_onchain!==false)throw Error('INVALID_CASE_PACKET');
    preparedCaseHash=j.case_hash;evidenceManifestHashes=[];$('caseHash').value=j.case_hash;
    $('adminCaseOutput').textContent=safeJson({...j,note:'PREPARE ONLY · no se creó ninguna fila en Supabase.'});
    $('adminEvidenceOutput').textContent='Caso preparado. Puedes registrar metadatos de evidencia sin subir ni guardar archivos.';
  }catch(e){preparedCaseHash='';$('adminCaseOutput').textContent='FAIL CLOSED · '+String(e.message||e)}
  renderReadiness();
}

async function prepareAdminEvidence(){
  const caseHash=preparedCaseHash||$('caseHash').value.trim();
  if(!adminReady||!validBytes32(caseHash)){$('adminEvidenceOutput').textContent='CASE_HASH_REQUIRED';return}
  const body={case_hash:caseHash,evidence_type:$('adminEvidenceType').value,storage_ref:$('adminStorageRef').value,sha256:$('adminEvidenceSha').value,visibility:$('adminEvidenceVisibility').value,note:$('adminEvidenceNote').value};
  $('adminEvidenceOutput').textContent='Preparando manifiesto de evidencia…';
  try{
    const j=await adminFetch('/api/exchange/p2p/admin/prepare-evidence',{method:'POST',body});
    if(!validBytes32(j.evidence_manifest_hash)||j.upload_performed!==false||j.database_mutation!==false||j.real_money_enabled!==false)throw Error('INVALID_EVIDENCE_PACKET');
    if(!evidenceManifestHashes.includes(j.evidence_manifest_hash))evidenceManifestHashes.push(j.evidence_manifest_hash);
    $('adminEvidenceOutput').textContent=safeJson({...j,evidence_count:evidenceManifestHashes.length,note:'Sólo metadatos/hash. El documento no fue subido por esta consola.'});
  }catch(e){$('adminEvidenceOutput').textContent='FAIL CLOSED · '+String(e.message||e)}
}

async function prepareAdminResolution(){
  const caseHash=preparedCaseHash||$('caseHash').value.trim();
  if(!adminReady||!validBytes32(caseHash)){$('adminResolutionOutput').textContent='CASE_HASH_REQUIRED';return}
  if(!$('adminHumanApprove').checked){$('adminResolutionOutput').textContent='HUMAN_APPROVAL_REQUIRED';return}
  const mode=$('adminResolutionMode').value;
  const body={case_hash:caseHash,current_status:$('adminCurrentStatus').value,mode,rationale_code:$('adminRationale').value,evidence_manifest_hashes:[...evidenceManifestHashes],human_approved:true};
  if(mode==='MUTUAL_SPLIT_AGREEMENT')body.split_buyer_amount_base_units=$('adminSplitAmount').value;
  $('adminResolutionOutput').textContent='Preparando resolución humana…';
  try{
    const j=await adminFetch('/api/exchange/p2p/admin/prepare-resolution',{method:'POST',body});
    if(!validBytes32(j.resolution_hash)||j.browser_broadcast_allowed!==false)throw Error('INVALID_RESOLUTION_PACKET');
    $('resolutionHash').value=j.resolution_hash;
    if(mode==='ARBITER_RELEASE_BUYER')$('resolutionDecision').value='buyer';
    if(mode==='ARBITER_REFUND_SELLER')$('resolutionDecision').value='seller';
    $('adminResolutionOutput').textContent=safeJson({...j,note:mode==='MUTUAL_SPLIT_AGREEMENT'?'Requiere aprobaciones de las partes; no usar resolveDispute binario.':'Hash listo para revisión multisig; esta página no transmite la resolución.'});
  }catch(e){$('adminResolutionOutput').textContent='FAIL CLOSED · '+String(e.message||e)}
  renderReadiness();
}

document.addEventListener('DOMContentLoaded',()=>{
  buildReadinessUI();setAdminButtons(false);
  $('loadAdminState').onclick=loadAdminState;
  $('prepareAdminCase').onclick=prepareAdminCase;
  $('prepareAdminEvidence').onclick=prepareAdminEvidence;
  $('prepareAdminResolution').onclick=prepareAdminResolution;
  $('masterlawToken').addEventListener('input',()=>{if(adminReady)resetAdmin('TOKEN_CHANGED · vuelve a validar rol admin.');else renderReadiness()});
  ['checkKyc','bindWallet','inspectEscrow','prepareFreeze','prepareResolve'].forEach(id=>{const el=$(id);if(el)el.addEventListener('click',()=>setTimeout(renderReadiness,750))});
  setInterval(renderReadiness,5000);renderReadiness();
});
})();
