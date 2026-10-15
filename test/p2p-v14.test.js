const { ethers } = require('ethers');
const ganache = require('ganache');
const fs = require('fs');
const path = require('path');
const solc = require('solc');

function compile() {
  const escrow = fs.readFileSync(path.join(__dirname, '..', 'contracts', 'MasterlawEXP2PEscrowV14.sol'), 'utf8');
  const mock = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract MockUSDCV14 {
  string public symbol='USDC'; uint8 public constant decimals=6;
  uint public totalSupply; mapping(address=>uint) public balanceOf; mapping(address=>mapping(address=>uint)) public allowance;
  bool public failTransfer; bool public failTransferFrom; uint public feeBps;
  event Transfer(address indexed from,address indexed to,uint value); event Approval(address indexed owner,address indexed spender,uint value);
  constructor(){_mint(msg.sender,1000000e6);}
  function setFailures(bool a,bool b) external { failTransfer=a; failTransferFrom=b; }
  function setFeeBps(uint bps) external { require(bps<=1000,'fee'); feeBps=bps; }
  function _mint(address to,uint a) internal { balanceOf[to]+=a; totalSupply+=a; emit Transfer(address(0),to,a); }
  function transfer(address to,uint a) external returns(bool){ if(failTransfer)return false; _move(msg.sender,to,a); return true; }
  function approve(address s,uint a) external returns(bool){ allowance[msg.sender][s]=a; emit Approval(msg.sender,s,a); return true; }
  function transferFrom(address f,address t,uint a) external returns(bool){ if(failTransferFrom)return false; uint x=allowance[f][msg.sender]; require(x>=a,'allowance'); if(x!=type(uint).max)allowance[f][msg.sender]=x-a; _move(f,t,a); return true; }
  function _move(address f,address t,uint a) internal { require(balanceOf[f]>=a,'balance'); uint fee=a*feeBps/10000; uint net=a-fee; balanceOf[f]-=a; balanceOf[t]+=net; if(fee>0)totalSupply-=fee; emit Transfer(f,t,net); if(fee>0)emit Transfer(f,address(0),fee); }
}`;
  const input = {
    language:'Solidity',
    sources:{'E.sol':{content:escrow},'M.sol':{content:mock}},
    settings:{optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errs = (out.errors || []).filter(e => e.severity === 'error');
  if (errs.length) throw Error(errs.map(e => e.formattedMessage).join('\n'));
  const e = out.contracts['E.sol'].MasterlawEXP2PEscrowV14;
  const m = out.contracts['M.sol'].MockUSDCV14;
  return {E:{abi:e.abi,bytecode:'0x'+e.evm.bytecode.object},M:{abi:m.abi,bytecode:'0x'+m.evm.bytecode.object}};
}

async function mustRevert(fn,label){let ok=false;try{const r=await fn();if(r?.wait)await r.wait()}catch{ok=true}if(!ok)throw Error('expected revert: '+label)}
function eq(a,b,label){if(a!==b)throw Error(`${label}: expected ${b}, got ${a}`)}

(async()=>{
  const C=compile();
  const gp=ganache.provider({logging:{quiet:true}});
  const provider=new ethers.BrowserProvider(gp);
  const seller=await provider.getSigner(0),buyer=await provider.getSigner(1),arbiter=await provider.getSigner(2),outsider=await provider.getSigner(3),nextArbiter=await provider.getSigner(4);
  const sellerAddr=await seller.getAddress(),buyerAddr=await buyer.getAddress(),arbiterAddr=await arbiter.getAddress(),nextArbiterAddr=await nextArbiter.getAddress();
  const deploy=async(artifact,args=[],signer=seller)=>{const c=await new ethers.ContractFactory(artifact.abi,artifact.bytecode,signer).deploy(...args);await c.waitForDeployment();return c};
  const usdc=await deploy(C.M); const usdcAddr=await usdc.getAddress();
  const escrow=await deploy(C.E,[usdcAddr,arbiterAddr]); const escrowAddr=await escrow.getAddress();
  await (await usdc.approve(escrowAddr,ethers.MaxUint256)).wait();
  const amount=ethers.parseUnits('100',6);
  let nonce=1;
  const ext=label=>ethers.keccak256(ethers.toUtf8Bytes(`masterlaw:p2p:v14:${label}:${nonce++}`));
  const create=async(value=amount,timeout=900)=>{const id=await escrow.nextTradeId();await (await escrow.createTrade(buyerAddr,value,timeout,ext('trade'))).wait();return id};

  eq(await escrow.VERSION(),'1.4.0-testnet','version');
  eq(await escrow.ORDER_REF_DOMAIN(),ethers.keccak256(ethers.toUtf8Bytes('MASTERLAWEX_P2P_ORDER_REF_V1')),'order domain');
  eq(await escrow.SPLIT_DOMAIN(),ethers.keccak256(ethers.toUtf8Bytes('MASTERLAWEX_P2P_MUTUAL_SPLIT_V1')),'split domain');

  // No administrative sweep / withdrawal surface.
  const fnNames=C.E.abi.filter(x=>x.type==='function').map(x=>x.name);
  for(const forbidden of ['withdraw','sweep','emergencyWithdraw','adminWithdraw']) if(fnNames.includes(forbidden)) throw Error('forbidden admin withdrawal function: '+forbidden);

  // Masterlaw/multisig can freeze one specific funded trade and anchor the private case hash.
  const t1=await create();
  const caseHash=ethers.keccak256(ethers.toUtf8Bytes('MASTERLAW_CASE:opaque-1'));
  await mustRevert(()=>escrow.connect(outsider).openDisputeByArbiter(t1,caseHash),'outsider arbiter freeze');
  await mustRevert(()=>escrow.connect(arbiter).openDisputeByArbiter(t1,ethers.ZeroHash),'zero case hash');
  await (await escrow.connect(arbiter).openDisputeByArbiter(t1,caseHash)).wait();
  eq((await escrow.trades(t1)).state,5n,'arbiter freeze state');
  eq(await escrow.caseHashByTrade(t1),caseHash,'case hash stored');
  await mustRevert(()=>escrow.connect(buyer).cancelByBuyer(t1),'cancel blocked after freeze');
  await mustRevert(()=>escrow.release(t1),'release blocked after freeze');

  // Binary arbitration requires an auditable opaque resolution hash.
  const resolutionHash=ethers.keccak256(ethers.toUtf8Bytes('MASTERLAW_RESOLUTION:opaque-1'));
  await mustRevert(()=>escrow.connect(arbiter).resolveDispute(t1,true,ethers.ZeroHash),'zero resolution hash');
  await mustRevert(()=>escrow.connect(outsider).resolveDispute(t1,true,resolutionHash),'non-arbiter resolution');
  const buyerBefore1=await usdc.balanceOf(buyerAddr);
  await (await escrow.connect(arbiter).resolveDispute(t1,true,resolutionHash)).wait();
  eq((await usdc.balanceOf(buyerAddr))-buyerBefore1,amount,'buyer arbitration payout');
  eq(await escrow.resolutionHashByTrade(t1),resolutionHash,'resolution hash stored');
  eq((await escrow.trades(t1)).state,3n,'released state after arbitration');

  // Participant dispute still works and the arbiter can refund seller.
  const sellerBefore2=await usdc.balanceOf(sellerAddr);
  const t2=await create();
  await (await escrow.connect(buyer).openDispute(t2)).wait();
  const res2=ethers.keccak256(ethers.toUtf8Bytes('MASTERLAW_RESOLUTION:refund'));
  await (await escrow.connect(arbiter).resolveDispute(t2,false,res2)).wait();
  eq(await usdc.balanceOf(sellerAddr),sellerBefore2,'seller arbitration refund');
  eq((await escrow.trades(t2)).state,6n,'refunded state');

  // Mutual split requires two explicit on-chain approvals for the exact same proposal.
  const t3=await create();
  await (await escrow.connect(buyer).markPaymentSent(t3)).wait();
  const splitCase=ethers.keccak256(ethers.toUtf8Bytes('MASTERLAW_CASE:split'));
  await (await escrow.connect(arbiter).openDisputeByArbiter(t3,splitCase)).wait();
  const buyerShare=ethers.parseUnits('40',6),sellerShare=amount-buyerShare;
  const agreementHash=ethers.keccak256(ethers.toUtf8Bytes('MASTERLAW_AGREEMENT:40-60'));
  const buyerBefore3=await usdc.balanceOf(buyerAddr),sellerBefore3=await usdc.balanceOf(sellerAddr);
  await (await escrow.proposeMutualSplit(t3,buyerShare,agreementHash)).wait();
  eq(await escrow.splitSellerApproved(t3),true,'seller first approval');
  eq(await escrow.splitBuyerApproved(t3),false,'buyer not yet approved');
  eq(await usdc.balanceOf(buyerAddr),buyerBefore3,'no payout before second approval');
  await mustRevert(()=>escrow.connect(buyer).approveMutualSplit(t3,buyerShare+1n,agreementHash),'mismatched split');
  await (await escrow.connect(buyer).approveMutualSplit(t3,buyerShare,agreementHash)).wait();
  eq((await usdc.balanceOf(buyerAddr))-buyerBefore3,buyerShare,'mutual split buyer payout');
  eq((await usdc.balanceOf(sellerAddr))-sellerBefore3,sellerShare,'mutual split seller payout');
  eq((await escrow.trades(t3)).state,7n,'partial settlement state');
  eq(await escrow.resolutionHashByTrade(t3),agreementHash,'agreement hash anchors settlement');
  await mustRevert(()=>escrow.connect(buyer).approveMutualSplit(t3,buyerShare,agreementHash),'cannot approve settled trade');

  // Buyer may propose; seller must approve. Full buyer amount becomes Released, not partial Settled.
  const t4=await create();
  await (await escrow.connect(buyer).openDispute(t4)).wait();
  const agreementFull=ethers.keccak256(ethers.toUtf8Bytes('MASTERLAW_AGREEMENT:full-buyer'));
  const buyerBefore4=await usdc.balanceOf(buyerAddr);
  await (await escrow.connect(buyer).proposeMutualSplit(t4,amount,agreementFull)).wait();
  await (await escrow.approveMutualSplit(t4,amount,agreementFull)).wait();
  eq((await escrow.trades(t4)).state,3n,'full mutual buyer release state');
  eq((await usdc.balanceOf(buyerAddr))-buyerBefore4,amount,'full mutual buyer payout');

  // Pause blocks only new trades, not mediation of existing trades.
  const t5=await create();
  await (await escrow.connect(arbiter).setNewTradesPaused(true)).wait();
  await mustRevert(()=>escrow.createTrade(buyerAddr,amount,900,ext('paused')),'paused creation');
  await (await escrow.connect(arbiter).openDisputeByArbiter(t5,ethers.keccak256(ethers.toUtf8Bytes('MASTERLAW_CASE:paused-existing')))).wait();
  await (await escrow.connect(arbiter).setNewTradesPaused(false)).wait();

  // Arbiter rotation remains two-step.
  await mustRevert(()=>escrow.connect(outsider).proposeArbiter(nextArbiterAddr),'outsider proposes arbiter');
  await (await escrow.connect(arbiter).proposeArbiter(nextArbiterAddr)).wait();
  await mustRevert(()=>escrow.connect(outsider).acceptArbiter(),'wrong pending arbiter');
  await (await escrow.connect(nextArbiter).acceptArbiter()).wait();
  eq(await escrow.arbiter(),nextArbiterAddr,'arbiter rotated');

  // Fee-on-transfer funding remains rejected atomically.
  await (await usdc.setFeeBps(100)).wait();
  const nextBefore=await escrow.nextTradeId();
  await mustRevert(()=>escrow.createTrade(buyerAddr,amount,900,ext('fee')),'fee-on-transfer funding');
  eq(await escrow.nextTradeId(),nextBefore,'failed fee funding rolls back id');
  await (await usdc.setFeeBps(0)).wait();

  console.log('P2P V1.4 MEDIATION TEST PASS');
})().catch(e=>{console.error(e);process.exit(1)});
