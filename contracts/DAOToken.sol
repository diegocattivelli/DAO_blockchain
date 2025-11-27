// SPDX-License-Identifier: MIT 
pragma solidity ^0.8.20;

interface IMintableERC20 {
    function mint(address to, uint256 amount) external;
    function decimals() external view returns (uint8);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IMultiSig {
    function owners() external view returns (address[] memory);
}

interface IDAOCore {
    function token() external view returns (address);
    function tokenDecimals() external view returns (uint8);
    function priceWeiPerToken() external view returns (uint256);
    function isPanicked() external view returns (bool);
    function panicWallet() external view returns (address);
    function owner() external view returns (address);
}

contract DAOToken {
    IDAOCore public daoCore;
    event TokensPurchased(address indexed buyer, uint256 weiPaid, uint256 tokensMinted);

    modifier notPanicked() {
        require(!daoCore.isPanicked(), "Panic mode active");
        _; 
    }

    modifier panicConfigured() {
        require(daoCore.panicWallet() != address(0), "Panic wallet not set");
        _;
    }

    modifier onlyMultisigOwner() {
        require(msg.sender == daoCore.owner(), "Solo la Multisig Owner puede ejecutar esto");
        _;
    }

    constructor(address _daoCore) {
        require(_daoCore != address(0), "Invalid DAO core");
        daoCore = IDAOCore(_daoCore);
    }

    function mintTokens(uint256 amount) external onlyMultisigOwner panicConfigured notPanicked {
        IMintableERC20 token = IMintableERC20(daoCore.token());
        token.mint(address(this), amount);
    }

    receive() external payable notPanicked panicConfigured {
        _buyTokens(msg.sender, msg.value);
    }

    function buyTokens() external payable notPanicked panicConfigured {
        _buyTokens(msg.sender, msg.value);
    }

    function _buyTokens(address buyer, uint256 weiAmount) internal {
        require(weiAmount > 0, "No ETH sent");
        uint256 price = daoCore.priceWeiPerToken();
        require(price > 0, "Price not set");

        uint8 dec = daoCore.tokenDecimals();
        uint256 tokensOut = (weiAmount * (10 ** uint256(dec))) / price;
        require(tokensOut > 0, "Too little ETH");

        IMintableERC20 token = IMintableERC20(daoCore.token());
        uint256 daoBalance = token.balanceOf(address(this));
        require(daoBalance >= tokensOut, "Not enough tokens in DAO");

        emit TokensPurchased(buyer, weiAmount, tokensOut);

        token.transfer(buyer, tokensOut);
    }
}