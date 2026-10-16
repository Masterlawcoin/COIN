(()=>{'use strict';
const A=window.ARCX_API,$=A.$,ABI=window.MLX_P2P_V15_ABI;
const STORAGE_KEY='masterlawex:p2p:v15:escrow-address:v1';
const VERSION='1.5.0-testnet',FEE_BPS=100n,DEN=10000n;
let runtime=null,busy=false;

const strip=x=>String(x||'').replace(/^0x/,'');
const word=v=>BigInt(v).toString(16).padStart(64,'0');
const addrWord=a=>strip(a).toLowerCase().padStart(64,'0');
const validAddress=a=>/^0x[a-fA-F0-9]{40}$/.test(String(a||''));
const same=(a,b)=>String(a||'').toLowerCase()===String(b||'').toLowerCase();
const bytes32=x=>/^0x[0-9a-fA-F]{64}$/.test(String(x||''));
function selector(sig){const v=ABI?.methods?.[sig];if(!/^[0-9a-fA-F]{8}$/.test(String(v||'')))throw Error(`ABI V1.5 sin selector ${sig}`);return '0x'+v.toLowerCase()}
function decodeAddress(data){const h=strip(data);if(h.length<64)throw Error('ABI address inválido');return '0x'+h.slice(24,64)}
function decodeUint(data){const h=strip(data);if(h.length<64)throw Error('ABI uint inválido');return BigInt('0x'+h.slice(0,64))}
function decodeString(data){const h=strip(data);if(h.length<128)throw Error('ABI string inválido');const off=Number(BigInt('0x'+h.slice(0,64)))*2;if(!Number.isSafeInteger(off)||off+64>h.length)throw Error('ABI string offset inválido');const len=Number(BigInt('0x'+h.slice(off,off+64))),start=off+64,end=start+len*2;if(!Number.isSafeInteger(len)||end>h.length)throw Error('ABI string largo inválido');const bytes=new Uint8Array((h.slice(start,end).match(/.{1,2}/g)||[]).map(x=>parseInt(x,16)));return new TextDecoder().decode(bytes)}
function fmt6(v){return A.fmt(BigInt(v||0),6,6)+' USDC'}
function gateStatus(){return window.MLX_P2P_GATE?.status?.()||{active:false}}
function gateOk(){const s=gateStatus();return !!s.active&&validAddress(A.account)&&same(s.wallet,A.account)}
function setState(text,kind=''){const el=$('p2pV15State');if(el){el.textContent=text;el.className=kind}}
function setMM(text,kind=''){const el=$('metamaskArcState');if(el){el.textContent=text;el.className=kind}}
function output(value){if($('p2pV15Output'))$('p2pV15Output').textContent=typeof value==='string'?value:JSON.stringify(value,null,2)}
function actionOutput(value){if($('v15ActionOutput'))$('v15ActionOutput').textContent=typeof value==='string'?value:JSON.stringify(value,null,2)}
function syncWallet(){if($('metamaskWalletState'))$('metamaskWalletState').textContent=A.account?`${A.account} · ARC ${A.C.chain}`:'No conectada.';setMM(A.account?'ARC + WALLET · READY':'NO CONFIGURADO',A.account?'good':'warn');syncButtons()}
function syncButtons(){const ok=!!runtime&&gateOk()&&!busy;for(const id of ['v15CreateTrade','v15MarkPaid','v15Release','v15Dispute'])if($(id))$(id).disabled=!ok}
function feeOf(amount){return BigInt(amount)*FEE_BPS/DEN}
function quote(){try{const amount=A.parse($('v15BuyerAmount')?.value||'',6);if(amount<=0n)throw Error('Monto inválido');const fee=feeOf(amount),lock=amount+fee;$('v15FeeQuote').textContent=`Comprador recibe: ${fmt6(amount)}\nComisión Masterlaw 1%: ${fmt6(fee)}\nVendedor bloquea: ${fmt6(lock)}`;return{amount,fee,lock}}catch(e){$('v15FeeQuote').textContent=String(e.message||e);return null}}
async function refHash(raw){const v=String(raw||'').trim();if(bytes32(v))return v.toLowerCase();if(!v)throw Error('Referencia / Trade UUID requerida');const data=new TextEncoder().encode('MASTERLAWEX_P2P_UI_REF_V1:'+v);const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',data));return '0x'+[...digest].map(b=>b.toString(16).padStart(2,'0')).join('')}
function requireGate(){if(!gateOk())throw Error('KYC_MASTERLAW_Y_WALLET_REQUERIDOS');if(!runtime)throw Error('ESCROW_V1_5_NO_VERIFICADO')}
async function setupMetaMask(){try{await A.connect();await A.ensureChain();syncWallet();A.toast('MetaMask configurado en ARC Testnet')}catch(e){actionOutput('MetaMask · '+String(e.message||e))}}
async function watchUSDC(){try{await A.ensureChain();if(!window.ethereum)throw Error('MetaMask/EVM wallet no disponible');const ok=await window.ethereum.request({method:'wallet_watchAsset',params:{type:'ERC20',options:{address:A.C.usdc,symbol:'USDC',decimals:6}}});A.toast(ok?'USDC agregado/confirmado en wallet':'La wallet no agregó USDC')}catch(e){actionOutput('USDC MetaMask · '+String(e.message||e))}}
async function verifyEscrow(explicit){
  const address=String(explicit||$('p2pV15EscrowAddress')?.value||localStorage.getItem(STORAGE_KEY)||'').trim();runtime=null;syncButtons();
  if(!validAddress(address)){setState('ESCROW · SIN CONFIGURAR','warn');output('Ingresa una dirección de contrato V1.5 válida.');return false}
  try{
    if(ABI?.version!==VERSION||Number(ABI?.feeBps)!==100)throw Error('ABI V1.5 no corresponde a fee 1%');
    const chain=String(await A.rpc('eth_chainId')).toLowerCase();if(chain!==A.C.chain)throw Error('RPC fuera de Arc Testnet 5042002');
    const code=await A.rpc('eth_getCode',[address,'latest']);if(!code||code==='0x')throw Error('Dirección sin bytecode');
    const [verRaw,assetRaw,arbRaw,treasuryRaw,feeRaw,quoteRaw]=await Promise.all([
      A.call(address,selector('VERSION()')),A.call(address,selector('asset()')),A.call(address,selector('arbiter()')),A.call(address,selector('feeTreasury()')),A.call(address,selector('FEE_BPS()')),A.call(address,selector('quoteFee(uint256)')+word(100000000n))
    ]);
    const version=decodeString(verRaw),asset=decodeAddress(assetRaw),arbiter=decodeAddress(arbRaw),treasury=decodeAddress(treasuryRaw),feeBps=decodeUint(feeRaw),quote100=decodeUint(quoteRaw);
    if(version!==VERSION)throw Error(`VERSION inesperada: ${version}`);
    if(!same(asset,A.C.usdc))throw Error('asset() no es USDC ARC canónico');
    if(feeBps!==100n||quote100!==1000000n)throw Error('Contrato no cobra exactamente 1%');
    if(!validAddress(arbiter)||!validAddress(treasury))throw Error('Árbitro/tesorería inválidos');
    const [arbCode,treasuryCode]=await Promise.all([A.rpc('eth_getCode',[arbiter,'latest']),A.rpc('eth_getCode',[treasury,'latest'])]);
    if(!arbCode||arbCode==='0x')throw Error('Árbitro debe ser multisig/smart-account con bytecode');
    if(!treasuryCode||treasuryCode==='0x')throw Error('Tesorería Masterlaw debe ser smart-account con bytecode');
    runtime={escrow:address,asset,arbiter,treasury,feeBps,version};localStorage.setItem(STORAGE_KEY,address);if($('p2pV15EscrowAddress'))$('p2pV15EscrowAddress').value=address;
    setState('V1.5 · VERIFIED · FEE 1%','good');output({network:'Arc Testnet',chain_id:5042002,escrow:address,version,asset,fee_bps:Number(feeBps),fee_percent:'1.00%',fee_treasury:treasury,arbiter,kyc_gate_required:true,buyer_receives_full_advertised_amount:true,refund_fee:'0%',real_money_enabled:false});syncButtons();return true;
  }catch(e){runtime=null;setState('V1.5 · FAIL CLOSED','bad');output('FAIL CLOSED · '+String(e.message||e));syncButtons();return false}
}
function clearEscrow(){runtime=null;localStorage.removeItem(STORAGE_KEY);if($('p2pV15EscrowAddress'))$('p2pV15EscrowAddress').value='';setState('ESCROW · SIN CONFIGURAR','warn');output('Escrow V1.5 eliminado de esta sesión local.');syncButtons()}
async function createTrade(){
  requireGate();if(busy)return;busy=true;syncButtons();
  try{
    const buyer=String($('v15BuyerWallet').value||'').trim();if(!validAddress(buyer)||same(buyer,A.account))throw Error('Wallet comprador inválida');
    const q=quote();if(!q)throw Error('Monto inválido');
    const mins=Number($('v15TimeoutMinutes').value||30);if(!Number.isInteger(mins)||mins<10||mins>1440)throw Error('Timeout debe ser 10–1440 minutos');
    const externalHash=await refHash($('v15TradeRef').value);
    actionOutput(`Aprobando ${fmt6(q.lock)} para escrow…`);
    await A.approveIfNeeded(A.C.usdc,runtime.escrow,q.lock,hash=>actionOutput(`Approve USDC enviado: ${hash}`));
    const data=selector('createTrade(address,uint256,uint64,bytes32)')+addrWord(buyer)+word(q.amount)+word(BigInt(mins*60))+strip(externalHash);
    const tx=await A.send(runtime.escrow,data,hash=>actionOutput(`CreateTrade enviado: ${hash}`));
    actionOutput({ok:true,action:'createTrade',tx_hash:tx,seller:A.account,buyer,amount_usdc:A.fmt(q.amount,6,6),fee_usdc:A.fmt(q.fee,6,6),locked_usdc:A.fmt(q.lock,6,6),fee_percent:'1%',external_trade_hash:externalHash,kyc_gate:true});
  }catch(e){actionOutput('FAIL CLOSED · '+String(e.message||e))}finally{busy=false;syncButtons()}
}
function tradeId(){const raw=String($('v15ActionTradeId')?.value||'').trim();if(!/^\d+$/.test(raw)||BigInt(raw)<=0n)throw Error('Trade ID inválido');return BigInt(raw)}
async function sendTrade(sig,label,requireBank=false){requireGate();if(busy)return;busy=true;syncButtons();try{if(requireBank&&!$('v15BankTransferConfirmed').checked)throw Error('Confirma primero que realizaste la transferencia bancaria');const id=tradeId();const tx=await A.send(runtime.escrow,selector(sig)+word(id),hash=>actionOutput(`${label} enviado: ${hash}`));actionOutput({ok:true,action:label,trade_id:id.toString(),tx_hash:tx,kyc_gate:true,fee_rule:'1% sólo al liberar cripto al comprador'})}catch(e){actionOutput('FAIL CLOSED · '+String(e.message||e))}finally{busy=false;syncButtons()}}

document.addEventListener('DOMContentLoaded',()=>{
  if(!$('p2pV15WalletConsole'))return;
  $('setupMetaMaskArc').onclick=setupMetaMask;$('watchUsdcMetaMask').onclick=watchUSDC;$('verifyP2PV15').onclick=()=>verifyEscrow();$('clearP2PV15').onclick=clearEscrow;
  $('v15BuyerAmount').oninput=quote;$('v15CreateTrade').onclick=createTrade;$('v15MarkPaid').onclick=()=>sendTrade('markPaymentSent(uint256)','markPaymentSent',true);$('v15Release').onclick=()=>sendTrade('release(uint256)','release');$('v15Dispute').onclick=()=>sendTrade('openDispute(uint256)','openDispute');
  window.addEventListener('mlx:p2p-gate',syncButtons);window.addEventListener('arcx:wallet',syncWallet);quote();syncWallet();const saved=localStorage.getItem(STORAGE_KEY);if(saved){$('p2pV15EscrowAddress').value=saved;verifyEscrow(saved)}
});
window.MLX_P2P_V15={verifyEscrow,quote,setupMetaMask,watchUSDC,get runtime(){return runtime}};
})();
