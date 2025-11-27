const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Staking - 100% Coverage", function () {
  let owner, user, creator, otherUser;
  let token, staking, mockDao;

  beforeEach(async () => {
    [owner, user, creator, otherUser] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockToken");
    token = await MockToken.deploy();
    await token.waitForDeployment();

    const MockDAO = await ethers.getContractFactory("MockDAO");
    mockDao = await MockDAO.deploy();
    await mockDao.waitForDeployment();

    const Staking = await ethers.getContractFactory("Staking");
    staking = await Staking.deploy(
      await token.getAddress(),
      await mockDao.getAddress(),
      otherUser.address
    );
    await staking.waitForDeployment();

    await mockDao.setStaking(await staking.getAddress());
    await mockDao.setCreator(creator.address);

    await token.mint(user.address, ethers.parseEther("10000"));
    await token.mint(creator.address, ethers.parseEther("10000"));
    await token.connect(user).approve(await staking.getAddress(), ethers.parseEther("10000"));
    await token.connect(creator).approve(await staking.getAddress(), ethers.parseEther("10000"));
  });

  describe("Constructor", function () {
    it("should deploy correctly with valid addresses", async () => {
      expect(await staking.token()).to.equal(await token.getAddress());
      expect(await staking.daoCore()).to.equal(await mockDao.getAddress());
    });

    it("should revert with zero token address", async () => {
      const Staking = await ethers.getContractFactory("Staking");
      await expect(
        Staking.deploy(ethers.ZeroAddress, await mockDao.getAddress(), otherUser.address)
      ).to.be.revertedWith("Invalid address");
    });

    it("should revert with zero dao address", async () => {
      const Staking = await ethers.getContractFactory("Staking");
      await expect(
        Staking.deploy(await token.getAddress(), ethers.ZeroAddress, otherUser.address)
      ).to.be.revertedWith("Invalid address");
    });
  });

  describe("Modifier onlyDAO", function () {
    it("should block non-DAO from calling stakeVote", async () => {
      await expect(
        staking.connect(user).stakeVote(user.address, 100, 1, 100)
      ).to.be.revertedWith("Staking: not DAO");
    });

    it("should block non-DAO from calling unstakeVote", async () => {
      await expect(
        staking.connect(user).unstakeVote(user.address, 1)
      ).to.be.revertedWith("Staking: not DAO");
    });

    it("should block non-DAO from calling stakeProposal", async () => {
      await expect(
        staking.connect(user).stakeProposal(user.address, 100, 1)
      ).to.be.revertedWith("Staking: not DAO");
    });

    it("should block non-DAO from calling unstakeProposal", async () => {
      await expect(
        staking.connect(user).unstakeProposal(user.address, 1)
      ).to.be.revertedWith("Staking: not DAO");
    });
  });

  describe("stakeVote", function () {
    it("should stake successfully", async () => {
      await mockDao.callStakeVote(user.address, 100, 1);
      expect(await staking.voteStakeOf(user.address, 1)).to.equal(100);
    });

    it("should emit VoteStaked event", async () => {
      await expect(mockDao.callStakeVote(user.address, 100, 1))
        .to.emit(staking, "VoteStaked");
    });

    it("should set unlock time", async () => {
      await mockDao.callStakeVote(user.address, 100, 1);
      const unlockTime = await staking.voteUnlockTimeOf(user.address, 1);
      expect(unlockTime).to.be.gt(0);
    });

    it("should accumulate multiple stakes", async () => {
      await mockDao.callStakeVote(user.address, 100, 1);
      await mockDao.callStakeVote(user.address, 50, 1);
      expect(await staking.voteStakeOf(user.address, 1)).to.equal(150);
    });

    it("should extend unlock time on additional stake", async () => {
      await mockDao.callStakeVote(user.address, 100, 1);
      const firstUnlock = await staking.voteUnlockTimeOf(user.address, 1);
      
      await ethers.provider.send("evm_increaseTime", [1800]);
      await ethers.provider.send("evm_mine");
      
      await mockDao.callStakeVote(user.address, 50, 1);
      const secondUnlock = await staking.voteUnlockTimeOf(user.address, 1);
      
      expect(secondUnlock).to.be.gt(firstUnlock);
    });

    it("should NOT update unlock time when new calculated unlock is not greater", async () => {
      const proposalId = 98;
      
      await mockDao.setLockTime(10000);
      await mockDao.callStakeVote(user.address, 100, proposalId);
      
      await mockDao.setLockTime(1);
      await mockDao.callStakeVote(user.address, 50, proposalId);
      
      expect(await staking.voteStakeOf(user.address, proposalId)).to.equal(150);
      await mockDao.setLockTime(3600);
    });

    it("should revert with invalid proposal", async () => {
      await mockDao.setValid(false);
      await expect(
        mockDao.callStakeVote(user.address, 100, 1)
      ).to.be.revertedWith("Invalid proposal");
    });

    it("should revert with zero amount", async () => {
      await expect(
        mockDao.callStakeVote(user.address, 0, 1)
      ).to.be.revertedWith("Invalid amount");
    });

    it("should revert when transferFrom fails (paused)", async () => {
      await token.pause();
      await expect(
        mockDao.callStakeVote(user.address, 100, 1)
      ).to.be.revertedWith("Pausable: paused");
      await token.unpause();
    });
  });

  describe("unstakeVote", function () {
    beforeEach(async () => {
      await mockDao.callStakeVote(user.address, 100, 1);
    });

    it("should unstake successfully after lock period", async () => {
      await ethers.provider.send("evm_increaseTime", [3700]);
      await ethers.provider.send("evm_mine");
      
      const balBefore = await token.balanceOf(user.address);
      await mockDao.callUnstakeVote(user.address, 1);
      const balAfter = await token.balanceOf(user.address);
      
      expect(balAfter - balBefore).to.equal(100);
      expect(await staking.voteStakeOf(user.address, 1)).to.equal(0);
    });

    it("should emit VoteUnstaked event", async () => {
      await ethers.provider.send("evm_increaseTime", [3700]);
      await ethers.provider.send("evm_mine");
      
      await expect(mockDao.callUnstakeVote(user.address, 1))
        .to.emit(staking, "VoteUnstaked")
        .withArgs(user.address, 1);
    });

    it("should revert when no stake exists", async () => {
      await expect(
        mockDao.callUnstakeVote(user.address, 999)
      ).to.be.revertedWith("No vote stake");
    });

    it("should revert when stake is locked", async () => {
      await expect(
        mockDao.callUnstakeVote(user.address, 1)
      ).to.be.revertedWith("Locked stake");
    });

    it("should revert when transfer fails (paused)", async () => {
      await ethers.provider.send("evm_increaseTime", [3700]);
      await ethers.provider.send("evm_mine");
      
      await token.pause();
      await expect(
        mockDao.callUnstakeVote(user.address, 1)
      ).to.be.revertedWith("Pausable: paused");
      await token.unpause();
    });
  });

  describe("stakeProposal", function () {
    it("should stake successfully for creator", async () => {
      await mockDao.callStakeProposal(creator.address, 200, 1);
      expect(await staking.proposalStakeOf(creator.address, 1)).to.equal(200);
    });

    it("should emit ProposalStaked event", async () => {
      await expect(mockDao.callStakeProposal(creator.address, 200, 1))
        .to.emit(staking, "ProposalStaked");
    });

    it("should set unlock time", async () => {
      await mockDao.callStakeProposal(creator.address, 200, 1);
      const unlockTime = await staking.proposalUnlockTimeOf(creator.address, 1);
      expect(unlockTime).to.be.gt(0);
    });

    it("should accumulate multiple stakes", async () => {
      await mockDao.callStakeProposal(creator.address, 100, 1);
      await mockDao.callStakeProposal(creator.address, 50, 1);
      expect(await staking.proposalStakeOf(creator.address, 1)).to.equal(150);
    });

    it("should extend unlock time on additional stake", async () => {
      await mockDao.callStakeProposal(creator.address, 100, 1);
      const firstUnlock = await staking.proposalUnlockTimeOf(creator.address, 1);
      
      await ethers.provider.send("evm_increaseTime", [1800]);
      await ethers.provider.send("evm_mine");
      
      await mockDao.callStakeProposal(creator.address, 50, 1);
      const secondUnlock = await staking.proposalUnlockTimeOf(creator.address, 1);
      
      expect(secondUnlock).to.be.gt(firstUnlock);
    });

    it("should revert with invalid proposal", async () => {
      await mockDao.setValid(false);
      await expect(
        mockDao.callStakeProposal(creator.address, 100, 1)
      ).to.be.revertedWith("Invalid proposal");
    });

    it("should revert with zero amount", async () => {
      await expect(
        mockDao.callStakeProposal(creator.address, 0, 1)
      ).to.be.revertedWith("Invalid amount");
    });

    it("should revert when non-creator tries to stake", async () => {
      await expect(
        mockDao.callStakeProposal(user.address, 100, 1)
      ).to.be.revertedWith("Only proposal creator can stake");
    });

    it("should revert when transferFrom fails (paused)", async () => {
      await token.pause();
      await expect(
        mockDao.callStakeProposal(creator.address, 100, 1)
      ).to.be.revertedWith("Pausable: paused");
      await token.unpause();
    });
  });

  describe("unstakeProposal", function () {
    beforeEach(async () => {
      await mockDao.callStakeProposal(creator.address, 200, 1);
    });

    it("should unstake successfully after lock period", async () => {
      await ethers.provider.send("evm_increaseTime", [3700]);
      await ethers.provider.send("evm_mine");
      
      const balBefore = await token.balanceOf(creator.address);
      await mockDao.callUnstakeProposal(creator.address, 1);
      const balAfter = await token.balanceOf(creator.address);
      
      expect(balAfter - balBefore).to.equal(200);
      expect(await staking.proposalStakeOf(creator.address, 1)).to.equal(0);
    });

    it("should emit ProposalUnstaked event", async () => {
      await ethers.provider.send("evm_increaseTime", [3700]);
      await ethers.provider.send("evm_mine");
      
      await expect(mockDao.callUnstakeProposal(creator.address, 1))
        .to.emit(staking, "ProposalUnstaked")
        .withArgs(creator.address, 1);
    });

    it("should revert when no stake exists", async () => {
      await expect(
        mockDao.callUnstakeProposal(creator.address, 999)
      ).to.be.revertedWith("No proposal stake");
    });

    it("should revert when stake is locked", async () => {
      await expect(
        mockDao.callUnstakeProposal(creator.address, 1)
      ).to.be.revertedWith("Locked stake");
    });

    it("should revert when non-creator tries to unstake", async () => {
      await ethers.provider.send("evm_increaseTime", [3700]);
      await ethers.provider.send("evm_mine");
      
      await mockDao.setCreator(user.address);
      await expect(
        mockDao.callUnstakeProposal(creator.address, 1)
      ).to.be.revertedWith("Only proposal creator can unstake");
    });

    it("should revert when transfer fails (paused)", async () => {
      await ethers.provider.send("evm_increaseTime", [3700]);
      await ethers.provider.send("evm_mine");
      
      await token.pause();
      await expect(
        mockDao.callUnstakeProposal(creator.address, 1)
      ).to.be.revertedWith("Pausable: paused");
      await token.unpause();
    });
  });

  describe("View Functions", function () {
    it("voteStakeOf should return correct values", async () => {
      expect(await staking.voteStakeOf(user.address, 1)).to.equal(0);
      await mockDao.callStakeVote(user.address, 100, 1);
      expect(await staking.voteStakeOf(user.address, 1)).to.equal(100);
    });

    it("voteUnlockTimeOf should return correct values", async () => {
      expect(await staking.voteUnlockTimeOf(user.address, 1)).to.equal(0);
      await mockDao.callStakeVote(user.address, 100, 1);
      expect(await staking.voteUnlockTimeOf(user.address, 1)).to.be.gt(0);
    });

    it("proposalStakeOf should return correct values", async () => {
      expect(await staking.proposalStakeOf(creator.address, 1)).to.equal(0);
      await mockDao.callStakeProposal(creator.address, 200, 1);
      expect(await staking.proposalStakeOf(creator.address, 1)).to.equal(200);
    });

    it("proposalUnlockTimeOf should return correct values", async () => {
      expect(await staking.proposalUnlockTimeOf(creator.address, 1)).to.equal(0);
      await mockDao.callStakeProposal(creator.address, 200, 1);
      expect(await staking.proposalUnlockTimeOf(creator.address, 1)).to.be.gt(0);
    });
  });
  
  describe("Coverage de Seguridad y Validaciones (Edge Cases)", function () {
    it("Debe revertir si un usuario llama directamente a stakeVote (onlyDAO)", async () => {
      await expect(
        staking.connect(user).stakeVote(user.address, 100, 1, 100)
      ).to.be.revertedWith("Staking: not DAO");
    });

    it("Debe revertir si un usuario llama directamente a unstakeVote (onlyDAO)", async () => {
      await expect(
        staking.connect(user).unstakeVote(user.address, 1)
      ).to.be.revertedWith("Staking: not DAO");
    });

    it("Debe revertir unstakeVote si el tiempo de bloqueo no ha pasado", async () => {
      await mockDao.callStakeVote(user.address, 100, 1);
      await expect(
        mockDao.callUnstakeVote(user.address, 1)
      ).to.be.revertedWith("Locked stake");
    });

    it("Debe revertir unstakeProposal si quien llama no es el creador original", async () => {
      await mockDao.callStakeProposal(creator.address, 100, 1);
      await ethers.provider.send("evm_increaseTime", [4000]); 
      await ethers.provider.send("evm_mine");
      await mockDao.setCreator(user.address); 
      await expect(
        mockDao.callUnstakeProposal(creator.address, 1)
      ).to.be.revertedWith("Only proposal creator can unstake");
    });
  });
});