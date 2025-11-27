// SPDX-License-Identifier: MIT 
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

interface IMintableERC20 {
    function mint(address to, uint256 amount) external;
    function decimals() external view returns (uint8);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}

interface IStaking {
    function stakeVote(address user, uint256 amount, uint256 proposalId, uint256 votingPower) external;
    function stakeProposal(address user, uint256 amount, uint256 proposalId) external;
    function unstakeVote(address user, uint256 proposalId) external;
    function unstakeProposal(address user, uint256 proposalId) external;
    function voteStakeOf(address user, uint256 proposalId) external view returns (uint256);
    function proposalStakeOf(address user, uint256 proposalId) external view returns (uint256);
    function voteVotingPowerOf(address user, uint256 proposalId) external view returns (uint256);
}

interface IMultiSig {
    function owners() external view returns (address[] memory);
}

interface IDAODelegation {
    function delegateVote(uint256 proposalId, address delegate, uint256 amount) external;
    function revokeDelegation(uint256 proposalId) external;
    function voteWithDelegation(uint256 proposalId, address delegator, bool inFavor) external returns (uint256);
    function hasDelegated(uint256 proposalId, address delegator) external view returns (bool);
    function getDelegationInfo(uint256 proposalId, address delegator) external view returns (address, uint256, bool);
}

interface IDAOToken {
    function buyTokens() external payable;
    function mintTokens(uint256 amount) external;
}

contract DAOCore is Ownable {
    enum VotingMode { LINEAR, QUADRATIC }
    enum ProposalStatus { ACTIVE, ACCEPTED, REJECTED }

    struct Proposal {
        uint256 id;
        address creator;
        string title;
        string description;
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 startTime;
        ProposalStatus status;
        mapping(address => bool) voted;
        mapping(address => bool) voteChoice;
        address[] voters;
    }

    IMintableERC20 public token;
    uint8 public tokenDecimals;
    IStaking public staking;
    IDAODelegation public delegation;
    IDAOToken public daoToken;

    address public panicWallet;
    bool public isPanicked;

    uint256 public priceWeiPerToken;
    uint256 public minStakeForVote;
    uint256 public minStakeForProposal;
    uint256 public votingPeriod;
    uint256 public tokensPerVotingPower;
    uint256 public lockTimeSeconds;
    VotingMode public votingMode = VotingMode.LINEAR;

    uint256 public proposalCount;
    mapping(uint256 => Proposal) private _proposals;

    event PanicSet(address indexed wallet);
    event PanicTriggered();
    event TranquilityRestored();
    event ParamsUpdated(uint256 priceWeiPerToken, uint256 minStakeVote, uint256 minStakeProposal, uint256 votingPeriod, uint256 tokensPerVP, uint256 lockTimeSeconds);
    event VotingModeToggled(VotingMode mode);
    event StakingChanged(address indexed oldStaking, address indexed newStaking);
    event ProposalCreated(uint256 indexed id, address indexed creator, string title);
    event Voted(uint256 indexed id, address indexed voter, bool inFavor, uint256 power);
    event ProposalFinalized(uint256 indexed id, ProposalStatus status);
    event DelegationContractSet(address indexed delegation);
    event TokenContractSet(address indexed tokenContract);

    modifier notPanicked() {
        require(!isPanicked, "Panic mode active");
        _; 
    }

    modifier panicConfigured() {
        require(panicWallet != address(0), "Panic wallet not set");
        _;
    }

    modifier onlyStakingSet() {
        require(address(staking) != address(0), "Invalid staking");
        _;
    }

    modifier onlyMultisigPanicOwner() {
        require(msg.sender == panicWallet, "Solo la Multisig Panico puede ejecutar esto");
        _;
    }

    modifier onlyMultisigOwner() {
        require(msg.sender == owner(), "Solo la Multisig Owner puede ejecutar esto");
        _;
    }

    constructor(
        address _token,
        address _multisigOwner,
        uint256 _priceWeiPerToken,
        uint256 _minStakeVote,
        uint256 _minStakeProposal,
        uint256 _votingPeriodSeconds,
        uint256 _tokensPerVotingPower,
        uint256 _lockTimeSeconds
    ) Ownable(_multisigOwner) {
        require(_token != address(0), "Invalid token");
        require(_multisigOwner != address(0), "Invalid owner");
        require(_priceWeiPerToken > 0, "Invalid price");
        require(_tokensPerVotingPower > 0, "Invalid tokensPerVP");
        require(_votingPeriodSeconds > 0, "Invalid voting period");
        require(_votingPeriodSeconds >= _lockTimeSeconds, "Voting period cannot be less than lock time");

        token = IMintableERC20(_token);
        tokenDecimals = token.decimals();

        priceWeiPerToken = _priceWeiPerToken;
        minStakeForVote = _minStakeVote;
        minStakeForProposal = _minStakeProposal;
        votingPeriod = _votingPeriodSeconds;
        tokensPerVotingPower = _tokensPerVotingPower;
        lockTimeSeconds = _lockTimeSeconds;
    }

    // --- CONFIGURACIÓN ---
    function setDelegationContract(address _delegation) external onlyMultisigOwner {
        require(_delegation != address(0), "Invalid delegation");
        delegation = IDAODelegation(_delegation);
        emit DelegationContractSet(_delegation);
    }

    function setTokenContract(address _tokenContract) external onlyMultisigOwner {
        require(_tokenContract != address(0), "Invalid token contract");
        daoToken = IDAOToken(_tokenContract);
        emit TokenContractSet(_tokenContract);
    }

    function setStakingAddress(address _staking) external onlyMultisigOwner {
        require(_staking != address(0), "Invalid staking");
        address old = address(staking);
        staking = IStaking(_staking);
        emit StakingChanged(old, _staking);
    }

    function updateParams(
        uint256 _priceWeiPerToken,
        uint256 _minStakeVote,
        uint256 _minStakeProposal,
        uint256 _votingPeriodSeconds,
        uint256 _tokensPerVotingPower,
        uint256 _lockTimeSeconds
    ) external onlyMultisigOwner panicConfigured notPanicked {
        require(_priceWeiPerToken > 0, "Invalid price");
        require(_tokensPerVotingPower > 0, "Invalid tokensPerVP");
        require(_votingPeriodSeconds > 0, "Invalid voting period");

        priceWeiPerToken = _priceWeiPerToken;
        minStakeForVote = _minStakeVote;
        minStakeForProposal = _minStakeProposal;
        votingPeriod = _votingPeriodSeconds;
        tokensPerVotingPower = _tokensPerVotingPower;
        lockTimeSeconds = _lockTimeSeconds;

        emit ParamsUpdated(_priceWeiPerToken, _minStakeVote, _minStakeProposal, _votingPeriodSeconds, _tokensPerVotingPower, _lockTimeSeconds);
    }

    function changeOwner(address newOwner) external onlyMultisigOwner notPanicked {
        require(newOwner != address(0), "Invalid new owner");
        transferOwnership(newOwner);
    }

    function setPanicWallet(address _wallet) external onlyMultisigOwner notPanicked {
        require(_wallet != address(0), "Invalid wallet");
        panicWallet = _wallet;
        emit PanicSet(_wallet);
    }

    function toggleVotingMode() external onlyMultisigOwner panicConfigured notPanicked {
        votingMode = (votingMode == VotingMode.LINEAR) ? VotingMode.QUADRATIC : VotingMode.LINEAR;
        emit VotingModeToggled(votingMode);
    }

    function panic() external panicConfigured onlyMultisigPanicOwner {
        isPanicked = true;
        emit PanicTriggered();
    }

    function tranquility() external panicConfigured onlyMultisigPanicOwner {
        isPanicked = false;
        emit TranquilityRestored();
    }

    // --- PROPUESTAS ---
    function createProposal(string memory title, string memory description, uint256 stakingAmount)
        external
        notPanicked
        panicConfigured
        onlyStakingSet
    {
        require(stakingAmount >= minStakeForProposal, "Insufficient proposal stake");

        uint256 id = ++proposalCount;
        Proposal storage p = _proposals[id];
        p.id = id;
        p.creator = msg.sender;
        p.title = title;
        p.description = description;
        p.startTime = block.timestamp;
        p.status = ProposalStatus.ACTIVE;

        emit ProposalCreated(id, msg.sender, title);

        staking.stakeProposal(msg.sender, stakingAmount, id);
    }

    function vote(uint256 id, bool inFavor, uint256 stakingAmount)
        external
        notPanicked
        panicConfigured
        onlyStakingSet
    {
        require(stakingAmount >= minStakeForVote, "Insufficient voting stake");
        Proposal storage p = _proposals[id];
        require(p.id > 0 && p.id <= proposalCount, "Invalid proposal");
        require(_isActive(id), "Voting period ended");

        if (address(delegation) != address(0)) {
            require(!delegation.hasDelegated(id, msg.sender), "Already delegated vote for this proposal");
        }

        uint256 vp = _calculateVotingPower(stakingAmount);
        require(vp > 0, "Zero voting power");

        p.voted[msg.sender] = true;
        p.voteChoice[msg.sender] = inFavor;
        p.voters.push(msg.sender);

        if (inFavor) p.votesFor += vp;
        else p.votesAgainst += vp;

        emit Voted(id, msg.sender, inFavor, vp);

        staking.stakeVote(msg.sender, stakingAmount, id, vp);
    }

    function unstakeVote(uint256 proposalId) external notPanicked onlyStakingSet panicConfigured {
        Proposal storage p = _proposals[proposalId];
        require(p.voted[msg.sender], "User did not vote");

        uint256 vp = staking.voteVotingPowerOf(msg.sender, proposalId);

        uint256 stakeAmount = staking.voteStakeOf(msg.sender, proposalId);
        require(stakeAmount > 0, "No stake to unstake");
        
        if (p.voteChoice[msg.sender]) {
            if (p.votesFor >= vp) p.votesFor -= vp;
            else p.votesFor = 0;
        } else {
            if (p.votesAgainst >= vp) p.votesAgainst -= vp;
            else p.votesAgainst = 0;
        }

        p.voted[msg.sender] = false;
        delete p.voteChoice[msg.sender];

        _removeVoter(p, msg.sender);
        
        staking.unstakeVote(msg.sender, proposalId);
    }

    function recordDelegatedVote(uint256 id, address voter, bool inFavor, uint256 votingPower) external notPanicked {
        require(msg.sender == address(delegation), "Only delegation contract");
        
        Proposal storage p = _proposals[id];
        require(p.id > 0 && p.id <= proposalCount, "Invalid proposal");
        require(_isActive(id), "Voting period ended");
        require(!p.voted[voter], "Already voted");

        p.voted[voter] = true;
        p.voteChoice[voter] = inFavor;
        p.voters.push(voter);

        if (inFavor) p.votesFor += votingPower;
        else p.votesAgainst += votingPower;

        emit Voted(id, voter, inFavor, votingPower);
    }

    function unstakeProposal(uint256 proposalId) external notPanicked onlyStakingSet panicConfigured {
        staking.unstakeProposal(msg.sender, proposalId);
    }

    function finalize(uint256 id) external notPanicked panicConfigured {
        Proposal storage p = _proposals[id];
        require(p.status == ProposalStatus.ACTIVE, "Already finalized");
        require(block.timestamp > p.startTime + votingPeriod, "Voting period not ended");
        require(_proposals[id].creator == msg.sender || msg.sender == owner(), "Only creator or owner can finalize");

        if (p.votesFor > p.votesAgainst) {
            p.status = ProposalStatus.ACCEPTED;
        } else {
            p.status = ProposalStatus.REJECTED;
        }

        emit ProposalFinalized(id, p.status);
    }

    // --- FUNCIONES INTERNAS ---
    function _isActive(uint256 id) internal view returns (bool) {
        Proposal storage p = _proposals[id];
        if (p.status != ProposalStatus.ACTIVE) return false;
        if (block.timestamp > p.startTime + votingPeriod) return false;
        return true;
    }

    function _calculateVotingPower(uint256 stakingAmount) internal view returns (uint256) {
        if (votingMode == VotingMode.QUADRATIC) {
            uint256 base = stakingAmount / tokensPerVotingPower;
            return Math.sqrt(base);
        } else {
            return stakingAmount / tokensPerVotingPower;
        }
    }

    function _removeVoter(Proposal storage p, address voter) internal {
        uint256 n = p.voters.length;
        for (uint256 i = 0; i < n; i++) {
            if (p.voters[i] == voter) {
                p.voters[i] = p.voters[n - 1];
                p.voters.pop();
                break;
            }
        }
    }

    // --- VISTAS PÚBLICAS ---
    function getParams() external view returns (
        uint256 priceWeiPerToken_,
        uint256 minStakeForVote_,
        uint256 minStakeForProposal_,
        uint256 votingPeriod_,
        uint256 tokensPerVotingPower_,
        uint256 lockTimeSeconds_
    ) {
        priceWeiPerToken_ = priceWeiPerToken;
        minStakeForVote_ = minStakeForVote;
        minStakeForProposal_ = minStakeForProposal;
        votingPeriod_ = votingPeriod;
        tokensPerVotingPower_ = tokensPerVotingPower;
        lockTimeSeconds_ = lockTimeSeconds;
    }
    
    function getProposal(uint256 id) external view returns (
        uint256 proposalId,
        address creator,
        string memory title,
        string memory description,
        uint256 votesFor,
        uint256 votesAgainst,
        uint256 startTime,
        ProposalStatus status,
        address[] memory voters
    ) {
        Proposal storage p = _proposals[id];
        return (p.id, p.creator, p.title, p.description, p.votesFor, p.votesAgainst, p.startTime, p.status, p.voters);
    }

    function hasVoted(uint256 proposalId, address voter) external view returns (bool) {
        return _proposals[proposalId].voted[voter];
    }

    function getVoteChoice(uint256 proposalId, address voter) external view returns (bool) {
        return _proposals[proposalId].voteChoice[voter];
    }

    function isValidProposal(uint256 proposalId) external view returns (bool) {
        return (proposalId > 0 && proposalId <= proposalCount);
    }

    function proposalCreator(uint256 proposalId) external view returns (address) {
        return _proposals[proposalId].creator;
    }

    function lockTime() external view returns (uint256) {
        return lockTimeSeconds;
    }

    function isActive(uint256 id) external view returns (bool) {
        return _isActive(id);
    }
}