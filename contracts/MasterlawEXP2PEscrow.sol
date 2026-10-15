// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMLXERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title MasterlawEX P2P Escrow V1
/// @notice Non-custodial USDC escrow candidate for Arc Testnet P2P trades.
/// @dev No fiat settlement is performed on-chain. The contract only controls the crypto leg.
contract MasterlawEXP2PEscrow {
    enum State { None, Funded, PaymentMarked, Released, Cancelled, Disputed, Refunded }

    struct Trade {
        address seller;
        address buyer;
        uint256 amount;
        uint64 createdAt;
        uint64 deadline;
        State state;
    }

    IMLXERC20 public immutable asset;
    address public arbiter;
    address public pendingArbiter;
    bool public newTradesPaused;
    uint256 public nextTradeId = 1;
    mapping(uint256 => Trade) public trades;

    uint256 private _lock = 1;

    event TradeCreated(uint256 indexed tradeId, address indexed seller, address indexed buyer, uint256 amount, uint64 deadline);
    event PaymentMarked(uint256 indexed tradeId, address indexed buyer);
    event Released(uint256 indexed tradeId, address indexed buyer, uint256 amount);
    event Cancelled(uint256 indexed tradeId, address indexed by, uint256 amount);
    event DisputeOpened(uint256 indexed tradeId, address indexed by);
    event DisputeResolved(uint256 indexed tradeId, bool releasedToBuyer, uint256 amount);
    event NewTradesPaused(bool paused);
    event ArbiterProposed(address indexed currentArbiter, address indexed pendingArbiter);
    event ArbiterAccepted(address indexed previousArbiter, address indexed newArbiter);

    error Unauthorized();
    error InvalidState();
    error InvalidAddress();
    error InvalidAmount();
    error InvalidTimeout();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error Paused();
    error TransferFailed();
    error Reentrancy();

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    modifier onlyArbiter() {
        if (msg.sender != arbiter) revert Unauthorized();
        _;
    }

    constructor(address asset_, address arbiter_) {
        if (asset_ == address(0) || arbiter_ == address(0) || asset_.code.length == 0) revert InvalidAddress();
        asset = IMLXERC20(asset_);
        arbiter = arbiter_;
    }

    /// @notice Seller locks USDC for a specific buyer. Timeout must be between 10 minutes and 24 hours.
    function createTrade(address buyer, uint256 amount, uint64 timeoutSeconds) external nonReentrant returns (uint256 tradeId) {
        if (newTradesPaused) revert Paused();
        if (buyer == address(0) || buyer == msg.sender) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (timeoutSeconds < 10 minutes || timeoutSeconds > 24 hours) revert InvalidTimeout();

        tradeId = nextTradeId++;
        uint64 nowTs = uint64(block.timestamp);
        uint64 deadline = nowTs + timeoutSeconds;
        trades[tradeId] = Trade({
            seller: msg.sender,
            buyer: buyer,
            amount: amount,
            createdAt: nowTs,
            deadline: deadline,
            state: State.Funded
        });

        _safeTransferFrom(msg.sender, address(this), amount);
        emit TradeCreated(tradeId, msg.sender, buyer, amount, deadline);
    }

    /// @notice Buyer declares that the off-chain fiat leg has been sent. This does not prove fiat settlement.
    function markPaymentSent(uint256 tradeId) external {
        Trade storage t = trades[tradeId];
        if (msg.sender != t.buyer) revert Unauthorized();
        if (t.state != State.Funded) revert InvalidState();
        if (block.timestamp > t.deadline) revert DeadlinePassed();
        t.state = State.PaymentMarked;
        emit PaymentMarked(tradeId, msg.sender);
    }

    /// @notice Seller releases escrowed USDC after confirming payment off-chain.
    function release(uint256 tradeId) external nonReentrant {
        Trade storage t = trades[tradeId];
        if (msg.sender != t.seller) revert Unauthorized();
        if (t.state != State.PaymentMarked) revert InvalidState();
        t.state = State.Released;
        _safeTransfer(t.buyer, t.amount);
        emit Released(tradeId, t.buyer, t.amount);
    }

    /// @notice Buyer may cancel before marking payment; escrow is returned to seller.
    function cancelByBuyer(uint256 tradeId) external nonReentrant {
        Trade storage t = trades[tradeId];
        if (msg.sender != t.buyer) revert Unauthorized();
        if (t.state != State.Funded) revert InvalidState();
        t.state = State.Cancelled;
        _safeTransfer(t.seller, t.amount);
        emit Cancelled(tradeId, msg.sender, t.amount);
    }

    /// @notice Seller can reclaim funds if buyer never marked payment before deadline.
    function cancelExpired(uint256 tradeId) external nonReentrant {
        Trade storage t = trades[tradeId];
        if (msg.sender != t.seller) revert Unauthorized();
        if (t.state != State.Funded) revert InvalidState();
        if (block.timestamp <= t.deadline) revert DeadlineNotPassed();
        t.state = State.Cancelled;
        _safeTransfer(t.seller, t.amount);
        emit Cancelled(tradeId, msg.sender, t.amount);
    }

    /// @notice Either participant can freeze a funded/payment-marked trade for arbitration.
    function openDispute(uint256 tradeId) external {
        Trade storage t = trades[tradeId];
        if (msg.sender != t.seller && msg.sender != t.buyer) revert Unauthorized();
        if (t.state != State.Funded && t.state != State.PaymentMarked) revert InvalidState();
        t.state = State.Disputed;
        emit DisputeOpened(tradeId, msg.sender);
    }

    /// @notice Arbiter can resolve only a disputed trade; funds go entirely to buyer or seller.
    function resolveDispute(uint256 tradeId, bool releaseToBuyer) external onlyArbiter nonReentrant {
        Trade storage t = trades[tradeId];
        if (t.state != State.Disputed) revert InvalidState();
        t.state = releaseToBuyer ? State.Released : State.Refunded;
        address recipient = releaseToBuyer ? t.buyer : t.seller;
        _safeTransfer(recipient, t.amount);
        emit DisputeResolved(tradeId, releaseToBuyer, t.amount);
    }

    /// @notice Pauses only creation of new escrows. Existing users can still release/cancel/dispute.
    function setNewTradesPaused(bool paused_) external onlyArbiter {
        newTradesPaused = paused_;
        emit NewTradesPaused(paused_);
    }

    /// @notice Two-step arbiter rotation prevents a typo from permanently transferring authority.
    function proposeArbiter(address next) external onlyArbiter {
        if (next == address(0) || next == arbiter) revert InvalidAddress();
        pendingArbiter = next;
        emit ArbiterProposed(arbiter, next);
    }

    function acceptArbiter() external {
        if (msg.sender != pendingArbiter) revert Unauthorized();
        address old = arbiter;
        arbiter = msg.sender;
        pendingArbiter = address(0);
        emit ArbiterAccepted(old, msg.sender);
    }

    function _safeTransfer(address to, uint256 amount) private {
        (bool ok, bytes memory ret) = address(asset).call(abi.encodeWithSelector(IMLXERC20.transfer.selector, to, amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }

    function _safeTransferFrom(address from, address to, uint256 amount) private {
        (bool ok, bytes memory ret) = address(asset).call(abi.encodeWithSelector(IMLXERC20.transferFrom.selector, from, to, amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }
}
