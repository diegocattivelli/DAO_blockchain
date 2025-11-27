const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DAOToken - Full Coverage", function () {
  let daoCore, daoToken, token;
  let owner, alice, bob, panicWallet;

  const PRICE = ethers.parseEther("0.001"); // 0.001 ETH per token
  const MIN_STAKE_VOTE = 10n;
  const MIN_STAKE_PROPOSAL = 20n;
  const VOTING_PERIOD = 60 * 60 * 24;
  const TOKENS_PER_VP = 1n;
  const LOCK_TIME = 60 * 60;

  beforeEach(async function () {
    [owner, alice, bob, panicWallet] = await ethers.getSigners();

    // Deploy Mock Token
    const MockTokenFactory = await ethers.getContractFactory("MockToken");
    token = await MockTokenFactory.deploy();
    await token.waitForDeployment();

    // Deploy DAOCore
    const DAOCore = await ethers.getContractFactory("DAOCore");
    daoCore = await DAOCore.deploy(
      await token.getAddress(),
      owner.address,
      PRICE,
      MIN_STAKE_VOTE,
      MIN_STAKE_PROPOSAL,
      VOTING_PERIOD,
      TOKENS_PER_VP,
      LOCK_TIME
    );
    await daoCore.waitForDeployment();

    // Deploy DAOToken
    const DAOToken = await ethers.getContractFactory("DAOToken");
    daoToken = await DAOToken.deploy(await daoCore.getAddress());
    await daoToken.waitForDeployment();

    // Configure
    await daoCore.setPanicWallet(panicWallet.address);
    await daoCore.setTokenContract(await daoToken.getAddress());

    // Mint tokens to DAOToken contract for selling
    const decimals = await token.decimals();
    const amountToMint = ethers.parseUnits("1000000", decimals);
    await token.mint(await daoToken.getAddress(), amountToMint);
  });

  describe("Constructor", function() {
    it("should revert with zero DAO core address", async function () {
      const F = await ethers.getContractFactory("DAOToken");
      await expect(F.deploy(ethers.ZeroAddress)).to.be.revertedWith("Invalid DAO core");
    });

    it("should set daoCore correctly", async function () {
      expect(await daoToken.daoCore()).to.equal(await daoCore.getAddress());
    });
  });

  describe("Buy tokens", function() {
    it("should buy tokens successfully", async function () {
      const weiSent = ethers.parseEther("1"); // 1 ETH
      
      await expect(
        daoToken.connect(alice).buyTokens({ value: weiSent })
      ).to.emit(daoToken, "TokensPurchased");

      const decimals = await token.decimals();
      const expectedTokens = (weiSent * BigInt(10 ** Number(decimals))) / PRICE;
      expect(await token.balanceOf(alice.address)).to.equal(expectedTokens);
    });

    it("should revert with zero ETH sent", async function () {
      await expect(
        daoToken.connect(alice).buyTokens({ value: 0 })
      ).to.be.revertedWith("No ETH sent");
    });

    it("should revert when DAO has insufficient tokens", async function () {
      // Deploy new DAOToken without minting tokens
      const DAOToken = await ethers.getContractFactory("DAOToken");
      const daoToken2 = await DAOToken.deploy(await daoCore.getAddress());
      await daoToken2.waitForDeployment();

      await expect(
        daoToken2.connect(alice).buyTokens({ value: ethers.parseEther("1") })
      ).to.be.revertedWith("Not enough tokens in DAO");
    });

    it("should revert with too little ETH", async function () {
      // Update price to very high
      await daoCore.updateParams(
        ethers.parseEther("1000000"), // Very expensive
        MIN_STAKE_VOTE,
        MIN_STAKE_PROPOSAL,
        VOTING_PERIOD,
        TOKENS_PER_VP,
        LOCK_TIME
      );

      await expect(
        daoToken.connect(alice).buyTokens({ value: 1 })
      ).to.be.revertedWith("Too little ETH");
    });

    it("should handle multiple purchases", async function () {
      await daoToken.connect(alice).buyTokens({ value: ethers.parseEther("0.5") });
      await daoToken.connect(bob).buyTokens({ value: ethers.parseEther("0.3") });

      expect(await token.balanceOf(alice.address)).to.be.gt(0);
      expect(await token.balanceOf(bob.address)).to.be.gt(0);
    });
  });

  describe("Mint tokens", function() {
    it("should mint tokens successfully", async function () {
      const decimals = await token.decimals();
      const amountToMint = ethers.parseUnits("1000", decimals);

      const balanceBefore = await token.balanceOf(await daoToken.getAddress());
      await daoToken.mintTokens(amountToMint);
      const balanceAfter = await token.balanceOf(await daoToken.getAddress());

      expect(balanceAfter - balanceBefore).to.equal(amountToMint);
    });

    it("should revert mintTokens if not owner", async function () {
      const decimals = await token.decimals();
      const amountToMint = ethers.parseUnits("1000", decimals);

      await expect(
        daoToken.connect(alice).mintTokens(amountToMint)
      ).to.be.reverted;
    });

    it("should revert mintTokens when panicked", async function () {
      await daoCore.connect(panicWallet).panic();

      const decimals = await token.decimals();
      const amountToMint = ethers.parseUnits("1000", decimals);

      await expect(
        daoToken.mintTokens(amountToMint)
      ).to.be.revertedWith("Panic mode active");
    });
  });

  describe("Panic mode", function() {
    it("should block buyTokens when panicked", async function () {
      await daoCore.connect(panicWallet).panic();

      await expect(
        daoToken.connect(alice).buyTokens({ value: ethers.parseEther("1") })
      ).to.be.revertedWith("Panic mode active");
    });

    it("should allow buyTokens after tranquility restored", async function () {
      await daoCore.connect(panicWallet).panic();
      await daoCore.connect(panicWallet).tranquility();

      await expect(
        daoToken.connect(alice).buyTokens({ value: ethers.parseEther("1") })
      ).to.emit(daoToken, "TokensPurchased");
    });
  });

  describe("Receive function", function() {
    it("should receive ETH and call buyTokens", async function () {
      const weiSent = ethers.parseEther("0.5");

      await expect(
        alice.sendTransaction({
          to: await daoToken.getAddress(),
          value: weiSent
        })
      ).to.emit(daoToken, "TokensPurchased");

      expect(await token.balanceOf(alice.address)).to.be.gt(0);
    });
  });

  describe("Price calculations", function() {
    it("should calculate correct token amount for different ETH values", async function () {
      const decimals = await token.decimals();
      
      // Test with 0.1 ETH
      const eth1 = ethers.parseEther("0.1");
      await daoToken.connect(alice).buyTokens({ value: eth1 });
      
      const expectedTokens1 = (eth1 * BigInt(10 ** Number(decimals))) / PRICE;
      expect(await token.balanceOf(alice.address)).to.equal(expectedTokens1);

      // Test with 0.5 ETH
      const eth2 = ethers.parseEther("0.5");
      await daoToken.connect(bob).buyTokens({ value: eth2 });
      
      const expectedTokens2 = (eth2 * BigInt(10 ** Number(decimals))) / PRICE;
      expect(await token.balanceOf(bob.address)).to.equal(expectedTokens2);
    });
  });

  describe("Coverage: Receive y Validaciones de Compra", function() {
    it("Debe permitir comprar tokens enviando ETH directamente al contrato (receive)", async function () {
      const amount = ethers.parseEther("1");
      
      await expect(
        alice.sendTransaction({
          to: await daoToken.getAddress(),
          value: amount
        })
      ).to.emit(daoToken, "TokensPurchased"); // Verifica que se emitió el evento
    });

    it("Debe revertir si el contrato DAOToken no tiene suficientes tokens para vender", async function () {
      const DAOTokenFactory = await ethers.getContractFactory("DAOToken");
      const emptyDaoToken = await DAOTokenFactory.deploy(await daoCore.getAddress());
      await emptyDaoToken.waitForDeployment();
      
      await expect(
        emptyDaoToken.connect(alice).buyTokens({ value: ethers.parseEther("1") })
      ).to.be.revertedWith("Not enough tokens in DAO");
    });
  });
});