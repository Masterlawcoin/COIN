# MasterlawEX P2P V1.4 — Masterlaw mediation on ARC

> Status: TESTNET DESIGN / NOT AUTHORIZED FOR REAL-MONEY OPERATION.
>
> Network lock: Arc Testnet only (`chainId 5042002`).

## Objective

Masterlaw is the identity, KYC/compliance, mediation, evidence and case-management control plane. MasterlawEX is the exchange UX. ARC is the crypto escrow/settlement layer.

No identity document, bank account, legal name, payment reference or other PII is written on-chain. ARC stores wallets, amounts, states and opaque hashes only.

## Identity and KYC gate

A Masterlaw user is identified by the existing Masterlaw `usuarios.id`. The P2P application must not create a second independent account system.

Before a user may create or take a P2P offer, Masterlaw must report an eligible KYC/compliance state. The exchange must fail closed when KYC state is missing, expired, rejected or under enhanced review.

Recommended application states:

- `REGISTERED`
- `KYC_PENDING`
- `VERIFIED`
- `ENHANCED_REVIEW`
- `BLOCKED`

Wallet ownership is proven by signature and bound to the Masterlaw identity. The database remains authoritative for the private identity-to-wallet relationship.

## Escrow V1.4 mediation controls

`MasterlawEXP2PEscrowV14` keeps the V1.3 non-custodial model and adds explicit mediation primitives.

### Arbiter-initiated freeze

A Masterlaw-controlled multisig/smart-account may freeze one specific funded/payment-marked trade:

```solidity
openDisputeByArbiter(uint256 tradeId, bytes32 caseHash)
```

`caseHash` is an opaque hash of the private Masterlaw case/evidence record. It must never contain raw PII.

This gives Masterlaw a targeted intervention mechanism without pausing or seizing unrelated trades.

### Binary arbitral resolution

The arbiter resolves a disputed trade with an auditable private-resolution anchor:

```solidity
resolveDispute(uint256 tradeId, bool releaseToBuyer, bytes32 resolutionHash)
```

The resolution remains binary:

- full release to buyer, or
- full refund to seller.

`resolutionHash` must be non-zero and should hash the final private Masterlaw resolution packet.

### Mutual partial settlement

A partial settlement is not an arbitral seizure. It requires both parties to approve exactly the same proposal on-chain:

```solidity
proposeMutualSplit(uint256 tradeId, uint256 buyerAmount, bytes32 agreementHash)
approveMutualSplit(uint256 tradeId, uint256 buyerAmount, bytes32 agreementHash)
```

The second matching approval executes the settlement atomically. For a genuine partial split, the final state is `Settled`.

The agreement hash must reference the private Masterlaw settlement agreement/evidence bundle without exposing its contents.

### No master withdrawal

V1.4 deliberately has no `withdraw`, `sweep`, `adminWithdraw` or emergency-drain function. The arbiter can mediate disputed trades but cannot transfer arbitrary user escrow balances.

## Masterlaw case lifecycle

Recommended private case timeline:

1. `OPENED`
2. `EVIDENCE_REQUESTED`
3. `UNDER_REVIEW`
4. `MEDIATION_PROPOSED`
5. `AGREEMENT_PENDING_SIGNATURES` or `ARBITRATION_PENDING`
6. `RESOLUTION_APPROVED`
7. `ONCHAIN_EXECUTION_PENDING`
8. `EXECUTED`
9. `CLOSED`

Every case must bind at least:

- Masterlaw case id
- backend P2P trade UUID
- ARC escrow contract
- ARC `tradeId`
- ARC `orderRef`
- buyer wallet
- seller wallet
- crypto amount in base units
- KYC/compliance snapshots for both parties
- evidence manifest hash
- case hash
- resolution/agreement hash
- on-chain transaction hash
- reviewer / multisig execution metadata

## Fail-closed invariants

Before showing fiat instructions or enabling any state-changing P2P action, the application must verify:

```text
Masterlaw identity exists
KYC buyer == VERIFIED
KYC seller == VERIFIED
configured_chain == 5042002
configured_escrow == V1.4 verified deployment
runtime VERSION() == 1.4.0-testnet
asset() == configured ARC USDC
arbiter() == configured Masterlaw multisig/smart-account
backend_seller == trades(tradeId).seller
backend_buyer == trades(tradeId).buyer
backend_amount == trades(tradeId).amount
backend_order_ref == trades(tradeId).orderRef
tradeIdByReference(orderRef) == tradeId
```

Any mismatch freezes the application-side trade for manual review.

## AI policy

AI may:

- summarize evidence
- compare backend and ARC state
- score anomalies/risk
- identify missing evidence
- draft a proposed mediation outcome
- alert reviewers

AI must not:

- hold private keys
- sign wallet transactions
- resolve disputes
- approve mutual settlements for users
- rotate the arbiter
- move treasury or user funds

## Production gate

Do not use real money until at least:

- independent audit of V1.4
- Masterlaw KYC/AML implementation and legal/regulatory readiness
- multisig/smart-account arbiter deployed and tested
- incident-response and pause runbooks
- durable case/evidence storage and audit logs
- backend ↔ ARC reconciliation under RPC failure/reorg scenarios
- privacy/data-retention controls
- tested backup RPC/indexer paths

The existence of a successful Arc Testnet deployment is not production authorization.
