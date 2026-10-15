const { ethers } = require('ethers');
const ganache = require('ganache');
const fs = require('fs');
const path = require('path');
const solc = require('solc');

function compileCore() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'contracts', 'ARCXV2.sol'), 'utf8');
  const input = {
    language: 'Solidity',
    sources: { 'ARCXV2.sol': { content: source } },
    settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi','evm.bytecode.object'] } } }
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  if ((out.errors || []).some(e => e.severity === 'error')) {
    console.error(out.errors); process.exit(1);
  }
  const r = {};
  for (const n of ['ARCXTokenFactory','ARCXMarketFactory','ARCXRouter','ARCXPair','ARCXToken']) {
    const c = out.contracts['ARCXV2.sol'][n]; r[n] = { abi: c.abi, bytecode: '0x' + c.evm.bytecode.object };
  }
  return r;
}

function compileMockUSDC() {
  const src = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract MockUSDC {
 string public name='USD Coin'; string public symbol='USDC'; uint8 public constant decimals=6; uint public totalSupply;
 mapping(address=>uint) public balanceOf; mapping(address=>mapping(address=>uint)) public allowance;
 event Transfer(address indexed from,address indexed to,uint value); event Approval(address indexed owner,address indexed spender,uint value);
 constructor(){_mint(msg.sender,1000000000e6);} function _mint(address t,uint a) internal {balanceOf[t]+=a;totalSupply+=a;emit Transfer(address(0),t,a);}
 function transfer(address t,uint a) external returns(bool){_m(msg.sender,t,a);return true;} function approve(address s,uint a) external returns(bool){allowance[msg.sender][s]=a;emit Approval(msg.sender,s,a);return true;}
 function transferFrom(address f,address t,uint a) external returns(bool){uint x=allowance[f][msg.sender];require(x>=a);if(x!=type(uint).max)allowance[f][msg.sender]=x-a;_m(f,t,a);return true;}
 function _m(address f,address t,uint a) internal {require(balanceOf[f]>=a);balanceOf[f]-=a;balanceOf[t]+=a;emit Transfer(f,t,a);}
}`;
  const input = { language:'Solidity', sources:{'M.sol':{content:src}}, settings:{optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}} };
  const out = JSON.parse(solc.compile(JSON.stringify(input))); const c = out.contracts['M.sol'].MockUSDC;
  return { abi:c.abi, bytecode:'0x'+c.evm.bytecode.object };
}

(async () => {
  const C = compileCore(), M = compileMockUSDC();
  const gp = ganache.provider({ logging:{ quiet:true } });
  const provider = new ethers.BrowserProvider(gp), signer = await provider.getSigner(), me = await signer.getAddress();
  const deploy = async (artifact,args=[]) => { const c = await new ethers.ContractFactory(artifact.abi,artifact.bytecode,signer).deploy(...args); await c.waitForDeployment(); return c; };

  const usdc = await deploy(M);
  const tf = await deploy(C.ARCXTokenFactory);
  let tx = await tf.createToken('Acme','ACME',100000000n,me), rc = await tx.wait();
  let ev = rc.logs.map(l=>{try{return tf.interface.parseLog(l)}catch{}}).find(x=>x&&x.name==='TokenCreated');
  const tokenAddress = ev.args.token, token = new ethers.Contract(tokenAddress,C.ARCXToken.abi,signer);

  const mf = await deploy(C.ARCXMarketFactory,[await usdc.getAddress()]);
  tx = await mf.createMarket(tokenAddress,'ipfs://acme'); rc = await tx.wait();
  ev = rc.logs.map(l=>{try{return mf.interface.parseLog(l)}catch{}}).find(x=>x&&x.name==='MarketCreated');
  const pairAddress = ev.args.pair, pair = new ethers.Contract(pairAddress,C.ARCXPair.abi,signer);
  const router = await deploy(C.ARCXRouter,[await mf.getAddress()]);

  const U = ethers.parseUnits('100000',6), T = ethers.parseUnits('10000000',18);
  await (await usdc.approve(pairAddress,U)).wait(); await (await token.approve(pairAddress,T)).wait();
  await (await pair.addLiquidity(U,T,0,me)).wait();
  if ((await pair.reserveUSDC()) !== U || (await pair.reserveToken()) !== T) throw Error('initial reserves mismatch');

  const topU = ethers.parseUnits('1000',6), excessiveT = ethers.parseUnits('200000',18), beforeT = await token.balanceOf(me);
  await (await usdc.approve(pairAddress,topU)).wait(); await (await token.approve(pairAddress,excessiveT)).wait();
  await (await pair.addLiquidity(topU,excessiveT,0,me)).wait();
  const usedT = beforeT - await token.balanceOf(me);
  if (usedT !== ethers.parseUnits('100000',18)) throw Error('ratio safety failed');

  const buyIn = ethers.parseUnits('100',6), q = await pair.quoteUSDCForToken(buyIn), beforeBuy = await token.balanceOf(me);
  await (await usdc.approve(await router.getAddress(),buyIn)).wait(); await (await router.buy(tokenAddress,buyIn,q*99n/100n)).wait();
  const bought = await token.balanceOf(me)-beforeBuy; if (bought !== q) throw Error('router buy mismatch');

  const sellIn = bought/2n, q2 = await pair.quoteTokenForUSDC(sellIn), beforeU = await usdc.balanceOf(me);
  await (await token.approve(await router.getAddress(),sellIn)).wait(); await (await router.sell(tokenAddress,sellIn,q2*99n/100n)).wait();
  if ((await usdc.balanceOf(me))-beforeU !== q2) throw Error('router sell mismatch');

  const lp = await pair.liquidityOf(me), rm = lp/10n, ub = await usdc.balanceOf(me), tb = await token.balanceOf(me);
  await (await pair.removeLiquidity(rm,0,0,me)).wait();
  if ((await usdc.balanceOf(me)) <= ub || (await token.balanceOf(me)) <= tb) throw Error('remove liquidity failed');

  await (await mf.setMarketStatus(tokenAddress,true,false)).wait();
  await (await usdc.approve(await router.getAddress(),ethers.parseUnits('1',6))).wait();
  let blocked=false; try { await router.buy(tokenAddress,ethers.parseUnits('1',6),0); } catch { blocked=true; }
  if (!blocked) throw Error('inactive market routed');
  await (await mf.setMarketStatus(tokenAddress,true,true)).wait();

  let bad=false; try { await mf.createMarket(me,'bad'); } catch { bad=true; }
  if (!bad) throw Error('EOA accepted as token');

  const m = await mf.markets(tokenAddress); if (!m.verified || !m.active) throw Error('market status mismatch');
  console.log('ARCX V2.1 INTEGRATION TEST PASS');
})().catch(e=>{ console.error(e); process.exit(1); });
