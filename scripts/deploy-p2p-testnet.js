const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const EXPECTED_VERSION = '1.3.0-testnet';
const EXPECTED_ORDER_REF_DOMAIN = ethers.keccak256(ethers.toUtf8Bytes('MASTERLAWEX_P2P_ORDER_REF_V1'));
const ARC_TESTNET_CHAIN_ID = 5042002n;
const ARC_TESTNET = {
  name: 'Arc Testnet',
  rpc: 'https://rpc.testnet.arc.io',
  explorer: 'https://testnet.arcscan.app'
};

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function addressEnv(name) {
  try {
    return ethers.getAddress(required(name));
  } catch {
    throw new Error(`${name} must be a valid EVM address`);
  }
}

async function main() {
  const rpcUrl = String(process.env.P2P_RPC_URL || ARC_TESTNET.rpc).trim();
  const privateKey = required('P2P_DEPLOYER_PRIVATE_KEY');
  const asset = addressEnv('P2P_ASSET_ADDRESS');
  const arbiter = addressEnv('P2P_ARBITER_ADDRESS');
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  const chainId = BigInt(network.chainId);
  const target = ARC_TESTNET;

  if (chainId !== ARC_TESTNET_CHAIN_ID) {
    throw new Error(`Refusing deployment on chain ${chainId}. MasterlawEX is ARC-only and requires Arc Testnet chainId ${ARC_TESTNET_CHAIN_ID}.`);
  }

  const assetCode = await provider.getCode(asset);
  if (assetCode === '0x') throw new Error('P2P_ASSET_ADDRESS is not a deployed contract on Arc Testnet');

  const token = new ethers.Contract(asset, [
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)'
  ], provider);
  const decimals = Number(await token.decimals());
  if (decimals !== 6) throw new Error(`Escrow asset must use 6 decimals; got ${decimals}`);
  let symbol = 'UNKNOWN';
  try { symbol = await token.symbol(); } catch {}

  const arbiterCode = await provider.getCode(arbiter);
  const allowEoaArbiter = String(process.env.P2P_ALLOW_EOA_ARBITER || '').toLowerCase() === 'true';
  if (arbiterCode === '0x' && !allowEoaArbiter) {
    throw new Error('Arbiter is an EOA. Use a multisig/smart-account address, or explicitly set P2P_ALLOW_EOA_ARBITER=true for ARC sandbox-only testing.');
  }

  const artifactPath = path.join(__dirname, '..', 'build', 'artifacts.json');
  if (!fs.existsSync(artifactPath)) throw new Error('Missing build/artifacts.json. Run npm run build first.');
  const artifacts = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const artifact = artifacts.MasterlawEXP2PEscrow;
  if (!artifact?.abi || !artifact?.bytecode?.startsWith('0x')) throw new Error('MasterlawEXP2PEscrow artifact is missing or invalid');
  if (artifacts._meta?.schema !== 2) throw new Error('Artifact provenance metadata missing. Rebuild with the current compiler pipeline.');
  if (!artifact.bytecodeSha256 || !artifacts._meta?.sourceHashes?.['contracts/MasterlawEXP2PEscrow.sol']) {
    throw new Error('P2P artifact is missing source/bytecode attestations');
  }

  const wallet = new ethers.Wallet(privateKey, provider);
  const deployer = await wallet.getAddress();
  const nativeBalance = await provider.getBalance(deployer);
  if (nativeBalance === 0n) throw new Error('Deployer has no native Arc Testnet gas balance');

  console.log(`Network: ${target.name} (${chainId})`);
  console.log(`RPC: ${rpcUrl}`);
  console.log(`Deployer: ${deployer}`);
  console.log(`Asset: ${asset} (${symbol}, ${decimals} decimals)`);
  console.log(`Arbiter: ${arbiter}${arbiterCode === '0x' ? ' [EOA ARC sandbox override]' : ' [contract/multisig]'}`);
  console.log(`Build ID: ${artifacts._meta.buildId}`);

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy(asset, arbiter);
  const deploymentTx = contract.deploymentTransaction();
  console.log(`Deployment tx: ${deploymentTx.hash}`);
  console.log(`${target.explorer}/tx/${deploymentTx.hash}`);

  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const receipt = await deploymentTx.wait();
  const verifiedAsset = ethers.getAddress(await contract.asset());
  const verifiedArbiter = ethers.getAddress(await contract.arbiter());
  const verifiedVersion = await contract.VERSION();
  const verifiedDomain = await contract.ORDER_REF_DOMAIN();
  if (verifiedAsset !== asset || verifiedArbiter !== arbiter) throw new Error('Post-deploy constructor verification failed');
  if (verifiedVersion !== EXPECTED_VERSION) throw new Error(`Unexpected escrow runtime version: ${verifiedVersion}`);
  if (verifiedDomain !== EXPECTED_ORDER_REF_DOMAIN) throw new Error('Unexpected order-reference domain');

  const probeExternalId = ethers.keccak256(ethers.toUtf8Bytes('MASTERLAWEX_P2P_DEPLOY_PROBE'));
  const contractOrderRef = await contract.computeOrderRef(probeExternalId);
  const localOrderRef = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'uint256', 'address', 'bytes32'],
      [EXPECTED_ORDER_REF_DOMAIN, ARC_TESTNET_CHAIN_ID, address, probeExternalId]
    )
  );
  if (contractOrderRef !== localOrderRef) throw new Error('Post-deploy ARC order-reference derivation mismatch');

  const onChainCode = await provider.getCode(address);
  if (onChainCode === '0x') throw new Error('Deployment receipt confirmed but contract code is empty');

  const record = {
    schema: 2,
    contract: 'MasterlawEXP2PEscrow',
    version: verifiedVersion,
    network: target.name,
    chainId: ARC_TESTNET_CHAIN_ID.toString(),
    address,
    deploymentTx: deploymentTx.hash,
    blockNumber: receipt.blockNumber,
    deployer,
    asset,
    assetSymbol: symbol,
    assetDecimals: decimals,
    arbiter,
    arbiterType: arbiterCode === '0x' ? 'EOA_ARC_SANDBOX_OVERRIDE' : 'CONTRACT_OR_MULTISIG',
    orderRefDomain: verifiedDomain,
    buildId: artifacts._meta.buildId,
    sourceHashes: artifacts._meta.sourceHashes,
    bytecodeSha256: artifact.bytecodeSha256
  };

  const outDir = path.join(__dirname, '..', 'build', 'deployments');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'p2p-arc-testnet.json');
  fs.writeFileSync(outFile, JSON.stringify(record, null, 2) + '\n');
  console.log(`Escrow ${verifiedVersion} deployed on ARC: ${address}`);
  console.log(`${target.explorer}/address/${address}`);
  console.log(`Deployment record: ${path.relative(process.cwd(), outFile)}`);
}

main().catch(error => {
  console.error(`ARC P2P DEPLOY ABORTED: ${error.message}`);
  process.exit(1);
});
