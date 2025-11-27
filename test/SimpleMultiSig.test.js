const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SimpleMultiSig - Complete Coverage", function () {
  let owner1, owner2, owner3, other;
  let multiSig;
  let MultiSig;

  beforeEach(async () => {
    [owner1, owner2, owner3, other] = await ethers.getSigners();
    MultiSig = await ethers.getContractFactory("SimpleMultiSig");
    multiSig = await MultiSig.deploy(
      [owner1.address, owner2.address, owner3.address],
      2 // required confirmations
    );
  });

  describe("Deployment & Constructor", function() {
    it("should deploy with correct parameters", async () => {
      expect(await multiSig._requiredConfirmations()).to.equal(2);
      const owners = await multiSig.owners();
      expect(owners.length).to.equal(3);
    });

    it("should revert if no owners provided", async () => {
      await expect(
        MultiSig.deploy([], 1)
      ).to.be.reverted;
    });

    it("should revert if required confirmations is 0", async () => {
      await expect(
        MultiSig.deploy([owner1.address, owner2.address], 0)
      ).to.be.reverted;
    });

    it("should revert if required confirmations exceeds owners length", async () => {
      await expect(
        MultiSig.deploy([owner1.address, owner2.address], 3)
      ).to.be.reverted;
    });
  });

  describe("Submit Transaction", function() {
    it("should submit a transaction by owner", async () => {
      await expect(
        multiSig.connect(owner1).submitTransaction(other.address, 0, "0x")
      ).to.emit(multiSig, "TransactionSubmitted");
      
      expect(await multiSig.transactionCount()).to.equal(1);
    });

    it("should submit transaction with value and data", async () => {
      const value = ethers.parseEther("1.0");
      const data = "0x1234";
      
      await expect(
        multiSig.connect(owner1).submitTransaction(other.address, value, data)
      ).to.emit(multiSig, "TransactionSubmitted")
       .withArgs(0, other.address, value, data);
    });

    it("should revert if non-owner tries to submit", async () => {
      await expect(
        multiSig.connect(other).submitTransaction(other.address, 0, "0x")
      ).to.be.reverted;
    });

    it("should increment transaction count", async () => {
      expect(await multiSig.transactionCount()).to.equal(0);
      await multiSig.connect(owner1).submitTransaction(other.address, 0, "0x");
      expect(await multiSig.transactionCount()).to.equal(1);
      await multiSig.connect(owner2).submitTransaction(other.address, 0, "0x");
      expect(await multiSig.transactionCount()).to.equal(2);
    });
  });

  describe("Confirm Transaction", function() {
    beforeEach(async () => {
      await multiSig.connect(owner1).submitTransaction(other.address, 0, "0x");
    });

    it("should confirm a transaction by owner", async () => {
      await expect(
        multiSig.connect(owner1).confirmTransaction(0)
      ).to.emit(multiSig, "TransactionConfirmed")
       .withArgs(0, owner1.address);
      
      expect(await multiSig.confirmations(0)).to.equal(1);
    });

    it("should allow multiple owners to confirm", async () => {
      await multiSig.connect(owner1).confirmTransaction(0);
      expect(await multiSig.confirmations(0)).to.equal(1);
      
      await multiSig.connect(owner2).confirmTransaction(0);
      expect(await multiSig.confirmations(0)).to.equal(2);
      
      await multiSig.connect(owner3).confirmTransaction(0);
      expect(await multiSig.confirmations(0)).to.equal(3);
    });

    it("should revert if non-owner tries to confirm", async () => {
      await expect(
        multiSig.connect(other).confirmTransaction(0)
      ).to.be.reverted;
    });

    it("should revert if transaction doesn't exist", async () => {
      await expect(
        multiSig.connect(owner1).confirmTransaction(999)
      ).to.be.reverted;
    });
  });

  describe("Execute Transaction", function() {
    beforeEach(async () => {
      await multiSig.connect(owner1).submitTransaction(other.address, 0, "0x");
    });

    it("should execute transaction with enough confirmations", async () => {
      await multiSig.connect(owner1).confirmTransaction(0);
      await multiSig.connect(owner2).confirmTransaction(0);

      await expect(
        multiSig.connect(owner1).executeTransaction(0)
      ).to.emit(multiSig, "TransactionExecuted")
       .withArgs(0);
    });

    it("should revert if not enough confirmations", async () => {
      await multiSig.connect(owner1).confirmTransaction(0);

      await expect(
        multiSig.connect(owner1).executeTransaction(0)
      ).to.be.reverted;
    });

    it("should revert if non-owner tries to execute", async () => {
      await multiSig.connect(owner1).confirmTransaction(0);
      await multiSig.connect(owner2).confirmTransaction(0);

      await expect(
        multiSig.connect(other).executeTransaction(0)
      ).to.be.reverted;
    });

    it("should revert if transaction doesn't exist", async () => {
      await expect(
        multiSig.connect(owner1).executeTransaction(999)
      ).to.be.reverted;
    });

    it("should revert if already executed", async () => {
      await multiSig.connect(owner1).confirmTransaction(0);
      await multiSig.connect(owner2).confirmTransaction(0);
      await multiSig.connect(owner1).executeTransaction(0);

      await expect(
        multiSig.connect(owner1).executeTransaction(0)
      ).to.be.reverted;
    });

    it("should not allow confirming already executed transaction", async () => {
      await multiSig.connect(owner1).confirmTransaction(0);
      await multiSig.connect(owner2).confirmTransaction(0);
      await multiSig.connect(owner1).executeTransaction(0);

      await expect(
        multiSig.connect(owner3).confirmTransaction(0)
      ).to.be.reverted;
    });

    it("should execute transaction with ETH transfer", async () => {
      await owner1.sendTransaction({
        to: multiSig.target,
        value: ethers.parseEther("2.0")
      });

      await multiSig.connect(owner1).submitTransaction(
        other.address,
        ethers.parseEther("1.0"),
        "0x"
      );

      await multiSig.connect(owner1).confirmTransaction(1);
      await multiSig.connect(owner2).confirmTransaction(1);

      const balanceBefore = await ethers.provider.getBalance(other.address);
      await multiSig.connect(owner1).executeTransaction(1);
      const balanceAfter = await ethers.provider.getBalance(other.address);

      expect(balanceAfter - balanceBefore).to.equal(
        ethers.parseEther("1.0")
      );
    });

    it("should revert if execution fails - call to reverting contract", async () => {
      const ReverterFactory = await ethers.getContractFactory("Reverter");
      const reverter = await ReverterFactory.deploy();
      await reverter.waitForDeployment();
      
      const callData = reverter.interface.encodeFunctionData("alwaysReverts");
      
      await multiSig.connect(owner1).submitTransaction(
        reverter.target,
        0,
        callData
      );

      await multiSig.connect(owner1).confirmTransaction(1);
      await multiSig.connect(owner2).confirmTransaction(1);

      await expect(
        multiSig.connect(owner1).executeTransaction(1)
      ).to.be.reverted;
    });

    it("Debe revertir si la ejecución de la transacción falla internamente", async () => {
      const ReverterFactory = await ethers.getContractFactory("Reverter");
      const reverter = await ReverterFactory.deploy();
      await reverter.waitForDeployment();
      
      const callData = reverter.interface.encodeFunctionData("alwaysReverts");
      
      await multiSig.connect(owner1).submitTransaction(
        await reverter.getAddress(),
        0,
        callData
      );

      await multiSig.connect(owner1).confirmTransaction(1); // ID 1 (asumiendo que es la segunda tx del test)
      await multiSig.connect(owner2).confirmTransaction(1);

      await expect(
        multiSig.connect(owner1).executeTransaction(1)
      ).to.be.revertedWithCustomError(multiSig, "ExecutionFailed");
    });
  });

  describe("View Functions", function() {
    it("should return correct transaction count", async () => {
      expect(await multiSig.transactionCount()).to.equal(0);
      
      await multiSig.connect(owner1).submitTransaction(other.address, 0, "0x");
      expect(await multiSig.transactionCount()).to.equal(1);
      
      await multiSig.connect(owner1).submitTransaction(other.address, 0, "0x");
      expect(await multiSig.transactionCount()).to.equal(2);
    });

    it("should return correct confirmations count", async () => {
      await multiSig.connect(owner1).submitTransaction(other.address, 0, "0x");
      
      expect(await multiSig.confirmations(0)).to.equal(0);
      
      await multiSig.connect(owner1).confirmTransaction(0);
      expect(await multiSig.confirmations(0)).to.equal(1);
      
      await multiSig.connect(owner2).confirmTransaction(0);
      expect(await multiSig.confirmations(0)).to.equal(2);
      
      await multiSig.connect(owner3).confirmTransaction(0);
      expect(await multiSig.confirmations(0)).to.equal(3);
    });

    it("should return owners array", async () => {
      const owners = await multiSig.owners();
      expect(owners).to.have.lengthOf(3);
      expect(owners[0]).to.equal(owner1.address);
      expect(owners[1]).to.equal(owner2.address);
      expect(owners[2]).to.equal(owner3.address);
    });

    it("should return correct confirmations even with no confirmations", async () => {
      await multiSig.connect(owner1).submitTransaction(other.address, 0, "0x");
      const count = await multiSig.confirmations(0);
      expect(count).to.equal(0);
    });
  });

  describe("Receive Function", function() {
    it("should receive ETH", async () => {
      const amount = ethers.parseEther("1.0");
      
      await owner1.sendTransaction({
        to: multiSig.target,
        value: amount
      });

      const balance = await ethers.provider.getBalance(multiSig.target);
      expect(balance).to.equal(amount);
    });

    it("should receive multiple ETH transfers", async () => {
      await owner1.sendTransaction({
        to: multiSig.target,
        value: ethers.parseEther("1.0")
      });

      await owner2.sendTransaction({
        to: multiSig.target,
        value: ethers.parseEther("0.5")
      });

      const balance = await ethers.provider.getBalance(multiSig.target);
      expect(balance).to.equal(ethers.parseEther("1.5"));
    });
  });

  describe("Edge Cases & Complex Scenarios", function() {
    it("should handle multiple transactions independently", async () => {
      await multiSig.connect(owner1).submitTransaction(other.address, 0, "0x");
      await multiSig.connect(owner1).submitTransaction(other.address, 0, "0x");
      await multiSig.connect(owner1).submitTransaction(other.address, 0, "0x");

      await multiSig.connect(owner1).confirmTransaction(0);
      await multiSig.connect(owner2).confirmTransaction(0);

      await multiSig.connect(owner1).confirmTransaction(2);
      await multiSig.connect(owner2).confirmTransaction(2);

      expect(await multiSig.confirmations(0)).to.equal(2);
      expect(await multiSig.confirmations(1)).to.equal(0);
      expect(await multiSig.confirmations(2)).to.equal(2);

      await multiSig.connect(owner1).executeTransaction(0);
      await multiSig.connect(owner1).executeTransaction(2);

      await multiSig.connect(owner1).confirmTransaction(1);
      await multiSig.connect(owner2).confirmTransaction(1);
      await expect(
        multiSig.connect(owner1).executeTransaction(1)
      ).to.emit(multiSig, "TransactionExecuted");
    });

    it("should allow same owner to confirm multiple times (idempotent)", async () => {
      await multiSig.connect(owner1).submitTransaction(other.address, 0, "0x");
      
      await multiSig.connect(owner1).confirmTransaction(0);
      await multiSig.connect(owner1).confirmTransaction(0); // Second time
      
      expect(await multiSig.confirmations(0)).to.equal(1);
    });

    it("should handle transaction with data payload", async () => {
      const data = "0xabcdef1234567890";
      
      await multiSig.connect(owner1).submitTransaction(other.address, 0, data);
      await multiSig.connect(owner1).confirmTransaction(0);
      await multiSig.connect(owner2).confirmTransaction(0);
      
      await expect(
        multiSig.connect(owner1).executeTransaction(0)
      ).to.emit(multiSig, "TransactionExecuted");
    });
  });
});