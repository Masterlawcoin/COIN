// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMLXERC20V14 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title MasterlawEX P2P Escrow V1.4
/// @notice ARC-oriented non-custodial USDC escrow with explicit Masterlaw mediation controls.
/// @dev No fiat settlement or PII is stored on-chain. Masterlaw case/evidence references are opaque hashes only.
///      There is deliberately no admin withdrawal / sweep function.
contract MasterlawEXP2PEscrowV14 {
    string public constant VERSION = "1.4.0-testnet";
    bytes32 public constant ORDER_REF_DOMAIN = keccak256("MASTERLAWEX_P2P_ORDER_REF_V1");
    bytes32 public constant SPLIT_DOMAIN = keccak256("MASTERLAWEX_P2P_MUTUAL_SPLIT_V1");

    enum State { None, Funded, PaymentMarked, Released, Cancelled, Disputed, Refunded, Settled }

    struct Trade {
        address seller;
        address buyer;
        uint256 amount;
        uint64 createdAt;
        uint64 deadline;
        State state;
        bytes32 orderRef;
    }

    IMLXERC20V14 public immutable asset;
    address public arbiter;
    address public pendingArbiter;
    bool public newTradesPaused;
    uint256 public nextTradeId = 1;

    mapping(uint256 => Trade) public trades;
    mapping(bytes32 => uint256) public tradeIdByReference;

    // Private Masterlaw records remain off-chain; only opaque integrity anchors are public.
    mapping(uint256 => bytes32) public caseHashByTrade;
    mapping(uint256 => bytes32) public resolutionHashByTrade;

    // Bilateral partial-settlement proposal. Both parties must explicitly approve the same proposal on-chain.
    mapping(uint256 => bytes32) public splitProposalHashByTrade;
    mapping(uint256 => uint256) public splitBuyerAmountByTrade;
    mapping(uint256 => bool) public splitSellerApproved;
    mapping(uint256 => bool) public splitBuyerApproved;

    uint256 private _lock = 1;

    event TradeCreated(uint256 indexed tradeId, bytes32 indexed orderRef, address indexed seller, address buyer, uint256 amount, uint64 deadline);
    event PaymentMarked(uint256 indexed tradeId, address indexed buyer);
    event Released(uint256 indexed tradeId, address indexed buyer, uint256 amount);
    event Cancelled(uint256 indexed tradeId, address indexed by, uint256 amount);
    event DisputeOpened(uint256 indexed tradeId, address indexed by, bytes32 indexed caseHash, bool arbiterInitiated);
    event DisputeResolved(uint256 indexed tradeId, bool releasedToBuyer, uint256 amount, bytes32 indexed resolutionHash);
    event MutualSplitProposed(uint256 indexed tradeId, bytes32 indexed proposalHash, uint256 buyerAmount, bytes32 agreementHash, address indexed proposer);
    event MutualSplitApproved(uint256 indexed tradeId, bytes32 indexed proposalHash, address indexed approver);
    event MutualSplitSettled(uint256 indexed tradeId, uint256 buyerAmount, uint256 sellerAmount, bytes32 indexed agreementHash);
    event NewTradesPaused(bool paused);
    event ArbiterProposed(address indexed currentArbiter, address indexed pendingArbiter);
    event ArbiterAccepted(address indexed previousArbiter, address indexed newArbiter);

    error Unauthorized();
    error InvalidState();
    error InvalidAddress();
    error InvalidAmount();
    error InvalidTimeout();
    error InvalidReference();
    error ReferenceInUse();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error Paused();
    error TransferFailed();
    error BalanceMismatch();
    error Reentrancy();
    error InvalidCaseHash();
    error InvalidResolutionHash();
    error InvalidAgreement();
    error ProposalMismatch();
    error AlreadyApproved();

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
        asset = IMLXERC20V14(asset_);
        arbiter = arbiter_;
    }

    function computeOrderRef(bytes32 externalTradeIdHash) public view returns (bytes32) {
        if (externalTradeIdHash == bytes32(0)) revert InvalidReference();
        return keccak256(abi.encode(ORDER_REF_DOMAIN, block.chainid, address(this), externalTradeIdHash));
    }

    function computeSplitProposalHash(
        uint256 tradeId,
        uint256 buyerAmount,
        bytes32 agreementHash
    ) public view returns (bytes32) {
        if (agreementHash == bytes32(0)) revert InvalidAgreement();
        return keccak256(abi.encode(SPLIT_DOMAIN, block.chainid, address(this), tradeId, buyerAmount, agreementHash));
    }

    function createTrade(
        address buyer,
        uint256 amount,
        uint64 timeoutSeconds,
        bytes32 externalTradeIdHash
    ) external nonReentrant returns (uint256 tradeId) {
        if (newTradesPaused) revert Paused();
        if (buyer == address(0) || buyer == msg.sender) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (timeoutSeconds < 10 minutes || timeoutSeconds > 24 hours) revert InvalidTimeout();

        bytes32 orderRef = computeOrderRef(externalTradeIdHash);
        if (tradeIdByReference[orderRef] != 0) revert ReferenceInUse();

        tradeId = nextTradeId++;
        uint64 nowTs = uint64(block.timestamp);
        uint64 deadline = nowTs + timeoutSeconds;
        trades[tradeId] = Trade({
            seller: msg.sender,
            buyer: buyer,
            amount: amount,
            createdAt: nowTs,
            deadline: deadline,
            state: State.Funded,
            orderRef: orderRef
        });
        tradeIdByReference[orderRef] = tradeId;

        _safeTransferFromExact(msg.sender, amount);
        emit TradeCreated(tradeId, orderRef, msg.sender, buyer, amount, deadline);
    }

    function markPaymentSent(uint256 tradeId) external {
        Trade storage t = trades[tradeId];
        if (msg.sender != t.buyer) revert Unauthorized();
        if (t.state != State.Funded) revert InvalidState();
        if (block.timestamp > t.deadline) revert DeadlinePassed();
        t.state = State.PaymentMarked;
        emit PaymentMarked(tradeId, msg.sender);
    }

    function release(uint256 tradeId) external nonReentrant {
        Trade storage t = trades[tradeId];
        if (msg.sender != t.seller) revert Unauthorized();
        if (t.state != State.PaymentMarked) revert InvalidState();
        t.state = State.Released;
        _safeTransferExact(t.buyer, t.amount);
        emit Released(tradeId, t.buyer, t.amount);
    }

    function cancelByBuyer(uint256 tradeId) external nonReentrant {
        Trade storage t = trades[tradeId];
        if (msg.sender != t.buyer) revert Unauthorized();
        if (t.state != State.Funded) revert InvalidState();
        t.state = State.Cancelled;
        _safeTransferExact(t.seller, t.amount);
        emit Cancelled(tradeId, msg.sender, t.amount);
    }

    function cancelExpired(uint256 tradeId) external nonReentrant {
        Trade storage t = trades[tradeId];
        if (msg.sender != t.seller) revert Unauthorized();
        if (t.state != State.Funded) revert InvalidState();
        if (block.timestamp <= t.deadline) revert DeadlineNotPassed();
        t.state = State.Cancelled;
        _safeTransferExact(t.seller, t.amount);
        emit Cancelled(tradeId, msg.sender, t.amount);
    }

    /// @notice Either participant freezes the trade for mediation/arbitration.
    function openDispute(uint256 tradeId) external {
        Trade storage t = trades[tradeId];
        if (msg.sender != t.seller && msg.sender != t.buyer) revert Unauthorized();
        _openDispute(tradeId, bytes32(0), false);
    }

    /// @notice Masterlaw arbiter/multisig can freeze a specific trade when risk/compliance detects a problem.
    /// @dev caseHash must be an opaque hash of the private Masterlaw case id/evidence bundle, never PII.
    function openDisputeByArbiter(uint256 tradeId, bytes32 caseHash) external onlyArbiter {
        if (caseHash == bytes32(0)) revert InvalidCaseHash();
        _openDispute(tradeId, caseHash, true);
    }

    function _openDispute(uint256 tradeId, bytes32 caseHash, bool arbiterInitiated) private {
        Trade storage t = trades[tradeId];
        if (t.state != State.Funded && t.state != State.PaymentMarked) revert InvalidState();
        t.state = State.Disputed;
        if (caseHash != bytes32(0)) caseHashByTrade[tradeId] = caseHash;
        emit DisputeOpened(tradeId, msg.sender, caseHash, arbiterInitiated);
    }

    /// @notice Binary arbitration path: full release to buyer or full refund to seller.
    /// @dev resolutionHash anchors the private Masterlaw decision/evidence packet without exposing it.
    function resolveDispute(
        uint256 tradeId,
        bool releaseToBuyer,
        bytes32 resolutionHash
    ) external onlyArbiter nonReentrant {
        if (resolutionHash == bytes32(0)) revert InvalidResolutionHash();
        Trade storage t = trades[tradeId];
        if (t.state != State.Disputed) revert InvalidState();

        resolutionHashByTrade[tradeId] = resolutionHash;
        t.state = releaseToBuyer ? State.Released : State.Refunded;
        address recipient = releaseToBuyer ? t.buyer : t.seller;
        _safeTransferExact(recipient, t.amount);
        emit DisputeResolved(tradeId, releaseToBuyer, t.amount, resolutionHash);
    }

    /// @notice Either participant can propose a partial settlement while the trade is disputed.
    /// @dev The proposer gives the first cryptographic approval by sending this transaction.
    function proposeMutualSplit(
        uint256 tradeId,
        uint256 buyerAmount,
        bytes32 agreementHash
    ) external {
        Trade storage t = trades[tradeId];
        if (t.state != State.Disputed) revert InvalidState();
        if (msg.sender != t.seller && msg.sender != t.buyer) revert Unauthorized();
        if (buyerAmount > t.amount) revert InvalidAmount();
        if (agreementHash == bytes32(0)) revert InvalidAgreement();

        bytes32 proposalHash = computeSplitProposalHash(tradeId, buyerAmount, agreementHash);
        splitProposalHashByTrade[tradeId] = proposalHash;
        splitBuyerAmountByTrade[tradeId] = buyerAmount;
        splitSellerApproved[tradeId] = msg.sender == t.seller;
        splitBuyerApproved[tradeId] = msg.sender == t.buyer;

        emit MutualSplitProposed(tradeId, proposalHash, buyerAmount, agreementHash, msg.sender);
    }

    /// @notice The counterparty explicitly approves the exact same split proposal; settlement executes atomically.
    function approveMutualSplit(
        uint256 tradeId,
        uint256 buyerAmount,
        bytes32 agreementHash
    ) external nonReentrant {
        Trade storage t = trades[tradeId];
        if (t.state != State.Disputed) revert InvalidState();
        if (msg.sender != t.seller && msg.sender != t.buyer) revert Unauthorized();
        if (agreementHash == bytes32(0)) revert InvalidAgreement();

        bytes32 proposalHash = computeSplitProposalHash(tradeId, buyerAmount, agreementHash);
        if (splitProposalHashByTrade[tradeId] != proposalHash || splitBuyerAmountByTrade[tradeId] != buyerAmount) {
            revert ProposalMismatch();
        }

        if (msg.sender == t.seller) {
            if (splitSellerApproved[tradeId]) revert AlreadyApproved();
            splitSellerApproved[tradeId] = true;
        } else {
            if (splitBuyerApproved[tradeId]) revert AlreadyApproved();
            splitBuyerApproved[tradeId] = true;
        }
        emit MutualSplitApproved(tradeId, proposalHash, msg.sender);

        if (splitSellerApproved[tradeId] && splitBuyerApproved[tradeId]) {
            _executeMutualSplit(tradeId, agreementHash);
        }
    }

    function _executeMutualSplit(uint256 tradeId, bytes32 agreementHash) private {
        Trade storage t = trades[tradeId];
        uint256 buyerAmount = splitBuyerAmountByTrade[tradeId];
        uint256 sellerAmount = t.amount - buyerAmount;

        if (buyerAmount == t.amount) t.state = State.Released;
        else if (buyerAmount == 0) t.state = State.Refunded;
        else t.state = State.Settled;

        resolutionHashByTrade[tradeId] = agreementHash;
        if (buyerAmount > 0) _safeTransferExact(t.buyer, buyerAmount);
        if (sellerAmount > 0) _safeTransferExact(t.seller, sellerAmount);
        emit MutualSplitSettled(tradeId, buyerAmount, sellerAmount, agreementHash);
    }

    /// @notice Pauses only creation of new escrows. Existing trades remain releasable/cancellable/disputable.
    function setNewTradesPaused(bool paused_) external onlyArbiter {
        newTradesPaused = paused_;
        emit NewTradesPaused(paused_);
    }

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

    function _safeTransferExact(address to, uint256 amount) private {
        uint256 escrowBefore = asset.balanceOf(address(this));
        uint256 recipientBefore = asset.balanceOf(to);

        (bool ok, bytes memory ret) = address(asset).call(abi.encodeWithSelector(IMLXERC20V14.transfer.selector, to, amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();

        uint256 escrowAfter = asset.balanceOf(address(this));
        uint256 recipientAfter = asset.balanceOf(to);
        if (
            escrowBefore < escrowAfter ||
            recipientAfter < recipientBefore ||
            escrowBefore - escrowAfter != amount ||
            recipientAfter - recipientBefore != amount
        ) revert BalanceMismatch();
    }

    function _safeTransferFromExact(address from, uint256 amount) private {
        uint256 escrowBefore = asset.balanceOf(address(this));

        (bool ok, bytes memory ret) = address(asset).call(
            abi.encodeWithSelector(IMLXERC20V14.transferFrom.selector, from, address(this), amount)
        );
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();

        uint256 escrowAfter = asset.balanceOf(address(this));
        if (escrowAfter < escrowBefore || escrowAfter - escrowBefore != amount) revert BalanceMismatch();
    }
}
