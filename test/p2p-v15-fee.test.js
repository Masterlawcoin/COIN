const { ethers } = require('ethers');
const ganache = require('ganache');
const fs = require('fs');
const path = require('path');
const solc = require('solc');

function compile() {
  const escrow = fs.readFileSync(path.join(__dirname, '..', 'contracts', 'MasterlawEXP2PEscrowV15.sol'), 'utf8');
  const mock = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract MockUSDCV15 {
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
  const input={language:'Solidity',sources:{'E.sol':{content:escrow},'M.sol':{content:mock}},settings:{optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}};
  const out=JSON.parse(solc.compile(JSON.stringify(input)));
  const errs=(out.errors||[]).filter(e=>e.severity==='error');
  if(errs.length)throw Error(errs.map(e=>e.formattedMessage).join('\n'));
  const e=out.contracts['E.sol'].MasterlawEXP2PEscrowV15,m=out.contracts['M.sol'].MockUSDCV15;
  return {E:{abi:e.abi,bytecode:'0x'+e.evm.bytecode.object},M:{abi:m.abi,bytecode:'0x'+m.evm.bytecode.object}};
}
async function mustRevert(fn,label){let ok=false;try{const r=await fn();if(r?.wait)await r.wait()}catch{ok=true}if(!ok)throw Error('expected revert: '+label)}
function eq(a,b,label){if(a!==b)throw Error(`${label}: expected ${b}, got ${a}`)}

(async()=>{
  const C=compile();
  const gp=ganache.provider({logging:{quiet:true}});
  const provider=new ethers.BrowserProvider(gp);
  const seller=await provider.getSigner(0),buyer=await provider.getSigner(1),arbiter=await provider.getSigner(2),treasury=await provider.getSigner(3),outsider=await provider.getSigner(4);
  const sellerAddr=await seller.getAddress(),buyerAddr=await buyer.getAddress(),arbiterAddr=await arbiter.getAddress(),treasuryAddr=await treasury.getAddress();
  const deploy=async(artifact,args=[],signer=seller)=>{const c=await new ethers.ContractFactory(artifact.abi,artifact.bytecode,signer).deploy(...args);await c.waitForDeployment();return c};
  const usdc=await deploy(C.M),usdcAddr=await usdc.getAddress();
  await mustRevert(()=>deploy(C.E,[usdcAddr,arbiterAddr,ethers.ZeroAddress]),'zero treasury');
  const escrow=await deploy(C.E,[usdcAddr,arbiterAddr,treasuryAddr]),escrowAddr=await escrow.getAddress();
  await (await usdc.approve(escrowAddr,ethers.MaxUint256)).wait();

  const amount=ethers.parseUnits('100',6),fee=ethers.parseUnits('1',6),lock=ethers.parseUnits('101',6);
  let nonce=1;
  const ext=label=>ethers.keccak256(ethers.toUtf8Bytes(`masterlaw:p2p:v15:${label}:${nonce++}`));
  const create=async(value=amount,timeout=900)=>{const id=await escrow.nextTradeId();await (await escrow.createTrade(buyerAddr,value,timeout,ext('trade'))).wait();return id};

  eq(await escrow.VERSION(),'1.5.0-testnet','version');
  eq(await escrow.FEE_BPS(),100n,'fee bps');
  eq(await escrow.BPS_DENOMINATOR(),10000n,'bps denominator');
  eq(await escrow.feeTreasury(),treasuryAddr,'treasury');
  eq(await escrow.quoteFee(amount),fee,'100 USDC => 1 USDC fee');
  eq(await escrow.quoteLockAmount(amount),lock,'100 USDC => seller locks 101');
  eq(await escrow.ORDER_REF_DOMAIN(),ethers.keccak256(ethers.toUtf8Bytes('MASTERLAWEX_P2P_ORDER_REF_V1')),'order domain');
  eq(await escrow.SPLIT_DOMAIN(),ethers.keccak256(ethers.toUtf8Bytes('MASTERLAWEX_P2P_MUTUAL_SPLIT_V1')),'split domain');

  const fnNames=C.E.abi.filter(x=>x.type==='function').map(x=>x.name);
  for(const forbidden of ['withdraw','sweep','emergencyWithdraw','adminWithdraw'])if(fnNames.includes(forbidden))throw Error('forbidden admin withdrawal function: '+forbidden);

  // Successful sale: buyer receives exact advertised amount; treasury receives 1%; seller funded amount+fee.
  const sellerBefore1=await usdc.balanceOf(sellerAddr),buyerBefore1=await usdc.balanceOf(buyerAddr),treasuryBefore1=await usdc.balanceOf(treasuryAddr);
  const t1=await create();
  eq(sellerBefore1-(await usdc.balanceOf(sellerAddr)),lock,'seller lock amount+fee');
  const row1=await escrow.trades(t1);eq(row1.amount,amount,'trade amount');eq(row1.feeReserved,fee,'fee reserve');
  await (await escrow.connect(buyer).markPaymentSent(t1)).wait();
  await (await escrow.release(t1)).wait();
  eq((await usdc.balanceOf(buyerAddr))-buyerBefore1,amount,'buyer receives full advertised USDC');
  eq((await usdc.balanceOf(treasuryAddr))-treasuryBefore1,fee,'Masterlaw receives 1% USDC');
  eq(await usdc.balanceOf(escrowAddr),0n,'escrow empty after release');

  // Buyer cancellation: full amount+fee returns to seller, treasury gets nothing.
  const sellerBefore2=await usdc.balanceOf(sellerAddr),treasuryBefore2=await usdc.balanceOf(treasuryAddr);
  const t2=await create();
  await (await escrow.connect(buyer).cancelByBuyer(t2)).wait();
  eq(await usdc.balanceOf(sellerAddr),sellerBefore2,'cancel returns amount+fee');
  eq(await usdc.balanceOf(treasuryAddr),treasuryBefore2,'cancel has no fee');

  // Arbitration refund: no fee; arbitration release: full 1% fee.
  const sellerBefore3=await usdc.balanceOf(sellerAddr),treasuryBefore3=await usdc.balanceOf(treasuryAddr);
  const t3=await create();
  await (await escrow.connect(arbiter).openDisputeByArbiter(t3,ethers.keccak256(ethers.toUtf8Bytes('CASE:refund')))).wait();
  await (await escrow.connect(arbiter).resolveDispute(t3,false,ethers.keccak256(ethers.toUtf8Bytes('RES:refund')))).wait();
  eq(await usdc.balanceOf(sellerAddr),sellerBefore3,'arbiter refund returns reserve');
  eq(await usdc.balanceOf(treasuryAddr),treasuryBefore3,'refund fee zero');

  const buyerBefore4=await usdc.balanceOf(buyerAddr),treasuryBefore4=await usdc.balanceOf(treasuryAddr);
  const t4=await create();
  await (await escrow.connect(arbiter).openDisputeByArbiter(t4,ethers.keccak256(ethers.toUtf8Bytes('CASE:release')))).wait();
  await (await escrow.connect(arbiter).resolveDispute(t4,true,ethers.keccak256(ethers.toUtf8Bytes('RES:release')))).wait();
  eq((await usdc.balanceOf(buyerAddr))-buyerBefore4,amount,'arbiter buyer payout');
  eq((await usdc.balanceOf(treasuryAddr))-treasuryBefore4,fee,'arbiter release fee 1%');

  // Partial mutual settlement charges 1% only on the crypto actually delivered to buyer.
  const t5=await create();
  await (await escrow.connect(buyer).openDispute(t5)).wait();
  const buyerShare=ethers.parseUnits('40',6),partialFee=ethers.parseUnits('0.4',6),sellerRefund=ethers.parseUnits('60.6',6);
  const agreement=ethers.keccak256(ethers.toUtf8Bytes('AGREEMENT:40-60'));
  const buyerBefore5=await usdc.balanceOf(buyerAddr),sellerBefore5=await usdc.balanceOf(sellerAddr),treasuryBefore5=await usdc.balanceOf(treasuryAddr);
  await (await escrow.proposeMutualSplit(t5,buyerShare,agreement)).wait();
  await (await escrow.connect(buyer).approveMutualSplit(t5,buyerShare,agreement)).wait();
  eq((await usdc.balanceOf(buyerAddr))-buyerBefore5,buyerShare,'partial buyer amount');
  eq((await usdc.balanceOf(treasuryAddr))-treasuryBefore5,partialFee,'partial 1% fee');
  eq((await usdc.balanceOf(sellerAddr))-sellerBefore5,sellerRefund,'unused amount+fee reserve refunded');
  eq((await escrow.trades(t5)).state,7n,'partial settled');

  // 0-to-buyer split is a pure refund: no fee.
  const t6=await create();
  await (await escrow.connect(buyer).openDispute(t6)).wait();
  const treasuryBefore6=await usdc.balanceOf(treasuryAddr),sellerBefore6=await usdc.balanceOf(sellerAddr);
  const zeroAgreement=ethers.keccak256(ethers.toUtf8Bytes('AGREEMENT:zero-buyer'));
  await (await escrow.proposeMutualSplit(t6,0,zeroAgreement)).wait();
  await (await escrow.connect(buyer).approveMutualSplit(t6,0,zeroAgreement)).wait();
  eq(await usdc.balanceOf(treasuryAddr),treasuryBefore6,'zero buyer amount has zero fee');
  eq((await usdc.balanceOf(sellerAddr))-sellerBefore6,lock,'zero buyer amount refunds full lock');

  // Fee-on-transfer tokens are rejected on funding and settlement remains atomic.
  await (await usdc.setFeeBps(100)).wait();
  const nextBefore=await escrow.nextTradeId();
  await mustRevert(()=>escrow.createTrade(buyerAddr,amount,900,ext('fee-on-transfer')),'fee-on-transfer funding');
  eq(await escrow.nextTradeId(),nextBefore,'failed funding rolls back id');
  await (await usdc.setFeeBps(0)).wait();

  const t7=await create();await (await escrow.connect(buyer).markPaymentSent(t7)).wait();
  await (await usdc.setFeeBps(100)).wait();
  await mustRevert(()=>escrow.release(t7),'fee-on-transfer settlement');
  eq((await escrow.trades(t7)).state,2n,'failed settlement rolls state back');
  await (await usdc.setFeeBps(0)).wait();
  await (await escrow.release(t7)).wait();

  await mustRevert(()=>escrow.connect(outsider).setNewTradesPaused(true),'only arbiter pause');
  console.log('P2P V1.5 1% FEE TEST PASS');
})().catch(e=>{console.error(e);process.exit(1)});
