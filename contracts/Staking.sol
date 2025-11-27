// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IDAO {
    function lockTime() external view returns (uint256);
    function isValidProposal(uint256 proposalId) external view returns (bool);
    function proposalCreator(uint256 proposalId) external view returns (address);
}

contract Staking {
    IERC20 public immutable token;
    address public immutable daoCore;
    address public immutable daoDelegation;

    struct StakeInfo {
        uint256 amount;
        uint256 stakedAt;
        uint256 votingPower;
        bool exists;
    }

    mapping(address => mapping(uint256 => StakeInfo)) private _voteStakes;
    mapping(address => mapping(uint256 => StakeInfo)) private _proposalStakes;

    event VoteStaked(address indexed user, uint256 indexed proposalId, uint256 amount, uint256 stakedAt, uint256 votingPower);
    event VoteUnstaked(address indexed user, uint256 indexed proposalId);
    event ProposalStaked(address indexed user, uint256 indexed proposalId, uint256 amount, uint256 stakedAt);
    event ProposalUnstaked(address indexed user, uint256 indexed proposalId);

    modifier onlyDAO() {
        require(msg.sender == daoCore || msg.sender == daoDelegation, "Staking: not DAO");
        _;
    }

    constructor(address _token, address _daoCore, address _daoDelegation) {
        require(_token != address(0) && _daoCore != address(0) && _daoDelegation != address(0), "Invalid address");
        token = IERC20(_token);
        daoCore = _daoCore;
        daoDelegation = _daoDelegation;
    }
    
    function stakeVote(address user, uint256 amount, uint256 proposalId, uint256 _votingPower) external onlyDAO {
        require(IDAO(daoCore).isValidProposal(proposalId), "Invalid proposal");
        require(amount > 0, "Invalid amount");

        StakeInfo storage s = _voteStakes[user][proposalId];

        s.amount += amount;
        s.votingPower += _votingPower;

        s.stakedAt = block.timestamp;
        s.exists = true;

        emit VoteStaked(user, proposalId, amount, s.stakedAt, _votingPower);
        require(token.transferFrom(user, address(this), amount), "Transfer failed");
    }

    function unstakeVote(address user, uint256 proposalId) external onlyDAO {
        StakeInfo storage s = _voteStakes[user][proposalId];
        require(s.exists, "No vote stake");

        uint256 currentLockTime = IDAO(daoCore).lockTime();
        require(block.timestamp >= s.stakedAt + currentLockTime, "Locked stake");

        uint256 amount = s.amount;
        s.amount = 0;
        s.votingPower = 0;
        s.exists = false;

        emit VoteUnstaked(user, proposalId);
        require(token.transfer(user, amount), "Transfer failed");
    }

    function stakeProposal(address user, uint256 amount, uint256 proposalId) external onlyDAO {
        require(IDAO(daoCore).isValidProposal(proposalId), "Invalid proposal");
        require(amount > 0, "Invalid amount");

        address creator = IDAO(daoCore).proposalCreator(proposalId);
        require(creator == user, "Only proposal creator can stake");

        StakeInfo storage s = _proposalStakes[user][proposalId];
        s.amount += amount;
        
        s.stakedAt = block.timestamp;
        s.exists = true;

        emit ProposalStaked(user, proposalId, amount, s.stakedAt);
        require(token.transferFrom(user, address(this), amount), "Transfer failed");
    }

    function unstakeProposal(address user, uint256 proposalId) external onlyDAO {
        StakeInfo storage s = _proposalStakes[user][proposalId];
        require(s.exists, "No proposal stake");
        
        uint256 currentLockTime = IDAO(daoCore).lockTime();
        require(block.timestamp >= s.stakedAt + currentLockTime, "Locked stake");

        address creator = IDAO(daoCore).proposalCreator(proposalId);
        require(creator == user, "Only proposal creator can unstake");

        uint256 amount = s.amount;
        s.amount = 0;
        s.exists = false;

        emit ProposalUnstaked(user, proposalId);
        require(token.transfer(user, amount), "Transfer failed");
    }

    function voteStakeOf(address user, uint256 proposalId) external view returns (uint256) {
        return _voteStakes[user][proposalId].amount;
    }

    function voteVotingPowerOf(address user, uint256 proposalId) external view returns (uint256) {
        return _voteStakes[user][proposalId].votingPower;
    }

    function voteStakedAt(address user, uint256 proposalId) external view returns (uint256) {
        return _voteStakes[user][proposalId].stakedAt;
    }

    function proposalStakeOf(address user, uint256 proposalId) external view returns (uint256) {
        return _proposalStakes[user][proposalId].amount;
    }

    function proposalStakedAt(address user, uint256 proposalId) external view returns (uint256) {
        return _proposalStakes[user][proposalId].stakedAt;
    }

    function voteUnlockTimeOf(address user, uint256 proposalId) external view returns (uint256) {
        if (!_voteStakes[user][proposalId].exists) return 0;
        return _voteStakes[user][proposalId].stakedAt + IDAO(daoCore).lockTime();
    }

    function proposalUnlockTimeOf(address user, uint256 proposalId) external view returns (uint256) {
        if (!_proposalStakes[user][proposalId].exists) return 0;
        return _proposalStakes[user][proposalId].stakedAt + IDAO(daoCore).lockTime();
    }
}