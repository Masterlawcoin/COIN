const fs = require('fs');
const path = require('path');
const solc = require('solc');

const source = fs.readFileSync(path.join(__dirname, '..', 'contracts', 'ARCXV2.sol'), 'utf8');
const input = {
  language: 'Solidity',
  sources: { 'ARCXV2.sol': { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } }
  }
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
for (const e of output.errors || []) console.log(e.severity.toUpperCase(), e.formattedMessage);
if ((output.errors || []).some(e => e.severity === 'error')) process.exit(1);
const names = ['ARCXTokenFactory','ARCXMarketFactory','ARCXRouter','ARCXPair','ARCXToken'];
const artifacts = {};
for (const name of names) {
  const c = output.contracts['ARCXV2.sol'][name];
  artifacts[name] = {
    abi: c.abi,
    bytecode: '0x' + c.evm.bytecode.object,
    deployedBytecode: '0x' + c.evm.deployedBytecode.object
  };
  console.log(`${name}: bytecode ${c.evm.bytecode.object.length / 2} bytes, runtime ${c.evm.deployedBytecode.object.length / 2} bytes`);
}
fs.mkdirSync(path.join(__dirname, '..', 'build'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'build', 'artifacts.json'), JSON.stringify(artifacts, null, 2));
console.log('BUILD PASS');
