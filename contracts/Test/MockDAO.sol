// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IStaking {
    function stakeVote(address user, uint256 amount, uint256 proposalId, uint256 votingPower) external;
    function unstakeVote(address user, uint256 proposalId) external;
    function stakeProposal(address user, uint256 amount, uint256 proposalId) external;
    function unstakeProposal(address user, uint256 proposalId) external;
}

contract MockDAO {
    bool public valid = true;
    address public creator = address(0);
    address public stakingContract;
    uint256 public lockTimeValue = 3600;

    function setValid(bool v) external {
        valid = v;
    }

    function setCreator(address c) external {
        creator = c;
    }

    function setStaking(address _staking) external {
        stakingContract = _staking;
    }

    function setLockTime(uint256 _lockTime) external {
        lockTimeValue = _lockTime;
    }

    function isValidProposal(uint256) external view returns (bool) {
        return valid;
    }

    function proposalCreator(uint256) external view returns (address) {
        return creator;
    }

    function lockTime() external view returns (uint256) {
        return lockTimeValue;
    }

    function callStakeVote(address user, uint256 amount, uint256 proposalId) external {
        IStaking(stakingContract).stakeVote(user, amount, proposalId, amount);
    }

    function callUnstakeVote(address user, uint256 proposalId) external {
        IStaking(stakingContract).unstakeVote(user, proposalId);
    }

    function callStakeProposal(address user, uint256 amount, uint256 proposalId) external {
        IStaking(stakingContract).stakeProposal(user, amount, proposalId);
    }

    function callUnstakeProposal(address user, uint256 proposalId) external {
        IStaking(stakingContract).unstakeProposal(user, proposalId);
    }
}