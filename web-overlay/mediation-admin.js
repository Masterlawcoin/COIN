(()=>{'use strict';
const A=window.ARCX_API,$=A.$;
const MASTERLAW_API='https://masterlaw-api.vercel.app';
let adminReady=false,preparedCaseHash='',evidenceManifestHashes=[];

function safeJson(v){return JSON.stringify(v,null,2)}
function validBytes32(v){return /^0x[0-9a-fA-F]{64}$/.test(String(v||''))}
function setStatus(id,text,kind){const el=$(id);if(!el)return;el.textContent=text;el.className='med-status '+kind}
function token(){return String($('masterlawToken')?.value||'').trim()}
function setAdminButtons(enabled){['prepareAdminCase','prepareAdminEvidence','prepareAdminResolution'].forEach(id=>{const el=$(id);if(el)el.disabled=!enabled})}
function resetAdmin(reason='ADMIN_ROLE_REQUIRED'){
  adminReady=false;preparedCaseHash='';evidenceManifestHashes=[];setAdminButtons(false);setStatus('adminState','ADMIN · LOCKED','bad');
  if($('adminCaseOutput'))$('adminCaseOutput').textContent=reason;
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

async function loadAdminState(){
  try{
    const j=await adminFetch('/api/exchange/p2p/admin/state-machine');
    if(Number(j.chain_id)!==5042002||j.browser_broadcast_allowed!==false)throw Error('ADMIN_STATE_SCOPE_MISMATCH');
    adminReady=true;setAdminButtons(true);setStatus('adminState','ADMIN · VERIFIED','good');
    $('adminCaseOutput').textContent=safeJson({actor:j.actor,chain_id:j.chain_id,states:j.states,prepare_only:true,database_mutation:false,real_money_enabled:false});
  }catch(e){resetAdmin('FAIL CLOSED · '+String(e.message||e))}
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
}

async function prepareAdminEvidence(){
  const caseHash=preparedCaseHash||$('caseHash').value.trim();
  if(!adminReady||!validBytes32(caseHash)){$('adminEvidenceOutput').textContent='CASE_HASH_REQUIRED';return}
  const body={case_hash:caseHash,evidence_type:$('adminEvidenceType').value,storage_ref:$('adminStorageRef').value,sha256:$('adminEvidenceSha').value,visibility:$('adminEvidenceVisibility').value,note:$('adminEvidenceNote').value};
  $('adminEvidenceOutput').textContent='Preparando manifiesto de evidencia…';
  try{
    const j=await adminFetch('/api/exchange/p2p/admin/prepare-evidence',{method:'POST',body});
    if(!validBytes32(j.evidence_manifest_hash)||j.upload_performed!==false)throw Error('INVALID_EVIDENCE_PACKET');
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
}

document.addEventListener('DOMContentLoaded',()=>{
  setAdminButtons(false);
  $('loadAdminState').onclick=loadAdminState;
  $('prepareAdminCase').onclick=prepareAdminCase;
  $('prepareAdminEvidence').onclick=prepareAdminEvidence;
  $('prepareAdminResolution').onclick=prepareAdminResolution;
  $('masterlawToken').addEventListener('input',()=>{if(adminReady)resetAdmin('TOKEN_CHANGED · vuelve a validar rol admin.')});
});
})();
