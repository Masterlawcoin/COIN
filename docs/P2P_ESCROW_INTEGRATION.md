# MasterlawEX P2P Escrow Integration — Testnet V1.3

> Status: PRE-DEPLOY / TESTNET ONLY. This document defines the integration contract between the P2P application and `MasterlawEXP2PEscrow`. It does not authorize real-money operation or mainnet use.

## Security objective

The database order and the on-chain escrow must describe the same economic operation before MasterlawEX exposes any fiat-payment step.

MasterlawEX must fail closed whenever chain, contract, asset, participants, amount, reference, receipt or state cannot be verified.

## Canonical identifiers

The backend P2P trade keeps its private UUID/database identifier off-chain.

Before requesting escrow creation, derive an opaque hash:

```text
externalTradeIdHash = keccak256(
  utf8("MASTERLAWEX_BACKEND_TRADE_V1:" + lowercaseTradeUuid)
)
```

Do not hash bank-account numbers, names, identity documents, payment references or other private payment data into this value.

The escrow derives the public on-chain reference itself:

```text
ORDER_REF_DOMAIN = keccak256("MASTERLAWEX_P2P_ORDER_REF_V1")

orderRef = keccak256(
  abi.encode(
    ORDER_REF_DOMAIN,
    chainId,
    escrowContractAddress,
    externalTradeIdHash
  )
)
```

The contract function `computeOrderRef(bytes32)` is authoritative. The backend/frontend may compute the same value locally, but must compare it with the contract result before accepting it.

This makes the same backend trade identifier produce a different `orderRef` on a different chain or a different escrow contract.

## Required deployment identity

Before enabling on-chain P2P actions, configuration must include and verify:

- chain ID
- escrow contract address
- escrow runtime `VERSION()`
- `ORDER_REF_DOMAIN()`
- escrow asset address
- asset decimals = 6
- arbiter address
- expected source/build attestation

A mismatch disables escrow actions.

## Trade creation sequence

1. Backend creates/reserves the P2P trade and assigns its UUID.
2. Backend derives `externalTradeIdHash` using the canonical rule above.
3. Frontend connects the seller wallet on the configured testnet.
4. Frontend reads `VERSION()`, `asset()`, `arbiter()`, `ORDER_REF_DOMAIN()` and `computeOrderRef(externalTradeIdHash)`.
5. Seller approves the exact USDC amount to the escrow contract.
6. Seller calls:

```solidity
createTrade(buyer, amount, timeoutSeconds, externalTradeIdHash)
```

7. Client waits for a confirmed receipt and extracts `TradeCreated`.
8. Backend/indexer verifies all of the following against the reserved database trade:
   - expected chain ID
   - expected escrow contract
   - seller wallet
   - buyer wallet
   - exact token amount in base units
   - canonical `orderRef`
   - `tradeIdByReference(orderRef)` points to the emitted on-chain trade ID
   - `trades(tradeId).state == Funded`
9. Only after every check passes may the application mark the order as `escrow_funded` and expose fiat-payment instructions.

If any check fails, the order remains blocked for review/cancellation. Never infer success from a submitted transaction hash alone.

## Payment-marked sequence

The buyer action is authoritative only after the matching on-chain transaction is confirmed:

```solidity
markPaymentSent(tradeId)
```

The backend mirrors the confirmed `PaymentMarked` event/state. A database-only `payment_marked` flag must never cause crypto release.

Marking payment on-chain is a declaration, not proof that fiat settled.

## Release sequence

After the seller verifies the fiat leg off-chain, the seller signs:

```solidity
release(tradeId)
```

The backend marks the crypto leg released only after:

- transaction success
- `Released` event matches the trade
- on-chain state is `Released`
- recipient is the expected buyer

The contract performs exact balance-delta checks and rejects assets that short-change the recipient.

## Disputes

Either participant may call:

```solidity
openDispute(tradeId)
```

Once state is `Disputed`, normal release/cancel paths are frozen. AI/agents may summarize evidence or assign risk, but must not sign or execute `resolveDispute`.

Final resolution remains human/multisig-controlled:

```solidity
resolveDispute(tradeId, releaseToBuyer)
```

## Expiry and cancellation

Before payment is marked:

- buyer may use `cancelByBuyer(tradeId)`
- seller may use `cancelExpired(tradeId)` only after deadline

Database state follows confirmed chain state, not the reverse.

## Reconciliation invariants

For every on-chain-enabled P2P trade:

```text
configured_chain == receipt.chain
configured_escrow == receipt.to/contract
backend_seller == trade.seller
backend_buyer == trade.buyer
backend_crypto_amount_base_units == trade.amount
canonical_order_ref == trade.orderRef
tradeIdByReference(canonical_order_ref) == tradeId
```

If an invariant breaks, freeze the application-side trade and require review.

## Agent policy

Agents may:

- score risk
- flag anomalies
- recommend holds
- compare backend vs chain state
- summarize dispute evidence
- alert on reconciliation failures

Agents must not:

- hold private keys
- approve tokens
- create/release/refund escrow autonomously
- rotate the arbiter
- resolve a dispute
- move treasury/user funds

## Production gate

Testnet success is not a mainnet approval. Mainnet requires, at minimum:

- independent smart-contract audit
- multisig/smart-account arbitration
- incident response and pause policy
- KYC/AML/compliance implementation where applicable
- monitored RPC/indexing redundancy
- operational key management
- transaction/state reconciliation testing under RPC failures and chain reorganizations
