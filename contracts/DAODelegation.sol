// SPDX-License-Identifier: MIT 
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/math/Math.sol";

interface IMintableERC20 {
    function balanceOf(address account) external view returns (uint256);
}

interface IStaking {
    function stakeVote(address voter, uint256 amount, uint256 proposalId, uint256 votingPower) external;
    function unstakeVote(address user, uint256 proposalId) external;
}

interface IDAOCore {
    function token() external view returns (address);
    function staking() external view returns (address);
    function minStakeForVote() external view returns (uint256);
    function tokensPerVotingPower() external view returns (uint256);
    function votingMode() external view returns (uint8);
    function proposalCount() external view returns (uint256);
    function isActive(uint256 proposalId) external view returns (bool);
    function hasVoted(uint256 proposalId, address voter) external view returns (bool);
    function recordDelegatedVote(uint256 id, address voter, bool inFavor, uint256 votingPower) external;
    function isPanicked() external view returns (bool);
    function panicWallet() external view returns (address);
}

contract DAODelegation {
    struct VoteDelegation {
        address delegator;
        address delegate;
        uint256 amount;
        bool active;
    }

    IDAOCore public daoCore;
    
    mapping(uint256 => mapping(address => VoteDelegation)) public voteDelegations;
    mapping(uint256 => mapping(address => bool)) public hasDelegated;

    event VoteDelegated(uint256 indexed proposalId, address indexed delegator, address indexed delegate, uint256 amount);
    event VoteDelegationRevoked(uint256 indexed proposalId, address indexed delegator, address indexed delegate);

    modifier notPanicked() {
        require(!daoCore.isPanicked(), "Panic mode active");
        _;
    }

    modifier panicConfigured() {
        require(daoCore.panicWallet() != address(0), "Panic wallet not set");
        _;
    }

    modifier onlyStakingSet() {
        require(daoCore.staking() != address(0), "Invalid staking");
        _;
    }

    constructor(address _daoCore) {
        require(_daoCore != address(0), "Invalid DAO core");
        daoCore = IDAOCore(_daoCore);
    }

    function delegateVote(uint256 proposalId, address delegate, uint256 amount)
        external
        notPanicked
        panicConfigured
        onlyStakingSet
    {
        require(delegate != address(0), "Invalid delegate");
        require(delegate != msg.sender, "Cannot delegate to yourself");
        require(amount >= daoCore.minStakeForVote(), "Insufficient delegation amount");
        require(proposalId > 0 && proposalId <= daoCore.proposalCount(), "Invalid proposal");
        require(daoCore.isActive(proposalId), "Proposal not active");
        
        require(!daoCore.hasVoted(proposalId, msg.sender), "Already voted, cannot delegate");
        require(!hasDelegated[proposalId][msg.sender], "Already delegated for this proposal");
        
        IMintableERC20 token = IMintableERC20(daoCore.token());
        require(token.balanceOf(msg.sender) >= amount, "Insufficient token balance");

        voteDelegations[proposalId][msg.sender] = VoteDelegation({
            delegator: msg.sender,
            delegate: delegate,
            amount: amount,
            active: true
        });
        hasDelegated[proposalId][msg.sender] = true;

        IStaking(daoCore.staking()).stakeVote(msg.sender, amount, proposalId, 0);
        
        emit VoteDelegated(proposalId, msg.sender, delegate, amount);
    }
    
    function revokeDelegation(uint256 proposalId)
        external
        notPanicked
        panicConfigured
        onlyStakingSet
    {
        require(hasDelegated[proposalId][msg.sender], "No active delegation");
        VoteDelegation storage delegation = voteDelegations[proposalId][msg.sender];
        require(delegation.active, "Delegation already used or revoked");
        
        require(!daoCore.hasVoted(proposalId, delegation.delegate), "Delegate already voted");
        
        delegation.active = false;
        IStaking(daoCore.staking()).unstakeVote(msg.sender, proposalId);
        
        emit VoteDelegationRevoked(proposalId, msg.sender, delegation.delegate);
    }

    function voteWithDelegation(uint256 proposalId, address delegator, bool inFavor)
        external
        notPanicked
        panicConfigured
        onlyStakingSet
        returns (uint256)
    {
        require(hasDelegated[proposalId][delegator], "No delegation from this address");
        VoteDelegation storage delegation = voteDelegations[proposalId][delegator];
        require(delegation.active, "Delegation not active");
        require(delegation.delegate == msg.sender, "Not the delegate");
        
        require(proposalId > 0 && proposalId <= daoCore.proposalCount(), "Invalid proposal");
        require(daoCore.isActive(proposalId), "Proposal not active");
        require(!daoCore.hasVoted(proposalId, msg.sender), "Delegate already voted");

        uint256 stakingAmount = delegation.amount;
        uint256 vp = _calculateVotingPower(stakingAmount);
        require(vp > 0, "Zero voting power");
        
        delegation.active = false;
        daoCore.recordDelegatedVote(proposalId, msg.sender, inFavor, vp);
        
        return vp;
    }

    function _calculateVotingPower(uint256 stakingAmount) internal view returns (uint256) {
        uint8 votingMode = daoCore.votingMode();
        uint256 tokensPerVP = daoCore.tokensPerVotingPower();
        
        if (votingMode == 1) { // QUADRATIC
            uint256 base = stakingAmount / tokensPerVP;
            return Math.sqrt(base);
        } else { // LINEAR
            return stakingAmount / tokensPerVP;
        }
    }

    function getDelegationInfo(uint256 proposalId, address delegator)
        external
        view
        returns (address delegate, uint256 amount, bool active)
    {
        if (!hasDelegated[proposalId][delegator]) {
            return (address(0), 0, false);
        }
        
        VoteDelegation storage delegation = voteDelegations[proposalId][delegator];
        return (delegation.delegate, delegation.amount, delegation.active);
    }
}