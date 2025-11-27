// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMintableERC20 {
    function balanceOf(address account) external view returns (uint256);
}

interface IStaking {
    function voteStakeOf(address user, uint256 proposalId) external view returns (uint256);
    function proposalStakeOf(address user, uint256 proposalId) external view returns (uint256);
}

interface IDAOCore {
    enum ProposalStatus { ACTIVE, ACCEPTED, REJECTED }
    
    function token() external view returns (address);
    function staking() external view returns (address);
    function proposalCount() external view returns (uint256);
    function getProposal(uint256 id) external view returns (
        uint256 proposalId,
        address creator,
        string memory title,
        string memory description,
        uint256 votesFor,
        uint256 votesAgainst,
        uint256 startTime,
        uint8 status,
        address[] memory voters
    );
    function hasVoted(uint256 proposalId, address voter) external view returns (bool);
    function getVoteChoice(uint256 proposalId, address voter) external view returns (bool);
}

interface IDAODelegation {
    function getDelegationInfo(uint256 proposalId, address delegator) external view returns (address, uint256, bool);
}

contract DAOViews {
    enum ProposalStatus { ACTIVE, ACCEPTED, REJECTED }

    struct VoterInfo {
        address voter;
        bool choice;
    }

    struct ProposalView {
        uint256 id;
        address creator;
        string title;
        string description;
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 startTime;
        ProposalStatus status;
        VoterInfo[] voters;
    }

    struct UserStakingInfo {
        uint256[] proposalIds;
        uint256[] voteStakes;
        uint256[] proposalStakes;
    }

    IDAOCore public daoCore;
    IDAODelegation public delegation;

    constructor(address _daoCore, address _delegation) {
        require(_daoCore != address(0), "Invalid DAO core");
        daoCore = IDAOCore(_daoCore);
        delegation = IDAODelegation(_delegation);
    }

    function getAllProposals() external view returns (ProposalView[] memory) {
        uint256 count = daoCore.proposalCount();
        ProposalView[] memory result = new ProposalView[](count);
        
        for (uint256 i = 1; i <= count; i++) {
            result[i - 1] = _getProposalView(i);
        }
        return result;
    }

    function getProposalsByStatus(ProposalStatus status_) external view returns (ProposalView[] memory) {
        uint256 count = daoCore.proposalCount();
        uint256 matchCount = 0;

        for (uint256 i = 1; i <= count; i++) {
            (, , , , , , , uint8 status, ) = daoCore.getProposal(i);
            if (ProposalStatus(status) == status_) matchCount++;
        }

        ProposalView[] memory result = new ProposalView[](matchCount);
        uint256 idx = 0;
        
        for (uint256 i = 1; i <= count; i++) {
            (, , , , , , , uint8 status, ) = daoCore.getProposal(i);
            if (ProposalStatus(status) == status_) {
                result[idx] = _getProposalView(i);
                idx++;
            }
        }
        return result;
    }

    function getUserTokenBalance(address user) external view returns (uint256) {
        IMintableERC20 token = IMintableERC20(daoCore.token());
        return token.balanceOf(user);
    }

    function getUserStaking(address user) external view returns (UserStakingInfo memory info) {
        uint256 count = daoCore.proposalCount();
        IStaking staking = IStaking(daoCore.staking());

        uint256[] memory ids = new uint256[](count);
        uint256[] memory voteS = new uint256[](count);
        uint256[] memory propS = new uint256[](count);

        for (uint256 i = 1; i <= count; i++) {
            ids[i-1] = i;
            voteS[i-1] = staking.voteStakeOf(user, i);
            propS[i-1] = staking.proposalStakeOf(user, i);
        }

        return UserStakingInfo({
            proposalIds: ids,
            voteStakes: voteS,
            proposalStakes: propS
        });
    }

    function getDelegationInfo(uint256 proposalId, address delegator)
        external
        view
        returns (address delegate, uint256 amount, bool active)
    {
        if (address(delegation) == address(0)) {
            return (address(0), 0, false);
        }
        return delegation.getDelegationInfo(proposalId, delegator);
    }

    function _getVotersInfo(uint256 id, address[] memory voters)
        internal
        view
        returns (VoterInfo[] memory)
    {
        uint256 len = voters.length;
        VoterInfo[] memory votersInfo = new VoterInfo[](len);

        for (uint256 i = 0; i < len; i++) {
            votersInfo[i] = VoterInfo({
                voter: voters[i],
                choice: daoCore.getVoteChoice(id, voters[i])
            });
        }

        return votersInfo;
    }

    function _getProposalView(uint256 id) internal view returns (ProposalView memory) {
        (
            uint256 proposalId,
            address creator,
            string memory title,
            string memory description,
            uint256 votesFor,
            uint256 votesAgainst,
            uint256 startTime,
            uint8 status,
            address[] memory voters
        ) = daoCore.getProposal(id);

        VoterInfo[] memory votersInfo = _getVotersInfo(id, voters);

        return ProposalView({
            id: proposalId,
            creator: creator,
            title: title,
            description: description,
            votesFor: votesFor,
            votesAgainst: votesAgainst,
            startTime: startTime,
            status: ProposalStatus(status),
            voters: votersInfo
        });
    }
}
