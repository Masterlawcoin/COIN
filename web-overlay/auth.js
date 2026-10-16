(()=>{'use strict';
const API='https://masterlaw-api.vercel.app';
const STORAGE='masterlawex:auth:v1';
let state=load();
let installPrompt=null;
let refreshing=null;

function load(){try{const v=JSON.parse(localStorage.getItem(STORAGE)||'null');return v&&v.token&&v.user?{token:String(v.token),user:v.user,validatedAt:Number(v.validatedAt||0)}:{token:'',user:null,validatedAt:0}}catch{return{token:'',user:null,validatedAt:0}}}
function persist(){if(state.token&&state.user)localStorage.setItem(STORAGE,JSON.stringify(state));else localStorage.removeItem(STORAGE);emit()}
function emit(){window.dispatchEvent(new CustomEvent('mlx:auth',{detail:status()}));syncUi();syncP2PGate()}
function status(){return{logged_in:!!state.token&&!!state.user,user:state.user||null,validated_at:state.validatedAt||null}}
function token(){return state.token||''}
function user(){return state.user||null}
function loggedIn(){return !!state.token&&!!state.user}
function safeText(v){return String(v??'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]))}
function displayName(){const u=state.user||{};return String(u.nombre||u.name||u.email||'Cuenta Masterlaw')}
function returnTo(){const q=new URLSearchParams(location.search);const r=q.get('return');return r&&r.startsWith('/')&&!r.startsWith('//')?r:'/p2p.html'}
function toast(message){if(window.ARCX_API?.toast)return window.ARCX_API.toast(message);let t=document.getElementById('mlxAuthToast');if(!t){t=document.createElement('div');t.id='mlxAuthToast';t.className='mlx-auth-toast';document.body.appendChild(t)}t.textContent=message;t.classList.add('show');clearTimeout(t._timer);t._timer=setTimeout(()=>t.classList.remove('show'),2800)}

async function jsonFetch(path,options={}){
  const headers={accept:'application/json',...(options.body?{'content-type':'application/json'}:{}),...(options.headers||{})};
  const r=await fetch(API+path,{...options,headers,cache:'no-store'});
  const j=await r.json().catch(()=>({ok:false,error:'INVALID_RESPONSE'}));
  if(!r.ok||!j?.ok)throw Object.assign(new Error(j.error||j.reason||('HTTP '+r.status)),{status:r.status,payload:j});
  return j;
}
async function login(email,password){
  const clean=String(email||'').trim().toLowerCase();
  if(!clean||!password)throw Error('Ingresa email y contraseña.');
  const j=await jsonFetch('/api/exchange/auth/login',{method:'POST',body:JSON.stringify({email:clean,password:String(password)})});
  if(!j.token||!j.user)throw Error('Respuesta de login incompleta.');
  state={token:String(j.token),user:j.user,validatedAt:Date.now()};persist();return state.user;
}
async function refresh(force=false){
  if(!state.token){emit();return null}
  if(!force&&Date.now()-state.validatedAt<120000){emit();return state.user}
  if(refreshing)return refreshing;
  refreshing=(async()=>{
    try{
      const j=await jsonFetch('/api/exchange/auth/me',{headers:{authorization:'Bearer '+state.token}});
      state.user=j.user;state.validatedAt=Date.now();persist();return state.user;
    }catch(e){
      state={token:'',user:null,validatedAt:0};persist();throw e;
    }finally{refreshing=null}
  })();
  return refreshing;
}
function logout(){state={token:'',user:null,validatedAt:0};persist();try{window.MLX_P2P_GATE?.clear?.('MASTERLAW_SESSION_CLOSED')}catch{}toast('Sesión Masterlaw cerrada')}
async function forgot(email){const clean=String(email||'').trim().toLowerCase();if(!clean)throw Error('Ingresa tu email.');return jsonFetch('/api/exchange/auth/forgot',{method:'POST',body:JSON.stringify({email:clean})})}

function injectStyles(){if(document.getElementById('mlxAuthStyles'))return;const s=document.createElement('style');s.id='mlxAuthStyles';s.textContent=`
.mlx-auth-pill{height:34px;border:1px solid #2b3139;background:#181a20;color:#eaecef;border-radius:9px;padding:0 11px;font:700 11px/1 system-ui;cursor:pointer;white-space:nowrap}.mlx-auth-pill.good{border-color:#0ecb8155;color:#0ecb81}.mlx-auth-pill.install{border-color:#f0b90b55;color:#f0b90b}.mlx-auth-inline{border:1px solid #2b3139;border-radius:8px;padding:10px 12px;margin-bottom:10px;background:#101318;font:12px/1.45 system-ui;color:#b7bdc6}.mlx-auth-inline b{color:#eaecef}.mlx-auth-inline a{color:#f0b90b;font-weight:800}.mlx-auth-toast{position:fixed;left:50%;bottom:82px;transform:translate(-50%,12px);background:#1e2329;color:#eaecef;border:1px solid #343a40;border-radius:10px;padding:11px 14px;z-index:99999;opacity:0;pointer-events:none;transition:.2s;font:700 12px system-ui;max-width:min(92vw,520px);box-shadow:0 12px 40px #0008}.mlx-auth-toast.show{opacity:1;transform:translate(-50%,0)}.mlx-install-sheet{position:fixed;inset:0;background:#000b;z-index:99998;display:flex;align-items:flex-end;justify-content:center;padding:18px}.mlx-install-card{width:min(520px,100%);background:#181a20;border:1px solid #343a40;border-radius:16px;padding:18px;color:#eaecef;font:13px/1.5 system-ui}.mlx-install-card h3{margin:0 0 8px}.mlx-install-card button{width:100%;height:42px;margin-top:10px;border-radius:9px;border:0;background:#f0b90b;color:#111;font-weight:900;cursor:pointer}@media(max-width:900px){.top-right .mlx-auth-pill{max-width:118px;overflow:hidden;text-overflow:ellipsis}.mlx-auth-pill.install{display:none}}
`;document.head.appendChild(s)}
function injectHeader(){
  const host=document.querySelector('.top-right');if(!host||document.getElementById('mlxAccountBtn'))return;
  const account=document.createElement('button');account.id='mlxAccountBtn';account.className='mlx-auth-pill';account.type='button';account.onclick=()=>{location.href='/login.html?return='+encodeURIComponent(location.pathname+location.search)};
  const install=document.createElement('button');install.id='mlxInstallBtn';install.className='mlx-auth-pill install';install.type='button';install.textContent='Instalar app';install.onclick=installApp;
  host.prepend(install);host.prepend(account);
}
function syncUi(){
  const b=document.getElementById('mlxAccountBtn');if(b){b.textContent=loggedIn()?displayName():'Cuenta Masterlaw';b.classList.toggle('good',loggedIn())}
  const loginState=document.getElementById('mlxLoginSession');if(loginState){loginState.innerHTML=loggedIn()?`<b>Sesión activa</b><br>${safeText(displayName())}<br><small>${safeText(state.user?.email||'')}</small>`:'<b>Sin sesión</b><br>Inicia sesión con tu cuenta Masterlaw.'}
  const continueBtn=document.getElementById('mlxContinue');if(continueBtn)continueBtn.hidden=!loggedIn();
  const logoutBtn=document.getElementById('mlxLogout');if(logoutBtn)logoutBtn.hidden=!loggedIn();
}
function syncP2PGate(){
  const input=document.getElementById('p2pMasterlawToken');if(!input)return;
  const label=input.closest('label');if(label)label.style.display='none';
  input.value=loggedIn()?state.token:'';
  const gate=document.getElementById('p2pMasterlawGate');if(gate){let box=document.getElementById('mlxP2PAccount');if(!box){box=document.createElement('div');box.id='mlxP2PAccount';box.className='mlx-auth-inline';const body=gate.querySelector('.ex-body');if(body)body.prepend(box)}if(box)box.innerHTML=loggedIn()?`<b>Cuenta Masterlaw: ${safeText(displayName())}</b><br>${safeText(state.user?.email||'')} · sesión validada por backend. Ahora vincula esta cuenta con tu wallet ARC para comprobar KYC.`:`<b>Primero inicia sesión en Masterlaw.</b><br>El KYC no puede validarse sin una cuenta autenticada. <a href="/login.html?return=%2Fp2p.html">Iniciar sesión →</a>`}
  const bind=document.getElementById('bindMasterlawP2P');if(bind){if(!loggedIn()){bind.disabled=false;bind.textContent='Iniciar sesión Masterlaw';bind.onclick=()=>{location.href='/login.html?return=%2Fp2p.html'}}else{bind.textContent='Validar KYC + wallet'}}
}

function standalone(){return matchMedia('(display-mode: standalone)').matches||navigator.standalone===true}
async function installApp(){
  if(standalone()){toast('MasterlawEX ya está instalada.');return}
  if(installPrompt){const p=installPrompt;installPrompt=null;await p.prompt();const choice=await p.userChoice;if(choice?.outcome==='accepted')toast('Instalando MasterlawEX…');return}
  showInstallHelp();
}
function showInstallHelp(){
  const old=document.getElementById('mlxInstallSheet');if(old)old.remove();const wrap=document.createElement('div');wrap.id='mlxInstallSheet';wrap.className='mlx-install-sheet';const android=/Android/i.test(navigator.userAgent),ios=/iPhone|iPad|iPod/i.test(navigator.userAgent);let instructions=android?'En Chrome: abre el menú ⋮ y toca “Instalar aplicación” o “Añadir a pantalla principal”.':ios?'En Safari: toca Compartir y luego “Añadir a pantalla de inicio”.':'En Chrome/Edge: usa el icono de instalación de la barra de direcciones o el menú “Instalar MasterlawEX”.';wrap.innerHTML=`<div class="mlx-install-card"><h3>Instalar MasterlawEX</h3><p>${instructions}</p><p>La app se abre en ventana independiente y conserva tu acceso. MetaMask seguirá solicitando cada firma sensible.</p><button type="button">Cerrar</button></div>`;wrap.querySelector('button').onclick=()=>wrap.remove();wrap.onclick=e=>{if(e.target===wrap)wrap.remove()};document.body.appendChild(wrap)}

function bindLoginPage(){
  const form=document.getElementById('mlxLoginForm');if(!form)return;
  const email=document.getElementById('mlxEmail'),password=document.getElementById('mlxPassword'),msg=document.getElementById('mlxLoginMessage'),submit=document.getElementById('mlxLoginSubmit');
  const show=(text,kind='')=>{msg.textContent=text;msg.className='mlx-login-message '+kind};
  form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;show('Validando cuenta…');try{await login(email.value,password.value);show('Login correcto. Redirigiendo…','good');setTimeout(()=>{location.href=returnTo()},350)}catch(err){const map={INVALID_CREDENTIALS:'Email o contraseña incorrectos.',MASTERLAW_ACCOUNT_DISABLED_OR_MISSING:'La cuenta no está habilitada para Masterlaw.',MASTERLAW_AUTH_NOT_CONFIGURED:'El servicio de autenticación no está configurado.'};show(map[err.message]||err.message||'No se pudo iniciar sesión.','bad')}finally{submit.disabled=false}};
  const forgotBtn=document.getElementById('mlxForgot');if(forgotBtn)forgotBtn.onclick=async()=>{try{const e=String(email.value||'').trim();if(!e){show('Ingresa tu email arriba para recuperar la contraseña.','bad');return}forgotBtn.disabled=true;await forgot(e);show('Si el correo existe, recibirás el enlace de recuperación.','good')}catch(err){show(err.message||'No se pudo solicitar recuperación.','bad')}finally{forgotBtn.disabled=false}};
  const installBtn=document.getElementById('mlxInstallPage');if(installBtn)installBtn.onclick=installApp;
  const continueBtn=document.getElementById('mlxContinue');if(continueBtn)continueBtn.onclick=()=>{location.href=returnTo()};
  const logoutBtn=document.getElementById('mlxLogout');if(logoutBtn)logoutBtn.onclick=()=>{logout();syncUi();show('Sesión cerrada.')};
}

window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;const b=document.getElementById('mlxInstallBtn');if(b)b.textContent='Instalar app'});
window.addEventListener('appinstalled',()=>{installPrompt=null;toast('MasterlawEX instalada correctamente')});
window.addEventListener('arcx:wallet',()=>setTimeout(syncP2PGate,0));
window.addEventListener('mlx:p2p-gate',()=>setTimeout(syncP2PGate,0));

document.addEventListener('DOMContentLoaded',()=>{
  injectStyles();injectHeader();bindLoginPage();syncUi();syncP2PGate();
  if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(()=>{});
  if(state.token)refresh().catch(()=>{toast('Tu sesión Masterlaw expiró. Inicia sesión nuevamente.')});
});

window.MLX_AUTH={login,logout,refresh,forgot,isLoggedIn:loggedIn,getToken:token,getUser:user,status,install:installApp,apiBase:API};
})();
