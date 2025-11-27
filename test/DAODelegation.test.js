const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DAODelegation - Full Coverage", function () {
  let daoCore, daoDelegation, token, staking;
  let owner, alice, bob, charlie, panicWallet;

  const PRICE = 1n;
  const TOKENS_PER_VP = 1n;
  const MIN_STAKE_VOTE = 10n;
  const MIN_STAKE_PROPOSAL = 20n;
  const VOTING_PERIOD = 60 * 60 * 24;
  const LOCK_TIME = 60 * 60;

  beforeEach(async function () {
    [owner, alice, bob, charlie, panicWallet] = await ethers.getSigners();

    // Deploy Mock Token
    const MockTokenFactory = await ethers.getContractFactory("MockToken");
    token = await MockTokenFactory.deploy();
    await token.waitForDeployment();

    // Mint tokens to users
    await token.mint(alice.address, 1000n);
    await token.mint(bob.address, 1000n);

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

    // Configure DAOCore
    await daoCore.setPanicWallet(panicWallet.address);
    await daoCore.setStakingAddress(await staking.getAddress());
    await daoCore.setDelegationContract(await daoDelegation.getAddress());

    // Create a proposal
    await daoCore.connect(alice).createProposal("P1", "D1", Number(MIN_STAKE_PROPOSAL));
  });

  describe("Constructor", function() {
    it("should revert with zero DAO core address", async function () {
      const F = await ethers.getContractFactory("DAODelegation");
      await expect(F.deploy(ethers.ZeroAddress)).to.be.revertedWith("Invalid DAO core");
    });

    it("should set daoCore correctly", async function () {
      expect(await daoDelegation.daoCore()).to.equal(await daoCore.getAddress());
    });
  });

  describe("Delegate vote", function() {
    it("should delegate vote successfully", async function () {
      await expect(
        daoDelegation.connect(alice).delegateVote(1, bob.address, Number(MIN_STAKE_VOTE))
      ).to.emit(daoDelegation, "VoteDelegated")
        .withArgs(1, alice.address, bob.address, Number(MIN_STAKE_VOTE));

      expect(await daoDelegation.hasDelegated(1, alice.address)).to.equal(true);
    });

    it("should revert with zero delegate address", async function () {
      await expect(
        daoDelegation.connect(alice).delegateVote(1, ethers.ZeroAddress, Number(MIN_STAKE_VOTE))
      ).to.be.revertedWith("Invalid delegate");
    });

    it("should revert when delegating to yourself", async function () {
      await expect(
        daoDelegation.connect(alice).delegateVote(1, alice.address, Number(MIN_STAKE_VOTE))
      ).to.be.revertedWith("Cannot delegate to yourself");
    });

    it("should revert with insufficient delegation amount", async function () {
      await expect(
        daoDelegation.connect(alice).delegateVote(1, bob.address, Number(MIN_STAKE_VOTE) - 1)
      ).to.be.revertedWith("Insufficient delegation amount");
    });

    it("should revert with invalid proposal", async function () {
      await expect(
        daoDelegation.connect(alice).delegateVote(999, bob.address, Number(MIN_STAKE_VOTE))
      ).to.be.revertedWith("Invalid proposal");
    });

    it("should revert when proposal not active", async function () {
      // Wait for voting period to end
      await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + 10]);
      await ethers.provider.send("evm_mine");

      await expect(
        daoDelegation.connect(alice).delegateVote(1, bob.address, Number(MIN_STAKE_VOTE))
      ).to.be.revertedWith("Proposal not active");
    });

    it("should revert when already voted", async function () {
      // Vote first
      await daoCore.connect(alice).vote(1, true, Number(MIN_STAKE_VOTE));

      // Try to delegate
      await expect(
        daoDelegation.connect(alice).delegateVote(1, bob.address, Number(MIN_STAKE_VOTE))
      ).to.be.revertedWith("Already voted, cannot delegate");
    });

    it("should revert when already delegated", async function () {
      await daoDelegation.connect(alice).delegateVote(1, bob.address, Number(MIN_STAKE_VOTE));

      await expect(
        daoDelegation.connect(alice).delegateVote(1, charlie.address, Number(MIN_STAKE_VOTE))
      ).to.be.revertedWith("Already delegated for this proposal");
    });

    it("should revert with insufficient token balance", async function () {
      // Charlie has no tokens
      await expect(
        daoDelegation.connect(charlie).delegateVote(1, bob.address, Number(MIN_STAKE_VOTE))
      ).to.be.revertedWith("Insufficient token balance");
    });
  });

  describe("Vote with delegation", function() {
    beforeEach(async function() {
      // Alice delegates to Bob
      await daoDelegation.connect(alice).delegateVote(1, bob.address, Number(MIN_STAKE_VOTE));
    });

    it("should vote with delegation successfully", async function () {
      await expect(
        daoDelegation.connect(bob).voteWithDelegation(1, alice.address, true)
      ).to.emit(daoCore, "Voted");

      const [,,,,votesFor,,,,] = await daoCore.getProposal(1);
      expect(votesFor).to.equal(Number(MIN_STAKE_VOTE) / Number(TOKENS_PER_VP));
    });

    it("should revert without delegation", async function () {
      await expect(
        daoDelegation.connect(bob).voteWithDelegation(1, charlie.address, true)
      ).to.be.revertedWith("No delegation from this address");
    });

    it("should revert when delegation not active", async function () {
      // Bob votes, consuming the delegation
      await daoDelegation.connect(bob).voteWithDelegation(1, alice.address, true);

      // Alice tries to delegate again (delegation is consumed)
      await expect(
        daoDelegation.connect(bob).voteWithDelegation(1, alice.address, true)
      ).to.be.revertedWith("Delegation not active");
    });

    it("should revert when not the delegate", async function () {
      await expect(
        daoDelegation.connect(charlie).voteWithDelegation(1, alice.address, true)
      ).to.be.revertedWith("Not the delegate");
    });

    it("should revert with invalid proposal", async function () {
      await expect(
        daoDelegation.connect(bob).voteWithDelegation(999, alice.address, true)
      ).to.be.revertedWith('No delegation from this address')
    });

    it("should revert when proposal not active", async function () {
      await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + 10]);
      await ethers.provider.send("evm_mine");

      await expect(
        daoDelegation.connect(bob).voteWithDelegation(1, alice.address, true)
      ).to.be.revertedWith("Proposal not active");
    });

    it("should revert when delegate already voted directly", async function () {
      // Bob votes directly first
      await daoCore.connect(bob).vote(1, true, Number(MIN_STAKE_VOTE));

      // Bob tries to use delegation
      await expect(
        daoDelegation.connect(bob).voteWithDelegation(1, alice.address, true)
      ).to.be.revertedWith("Delegate already voted");
    });

    it("should vote AGAINST with delegation", async function () {
      await daoDelegation.connect(bob).voteWithDelegation(1, alice.address, false);

      const [,,,,,votesAgainst,,,] = await daoCore.getProposal(1);
      expect(votesAgainst).to.equal(Number(MIN_STAKE_VOTE) / Number(TOKENS_PER_VP));
    });

    it("should mark delegation as inactive after voting", async function () {
      await daoDelegation.connect(bob).voteWithDelegation(1, alice.address, true);

      const delegation = await daoDelegation.voteDelegations(1, alice.address);
      expect(delegation.active).to.equal(false);
    });
  });

  describe("Revoke delegation", function() {
    beforeEach(async function() {
      await daoDelegation.connect(alice).delegateVote(1, bob.address, Number(MIN_STAKE_VOTE));
    });

    it("should revoke delegation successfully", async function () {
      await expect(
        daoDelegation.connect(alice).revokeDelegation(1)
      ).to.emit(daoDelegation, "VoteDelegationRevoked")
        .withArgs(1, alice.address, bob.address);

      const delegation = await daoDelegation.voteDelegations(1, alice.address);
      expect(delegation.active).to.equal(false);
    });

    it("should revert when no delegation exists", async function () {
      await expect(
        daoDelegation.connect(charlie).revokeDelegation(1)
      ).to.be.revertedWith("No active delegation");
    });

    it("should revert when delegation already used", async function () {
      // Bob uses the delegation
      await daoDelegation.connect(bob).voteWithDelegation(1, alice.address, true);

      // Alice tries to revoke
      await expect(
        daoDelegation.connect(alice).revokeDelegation(1)
      ).to.be.revertedWith("Delegation already used or revoked");
    });

    it("should revert when delegate already voted", async function () {
      // Bob votes directly
      await daoCore.connect(bob).vote(1, true, Number(MIN_STAKE_VOTE));

      // Alice tries to revoke
      await expect(
        daoDelegation.connect(alice).revokeDelegation(1)
      ).to.be.revertedWith("Delegate already voted");
    });
  });

  describe("Get delegation info", function() {
    it("should return empty info when no delegation", async function () {
      const [delegate, amount, active] = await daoDelegation.getDelegationInfo(1, alice.address);
      
      expect(delegate).to.equal(ethers.ZeroAddress);
      expect(amount).to.equal(0);
      expect(active).to.equal(false);
    });

    it("should return delegation info correctly", async function () {
      await daoDelegation.connect(alice).delegateVote(1, bob.address, Number(MIN_STAKE_VOTE));

      const [delegate, amount, active] = await daoDelegation.getDelegationInfo(1, alice.address);
      
      expect(delegate).to.equal(bob.address);
      expect(amount).to.equal(Number(MIN_STAKE_VOTE));
      expect(active).to.equal(true);
    });

    it("should show inactive after delegation used", async function () {
      await daoDelegation.connect(alice).delegateVote(1, bob.address, Number(MIN_STAKE_VOTE));
      await daoDelegation.connect(bob).voteWithDelegation(1, alice.address, true);

      const [delegate, amount, active] = await daoDelegation.getDelegationInfo(1, alice.address);
      
      expect(delegate).to.equal(bob.address);
      expect(amount).to.equal(Number(MIN_STAKE_VOTE));
      expect(active).to.equal(false);
    });
  });

  describe("Integration with voting modes", function() {
    it("should work with QUADRATIC voting mode", async function () {
      // Switch to quadratic mode
      await daoCore.toggleVotingMode();

      // Delegate 100 tokens
      await daoDelegation.connect(alice).delegateVote(1, bob.address, 100);

      // Vote with delegation
      await daoDelegation.connect(bob).voteWithDelegation(1, alice.address, true);

      // Check voting power (sqrt(100/1) = 10)
      const [,,,,votesFor,,,,] = await daoCore.getProposal(1);
      expect(votesFor).to.equal(10);
    });
  });

  describe("Panic mode integration", function() {
    it("should block delegation when panicked", async function () {
      await daoCore.connect(panicWallet).panic();

      await expect(
        daoDelegation.connect(alice).delegateVote(1, bob.address, Number(MIN_STAKE_VOTE))
      ).to.be.revertedWith("Panic mode active");
    });

    it("should block revocation when panicked", async function () {
      await daoDelegation.connect(alice).delegateVote(1, bob.address, Number(MIN_STAKE_VOTE));
      
      await daoCore.connect(panicWallet).panic();

      await expect(
        daoDelegation.connect(alice).revokeDelegation(1)
      ).to.be.revertedWith("Panic mode active");
    });

    it("should block voting with delegation when panicked", async function () {
      await daoDelegation.connect(alice).delegateVote(1, bob.address, Number(MIN_STAKE_VOTE));
      
      await daoCore.connect(panicWallet).panic();

      await expect(
        daoDelegation.connect(bob).voteWithDelegation(1, alice.address, true)
      ).to.be.revertedWith("Panic mode active");
    });
  });
});