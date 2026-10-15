const { ethers } = require('ethers');
const ganache = require('ganache');
const fs = require('fs');
const path = require('path');
const solc = require('solc');

function compile() {
  const escrow = fs.readFileSync(path.join(__dirname,'..','contracts','MasterlawEXP2PEscrow.sol'),'utf8');
  const mock = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract MockUSDC {string public name='USD Coin';string public symbol='USDC';uint8 public constant decimals=6;uint public totalSupply;mapping(address=>uint)public balanceOf;mapping(address=>mapping(address=>uint))public allowance;event Transfer(address indexed from,address indexed to,uint value);event Approval(address indexed owner,address indexed spender,uint value);constructor(){_mint(msg.sender,1000000e6);}function _mint(address to,uint a)internal{balanceOf[to]+=a;totalSupply+=a;emit Transfer(address(0),to,a);}function transfer(address to,uint a)external returns(bool){_move(msg.sender,to,a);return true;}function approve(address s,uint a)external returns(bool){allowance[msg.sender][s]=a;emit Approval(msg.sender,s,a);return true;}function transferFrom(address f,address t,uint a)external returns(bool){uint x=allowance[f][msg.sender];require(x>=a,'allowance');if(x!=type(uint).max)allowance[f][msg.sender]=x-a;_move(f,t,a);return true;}function _move(address f,address t,uint a)internal{require(balanceOf[f]>=a,'balance');balanceOf[f]-=a;balanceOf[t]+=a;emit Transfer(f,t,a);}}`;
  const input={language:'Solidity',sources:{'E.sol':{content:escrow},'M.sol':{content:mock}},settings:{optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}};
  const out=JSON.parse(solc.compile(JSON.stringify(input)));
  const errs=(out.errors||[]).filter(e=>e.severity==='error');if(errs.length)throw Error(errs.map(e=>e.formattedMessage).join('\n'));
  const e=out.contracts['E.sol'].MasterlawEXP2PEscrow,m=out.contracts['M.sol'].MockUSDC;
  return {E:{abi:e.abi,bytecode:'0x'+e.evm.bytecode.object},M:{abi:m.abi,bytecode:'0x'+m.evm.bytecode.object}};
}
async function mustRevert(fn,label){let ok=false;try{let tx=await fn();await tx.wait()}catch{ok=true}if(!ok)throw Error('expected revert: '+label)}
(async()=>{
  const C=compile(),gp=ganache.provider({logging:{quiet:true}}),provider=new ethers.BrowserProvider(gp);
  const seller=await provider.getSigner(0),buyer=await provider.getSigner(1),arbiter=await provider.getSigner(2),nextArbiter=await provider.getSigner(3);
  const sellerAddr=await seller.getAddress(),buyerAddr=await buyer.getAddress(),arbiterAddr=await arbiter.getAddress();
  const deploy=async(a,args=[],s=seller)=>{const c=await new ethers.ContractFactory(a.abi,a.bytecode,s).deploy(...args);await c.waitForDeployment();return c};
  const usdc=await deploy(C.M),escrow=await deploy(C.E,[await usdc.getAddress(),arbiterAddr]);
  const amount=ethers.parseUnits('100',6);await(await usdc.approve(await escrow.getAddress(),amount*10n)).wait();

  // Happy path: seller funds -> buyer marks paid -> seller releases.
  await(await escrow.createTrade(buyerAddr,amount,900)).wait();
  if(await usdc.balanceOf(await escrow.getAddress())!==amount)throw Error('escrow not funded');
  await mustRevert(()=>escrow.connect(buyer).release(1),'buyer cannot release');
  await(await escrow.connect(buyer).markPaymentSent(1)).wait();
  const buyerBefore=await usdc.balanceOf(buyerAddr);await(await escrow.release(1)).wait();
  if((await usdc.balanceOf(buyerAddr))-buyerBefore!==amount)throw Error('buyer release mismatch');
  if((await escrow.trades(1)).state!==3n)throw Error('released state mismatch');

  // Buyer cancel before payment returns funds to seller.
  const sellerBefore=await usdc.balanceOf(sellerAddr);await(await escrow.createTrade(buyerAddr,amount,900)).wait();await(await escrow.connect(buyer).cancelByBuyer(2)).wait();
  if((await usdc.balanceOf(sellerAddr))-sellerBefore!==0n) {
    // createTrade first removed amount, cancel must restore to the exact pre-create balance.
    if(await usdc.balanceOf(sellerAddr)!==sellerBefore)throw Error('buyer cancel refund mismatch');
  }

  // Dispute freezes trade and arbiter refunds seller.
  const pre3=await usdc.balanceOf(sellerAddr);await(await escrow.createTrade(buyerAddr,amount,900)).wait();await(await escrow.connect(buyer).markPaymentSent(3)).wait();await(await escrow.connect(buyer).openDispute(3)).wait();
  await mustRevert(()=>escrow.release(3),'release blocked after dispute');
  await(await escrow.connect(arbiter).resolveDispute(3,false)).wait();if(await usdc.balanceOf(sellerAddr)!==pre3)throw Error('arbiter refund mismatch');

  // Seller can recover a never-paid expired escrow.
  const pre4=await usdc.balanceOf(sellerAddr);await(await escrow.createTrade(buyerAddr,amount,600)).wait();await provider.send('evm_increaseTime',[601]);await provider.send('evm_mine',[]);await(await escrow.cancelExpired(4)).wait();if(await usdc.balanceOf(sellerAddr)!==pre4)throw Error('expired refund mismatch');

  // Pausing blocks only new escrows, not existing lifecycle.
  await(await escrow.connect(arbiter).setNewTradesPaused(true)).wait();await mustRevert(()=>escrow.createTrade(buyerAddr,amount,900),'paused create');await(await escrow.connect(arbiter).setNewTradesPaused(false)).wait();

  // Two-step arbiter rotation.
  const next=await nextArbiter.getAddress();await(await escrow.connect(arbiter).proposeArbiter(next)).wait();await mustRevert(()=>escrow.connect(buyer).acceptArbiter(),'wrong arbiter accept');await(await escrow.connect(nextArbiter).acceptArbiter()).wait();if((await escrow.arbiter()).toLowerCase()!==next.toLowerCase())throw Error('arbiter rotation failed');

  console.log('MASTERLAWEX P2P ESCROW V1 TEST PASS');
})().catch(e=>{console.error(e);process.exit(1)});
