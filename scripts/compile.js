const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const solc = require('solc');

const sha256 = value => '0x' + crypto.createHash('sha256').update(value).digest('hex');
const optimizer = { enabled: true, runs: 200 };
const core = fs.readFileSync(path.join(__dirname, '..', 'contracts', 'ARCXV2.sol'), 'utf8');
const p2p = fs.readFileSync(path.join(__dirname, '..', 'contracts', 'MasterlawEXP2PEscrow.sol'), 'utf8');
const p2pV14 = fs.readFileSync(path.join(__dirname, '..', 'contracts', 'MasterlawEXP2PEscrowV14.sol'), 'utf8');
const p2pV15 = fs.readFileSync(path.join(__dirname, '..', 'contracts', 'MasterlawEXP2PEscrowV15.sol'), 'utf8');
const sourceHashes = {
  'contracts/ARCXV2.sol': sha256(core),
  'contracts/MasterlawEXP2PEscrow.sol': sha256(p2p),
  'contracts/MasterlawEXP2PEscrowV14.sol': sha256(p2pV14),
  'contracts/MasterlawEXP2PEscrowV15.sol': sha256(p2pV15)
};
const buildDescriptor = {
  compiler: solc.version(),
  optimizer,
  sourceHashes
};
const input = {
  language: 'Solidity',
  sources: {
    'ARCXV2.sol': { content: core },
    'MasterlawEXP2PEscrow.sol': { content: p2p },
    'MasterlawEXP2PEscrowV14.sol': { content: p2pV14 },
    'MasterlawEXP2PEscrowV15.sol': { content: p2pV15 }
  },
  settings: {
    optimizer,
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.methodIdentifiers'] } }
  }
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
for (const e of output.errors || []) console.log(e.severity.toUpperCase(), e.formattedMessage);
if ((output.errors || []).some(e => e.severity === 'error')) process.exit(1);
const specs = [
  ['ARCXV2.sol','ARCXTokenFactory'],['ARCXV2.sol','ARCXMarketFactory'],['ARCXV2.sol','ARCXRouter'],['ARCXV2.sol','ARCXPair'],['ARCXV2.sol','ARCXToken'],
  ['MasterlawEXP2PEscrow.sol','MasterlawEXP2PEscrow'],
  ['MasterlawEXP2PEscrowV14.sol','MasterlawEXP2PEscrowV14'],
  ['MasterlawEXP2PEscrowV15.sol','MasterlawEXP2PEscrowV15']
];
const artifacts = {
  _meta: {
    schema: 2,
    buildId: sha256(JSON.stringify(buildDescriptor)),
    ...buildDescriptor
  }
};
for (const [file,name] of specs) {
  const c = output.contracts[file][name];
  const bytecode = '0x' + c.evm.bytecode.object;
  const deployedBytecode = '0x' + c.evm.deployedBytecode.object;
  artifacts[name] = {
    source: 'contracts/' + file,
    abi: c.abi,
    methodIdentifiers: c.evm.methodIdentifiers || {},
    bytecode,
    deployedBytecode,
    bytecodeSha256: sha256(bytecode),
    deployedBytecodeSha256: sha256(deployedBytecode)
  };
  console.log(`${name}: bytecode ${c.evm.bytecode.object.length / 2} bytes, runtime ${c.evm.deployedBytecode.object.length / 2} bytes, sha256 ${artifacts[name].bytecodeSha256.slice(0,18)}…`);
}
fs.mkdirSync(path.join(__dirname, '..', 'build'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'build', 'artifacts.json'), JSON.stringify(artifacts, null, 2) + '\n');
console.log(`MASTERLAWEX BUILD PASS · ${artifacts._meta.buildId}`);
