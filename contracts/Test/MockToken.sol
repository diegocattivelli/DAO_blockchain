// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockToken {
    string public name = "MockToken";
    string public symbol = "MTK";
    uint8 public decimalsVal = 18;
    bool public paused = false;

    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    modifier whenNotPaused() {
        require(!paused, "Pausable: paused");
        _;
    }

    function decimals() external view returns (uint8) {
        return decimalsVal;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function transfer(address to, uint256 amount) external whenNotPaused returns (bool) {
        require(_balances[msg.sender] >= amount, "insufficient balance");
        _balances[msg.sender] -= amount;
        _balances[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        _allowances[msg.sender][spender] = amount;
        return true;
    }

    function allowance(address owner, address spender) external view returns (uint256) {
        return _allowances[owner][spender];
    }

    function transferFrom(address from, address to, uint256 amount) external whenNotPaused returns (bool) {
        require(_balances[from] >= amount, "insufficient balance");
        require(_allowances[from][msg.sender] >= amount, "insufficient allowance");
        _balances[from] -= amount;
        _balances[to] += amount;
        _allowances[from][msg.sender] -= amount;
        return true;
    }

    function mint(address to, uint256 amount) external {
        _balances[to] += amount;
    }

    function pause() external {
        paused = true;
    }

    function unpause() external {
        paused = false;
    }
}