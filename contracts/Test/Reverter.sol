// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract Reverter {
    function alwaysReverts() external pure {
        revert("Always fails");
    }
}