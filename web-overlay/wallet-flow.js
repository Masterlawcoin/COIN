(()=>{'use strict';
const $=id=>document.getElementById(id);
let busy=false;
function accountOk(){return !!window.MLX_AUTH?.isLoggedIn?.()}
function wallet(){return window.ARCX_API?.account||''}
function p2pLogged(){return !!window.MLX_P2P_SESSION?.isLoggedIn?.()}
function kycOk(){return !!window.MLX_P2P_GATE?.isActive?.()}
function step(){if(!accountOk())return 1;if(!wallet())return 2;if(!p2pLogged())return 3;if(!kycOk())return 4;return 5}
function setText(id,text,kind=''){const el=$(id);if(!el)return;el.textContent=text;el.className=kind}
function render(message=''){
  const s=step();
  setText('mlxFlow1',accountOk()?'✓ Cuenta Masterlaw':'1 · Cuenta Masterlaw',accountOk()?'good':'');
  setText('mlxFlow2',wallet()?'✓ MetaMask '+wallet().slice(0,6)+'…'+wallet().slice(-4):'2 · Conectar MetaMask',wallet()?'good':'');
  setText('mlxFlow3',p2pLogged()?'✓ Firma wallet':'3 · Firmar acceso',p2pLogged()?'good':'');
  setText('mlxFlow4',kycOk()?'✓ KYC verificado':'4 · Validar KYC',kycOk()?'good':'');
  const btn=$('mlxConnectFlow');if(btn){btn.disabled=busy||s===5;btn.textContent=s===1?'Iniciar sesión Masterlaw':s===2?'Conectar MetaMask':s===3?'Firmar acceso P2P':s===4?'Validar KYC + wallet':'Listo para operar'}
  const out=$('mlxFlowOutput');if(out)out.textContent=message||(s===5?'Cuenta + MetaMask + firma + KYC verificados.':`Completa el paso ${s}.`);
}
async function run(){
  if(busy)return;busy=true;render('Procesando…');
  try{
    let s=step();
    if(s===1){location.href='/login.html?return=%2Fp2p.html';return}
    if(s===2){render('Abriendo MetaMask… aprueba la conexión y vuelve a MasterlawEX.');await window.ARCX_API.connect();s=step()}
    if(s===3){render('Solicitando firma segura en MetaMask…');await window.MLX_P2P_SESSION.login();s=step()}
    if(s===4){render('Comprobando KYC Masterlaw y vínculo con la misma wallet…');const ok=await window.MLX_P2P_GATE.bind();if(!ok)throw Error('KYC_OR_WALLET_BIND_FAILED');s=step()}
    if(s===5)render('LISTO · cuenta Masterlaw + MetaMask + firma + KYC verificados.')
  }catch(e){render('No se pudo completar: '+String(e?.message||e)+' · Reintenta este paso.')}
  finally{busy=false;render()}
}
function bind(){const b=$('mlxConnectFlow');if(b)b.onclick=run;render();window.addEventListener('mlx:auth',()=>render());window.addEventListener('arcx:wallet',()=>render());window.addEventListener('mlx:p2p-session',()=>render());window.addEventListener('mlx:p2p-gate',()=>render())}
document.addEventListener('DOMContentLoaded',bind);
window.MLX_WALLET_FLOW={run,render,step};
})();
