const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DAOCore - Full Coverage", function () {
  let daoCore;
  let token;
  let staking;
  let owner;
  let alice;
  let bob;
  let panicWallet;
  let outsider;

  const PRICE = 1n;
  const TOKENS_PER_VP = 1n;
  const MIN_STAKE_VOTE = 10n;
  const MIN_STAKE_PROPOSAL = 20n;
  const VOTING_PERIOD = 60 * 60 * 24;
  const LOCK_TIME = 60 * 60;

  beforeEach(async function () {
    [owner, alice, bob, panicWallet, outsider] = await ethers.getSigners();

    // Deploy Mock Token
    const MockTokenFactory = await ethers.getContractFactory("MockToken");
    token = await MockTokenFactory.deploy();
    await token.waitForDeployment();

    // Deploy Mock Staking
    const MockStakingFactory = await ethers.getContractFactory("MockStaking");
    staking = await MockStakingFactory.deploy();
    await staking.waitForDeployment();

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
  });

  describe("Constructor validations", function() {
    it("should revert with zero token address", async function () {
      const F = await ethers.getContractFactory("DAOCore");
      await expect(
        F.deploy(ethers.ZeroAddress, owner.address, PRICE, MIN_STAKE_VOTE, MIN_STAKE_PROPOSAL, VOTING_PERIOD, TOKENS_PER_VP, LOCK_TIME)
      ).to.be.revertedWith("Invalid token");
    });

    it("should revert with zero owner address", async function () {
      const F = await ethers.getContractFactory("DAOCore");
      await expect(
        F.deploy(await token.getAddress(), ethers.ZeroAddress, PRICE, MIN_STAKE_VOTE, MIN_STAKE_PROPOSAL, VOTING_PERIOD, TOKENS_PER_VP, LOCK_TIME)
      ).to.be.reverted;
    });

    it("should revert with zero price", async function () {
      const F = await ethers.getContractFactory("DAOCore");
      await expect(
        F.deploy(await token.getAddress(), owner.address, 0n, MIN_STAKE_VOTE, MIN_STAKE_PROPOSAL, VOTING_PERIOD, TOKENS_PER_VP, LOCK_TIME)
      ).to.be.revertedWith("Invalid price");
    });

    it("should revert with zero tokensPerVP", async function () {
      const F = await ethers.getContractFactory("DAOCore");
      await expect(
        F.deploy(await token.getAddress(), owner.address, PRICE, MIN_STAKE_VOTE, MIN_STAKE_PROPOSAL, VOTING_PERIOD, 0n, LOCK_TIME)
      ).to.be.revertedWith("Invalid tokensPerVP");
    });

    it("should revert with zero voting period", async function () {
      const F = await ethers.getContractFactory("DAOCore");
      await expect(
        F.deploy(await token.getAddress(), owner.address, PRICE, MIN_STAKE_VOTE, MIN_STAKE_PROPOSAL, 0, TOKENS_PER_VP, LOCK_TIME)
      ).to.be.revertedWith("Invalid voting period");
    });

    it("should revert when voting period less than lock time", async function () {
      const F = await ethers.getContractFactory("DAOCore");
      await expect(
        F.deploy(await token.getAddress(), owner.address, PRICE, MIN_STAKE_VOTE, MIN_STAKE_PROPOSAL, LOCK_TIME - 1, TOKENS_PER_VP, LOCK_TIME)
      ).to.be.revertedWith("Voting period cannot be less than lock time");
    });
  });

  describe("Panic wallet and panic mode", function() {
    it("should revert operations when panic wallet not set", async function () {
      await expect(daoCore.updateParams(PRICE, MIN_STAKE_VOTE, MIN_STAKE_PROPOSAL, VOTING_PERIOD, TOKENS_PER_VP, LOCK_TIME))
        .to.be.revertedWith("Panic wallet not set");
    });

    it("should revert setPanicWallet with zero address", async function () {
      await expect(daoCore.setPanicWallet(ethers.ZeroAddress)).to.be.revertedWith("Invalid wallet");
    });

    it("should set panic wallet successfully", async function () {
      await expect(daoCore.setPanicWallet(panicWallet.address))
        .to.emit(daoCore, "PanicSet")
        .withArgs(panicWallet.address);
      expect(await daoCore.panicWallet()).to.equal(panicWallet.address);
    });

    it("should revert panic if not panic wallet", async function () {
      await daoCore.setPanicWallet(panicWallet.address);
      await expect(daoCore.connect(outsider).panic()).to.be.reverted;
    });

    it("should trigger panic successfully", async function () {
      await daoCore.setPanicWallet(panicWallet.address);
      await expect(daoCore.connect(panicWallet).panic())
        .to.emit(daoCore, "PanicTriggered");
      expect(await daoCore.isPanicked()).to.equal(true);
    });

    it("should block functions when panicked", async function () {
      await daoCore.setPanicWallet(panicWallet.address);
      await daoCore.connect(panicWallet).panic();
      
      await expect(daoCore.updateParams(PRICE, MIN_STAKE_VOTE, MIN_STAKE_PROPOSAL, VOTING_PERIOD, TOKENS_PER_VP, LOCK_TIME))
        .to.be.revertedWith("Panic mode active");
    });

    it("should restore tranquility successfully", async function () {
      await daoCore.setPanicWallet(panicWallet.address);
      await daoCore.connect(panicWallet).panic();
      await expect(daoCore.connect(panicWallet).tranquility())
        .to.emit(daoCore, "TranquilityRestored");
      expect(await daoCore.isPanicked()).to.equal(false);
    });
  });

  describe("Owner functions", function() {
    beforeEach(async function() {
      await daoCore.setPanicWallet(panicWallet.address);
    });

    it("should revert updateParams with invalid price", async function () {
      await expect(
        daoCore.updateParams(0n, 1n, 2n, VOTING_PERIOD, 1n, LOCK_TIME)
      ).to.be.revertedWith("Invalid price");
    });

    it("should update params successfully", async function () {
      const newPrice = PRICE * 2n;
      await expect(
        daoCore.updateParams(newPrice, 5n, 6n, VOTING_PERIOD, 2n, LOCK_TIME)
      ).to.emit(daoCore, "ParamsUpdated")
       .withArgs(newPrice, 5n, 6n, VOTING_PERIOD, 2n, LOCK_TIME);
      
      expect(await daoCore.priceWeiPerToken()).to.equal(newPrice);
    });

    it("should revert changeOwner with zero address", async function () {
      await expect(daoCore.changeOwner(ethers.ZeroAddress)).to.be.revertedWith("Invalid new owner");
    });

    it("should change owner successfully", async function () {
      await daoCore.changeOwner(alice.address);
      await expect(daoCore.setPanicWallet(outsider.address)).to.be.reverted;
      await daoCore.connect(alice).changeOwner(owner.address);
    });

    it("should toggle voting mode", async function () {
      expect(Number(await daoCore.votingMode())).to.equal(0);
      await expect(daoCore.toggleVotingMode()).to.emit(daoCore, "VotingModeToggled");
      expect(Number(await daoCore.votingMode())).to.equal(1);
    });
  });

  describe("Staking configuration", function() {
    beforeEach(async function() {
      await daoCore.setPanicWallet(panicWallet.address);
    });

    it("should revert setStakingAddress with zero address", async function () {
      await expect(daoCore.setStakingAddress(ethers.ZeroAddress))
        .to.be.revertedWith("Invalid staking");
    });

    it("should set staking address", async function () {
      await expect(daoCore.setStakingAddress(await staking.getAddress()))
        .to.emit(daoCore, "StakingChanged");
      expect(await daoCore.staking()).to.equal(await staking.getAddress());
    });
  });

  describe("Proposals", function() {
    beforeEach(async function() {
      await daoCore.setPanicWallet(panicWallet.address);
      await daoCore.setStakingAddress(await staking.getAddress());
    });

    it("should revert createProposal with insufficient stake", async function () {
      await expect(
        daoCore.connect(alice).createProposal("t", "d", Number(MIN_STAKE_PROPOSAL) - 1)
      ).to.be.revertedWith("Insufficient proposal stake");
    });

    it("should create proposal successfully", async function () {
      await expect(
        daoCore.connect(alice).createProposal("Title1", "Desc1", Number(MIN_STAKE_PROPOSAL))
      ).to.emit(daoCore, "ProposalCreated");
      
      expect(await daoCore.proposalCount()).to.equal(1);
    });
  });

  describe("Voting", function() {
    beforeEach(async function() {
      await daoCore.setPanicWallet(panicWallet.address);
      await daoCore.setStakingAddress(await staking.getAddress());
      await daoCore.connect(alice).createProposal("P1", "D1", Number(MIN_STAKE_PROPOSAL));
    });

    it("should revert vote with insufficient stake", async function () {
      await expect(
        daoCore.connect(bob).vote(1, true, Number(MIN_STAKE_VOTE) - 1)
      ).to.be.revertedWith("Insufficient voting stake");
    });

    it("should vote successfully in LINEAR mode", async function () {
      await expect(daoCore.connect(bob).vote(1, true, Number(MIN_STAKE_VOTE)))
        .to.emit(daoCore, "Voted");
      
      const [,,,,votesFor,,,,] = await daoCore.getProposal(1);
      expect(votesFor).to.equal(Number(MIN_STAKE_VOTE) / Number(TOKENS_PER_VP));
    });

    it("should vote successfully in QUADRATIC mode", async function () {
      await daoCore.toggleVotingMode();
      await daoCore.connect(bob).vote(1, true, 100);
      
      const [,,,,votesFor,,,,] = await daoCore.getProposal(1);
      expect(votesFor).to.equal(10); // sqrt(100/1) = 10
    });

    it("should vote against successfully", async function () {
      await daoCore.connect(bob).vote(1, false, Number(MIN_STAKE_VOTE));
      const [,,,,,votesAgainst,,,] = await daoCore.getProposal(1);
      expect(votesAgainst).to.equal(Number(MIN_STAKE_VOTE) / Number(TOKENS_PER_VP));
    });

    it("should revert vote when voting period ended", async function () {
      await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + 10]);
      await ethers.provider.send("evm_mine");
      
      await expect(
        daoCore.connect(bob).vote(1, true, Number(MIN_STAKE_VOTE))
      ).to.be.revertedWith("Voting period ended");
    });
  });

  describe("Unstake vote", function() {
    beforeEach(async function() {
      await daoCore.setPanicWallet(panicWallet.address);
      await daoCore.setStakingAddress(await staking.getAddress());
      await daoCore.connect(alice).createProposal("P1", "D1", Number(MIN_STAKE_PROPOSAL));
      await daoCore.connect(bob).vote(1, true, Number(MIN_STAKE_VOTE));
    });

    it("should revert unstakeVote if user did not vote", async function () {
      await expect(daoCore.connect(alice).unstakeVote(1))
        .to.be.revertedWith("User did not vote");
    });

    it("should unstake vote successfully", async function () {
      await expect(daoCore.connect(bob).unstakeVote(1))
        .to.emit(staking, "UnstakedVote");
    });
  });

  describe("Finalize proposal", function() {
    beforeEach(async function() {
      await daoCore.setPanicWallet(panicWallet.address);
      await daoCore.setStakingAddress(await staking.getAddress());
    });

    it("should revert finalize if voting period not ended", async function () {
      await daoCore.connect(alice).createProposal("P1", "D1", Number(MIN_STAKE_PROPOSAL));
      await expect(daoCore.finalize(1)).to.be.revertedWith("Voting period not ended");
    });

    it("should finalize as ACCEPTED", async function () {
      await daoCore.connect(alice).createProposal("P1", "D1", Number(MIN_STAKE_PROPOSAL));
      await daoCore.connect(bob).vote(1, true, Number(MIN_STAKE_VOTE));
      
      await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + 10]);
      await ethers.provider.send("evm_mine");
      
      await expect(daoCore.finalize(1)).to.emit(daoCore, "ProposalFinalized");
      
      const [,,,,,,,status] = await daoCore.getProposal(1);
      expect(status).to.equal(1); // ACCEPTED
    });

    it("should finalize as REJECTED", async function () {
      await daoCore.connect(alice).createProposal("P2", "D2", Number(MIN_STAKE_PROPOSAL));
      
      await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + 10]);
      await ethers.provider.send("evm_mine");
      
      await daoCore.finalize(1);
      const [,,,,,,,status] = await daoCore.getProposal(1);
      expect(status).to.equal(2); // REJECTED
    });
  });

  describe("View functions", function() {
    beforeEach(async function() {
      await daoCore.setPanicWallet(panicWallet.address);
      await daoCore.setStakingAddress(await staking.getAddress());
    });

    it("should validate proposal", async function () {
      await daoCore.connect(alice).createProposal("P", "D", Number(MIN_STAKE_PROPOSAL));
      expect(await daoCore.isValidProposal(1)).to.equal(true);
      expect(await daoCore.isValidProposal(0)).to.equal(false);
    });

    it("should return proposal creator", async function () {
      await daoCore.connect(alice).createProposal("P", "D", Number(MIN_STAKE_PROPOSAL));
      expect(await daoCore.proposalCreator(1)).to.equal(alice.address);
    });

    it("should return lock time", async function () {
      expect(await daoCore.lockTime()).to.equal(LOCK_TIME);
    });

    it("should check if user has voted", async function () {
      await daoCore.connect(alice).createProposal("P", "D", Number(MIN_STAKE_PROPOSAL));
      await daoCore.connect(bob).vote(1, true, Number(MIN_STAKE_VOTE));
      expect(await daoCore.hasVoted(1, bob.address)).to.equal(true);
      expect(await daoCore.hasVoted(1, outsider.address)).to.equal(false);
    });
  });
});