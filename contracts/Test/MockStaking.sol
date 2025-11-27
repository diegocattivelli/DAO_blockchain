// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockStaking {

    mapping(address => mapping(uint256 => uint256)) public voteStakes;
    mapping(address => mapping(uint256 => uint256)) public proposalStakes;
    mapping(address => mapping(uint256 => uint256)) public voteVotingPowers;

    event StakedVote(address indexed user, uint256 amount, uint256 proposalId, uint256 votingPower);
    event StakedProposal(address indexed user, uint256 amount, uint256 proposalId);
    event UnstakedVote(address indexed user, uint256 proposalId);
    event UnstakedProposal(address indexed user, uint256 proposalId);
    event VoteUnstaked(address indexed user, uint256 indexed proposalId);

    function stakeVote(address user, uint256 amount, uint256 proposalId, uint256 votingPower) external {
        voteStakes[user][proposalId] += amount;
        voteVotingPowers[user][proposalId] += votingPower;
        emit StakedVote(user, amount, proposalId, votingPower);
    }

    function stakeProposal(address user, uint256 amount, uint256 proposalId) external {
        proposalStakes[user][proposalId] += amount;
        emit StakedProposal(user, amount, proposalId);
    }

    function unstakeVote(address user, uint256 proposalId) external {
        require(voteStakes[user][proposalId] > 0, "no vote stake");
        voteStakes[user][proposalId] = 0;
        voteVotingPowers[user][proposalId] = 0;
        emit UnstakedVote(user, proposalId);
        emit VoteUnstaked(user, proposalId);
    }

    function unstakeProposal(address user, uint256 proposalId) external {
        require(proposalStakes[user][proposalId] > 0, "no proposal stake");
        proposalStakes[user][proposalId] = 0;
        emit UnstakedProposal(user, proposalId);
    }

    function voteStakeOf(address user, uint256 proposalId) external view returns (uint256) {
        return voteStakes[user][proposalId];
    }

    function voteVotingPowerOf(address user, uint256 proposalId) external view returns (uint256) {
        return voteVotingPowers[user][proposalId];
    }

    function proposalStakeOf(address user, uint256 proposalId) external view returns (uint256) {
        return proposalStakes[user][proposalId];
    }
}