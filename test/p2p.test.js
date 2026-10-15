const { ethers } = require('ethers');
const ganache = require('ganache');
const fs = require('fs');
const path = require('path');
const solc = require('solc');

function compile() {
  const escrow = fs.readFileSync(path.join(__dirname, '..', 'contracts', 'MasterlawEXP2PEscrow.sol'), 'utf8');
  const mock = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract MockUSDC {
  string public name='USD Coin'; string public symbol='USDC'; uint8 public constant decimals=6;
  uint public totalSupply; mapping(address=>uint) public balanceOf; mapping(address=>mapping(address=>uint)) public allowance;
  bool public failTransfer; bool public failTransferFrom; uint public feeBps;
  event Transfer(address indexed from,address indexed to,uint value); event Approval(address indexed owner,address indexed spender,uint value);
  constructor(){_mint(msg.sender,1000000e6);}
  function setFailures(bool transferFail,bool transferFromFail) external { failTransfer=transferFail; failTransferFrom=transferFromFail; }
  function setFeeBps(uint bps) external { require(bps<=1000,'fee'); feeBps=bps; }
  function _mint(address to,uint a) internal { balanceOf[to]+=a; totalSupply+=a; emit Transfer(address(0),to,a); }
  function transfer(address to,uint a) external returns(bool){ if(failTransfer)return false; _move(msg.sender,to,a); return true; }
  function approve(address s,uint a) external returns(bool){ allowance[msg.sender][s]=a; emit Approval(msg.sender,s,a); return true; }
  function transferFrom(address f,address t,uint a) external returns(bool){ if(failTransferFrom)return false; uint x=allowance[f][msg.sender]; require(x>=a,'allowance'); if(x!=type(uint).max)allowance[f][msg.sender]=x-a; _move(f,t,a); return true; }
  function _move(address f,address t,uint a) internal { require(balanceOf[f]>=a,'balance'); uint fee=a*feeBps/10000; uint net=a-fee; balanceOf[f]-=a; balanceOf[t]+=net; if(fee>0)totalSupply-=fee; emit Transfer(f,t,net); if(fee>0)emit Transfer(f,address(0),fee); }
}`;
  const input = {
    language: 'Solidity',
    sources: { 'E.sol': { content: escrow }, 'M.sol': { content: mock } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } }
    }
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errs = (out.errors || []).filter(e => e.severity === 'error');
  if (errs.length) throw Error(errs.map(e => e.formattedMessage).join('\n'));
  const e = out.contracts['E.sol'].MasterlawEXP2PEscrow;
  const m = out.contracts['M.sol'].MockUSDC;
  return {
    E: { abi: e.abi, bytecode: '0x' + e.evm.bytecode.object },
    M: { abi: m.abi, bytecode: '0x' + m.evm.bytecode.object }
  };
}

async function mustRevert(fn, label) {
  let reverted = false;
  try {
    const result = await fn();
    if (result && typeof result.wait === 'function') await result.wait();
  } catch {
    reverted = true;
  }
  if (!reverted) throw Error('expected revert: ' + label);
}

function equal(actual, expected, label) {
  if (actual !== expected) throw Error(`${label}: expected ${expected}, got ${actual}`);
}

(async () => {
  const C = compile();
  const gp = ganache.provider({ logging: { quiet: true } });
  const provider = new ethers.BrowserProvider(gp);
  const seller = await provider.getSigner(0);
  const buyer = await provider.getSigner(1);
  const arbiter = await provider.getSigner(2);
  const nextArbiter = await provider.getSigner(3);
  const outsider = await provider.getSigner(4);
  const sellerAddr = await seller.getAddress();
  const buyerAddr = await buyer.getAddress();
  const arbiterAddr = await arbiter.getAddress();
  const outsiderAddr = await outsider.getAddress();

  const deploy = async (artifact, args = [], signer = seller) => {
    const c = await new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer).deploy(...args);
    await c.waitForDeployment();
    return c;
  };

  const usdc = await deploy(C.M);
  const usdcAddr = await usdc.getAddress();
  const escrow = await deploy(C.E, [usdcAddr, arbiterAddr]);
  const escrowAddr = await escrow.getAddress();
  const amount = ethers.parseUnits('100', 6);
  await (await usdc.approve(escrowAddr, ethers.MaxUint256)).wait();

  let refNonce = 1;
  const makeRef = label => ethers.keccak256(ethers.toUtf8Bytes(`masterlawex:p2p:${label}`));
  const freshRef = label => makeRef(`${label}:${refNonce++}`);
  const create = async (timeout = 900, value = amount, who = buyerAddr, reference = freshRef('trade')) => {
    const id = await escrow.nextTradeId();
    await (await escrow.createTrade(who, value, timeout, reference)).wait();
    const stored = await escrow.trades(id);
    equal(stored.orderRef, reference, 'trade reference stored');
    equal(await escrow.tradeIdByReference(reference), id, 'reference reverse lookup');
    return id;
  };

  // Constructor and creation guardrails.
  await mustRevert(() => deploy(C.E, [ethers.ZeroAddress, arbiterAddr]), 'zero asset');
  await mustRevert(() => deploy(C.E, [sellerAddr, arbiterAddr]), 'EOA asset');
  await mustRevert(() => deploy(C.E, [usdcAddr, ethers.ZeroAddress]), 'zero arbiter');
  await mustRevert(() => escrow.createTrade(ethers.ZeroAddress, amount, 900, freshRef('zero-buyer')), 'zero buyer');
  await mustRevert(() => escrow.createTrade(sellerAddr, amount, 900, freshRef('self-buyer')), 'seller equals buyer');
  await mustRevert(() => escrow.createTrade(buyerAddr, 0, 900, freshRef('zero-amount')), 'zero amount');
  await mustRevert(() => escrow.createTrade(buyerAddr, amount, 599, freshRef('short-timeout')), 'timeout too short');
  await mustRevert(() => escrow.createTrade(buyerAddr, amount, 86401, freshRef('long-timeout')), 'timeout too long');
  await mustRevert(() => escrow.createTrade(buyerAddr, amount, 900, ethers.ZeroHash), 'zero reference');

  // One off-chain order reference can bind to exactly one escrow for the lifetime of the contract.
  const duplicateRef = freshRef('duplicate-reference');
  const duplicateTrade = await create(904, amount + 4n, buyerAddr, duplicateRef);
  await mustRevert(() => escrow.createTrade(buyerAddr, amount + 5n, 905, duplicateRef), 'duplicate reference');
  equal(await escrow.tradeIdByReference(duplicateRef), duplicateTrade, 'duplicate reference remains bound to original trade');
  await (await escrow.connect(buyer).cancelByBuyer(duplicateTrade)).wait();

  // Exact funding: a fee-on-transfer asset cannot make escrow accounting insolvent.
  const nextBeforeFee = await escrow.nextTradeId();
  const escrowBeforeFee = await usdc.balanceOf(escrowAddr);
  const feeFundingRef = freshRef('fee-funding');
  await (await usdc.setFeeBps(100)).wait();
  await mustRevert(() => escrow.createTrade(buyerAddr, amount + 2n, 901, feeFundingRef), 'fee-on-transfer funding');
  equal(await escrow.nextTradeId(), nextBeforeFee, 'failed fee funding rolls back trade id');
  equal(await escrow.tradeIdByReference(feeFundingRef), 0n, 'failed fee funding rolls back reference binding');
  equal(await usdc.balanceOf(escrowAddr), escrowBeforeFee, 'failed fee funding rolls back balance');
  await (await usdc.setFeeBps(0)).wait();

  // Use dedicated trades for expected reverts so Ganache cannot reuse a stale eth_estimateGas rejection
  // when the same calldata later becomes valid after a state/time change.
  const preReleaseTrade = await create();
  await mustRevert(() => escrow.release(preReleaseTrade), 'seller cannot release before payment');
  await (await escrow.connect(buyer).cancelByBuyer(preReleaseTrade)).wait();

  // Happy path: seller funds -> buyer marks paid -> seller releases.
  const trade1 = await create();
  equal(await usdc.balanceOf(escrowAddr), amount, 'escrow funding');
  await mustRevert(() => escrow.connect(buyer).release(trade1), 'buyer cannot release');
  await mustRevert(() => escrow.connect(outsider).markPaymentSent(trade1), 'outsider cannot mark payment');
  await (await escrow.connect(buyer).markPaymentSent(trade1)).wait();
  await mustRevert(() => escrow.connect(buyer).markPaymentSent(trade1), 'duplicate payment mark');
  const buyerBefore = await usdc.balanceOf(buyerAddr);
  await (await escrow.release(trade1)).wait();
  equal((await usdc.balanceOf(buyerAddr)) - buyerBefore, amount, 'buyer release amount');
  equal((await escrow.trades(trade1)).state, 3n, 'released state');
  await mustRevert(() => escrow.release(trade1), 'double release');
  await mustRevert(() => escrow.connect(buyer).cancelByBuyer(trade1), 'cancel released trade');
  await mustRevert(() => escrow.connect(buyer).openDispute(trade1), 'dispute released trade');

  // Buyer cancellation restores seller funds exactly.
  const sellerBefore2 = await usdc.balanceOf(sellerAddr);
  const trade2 = await create();
  await mustRevert(() => escrow.connect(outsider).cancelByBuyer(trade2), 'outsider buyer cancel');
  await (await escrow.connect(buyer).cancelByBuyer(trade2)).wait();
  equal(await usdc.balanceOf(sellerAddr), sellerBefore2, 'buyer cancel refund');
  equal((await escrow.trades(trade2)).state, 4n, 'cancelled state');
  await mustRevert(() => escrow.connect(buyer).cancelByBuyer(trade2), 'double cancel');

  // Early reclaim check uses its own trade; the real expired reclaim uses another trade id.
  const earlyExpiryTrade = await create(600);
  await mustRevert(() => escrow.cancelExpired(earlyExpiryTrade), 'early seller reclaim');
  await (await escrow.connect(buyer).cancelByBuyer(earlyExpiryTrade)).wait();

  const sellerBefore3 = await usdc.balanceOf(sellerAddr);
  const trade3 = await create(600);
  await provider.send('evm_increaseTime', [601]);
  await provider.send('evm_mine', []);
  await mustRevert(() => escrow.connect(buyer).markPaymentSent(trade3), 'late payment mark');
  await mustRevert(() => escrow.connect(outsider).cancelExpired(trade3), 'outsider expired reclaim');
  await (await escrow.cancelExpired(trade3)).wait();
  equal(await usdc.balanceOf(sellerAddr), sellerBefore3, 'expired seller refund');

  // Dispute freezes the normal lifecycle and only the arbiter can resolve.
  const trade4 = await create();
  await (await escrow.connect(buyer).markPaymentSent(trade4)).wait();
  await mustRevert(() => escrow.connect(outsider).openDispute(trade4), 'outsider dispute');
  await (await escrow.connect(buyer).openDispute(trade4)).wait();
  equal((await escrow.trades(trade4)).state, 5n, 'disputed state');
  await mustRevert(() => escrow.connect(buyer).openDispute(trade4), 'duplicate dispute');
  await mustRevert(() => escrow.release(trade4), 'release blocked after dispute');
  await mustRevert(() => escrow.connect(outsider).resolveDispute(trade4, true), 'non-arbiter resolution');
  const buyerBefore4 = await usdc.balanceOf(buyerAddr);
  await (await escrow.connect(arbiter).resolveDispute(trade4, true)).wait();
  equal((await usdc.balanceOf(buyerAddr)) - buyerBefore4, amount, 'arbiter release amount');
  await mustRevert(() => escrow.connect(arbiter).resolveDispute(trade4, false), 'duplicate resolution');

  // Refund branch returns the full escrow to seller.
  const sellerBefore5 = await usdc.balanceOf(sellerAddr);
  const trade5 = await create();
  await (await escrow.openDispute(trade5)).wait();
  await (await escrow.connect(arbiter).resolveDispute(trade5, false)).wait();
  equal(await usdc.balanceOf(sellerAddr), sellerBefore5, 'arbiter seller refund');
  equal((await escrow.trades(trade5)).state, 6n, 'refunded state');

  // ERC-20 failures must revert atomically; failed funding cannot consume the external reference.
  const transferFailRef = freshRef('transferfrom-failure');
  await (await usdc.setFailures(false, true)).wait();
  await mustRevert(() => escrow.createTrade(buyerAddr, amount + 1n, 900, transferFailRef), 'transferFrom false');
  equal(await escrow.tradeIdByReference(transferFailRef), 0n, 'transferFrom failure rolls back reference binding');
  await (await usdc.setFailures(false, false)).wait();
  const trade6 = await create();
  await (await escrow.connect(buyer).markPaymentSent(trade6)).wait();
  await (await usdc.setFailures(true, false)).wait();
  await mustRevert(() => escrow.release(trade6), 'transfer false on release');
  equal((await escrow.trades(trade6)).state, 2n, 'failed release state rollback');
  await (await usdc.setFailures(false, false)).wait();
  await (await escrow.openDispute(trade6)).wait();
  await (await escrow.connect(arbiter).resolveDispute(trade6, false)).wait();
  equal((await escrow.trades(trade6)).state, 6n, 'failed-release trade safely resolved');

  // Exact payout: a token that begins charging a fee after funding cannot short-change the recipient.
  const tradeFeeOut = await create(902, amount + 3n);
  await (await escrow.connect(buyer).markPaymentSent(tradeFeeOut)).wait();
  const escrowBeforeFeeOut = await usdc.balanceOf(escrowAddr);
  const buyerBeforeFeeOut = await usdc.balanceOf(buyerAddr);
  await (await usdc.setFeeBps(100)).wait();
  await mustRevert(() => escrow.release(tradeFeeOut), 'fee-on-transfer payout');
  equal((await escrow.trades(tradeFeeOut)).state, 2n, 'fee payout state rollback');
  equal(await usdc.balanceOf(escrowAddr), escrowBeforeFeeOut, 'fee payout escrow balance rollback');
  equal(await usdc.balanceOf(buyerAddr), buyerBeforeFeeOut, 'fee payout recipient balance rollback');
  await (await usdc.setFeeBps(0)).wait();
  await (await escrow.openDispute(tradeFeeOut)).wait();
  await (await escrow.connect(arbiter).resolveDispute(tradeFeeOut, false)).wait();

  // Pausing blocks only new trades; existing escrow lifecycle remains available.
  const trade7 = await create();
  await mustRevert(() => escrow.connect(outsider).setNewTradesPaused(true), 'non-arbiter pause');
  await (await escrow.connect(arbiter).setNewTradesPaused(true)).wait();
  await mustRevert(() => escrow.createTrade(buyerAddr, amount, 900, freshRef('paused-create')), 'paused create');
  await (await escrow.connect(buyer).cancelByBuyer(trade7)).wait();
  await (await escrow.connect(arbiter).setNewTradesPaused(false)).wait();

  // Two-step arbiter rotation: invalid proposals rejected; old arbiter loses authority after acceptance.
  await mustRevert(() => escrow.connect(outsider).proposeArbiter(outsiderAddr), 'non-arbiter proposal');
  await mustRevert(() => escrow.connect(arbiter).proposeArbiter(ethers.ZeroAddress), 'zero arbiter proposal');
  await mustRevert(() => escrow.connect(arbiter).proposeArbiter(arbiterAddr), 'same arbiter proposal');
  const next = await nextArbiter.getAddress();
  await (await escrow.connect(arbiter).proposeArbiter(next)).wait();
  await mustRevert(() => escrow.connect(buyer).acceptArbiter(), 'wrong arbiter accept');
  await (await escrow.connect(nextArbiter).acceptArbiter()).wait();
  equal((await escrow.arbiter()).toLowerCase(), next.toLowerCase(), 'arbiter rotation');
  equal(await escrow.pendingArbiter(), ethers.ZeroAddress, 'pending arbiter cleared');
  await mustRevert(() => escrow.connect(arbiter).setNewTradesPaused(true), 'old arbiter authority removed');
  await (await escrow.connect(nextArbiter).setNewTradesPaused(true)).wait();
  await (await escrow.connect(nextArbiter).setNewTradesPaused(false)).wait();

  console.log('MASTERLAWEX P2P ESCROW V1.2 ADVERSARIAL TEST PASS');
})().catch(e => {
  console.error(e);
  process.exit(1);
});
