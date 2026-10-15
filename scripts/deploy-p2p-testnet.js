const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const SUPPORTED_TESTNETS = new Map([
  [5042002n, { name: 'Arc Testnet', explorer: 'https://explorer.testnet.arc.io' }],
  [84532n, { name: 'Base Sepolia', explorer: 'https://sepolia.basescan.org' }]
]);

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
  const rpcUrl = required('P2P_RPC_URL');
  const privateKey = required('P2P_DEPLOYER_PRIVATE_KEY');
  const asset = addressEnv('P2P_ASSET_ADDRESS');
  const arbiter = addressEnv('P2P_ARBITER_ADDRESS');
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  const chainId = BigInt(network.chainId);
  const target = SUPPORTED_TESTNETS.get(chainId);

  if (!target) {
    throw new Error(`Refusing deployment on chain ${chainId}. Only Arc Testnet (5042002) and Base Sepolia (84532) are allowed.`);
  }

  const expectedChain = String(process.env.P2P_EXPECTED_CHAIN_ID || '').trim();
  if (expectedChain && BigInt(expectedChain) !== chainId) {
    throw new Error(`RPC chain mismatch: expected ${expectedChain}, got ${chainId}`);
  }

  const assetCode = await provider.getCode(asset);
  if (assetCode === '0x') throw new Error('P2P_ASSET_ADDRESS is not a deployed contract');

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
    throw new Error('Arbiter is an EOA. Use a multisig/smart-account address, or explicitly set P2P_ALLOW_EOA_ARBITER=true for sandbox-only testing.');
  }

  const artifactPath = path.join(__dirname, '..', 'build', 'artifacts.json');
  if (!fs.existsSync(artifactPath)) throw new Error('Missing build/artifacts.json. Run npm run build first.');
  const artifacts = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const artifact = artifacts.MasterlawEXP2PEscrow;
  if (!artifact?.abi || !artifact?.bytecode?.startsWith('0x')) throw new Error('MasterlawEXP2PEscrow artifact is missing or invalid');
  if (artifacts._meta?.schema !== 2) throw new Error('Artifact provenance metadata missing. Rebuild with the current compiler pipeline.');

  const wallet = new ethers.Wallet(privateKey, provider);
  const deployer = await wallet.getAddress();
  const nativeBalance = await provider.getBalance(deployer);
  if (nativeBalance === 0n) throw new Error('Deployer has no native testnet gas balance');

  console.log(`Network: ${target.name} (${chainId})`);
  console.log(`Deployer: ${deployer}`);
  console.log(`Asset: ${asset} (${symbol}, ${decimals} decimals)`);
  console.log(`Arbiter: ${arbiter}${arbiterCode === '0x' ? ' [EOA sandbox override]' : ' [contract/multisig]'}`);
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
  if (verifiedAsset !== asset || verifiedArbiter !== arbiter) throw new Error('Post-deploy constructor verification failed');

  const onChainCode = await provider.getCode(address);
  if (onChainCode === '0x') throw new Error('Deployment receipt confirmed but contract code is empty');

  const record = {
    schema: 1,
    contract: 'MasterlawEXP2PEscrow',
    network: target.name,
    chainId: chainId.toString(),
    address,
    deploymentTx: deploymentTx.hash,
    blockNumber: receipt.blockNumber,
    deployer,
    asset,
    assetSymbol: symbol,
    assetDecimals: decimals,
    arbiter,
    arbiterType: arbiterCode === '0x' ? 'EOA_SANDBOX_OVERRIDE' : 'CONTRACT_OR_MULTISIG',
    buildId: artifacts._meta.buildId,
    sourceHashes: artifacts._meta.sourceHashes,
    bytecodeSha256: artifact.bytecodeSha256
  };

  const outDir = path.join(__dirname, '..', 'build', 'deployments');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `p2p-${chainId}.json`);
  fs.writeFileSync(outFile, JSON.stringify(record, null, 2) + '\n');
  console.log(`Escrow deployed: ${address}`);
  console.log(`${target.explorer}/address/${address}`);
  console.log(`Deployment record: ${path.relative(process.cwd(), outFile)}`);
}

main().catch(error => {
  console.error(`P2P DEPLOY ABORTED: ${error.message}`);
  process.exit(1);
});
