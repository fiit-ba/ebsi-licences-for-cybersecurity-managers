# Sequence diagrams

How the two contracts work with each other and with EBSI's registries. The
first diagram is the check that most other calls start with. The contracts
themselves are described in [README.md](../README.md).

Participants:

| Name | What it is |
|---|---|
| `CertificateRegistry` | The records and their standing. All a verifier reads. |
| `CertificateGovernance` | TIs, signers, cosigners, policies and proposals, one contract per TAO. |
| DID Registry | EBSI's DIDR: which keys are valid keys of a DID. |
| Trusted Issuers Registry | EBSI's TIR: who accredited whom. |
| TAO | The contract's owner; acts with a key of its DID. |
| TI signer | A key of the TI's DID, or of a cosigner's DID, with a role. |

## 1. Is this key a signer of this TI, and is the TI accredited?

The check has two parts:

1. **The key signs for this TI.** It is one of the TI's signer keys and the
   DID Registry still shows it as a valid key of the TI's DID, or it is a valid
   key of one of the TI's cosigner DIDs. Either way it holds a role (A, B, C,
   ...), which quorums and veto rights count. A key the DID Registry no longer
   shows has no role.
2. **The TI is accredited.** The Trusted Issuers Registry shows the TI's
   accreditation by the TAO, and every step above it up to the RootTAO.

`requireActiveSigner(tiId, account)` checks both, when something starts:
registering a certificate, proposing a status change or a rule change.
`requireSigner(tiId, account)` checks only the first part. It is used for
every signature, for a veto and for `suspendNow`.

```mermaid
sequenceDiagram
    autonumber
    participant C as Caller
    participant G as CertificateGovernance
    participant D as DID Registry
    participant T as Trusted Issuers Registry

    C->>G: requireActiveSigner(tiId, account)
    Note over G: roleOf(tiId, account)
    alt account is one of the TI's signers
        G->>D: checkController(tiDid, account)
        D-->>G: true / false
    else otherwise, each cosigner in turn
        loop until one matches
            G->>D: checkController(cosignerDid, account)
            D-->>G: true / false
        end
    end
    alt no role
        G-->>C: revert NotASigner
    end
    Note over G: isActiveTi(tiDid, attributeId)
    G->>T: getLatestRevisionAttribute(tiDid, attributeId)
    T-->>G: type TI, tao = taoDid
    loop each parent, up to MAX_TRUST_CHAIN_DEPTH
        G->>T: getLatestRevisionAttribute(parent.tao, parentAttributeId)
        T-->>G: TAO, or RootTAO (stop)
    end
    alt not accredited, or the chain breaks
        G-->>C: revert TiNotActive
    else
        G-->>C: ok
    end
```

## 2. Deployment and setting up a TI

Both contracts run behind a beacon proxy. The registry is deployed
first, governance is initialized with its address, and then the registry is
pointed at governance.

```mermaid
sequenceDiagram
    autonumber
    actor Dep as Deployer
    actor TAO
    participant F as EBSI Proxy Factory
    participant R as CertificateRegistry
    participant G as CertificateGovernance
    participant D as DID Registry
    participant T as Trusted Issuers Registry

    Dep->>F: deployProxy("CertificateRegistry", initialize(tao))
    F->>R: initialize(tao)
    Dep->>F: deployProxy("CertificateGovernance", initialize(tao, taoDid, DIDR, TIR, registry))
    F->>G: initialize(...)
    G-->>Dep: CertificateRegistryChanged
    TAO->>R: setGovernance(governance)
    R-->>TAO: GovernanceChanged

    Note over TAO,T: Per TI, once the TAO has accredited it in the TIR
    TAO->>G: addTi(TiSetup{did, attributeId, signers, roles, cosigners, policies, ttl})
    G->>D: checkController(taoDid, TAO)
    G->>T: isActiveTi(did, attributeId), as in diagram 1
    loop each signer
        G->>D: checkController(did, signer)
    end
    Note over G: every policy well formed and reachable with the roles present
    G-->>TAO: SignerAdded..., PolicyChanged..., ProposalTtlChanged, TiConfigured(tiId)

    opt later
        TAO->>G: setCosigners(tiId, cosigners)
        G-->>TAO: CosignersChanged
        TAO->>G: setTiAttribute(tiId, attributeId)
        G-->>TAO: TiAttributeChanged
    end
```

## 3. Registering a certificate

The record is written once the holder has collected the certificate, when the
credential's id and its signed JWT exist: the record's key is computed from the
TI's DID and that id, and the record keeps the JWT's hash.

```mermaid
sequenceDiagram
    autonumber
    actor S as TI signer
    participant R as CertificateRegistry
    participant G as CertificateGovernance

    Note over S: certificateIdHash = SHA-256(abi.encode("PLR-CERTIFICATE-ID-V1", vc.id))<br/>credentialHash = SHA-256(JWT before the first "~")
    S->>R: registerCertificate(certificateIdHash, issuerDid, validFrom, validUntil, credentialHash, standing)
    Note over R: refuses empty fields, validUntil <= validFrom, standing NONE
    R->>G: requireActiveSigner(keccak256(issuerDid), signer)
    Note over G: diagram 1
    G-->>R: ok
    Note over R: statusKey = SHA-256(abi.encode("PLR-CERTIFICATE-V4", issuerDid, certificateIdHash))
    alt a record under statusKey exists
        R-->>S: revert CertificateAlreadyRegistered
    else
        R-->>S: CertificateRegistered(statusKey, credentialHash, validFrom, validUntil, standing, signer)
    end
```

## 4. Emergency suspension

One signature, no quorum (component 10.6). It does not ask whether the TI is
still accredited: a revoked TI's certificates are withdrawn this way.

```mermaid
sequenceDiagram
    autonumber
    actor S as TI signer
    participant R as CertificateRegistry
    participant G as CertificateGovernance

    S->>R: suspendNow(statusKey, reasonHash)
    Note over R: reasonHash required, the record must exist
    R->>G: requireSigner(keccak256(record.issuerDid), signer)
    G-->>R: ok (roleOf, diagram 1, without the TIR)
    alt standing is not VALID
        R-->>S: revert CertificateNotValid
    else
        R-->>S: CertificateStandingChanged(statusKey, SUSPENDED, 0, reasonHash, signer)
    end
```

## 5. A status proposal: suspend, revoke or reinstate

The proposer's call counts as the first signature. Quorum counts distinct roles
under the action's policy. A revocation usually has a timelock; a suspension
and a reinstatement usually do not; either way the proposal is `APPROVED`
until it is executed.

```mermaid
sequenceDiagram
    autonumber
    actor A as Signer, role A
    actor B as Signer, role B
    participant G as CertificateGovernance
    participant R as CertificateRegistry

    A->>G: proposeAction(tiId, statusKey, actionType, reasonHash)
    Note over G: requireActiveSigner (diagram 1)<br/>reasonHash required unless REINSTATE
    G->>R: requireChangeableBy(statusKey, tiId)
    Note over R: record exists, is this TI's, is not REVOKED
    R-->>G: ok
    Note over G: one open proposal per certificate,<br/>an open one past its TTL is expired here
    G-->>A: ProposalCreated(id, tiId, statusKey, actionType, reasonHash, A)
    G-->>A: ProposalSigned(id, A, role A, {A})

    B->>G: signProposal(id)
    Note over G: open, within TTL, caller holds a role
    G-->>B: ProposalSigned(id, B, role B, {A, B})
    Note over G: policy met → state APPROVED,<br/>quorumReachedAt = now
    G-->>B: QuorumReached(id, executableAt = quorumReachedAt + timelock)

    opt timelock > 0
        Note over A,G: wait until executableAt, any veto role may cancel meanwhile (diagram 6)
    end

    A->>G: execute(id)
    Note over G: caller is a signer, TI still accredited (TIR),<br/>state APPROVED, quorum met again with today's keys and policy,<br/>now >= executableAt
    G-->>A: ProposalExecuted(id, statusKey, actionType)
    G->>R: applyExecuted(tiId, statusKey, actionType, id, reasonHash, A)
    Note over R: only governance may call, same checks as requireChangeableBy
    R-->>A: CertificateStandingChanged(statusKey, SUSPENDED / REVOKED / VALID, id, reasonHash, A)
```

If a signer key is removed or replaced after the quorum and a later signature
brings the quorum back, `quorumReachedAt` restarts and `QuorumReached` is
emitted again.

## 6. Veto, withdrawal and expiry

```mermaid
sequenceDiagram
    autonumber
    actor V as Signer with a veto role, or the proposer
    actor Any as Anyone
    participant G as CertificateGovernance

    V->>G: cancelProposal(id, reasonHash)
    Note over G: open, within TTL, caller holds a role,<br/>caller is the proposer or its role is in vetoRoleMask
    G-->>V: ProposalCancelled(id, statusKey, V, reasonHash)

    Note over Any,G: a proposal past its TTL
    Any->>G: expireProposal(id)
    G-->>Any: ProposalExpired(id, statusKey)
```

## 7. A rule change of a TI

Signers, policies and the proposal TTL change only through the TI's ADMIN
policy (component 10.4). Without a timelock, the signature that completes the
quorum applies the change.

```mermaid
sequenceDiagram
    autonumber
    actor A as Signer, role A
    actor C as Signer, role C
    participant G as CertificateGovernance
    participant D as DID Registry

    A->>G: proposeReplaceSigner(tiId, oldKey, newKey)
    Note over G: requireActiveSigner (diagram 1)
    G->>D: checkController(tiDid, newKey)
    Note over G: oldKey is a signer, newKey is new, not retired
    G-->>A: AdminProposalCreated(id, tiId, REPLACE_SIGNER, A), AdminProposalSigned

    C->>G: signAdminProposal(id)
    G-->>C: AdminProposalSigned, AdminQuorumReached(id, executableAt)

    alt ADMIN timelock = 0
        Note over G: applied within C's call
    else timelock > 0
        Note over A,G: wait, a veto role may cancelAdminProposal,<br/>but not the key being removed (CannotVetoOwnRemoval)
        A->>G: executeAdminProposal(id)
        Note over G: quorum met again, now >= executableAt
    end
    Note over G: TI still accredited, the change is still valid,<br/>oldKey retired, newKey takes its role
    G-->>A: SignerReplaced(tiId, oldKey, newKey, role), AdminProposalExecuted(id, REPLACE_SIGNER)
```

## 8. A verifier checks a certificate

A verifier reads EBSI's registries and the certificate registry, and needs
neither the back-office nor the TI. The contract does not judge the trust
chain when it is read: the verifier checks the chain itself, in the Trusted
Issuers Registry, before it reads the record. A broken chain stops it there,
whatever the record says.

```mermaid
sequenceDiagram
    autonumber
    actor W as Verifier
    participant D as DID Registry
    participant T as Trusted Issuers Registry
    participant R as CertificateRegistry

    Note over W: from the presentation: issuer (TI DID), vc.id, the signed JWT
    W->>D: the issuer's DID document as of issuance (valid-at)
    D-->>W: its keys then
    alt the JWT's signature does not verify
        Note over W: INVALID_SIGNATURE, stop
    end

    W->>T: the TI's accreditation
    T-->>W: VerifiableAccreditationToAttest, signed by its TAO
    loop up the chain
        W->>T: the accreditation of the DID above
        T-->>W: TAO's accreditation, or the RootTAO's authorisation
    end
    alt the TIR cannot be read
        Note over W: INDETERMINATE, stop
    else broken chain: an attribute Revoked, missing or not in force, a step that does not cover the schema, or no trusted root at the top
        Note over W: UNTRUSTED_ISSUER, stop
    end

    W->>R: computeStatusKey(issuerDid, vc.id)
    R-->>W: statusKey
    Note over W: or locally, with the same two SHA-256 steps
    W->>R: certificateStatus(statusKey)
    R-->>W: Certificate{standing, validFrom, validUntil, registeredAt, changedAt, credentialHash, issuerDid}
    alt standing NONE
        Note over W: STATUS_UNAVAILABLE
    else credentialHash != SHA-256(JWT before "~") or issuerDid differs
        Note over W: refused
    else standing SUSPENDED or REVOKED
        Note over W: not valid
    else outside validFrom..validUntil
        Note over W: not yet valid, or expired
    else
        Note over W: VALID
    end
```

## 9. An auditor checks a proposal

The reason is on chain only as a salted commitment. Its pre-image comes
from the back-office, which records each disclosure.

```mermaid
sequenceDiagram
    autonumber
    actor Au as Auditor
    participant BO as Back-office
    participant G as CertificateGovernance
    participant R as CertificateRegistry

    Au->>G: getProposal(id)
    G-->>Au: tiId, statusKey, actionType, reasonHash, signatures, state, ...
    Au->>BO: POST registry/audit/reason-preimage (proposal)
    BO-->>Au: reasonCode, reasonNote, salt (disclosure recorded)
    Au->>G: verifyProposalReason(id, reasonCode, reasonNote, salt)
    G-->>Au: true / false
    Au->>R: computeStatusKey(issuerDid, certificateId)
    R-->>Au: equals the proposal's statusKey?
    Au->>R: certificateStatus(statusKey)
    R-->>Au: the standing the executed proposal set
```
