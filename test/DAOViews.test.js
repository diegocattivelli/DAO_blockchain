const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DAOViews - Full Coverage", function () {
  let daoCore, daoViews, daoDelegation, token, staking;
  let owner, alice, bob, panicWallet;

  const PRICE = 1n;
  const TOKENS_PER_VP = 1n;
  const MIN_STAKE_VOTE = 10n;
  const MIN_STAKE_PROPOSAL = 20n;
  const VOTING_PERIOD = 60 * 60 * 24;
  const LOCK_TIME = 60 * 60;

  beforeEach(async function () {
    [owner, alice, bob, panicWallet] = await ethers.getSigners();

    // Deploy Mock Token
    const MockTokenFactory = await ethers.getContractFactory("MockToken");
    token = await MockTokenFactory.deploy();
    await token.waitForDeployment();

    // Mint tokens to users
    await token.mint(alice.address, 1000n);
    await token.mint(bob.address, 500n);

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

    // Deploy DAODelegation
    const DAODelegation = await ethers.getContractFactory("DAODelegation");
    daoDelegation = await DAODelegation.deploy(await daoCore.getAddress());
    await daoDelegation.waitForDeployment();

    // Deploy DAOViews
    const DAOViews = await ethers.getContractFactory("DAOViews");
    daoViews = await DAOViews.deploy(await daoCore.getAddress(), await daoDelegation.getAddress());
    await daoViews.waitForDeployment();

    // Configure
    await daoCore.setPanicWallet(panicWallet.address);
    await daoCore.setStakingAddress(await staking.getAddress());
    await daoCore.setDelegationContract(await daoDelegation.getAddress());
  });

  describe("Constructor", function() {
    it("should revert with zero DAO core address", async function () {
      const F = await ethers.getContractFactory("DAOViews");
      await expect(
        F.deploy(ethers.ZeroAddress, await daoDelegation.getAddress())
      ).to.be.revertedWith("Invalid DAO core");
    });

    it("should set addresses correctly", async function () {
      expect(await daoViews.daoCore()).to.equal(await daoCore.getAddress());
      expect(await daoViews.delegation()).to.equal(await daoDelegation.getAddress());
    });
  });

  describe("Get all proposals", function() {
    it("should return empty array when no proposals", async function () {
      const proposals = await daoViews.getAllProposals();
      expect(proposals.length).to.equal(0);
    });

    it("should return all proposals", async function () {
      await daoCore.connect(alice).createProposal("P1", "D1", Number(MIN_STAKE_PROPOSAL));
      await daoCore.connect(bob).createProposal("P2", "D2", Number(MIN_STAKE_PROPOSAL));

      const proposals = await daoViews.getAllProposals();
      expect(proposals.length).to.equal(2);
      expect(proposals[0].title).to.equal("P1");
      expect(proposals[1].title).to.equal("P2");
    });

    it("should include voter information", async function () {
      await daoCore.connect(alice).createProposal("P1", "D1", Number(MIN_STAKE_PROPOSAL));
      await daoCore.connect(bob).vote(1, true, Number(MIN_STAKE_VOTE));

      const proposals = await daoViews.getAllProposals();
      expect(proposals[0].voters.length).to.equal(1);
      expect(proposals[0].voters[0].voter).to.equal(bob.address);
      expect(proposals[0].voters[0].choice).to.equal(true);
    });
  });

  describe("Get proposals by status", function() {
    beforeEach(async function() {
      // Create 3 proposals
      await daoCore.connect(alice).createProposal("Active", "D1", Number(MIN_STAKE_PROPOSAL));
      await daoCore.connect(alice).createProposal("ToAccept", "D2", Number(MIN_STAKE_PROPOSAL));
      await daoCore.connect(alice).createProposal("ToReject", "D3", Number(MIN_STAKE_PROPOSAL));

      // Vote on proposal 2 (FOR) and 3 (AGAINST)
      await daoCore.connect(bob).vote(2, true, Number(MIN_STAKE_VOTE));
      
      // Wait and finalize
      await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + 10]);
      await ethers.provider.send("evm_mine");

      await daoCore.finalize(2); // Will be ACCEPTED
      await daoCore.finalize(3); // Will be REJECTED
    });

    it("should return only ACTIVE proposals", async function () {
      const active = await daoViews.getProposalsByStatus(0); // 0 = ACTIVE
      expect(active.length).to.equal(1);
      expect(active[0].title).to.equal("Active");
    });

    it("should return only ACCEPTED proposals", async function () {
      const accepted = await daoViews.getProposalsByStatus(1); // 1 = ACCEPTED
      expect(accepted.length).to.equal(1);
      expect(accepted[0].title).to.equal("ToAccept");
    });

    it("should return only REJECTED proposals", async function () {
      const rejected = await daoViews.getProposalsByStatus(2); // 2 = REJECTED
      expect(rejected.length).to.equal(1);
      expect(rejected[0].title).to.equal("ToReject");
    });

    it("should return empty array when no proposals match status", async function () {
      // Finalize the last active proposal
      await daoCore.finalize(1);
      
      const active = await daoViews.getProposalsByStatus(0);
      expect(active.length).to.equal(0);
    });
  });

  describe("Get user token balance", function() {
    it("should return correct balance", async function () {
      expect(await daoViews.getUserTokenBalance(alice.address)).to.equal(1000n);
      expect(await daoViews.getUserTokenBalance(bob.address)).to.equal(500n);
    });

    it("should return zero for address with no tokens", async function () {
      expect(await daoViews.getUserTokenBalance(panicWallet.address)).to.equal(0);
    });
  });

  describe("Get user staking", function() {
    beforeEach(async function() {
      await daoCore.connect(alice).createProposal("P1", "D1", Number(MIN_STAKE_PROPOSAL));
      await daoCore.connect(alice).createProposal("P2", "D2", Number(MIN_STAKE_PROPOSAL));
      await daoCore.connect(bob).vote(1, true, Number(MIN_STAKE_VOTE));
    });

    it("should return staking info for user", async function () {
      const stakingInfo = await daoViews.getUserStaking(alice.address);
      
      expect(stakingInfo.proposalIds.length).to.equal(2);
      expect(stakingInfo.voteStakes.length).to.equal(2);
      expect(stakingInfo.proposalStakes.length).to.equal(2);
      
      // Alice created both proposals
      expect(stakingInfo.proposalStakes[0]).to.equal(Number(MIN_STAKE_PROPOSAL));
      expect(stakingInfo.proposalStakes[1]).to.equal(Number(MIN_STAKE_PROPOSAL));
    });

    it("should return correct vote stakes", async function () {
      const stakingInfo = await daoViews.getUserStaking(bob.address);
      
      // Bob voted on proposal 1
      expect(stakingInfo.voteStakes[0]).to.equal(Number(MIN_STAKE_VOTE));
      expect(stakingInfo.voteStakes[1]).to.equal(0); // Didn't vote on proposal 2
    });

    it("should return empty arrays when user has no stakes", async function () {
      const stakingInfo = await daoViews.getUserStaking(panicWallet.address);
      
      expect(stakingInfo.proposalIds.length).to.equal(2); // Still shows all proposals
      expect(stakingInfo.voteStakes[0]).to.equal(0);
      expect(stakingInfo.proposalStakes[0]).to.equal(0);
    });
  });

  describe("Get delegation info", function() {
    it("should return empty info when no delegation", async function () {
      await daoCore.connect(alice).createProposal("P1", "D1", Number(MIN_STAKE_PROPOSAL));
      
      const [delegate, amount, active] = await daoViews.getDelegationInfo(1, alice.address);
      
      expect(delegate).to.equal(ethers.ZeroAddress);
      expect(amount).to.equal(0);
      expect(active).to.equal(false);
    });

    it("should return delegation info when exists", async function () {
      await daoCore.connect(alice).createProposal("P1", "D1", Number(MIN_STAKE_PROPOSAL));
      await daoDelegation.connect(alice).delegateVote(1, bob.address, Number(MIN_STAKE_VOTE));
      
      const [delegate, amount, active] = await daoViews.getDelegationInfo(1, alice.address);
      
      expect(delegate).to.equal(bob.address);
      expect(amount).to.equal(Number(MIN_STAKE_VOTE));
      expect(active).to.equal(true);
    });

    it("should show inactive delegation after use", async function () {
      await daoCore.connect(alice).createProposal("P1", "D1", Number(MIN_STAKE_PROPOSAL));
      await daoDelegation.connect(alice).delegateVote(1, bob.address, Number(MIN_STAKE_VOTE));
      await daoDelegation.connect(bob).voteWithDelegation(1, alice.address, true);
      
      const [delegate, amount, active] = await daoViews.getDelegationInfo(1, alice.address);
      
      expect(delegate).to.equal(bob.address);
      expect(amount).to.equal(Number(MIN_STAKE_VOTE));
      expect(active).to.equal(false);
    });

    it("should handle when delegation contract is not set", async function () {
      // Deploy new DAOViews without delegation
      const DAOViews = await ethers.getContractFactory("DAOViews");
      const daoViews2 = await DAOViews.deploy(await daoCore.getAddress(), ethers.ZeroAddress);
      await daoViews2.waitForDeployment();

      await daoCore.connect(alice).createProposal("P1", "D1", Number(MIN_STAKE_PROPOSAL));
      
      const [delegate, amount, active] = await daoViews2.getDelegationInfo(1, alice.address);
      
      expect(delegate).to.equal(ethers.ZeroAddress);
      expect(amount).to.equal(0);
      expect(active).to.equal(false);
    });
  });

  describe("Complex scenarios", function() {
    it("should handle multiple voters in proposal view", async function () {
      await daoCore.connect(alice).createProposal("P1", "D1", Number(MIN_STAKE_PROPOSAL));
      await daoCore.connect(alice).vote(1, true, Number(MIN_STAKE_VOTE));
      await daoCore.connect(bob).vote(1, false, Number(MIN_STAKE_VOTE));

      const proposals = await daoViews.getAllProposals();
      expect(proposals[0].voters.length).to.equal(2);
      
      const voters = proposals[0].voters;
      expect(voters.find(v => v.voter === alice.address).choice).to.equal(true);
      expect(voters.find(v => v.voter === bob.address).choice).to.equal(false);
    });

    it("should show correct data after proposal lifecycle", async function () {
      // Create
      await daoCore.connect(alice).createProposal("Lifecycle", "Test", Number(MIN_STAKE_PROPOSAL));
      
      let proposals = await daoViews.getAllProposals();
      expect(proposals[0].status).to.equal(0); // ACTIVE

      // Vote
      await daoCore.connect(bob).vote(1, true, Number(MIN_STAKE_VOTE));
      
      proposals = await daoViews.getAllProposals();
      expect(proposals[0].votesFor).to.equal(Number(MIN_STAKE_VOTE));

      // Finalize
      await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + 10]);
      await ethers.provider.send("evm_mine");
      await daoCore.finalize(1);

      proposals = await daoViews.getAllProposals();
      expect(proposals[0].status).to.equal(1); // ACCEPTED
    });
  });

  describe("Coverage Branch: Sin contrato de delegación", function() {
    it("Debe manejar correctamente getDelegationInfo cuando no hay contrato de delegación", async function () {
      const DAOViews = await ethers.getContractFactory("DAOViews");
      const viewsNoDelegation = await DAOViews.deploy(await daoCore.getAddress(), ethers.ZeroAddress);
      await viewsNoDelegation.waitForDeployment();

      const [delegate, amount, active] = await viewsNoDelegation.getDelegationInfo(1, alice.address);
      
      expect(delegate).to.equal(ethers.ZeroAddress);
      expect(amount).to.equal(0n);
      expect(active).to.equal(false);
    });
  });
});