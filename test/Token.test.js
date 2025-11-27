const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DAO Full Coverage", () => {
    let dao, daoToken, daoViews, daoDelegation;
    let token, staking;
    let owner, multisig, panicWallet, addr1, addr2, outsider;

    beforeEach(async () => {
        [owner, multisig, panicWallet, addr1, addr2, outsider] = await ethers.getSigners();

        const Token = await ethers.getContractFactory("Token");
        token = await Token.deploy(owner.address);
        await token.waitForDeployment();

        const Staking = await ethers.getContractFactory("MockStaking");
        staking = await Staking.deploy();
        await staking.waitForDeployment();

        const DAOCore = await ethers.getContractFactory("DAOCore");
        dao = await DAOCore.deploy(
            await token.getAddress(),
            multisig.address,
            100, // Price
            10,  // Min Vote
            20,  // Min Proposal
            60,  // Voting Period
            10,  // Tokens per VP
            30   // Lock time
        );
        await dao.waitForDeployment();

        const DAOToken = await ethers.getContractFactory("DAOToken");
        daoToken = await DAOToken.deploy(await dao.getAddress());
        await daoToken.waitForDeployment();

        const DAODelegation = await ethers.getContractFactory("DAODelegation");
        daoDelegation = await DAODelegation.deploy(await dao.getAddress());
        await daoDelegation.waitForDeployment();

        const DAOViews = await ethers.getContractFactory("DAOViews");
        daoViews = await DAOViews.deploy(await dao.getAddress(), await daoDelegation.getAddress());
        await daoViews.waitForDeployment();

        await dao.connect(multisig).setPanicWallet(panicWallet.address);
        await dao.connect(multisig).setStakingAddress(await staking.getAddress());
        await dao.connect(multisig).setTokenContract(await daoToken.getAddress());
        await dao.connect(multisig).setDelegationContract(await daoDelegation.getAddress());

        await token.connect(owner).transferOwnership(await daoToken.getAddress());
        
        await daoToken.connect(multisig).mintTokens(ethers.parseUnits("1000000", 18));
    });

    it("constructor configs OK", async () => {
        expect(await dao.priceWeiPerToken()).to.equal(100);
        expect(await dao.minStakeForVote()).to.equal(10);
        expect(await dao.minStakeForProposal()).to.equal(20);
    });

    it("owner puede mintear tokens", async () => {
        await daoToken.connect(multisig).mintTokens(1000);
    });

    it("mintTokens falla si panicWallet no configurada (coverage require)", async () => {
        const DAOToken = await ethers.getContractFactory("DAOToken");
        const DAOCore = await ethers.getContractFactory("DAOCore");
        
        const dao2 = await DAOCore.deploy(
            await token.getAddress(),
            multisig.address, 100, 10, 20, 60, 10, 30
        );
        await dao2.waitForDeployment();
        
        const daoToken2 = await DAOToken.deploy(await dao2.getAddress());
        await daoToken2.waitForDeployment();
        
        await dao2.connect(multisig).setTokenContract(await daoToken2.getAddress());

        await expect(daoToken2.connect(multisig).mintTokens(1000))
            .to.be.revertedWith("Panic wallet not set");
    });

    it("updateParams OK", async () => {
        await dao.connect(multisig).updateParams(200, 11, 22, 61, 9, 31);
        expect(await dao.priceWeiPerToken()).to.equal(200);
    });

    it("changeOwner OK", async () => {
        await dao.connect(multisig).changeOwner(addr1.address);
        expect(await dao.owner()).to.equal(addr1.address);
    });

    it("setPanicWallet OK", async () => {
        await dao.connect(multisig).setPanicWallet(addr1.address);
        expect(await dao.panicWallet()).to.equal(addr1.address);
    });

    it("panic / tranquility OK", async () => {
        await dao.connect(panicWallet).panic();
        expect(await dao.isPanicked()).to.equal(true);

        await dao.connect(panicWallet).tranquility();
        expect(await dao.isPanicked()).to.equal(false);
    });

    it("panic fail si caller no es panic wallet", async () => {
        await expect(dao.connect(addr1).panic())
            .to.be.revertedWith("Solo la Multisig Panico puede ejecutar esto");
    });

    it("buyTokens ok", async () => {
        await daoToken.connect(addr1).buyTokens({ value: 100 });
        expect(await token.balanceOf(addr1.address)).to.be.gt(0);
    });

    it("fail buyTokens sin tokens suficientes", async () => {
        const DAOCore = await ethers.getContractFactory("DAOCore");
        const smallDao = await DAOCore.deploy(
            await token.getAddress(), multisig.address, 100, 10, 20, 60, 10, 30
        );
        await smallDao.waitForDeployment();
        
        const DAOToken = await ethers.getContractFactory("DAOToken");
        const smallDaoToken = await DAOToken.deploy(await smallDao.getAddress());
        await smallDaoToken.waitForDeployment();

        await smallDao.connect(multisig).setPanicWallet(panicWallet.address);
        await smallDao.connect(multisig).setStakingAddress(await staking.getAddress());
        await smallDao.connect(multisig).setTokenContract(await smallDaoToken.getAddress());

        await expect(
            smallDaoToken.connect(addr1).buyTokens({ value: 100 })
        ).to.be.revertedWith("Not enough tokens in DAO");
    });

    it("createProposal OK", async () => {
        await dao.connect(addr1).createProposal("A", "B", 20);
        expect((await daoViews.getAllProposals()).length).to.equal(1);
    });

    it("createProposal falla si stake insuficiente", async () => {
        await expect(
            dao.connect(addr1).createProposal("A", "B", 1)
        ).to.be.revertedWith("Insufficient proposal stake");
    });

    it("vote linear ok", async () => {
        await dao.connect(addr1).createProposal("A", "B", 20);
        await dao.connect(addr1).vote(1, true, 20);

        const list = await daoViews.getAllProposals();
        expect(list[0].votesFor).to.equal(2);
    });

    it("vote quadratic ok", async () => {
        await dao.connect(multisig).toggleVotingMode();
        await dao.connect(addr1).createProposal("A", "B", 20);
        await dao.connect(addr1).vote(1, true, 20);

        const list = await daoViews.getAllProposals();
        expect(list[0].votesFor).to.equal(1);
    });

    it("vote falla si stake insuficiente", async () => {
        await dao.connect(addr1).createProposal("A", "B", 20);
        await expect(
            dao.connect(addr1).vote(1, true, 1)
        ).to.be.revertedWith("Insufficient voting stake");
    });

    it("unstakeVote ok", async () => {
        await dao.connect(addr1).createProposal("A", "B", 20);
        await dao.connect(addr1).vote(1, true, 20);

        await dao.connect(addr1).unstakeVote(1);
    });

    it("unstakeVote falla si usuario no votó", async () => {
        await dao.connect(addr1).createProposal("A", "B", 20);
        await expect(
            dao.connect(addr1).unstakeVote(1)
        ).to.be.revertedWith("User did not vote");
    });

    it("unstakeProposal ok", async () => {
        await dao.connect(addr1).createProposal("A", "B", 20);
        await dao.connect(addr1).unstakeProposal(1);
    });

    // --- CORRECCIONES APLICADAS ---
    it("finalize accepted", async () => {
        await dao.connect(addr1).createProposal("A", "B", 20);
        await dao.connect(addr1).vote(1, true, 20);

        await ethers.provider.send("evm_increaseTime", [1000]);
        await ethers.provider.send("evm_mine");

        // Usamos addr1 (creador) para finalizar
        await dao.connect(addr1).finalize(1);
        const p = (await daoViews.getAllProposals())[0];
        expect(p.status).to.equal(1);
    });

    it("finalize rejected", async () => {
        await dao.connect(addr1).createProposal("A", "B", 20);

        await ethers.provider.send("evm_increaseTime", [1000]);
        await ethers.provider.send("evm_mine");

        // Usamos addr1 (creador) para finalizar
        await dao.connect(addr1).finalize(1);
        const p = (await daoViews.getAllProposals())[0];
        expect(p.status).to.equal(2);
    });
    // ----------------------------

    it("finalize falla si no terminó periodo", async () => {
        await dao.connect(addr1).createProposal("A", "B", 20);
        await expect(dao.finalize(1))
            .to.be.revertedWith("Voting period not ended");
    });

    it("getProposalsByStatus OK", async () => {
        await dao.connect(addr1).createProposal("A", "B", 20);

        let list = await daoViews.getProposalsByStatus(0);
        expect(list.length).to.equal(1);
    });

    it("isValidProposal OK", async () => {
        await dao.connect(addr1).createProposal("A", "B", 20);
        expect(await dao.isValidProposal(1)).to.equal(true);
        expect(await dao.isValidProposal(99)).to.equal(false);
    });

    it("proposalCreator OK", async () => {
        await dao.connect(addr1).createProposal("A", "B", 20);
        expect(await dao.proposalCreator(1)).to.equal(addr1.address);
    });
});