(()=>{'use strict';
const CHAIN='0x4cef52';
const RPC='https://rpc.testnet.arc.io';
const FALLBACK='https://rpc.testnet.arc.network';
const EXPLORER='https://testnet.arcscan.app';
const SDK='https://esm.sh/@metamask/connect-evm@2.1.1?bundle';
let client=null,provider=null,loading=null;

function dispatchAccount(accounts){window.dispatchEvent(new CustomEvent('mlx:mm-accounts',{detail:{accounts:Array.isArray(accounts)?accounts:[]}}))}
function dispatchChain(chainId){window.dispatchEvent(new CustomEvent('mlx:mm-chain',{detail:{chainId:String(chainId||'')}}))}
async function init(){
  if(window.ethereum)return{provider:window.ethereum,client:null,injected:true};
  if(provider)return{provider,client,injected:false};
  if(loading)return loading;
  loading=(async()=>{
    const mod=await import(SDK);
    if(typeof mod.createEVMClient!=='function')throw Error('METAMASK_CONNECT_SDK_UNAVAILABLE');
    client=await mod.createEVMClient({
      dapp:{name:'MasterlawEX',url:'https://arcx-exchange-v2.vercel.app',iconUrl:'https://arcx-exchange-v2.vercel.app/app-icon.svg'},
      api:{supportedNetworks:{[CHAIN]:RPC}},
      eventHandlers:{
        accountsChanged:accounts=>dispatchAccount(accounts),
        chainChanged:chainId=>dispatchChain(chainId)
      }
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
window.MLX_METAMASK_CONNECT={CHAIN,RPC,SDK,init,getProvider,connect,switchArc,mode};
})();
