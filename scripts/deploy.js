const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function exportFrontend(addresses) {
  const FRONTEND_DIR = path.join(__dirname, "..", "frontend");
  const ABI_DIR = path.join(FRONTEND_DIR, "abis");
  const CONFIG_FILE = path.join(FRONTEND_DIR, "dao-config.js");

  if (!fs.existsSync(FRONTEND_DIR)) {
    console.warn("⚠️  FRONTEND_DIR no existe, omitiendo exportación al front:", FRONTEND_DIR);
    return;
  }
  if (!fs.existsSync(ABI_DIR)) {
    fs.mkdirSync(ABI_DIR, { recursive: true });
  }

  const contractNames = [
    "DAOCore",
    "DAODelegation",
    "DAOToken",
    "DAOViews",
    "SimpleMultiSig",
    "Staking",
    "Token",
  ];

  for (const name of contractNames) {
    const artifact = await hre.artifacts.readArtifact(name);
    const abiPath = path.join(ABI_DIR, `${name}.json`);
    fs.writeFileSync(abiPath, JSON.stringify(artifact.abi, null, 2));
    console.log(`✔ ABI exportada: ${abiPath}`);
  }

  const contractsConfig = {
    daoCore:       addresses.daoCore,
    daoDelegation: addresses.daoDelegation,
    daoToken:      addresses.daoToken,
    daoViews:      addresses.daoViews,
    staking:       addresses.staking,
    token:         addresses.token,
    multisigOwner: addresses.multisigOwner,
    multisigPanic: addresses.multisigPanic,
  };

  const configJs = `// AUTO-GENERADO por scripts/deploy.js — no editar a mano
export const CONTRACTS = ${JSON.stringify(contractsConfig, null, 2)};
`;
  fs.writeFileSync(CONFIG_FILE, configJs);
  console.log(`✔ Config de contratos exportada al front: ${CONFIG_FILE}`);
}

// ============================= DEPLOY ================================
async function main() {
  // Tomar las primeras 10 cuentas disponibles de Hardhat/Ganache
  const [
    deployer,
    owner1, owner2, owner3,
    panicOwner1, panicOwner2, panicOwner3,
    newOwner1, newOwner2, newOwner3
  ] = await hre.ethers.getSigners();

  console.log("Deploying with:", deployer.address);

  // 1) MULTISIG OWNER
  const SimpleMultiSig = await hre.ethers.getContractFactory("SimpleMultiSig");
  const owners = [owner1.address, owner2.address, owner3.address];
  const requiredConfirmations = 2;

  const multisigOwner = await SimpleMultiSig.deploy(owners, requiredConfirmations);
  await multisigOwner.waitForDeployment();
  console.log("✔ Multisig OWNER deployed at:", multisigOwner.target);

  // 2) MULTISIG PÁNICO
  const panicOwners = [panicOwner1.address, panicOwner2.address, panicOwner3.address];
  const multisigPanic = await SimpleMultiSig.deploy(panicOwners, 2);
  await multisigPanic.waitForDeployment();
  console.log("✔ Multisig PANIC deployed at:", multisigPanic.target);

  // 3) TOKEN BASE
  const Token = await hre.ethers.getContractFactory("Token");
  const token = await Token.deploy(deployer.address);
  await token.waitForDeployment();
  console.log("✔ Token deployed at:", token.target);

  // 4) DAO CORE
  const DAOCore = await hre.ethers.getContractFactory("DAOCore");
  const priceWeiPerToken     = hre.ethers.parseEther("0.0001");
  const minStakeVote         = hre.ethers.parseUnits("50", 18);
  const minStakeProposal     = hre.ethers.parseUnits("100", 18);
  const votingPeriodSeconds  = 3 * 24 * 60 * 60;
  const tokensPerVotingPower = 10n;
  const lockTimeSeconds      = 2 * 24 * 60 * 60;

  const daoCore = await DAOCore.deploy(
    token.target,
    deployer.address, // temporal para staking
    priceWeiPerToken,
    minStakeVote,
    minStakeProposal,
    votingPeriodSeconds,
    tokensPerVotingPower,
    lockTimeSeconds
  );
  await daoCore.waitForDeployment();
  console.log("✔ DAOCore deployed at:", daoCore.target);

  // 5) DAO DELEGATION
  const DAODelegation = await hre.ethers.getContractFactory("DAODelegation");
  const daoDelegation = await DAODelegation.deploy(daoCore.target);
  await daoDelegation.waitForDeployment();
  console.log("✔ DAODelegation deployed at:", daoDelegation.target);

  // 6) DAO TOKEN
  const DAOToken = await hre.ethers.getContractFactory("DAOToken");
  const daoToken = await DAOToken.deploy(daoCore.target);
  await daoToken.waitForDeployment();
  console.log("✔ DAOToken deployed at:", daoToken.target);

  // 7) DAO VIEWS
  const DAOViews = await hre.ethers.getContractFactory("DAOViews");
  const daoViews = await DAOViews.deploy(daoCore.target, daoDelegation.target);
  await daoViews.waitForDeployment();
  console.log("✔ DAOViews deployed at:", daoViews.target);

  // 8) TRANSFERIR OWNERSHIP DEL TOKEN AL DAO TOKEN CONTRACT
  await (await token.transferOwnership(daoToken.target)).wait();
  console.log("✔ Token ownership transferred to DAOToken");

  // 9) STAKING
  const Staking = await hre.ethers.getContractFactory("Staking");
  const staking = await Staking.deploy(token.target, daoCore.target, daoDelegation.target);
  await staking.waitForDeployment();
  console.log("✔ Staking deployed at:", staking.target);

  // 10) CONFIGURAR DAO
  await (await daoCore.setStakingAddress(staking.target)).wait();
  await (await daoCore.setDelegationContract(daoDelegation.target)).wait();
  await (await daoCore.setTokenContract(daoToken.target)).wait();
  await (await daoCore.setPanicWallet(multisigPanic.target)).wait();
  console.log("✔ Panic Wallet configurada");
  console.log("✔ DAO core configurado con staking, delegation y token");

  // 11) TRANSFERIR OWNERSHIP DEL DAO A MULTISIG
  await (await daoCore.changeOwner(multisigOwner.target)).wait();
  console.log("✔ Ownership del DAO transferido a multisigOwner");

  // 12) GUARDAR DIRECCIONES
  const addresses = {
    multisigOwner: multisigOwner.target,
    multisigPanic: multisigPanic.target,
    token: token.target,
    daoCore: daoCore.target,
    daoDelegation: daoDelegation.target,
    daoToken: daoToken.target,
    daoViews: daoViews.target,
    staking: staking.target,
    deployer: deployer.address,
    network: hre.network.name,
    timestamp: new Date().toISOString(),
  };

  const deploymentsDir = "./deployments";
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir);
  const filename = `${deploymentsDir}/${hre.network.name}-deployment.json`;
  fs.writeFileSync(filename, JSON.stringify(addresses, null, 2));
  console.log(`💾 Addresses saved to: ${filename}`);

  // 13) EXPORTAR ABI + CONFIG PARA EL FRONT
  await exportFrontend(addresses).catch(e => console.warn("⚠️  No se pudo exportar al front:", e.message));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
