// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract SimpleMultiSig {
    struct Transaction {
        address to;
        uint256 value;
        bool executed;
        bytes data;
    }

    mapping(address => bool) _isOwner;
    address[] private _owners;

    uint8 public _requiredConfirmations;
    
    // Confirmations mapping
    // Each transaction ID have a list of confirmations
    mapping(uint256 => mapping(address => bool)) private _isConfirmed;
    
    Transaction[] private _transactions;
    
    error NotAnOwner();
    error OwnersRequired();
    error InvalidTransaction(uint256 txnId);
    error InvalidRequiredConfirmations();
    error NotEnoughConfirmations();
    error AlreadyExecuted(uint256 txnId);
    error ExecutionFailed(uint256 txnId, bytes data);

    modifier onlyOwner() {
        if (!_isOwner[msg.sender]) { revert NotAnOwner(); } 
        _;
    }
    
    modifier txnExists(uint256 txnId_) {
        if (txnId_ >= _transactions.length) { revert InvalidTransaction(txnId_); }
        _;
    }
    
    modifier notExecuted(uint256 txnId_) {
        if (_transactions[txnId_].executed) { revert AlreadyExecuted(txnId_); }
        _;
    }
    
    event TransactionSubmitted(uint256 indexed txId, address indexed to, uint256 value, bytes data);
    event TransactionConfirmed(uint256 indexed txId, address indexed owner);
    event TransactionExecuted(uint256 indexed txId);
    
    constructor(address[] memory owners_, uint8 required_) {
        if (owners_.length == 0) { revert OwnersRequired(); }
        if (required_ == 0 || required_ > owners_.length) { revert InvalidRequiredConfirmations(); }
        
        _owners = owners_;
        _requiredConfirmations = required_;

        for (uint256 i = 0; i < _owners.length; i++) {
            _isOwner[_owners[i]] = true;
        }
    }
    
    receive() external payable {}
    
    function submitTransaction(address to_, uint256 value_, bytes memory data_) 
        public 
        onlyOwner
        returns (uint256) 
    {
        uint256 txnId = _transactions.length;
        
        _transactions.push(Transaction({
            to: to_,
            value: value_,
            data: data_,
            executed: false
        }));
        
        emit TransactionSubmitted(txnId, to_, value_, data_);
        return txnId;
    }
    
    function confirmTransaction(uint256 txnId_) 
        public 
        onlyOwner 
        txnExists(txnId_) 
        notExecuted(txnId_) 
    {
        _isConfirmed[txnId_][msg.sender] = true;
        emit TransactionConfirmed(txnId_, msg.sender);
    }
    
    function executeTransaction(uint256 txnId_) 
        public 
        onlyOwner 
        txnExists(txnId_) 
        notExecuted(txnId_) 
    {
        if (confirmations(txnId_) < _requiredConfirmations) { revert NotEnoughConfirmations(); }

        Transaction storage txn = _transactions[txnId_];

        txn.executed = true;
        
        (bool success, bytes memory data) = txn.to.call{value: txn.value}(txn.data);
        
        if (!success) { revert ExecutionFailed(txnId_, data); }

        emit TransactionExecuted(txnId_);
    }

    function confirmations(uint256 txnId_) public view returns (uint8) {
       uint8 confirmations_ = 0;

        for (uint256 i; i < _owners.length; i++) {
            address owner = _owners[i];
            if (_isConfirmed[txnId_][owner]) {
                confirmations_++;
            }
        }

        return confirmations_;
    }

    function transactionCount() public view returns (uint256) {
        return _transactions.length;
    }
    
    function owners() public view returns (address[] memory) {
        return _owners;
    }

    function getTransaction(uint256 _txIndex) public view returns (
        address to, 
        uint256 value, 
        bytes memory data, 
        bool executed, 
        uint8 numConfirmations
    ) {
        Transaction storage txn = _transactions[_txIndex];
        return (
            txn.to,
            txn.value,
            txn.data,
            txn.executed,
            confirmations(_txIndex)
        );
    }
}