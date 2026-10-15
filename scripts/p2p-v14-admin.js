const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const ARC_CHAIN_ID = 5042002n;
const ARC = {
  name: 'Arc Testnet',
  rpc: 'https://rpc.testnet.arc.io',
  explorer: 'https://testnet.arcscan.app',
  usdc: '0x3600000000000000000000000000000000000000'
};
const EXPECTED_VERSION = '1.4.0-testnet';
const EXPECTED_ORDER_DOMAIN = ethers.keccak256(ethers.toUtf8Bytes('MASTERLAWEX_P2P_ORDER_REF_V1'));
const EXPECTED_SPLIT_DOMAIN = ethers.keccak256(ethers.toUtf8Bytes('MASTERLAWEX_P2P_MUTUAL_SPLIT_V1'));

function arg(name, fallback = '') {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) return String(process.argv[i + 1]).trim();
  return String(process.env[name.toUpperCase().replaceAll('-', '_')] || fallback).trim();
}
function required(name) {
  const value = arg(name);
  if (!value) throw new Error(`Missing --${name} (or ${name.toUpperCase().replaceAll('-', '_')})`);
  return value;
}
function bytes32(value, label) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value || '') || /^0x0{64}$/i.test(value)) throw new Error(`${label} must be a non-zero bytes32`);
  return value.toLowerCase();
}
function positiveId(value) {
  if (!/^\d+$/.test(value || '') || BigInt(value) <= 0n) throw new Error('trade-id must be an integer greater than 0');
  return BigInt(value);
}
function json(value) {
  console.log(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
}

async function main() {
  const action = (arg('action', 'inspect') || 'inspect').toLowerCase();
  const rpcUrl = arg('rpc-url', ARC.rpc);
  const escrow = ethers.getAddress(required('escrow'));
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (BigInt(network.chainId) !== ARC_CHAIN_ID) throw new Error(`ARC-only: RPC chainId must be ${ARC_CHAIN_ID}`);
  if ((await provider.getCode(escrow)) === '0x') throw new Error('escrow address has no contract code');

  const artifactPath = path.join(__dirname, '..', 'build', 'artifacts.json');
  if (!fs.existsSync(artifactPath)) throw new Error('Missing build/artifacts.json; run npm run build');
  const artifacts = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const artifact = artifacts.MasterlawEXP2PEscrowV14;
  if (!artifact?.abi) throw new Error('MasterlawEXP2PEscrowV14 artifact missing');
  const contract = new ethers.Contract(escrow, artifact.abi, provider);

  const [version, asset, arbiter, orderDomain, splitDomain] = await Promise.all([
    contract.VERSION(), contract.asset(), contract.arbiter(), contract.ORDER_REF_DOMAIN(), contract.SPLIT_DOMAIN()
  ]);
  if (version !== EXPECTED_VERSION) throw new Error(`Unexpected VERSION(): ${version}`);
  if (ethers.getAddress(asset) !== ethers.getAddress(ARC.usdc)) throw new Error('asset() is not canonical ARC USDC');
  if (String(orderDomain).toLowerCase() !== EXPECTED_ORDER_DOMAIN.toLowerCase()) throw new Error('ORDER_REF_DOMAIN mismatch');
  if (String(splitDomain).toLowerCase() !== EXPECTED_SPLIT_DOMAIN.toLowerCase()) throw new Error('SPLIT_DOMAIN mismatch');

  const base = {
    network: ARC.name,
    chainId: ARC_CHAIN_ID,
    escrow,
    explorer: `${ARC.explorer}/address/${escrow}`,
    version,
    asset: ethers.getAddress(asset),
    arbiter: ethers.getAddress(arbiter),
    mode: 'PREPARE_ONLY_MULTISIG_SAFE',
    sendsTransaction: false
  };

  if (action === 'inspect') {
    const tradeId = positiveId(required('trade-id'));
    const trade = await contract.trades(tradeId);
    if (Number(trade.state) === 0) throw new Error(`trade ${tradeId} does not exist`);
    const [caseHash, resolutionHash, proposalHash, buyerAmount, sellerApproved, buyerApproved] = await Promise.all([
      contract.caseHashByTrade(tradeId),
      contract.resolutionHashByTrade(tradeId),
      contract.splitProposalHashByTrade(tradeId),
      contract.splitBuyerAmountByTrade(tradeId),
      contract.splitSellerApproved(tradeId),
      contract.splitBuyerApproved(tradeId)
    ]);
    return json({
      ...base,
      action: 'inspect',
      tradeId,
      trade: {
        seller: trade.seller,
        buyer: trade.buyer,
        amountBaseUnits: trade.amount,
        amountUSDC: ethers.formatUnits(trade.amount, 6),
        createdAt: Number(trade.createdAt),
        deadline: Number(trade.deadline),
        state: Number(trade.state),
        orderRef: trade.orderRef
      },
      mediation: { caseHash, resolutionHash },
      mutualSplit: { proposalHash, buyerAmountBaseUnits: buyerAmount, sellerApproved, buyerApproved }
    });
  }

  const iface = new ethers.Interface(artifact.abi);
  let functionName;
  let args;
  if (action === 'freeze') {
    const tradeId = positiveId(required('trade-id'));
    const caseHash = bytes32(required('case-hash'), 'case-hash');
    functionName = 'openDisputeByArbiter';
    args = [tradeId, caseHash];
  } else if (action === 'resolve') {
    const tradeId = positiveId(required('trade-id'));
    const decision = required('decision').toLowerCase();
    if (!['buyer', 'seller'].includes(decision)) throw new Error('decision must be buyer or seller');
    const resolutionHash = bytes32(required('resolution-hash'), 'resolution-hash');
    functionName = 'resolveDispute';
    args = [tradeId, decision === 'buyer', resolutionHash];
  } else if (action === 'pause') {
    const raw = required('paused').toLowerCase();
    if (!['true', 'false'].includes(raw)) throw new Error('paused must be true or false');
    functionName = 'setNewTradesPaused';
    args = [raw === 'true'];
  } else if (action === 'propose-arbiter') {
    functionName = 'proposeArbiter';
    args = [ethers.getAddress(required('next-arbiter'))];
  } else {
    throw new Error('action must be inspect, freeze, resolve, pause or propose-arbiter');
  }

  const data = iface.encodeFunctionData(functionName, args);
  return json({
    ...base,
    action,
    safeTransaction: {
      to: escrow,
      value: '0',
      data,
      operation: 0
    },
    requiredSigner: ethers.getAddress(arbiter),
    instruction: 'Submit this calldata through the configured Masterlaw arbiter multisig/smart-account. This tool never signs or broadcasts.'
  });
}

main().catch(error => {
  console.error(`MASTERLAW P2P V1.4 ADMIN ABORTED: ${error.message}`);
  process.exit(1);
});
