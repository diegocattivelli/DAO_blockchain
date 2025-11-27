const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

// ============================= HELPERS ================================

async function exportFrontend(addresses) {
  const FRONTEND_DIR = path.join(__dirname, "..", "frontend");
  const ABI_DIR = path.join(FRONTEND_DIR, "abis");
  const CONFIG_FILE = path.join(FRONTEND_DIR, "dao-config.js");

  if (!fs.existsSync(FRONTEND_DIR)) return;

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
    const abiPath = path.join(ABI_DIR, ${name}.json);
    fs.writeFileSync(abiPath, JSON.stringify(artifact.abi, null, 2));
  }

  const configJs = export const CONTRACTS = ${JSON.stringify(addresses, null, 2)};;
  fs.writeFileSync(CONFIG_FILE, configJs);
}

async function verify(address, constructorArgs = []) {
  console.log(\n🟦 Verificando ${address}...);
  try {
    await hre.run("verify:verify", {
      address,
      constructorArguments: constructorArgs,
    });
    console.log(➡ Verificado OK: ${address});
  } catch (err) {
    console.log(⚠ No se pudo verificar:, err.message);
  }
}

// ============================= DEPLOY ================================

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying with:", deployer.address);
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Balance:", balance.toString());

  // ⚠ Fix para Sepolia: gasPrice explícito
  const gasPrice = hre.ethers.parseUnits("2", "gwei");

  // ---------- MULTISIG ----------
  const SimpleMultiSig = await hre.ethers.getContractFactory("SimpleMultiSig", deployer);
  const multisigOwner = await SimpleMultiSig.deploy([deployer.address], 1, { gasPrice });
  await multisigOwner.waitForDeployment();

  const multisigPanic = await SimpleMultiSig.deploy([deployer.address], 1, { gasPrice });
  await multisigPanic.waitForDeployment();

  // ---------- TOKEN ----------
  const Token = await hre.ethers.getContractFactory("Token", deployer);
  const token = await Token.deploy(deployer.address, { gasPrice });
  await token.waitForDeployment();

  // ---------- DAO CORE ----------
  const DAOCore = await hre.ethers.getContractFactory("DAOCore", deployer);

  const priceWeiPerToken = hre.ethers.parseEther("0.0001");
  const minStakeVote = hre.ethers.parseUnits("50", 18);
  const minStakeProposal = hre.ethers.parseUnits("100", 18);
  const votingPeriodSeconds = 3 * 24 * 60 * 60;
  const tokensPerVotingPower = 10n;
  const lockTimeSeconds = 2 * 24 * 60 * 60;

  const daoCore = await DAOCore.deploy(
    token.target,
    deployer.address,
    priceWeiPerToken,
    minStakeVote,
    minStakeProposal,
    votingPeriodSeconds,
    tokensPerVotingPower,
    lockTimeSeconds,
    { gasPrice }
  );
  await daoCore.waitForDeployment();

  const DAODelegation = await hre.ethers.getContractFactory("DAODelegation", deployer);
  const daoDelegation = await DAODelegation.deploy(daoCore.target, { gasPrice });
  await daoDelegation.waitForDeployment();

  const DAOToken = await hre.ethers.getContractFactory("DAOToken", deployer);
  const daoToken = await DAOToken.deploy(daoCore.target, { gasPrice });
  await daoToken.waitForDeployment();

  const DAOViews = await hre.ethers.getContractFactory("DAOViews", deployer);
  const daoViews = await DAOViews.deploy(daoCore.target, daoDelegation.target, { gasPrice });
  await daoViews.waitForDeployment();

  // ---------- OWNER TRANSFERS ----------
  await (await token.transferOwnership(daoToken.target, { gasPrice })).wait();
  await (await daoCore.setStakingAddress(daoDelegation.target, { gasPrice })).wait();
  await (await daoCore.setDelegationContract(daoDelegation.target, { gasPrice })).wait();
  await (await daoCore.setTokenContract(daoToken.target, { gasPrice })).wait();
  await (await daoCore.setPanicWallet(multisigPanic.target, { gasPrice })).wait();
  await (await daoCore.changeOwner(multisigOwner.target, { gasPrice })).wait();

  // ---------- STAKING ----------
  const Staking = await hre.ethers.getContractFactory("Staking", deployer);
  const staking = await Staking.deploy(
    token.target,
    daoCore.target,
    daoDelegation.target,
    { gasPrice }
  );
  await staking.waitForDeployment();

  // ======================================================================
  // GUARDAMOS DEPLOY
  // ======================================================================

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
  fs.writeFileSync(
    ${deploymentsDir}/sepolia-deployment.json,
    JSON.stringify(addresses, null, 2)
  );

  await exportFrontend(addresses);

  // ============================= VERIFY =============================
  console.log("\n\n================= VERIFICANDO CONTRATOS =================");

  await verify(multisigOwner.target, [[deployer.address], 1]);
  await verify(multisigPanic.target, [[deployer.address], 1]);
  await verify(token.target, [deployer.address]);
  await verify(daoCore.target, [
    token.target,
    deployer.address,
    priceWeiPerToken,
    minStakeVote,
    minStakeProposal,
    votingPeriodSeconds,
    tokensPerVotingPower,
    lockTimeSeconds
  ]);
  await verify(daoDelegation.target, [daoCore.target]);
  await verify(daoToken.target, [daoCore.target]);
  await verify(daoViews.target, [daoCore.target, daoDelegation.target]);
  await verify(staking.target, [
    token.target,
    daoCore.target,
    daoDelegation.target
  ]);

  console.log("\n🎉 LISTO: Deploy + Verificación completados en Sepolia");
}

// RUN
main().catch((err) => {
  console.error(err);
  process.exit(1);
});