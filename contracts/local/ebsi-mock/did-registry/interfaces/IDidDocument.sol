// SPDX-License-Identifier: EUPL V1.2
pragma solidity 0.8.26;

interface IDidDocument {
    // --- Errors ---
    /// @notice A required address parameter was the zero address.
    error ZeroAddress();
    /// @notice The first public key of a DID document must be of secp256k1 type.
    error FirstPublicKeyMustBeSecp256k1();
    /// @notice A capabilityInvocation verification method must use a secp256k1 key.
    error CapabilityInvocationKeyMustBeSecp256k1();
    /// @notice Requested page size exceeds the maximum allowed (50).
    error PageSizeTooLarge();
    /// @notice Requested page size must be greater than zero.
    error PageSizeZero();
    /// @notice Requested page number must be greater than zero.
    error PageZero();
    /// @notice The referenced controller DID does not exist.
    error ControllerDoesNotExist();
    /// @notice The referenced DID does not exist.
    error DidDoesNotExist();
    /// @notice Caller is neither a controller nor authorised by the given policy.
    /// @param policy The policy attribute that was checked.
    error NotControllerNorAuthorisedForPolicy(string policy);
    /// @notice The provided DID is empty.
    error InvalidDid();
    /// @notice The provided base document is empty.
    error InvalidBaseDocument();
    /// @notice The provided verification method id is empty.
    error InvalidVMethodId();
    /// @notice The provided public key is empty.
    error InvalidPublicKey();
    /// @notice The provided validity period is invalid.
    error InvalidDates();
    /// @notice A DID document already exists for the provided DID.
    error DidAlreadyExists();
    /// @notice The DID is already a controller of the DID document.
    error AlreadyAController();
    /// @notice The maximum number of controllers has been reached.
    error MaxNumberOfControllers();
    /// @notice The controller was not found in the DID document.
    error ControllerNotFound();
    /// @notice A DID document must retain at least one controller.
    error CannotRemoveLastController();
    /// @notice A verification method with the given id already exists.
    error VMethodIdAlreadyExists();
    /// @notice The public key is already in use by another verification method.
    error PublicKeyAlreadyInUse();
    /// @notice The provided verification relationship name is empty.
    error InvalidName();
    /// @notice The provided verification relationship name is not supported.
    error InvalidVerificationMethod();
    /// @notice The referenced verification method does not exist.
    error VMethodIdDoesNotExist();
    /// @notice A capabilityInvocation relationship already exists for the method.
    error CapabilityInvocationAlreadyExists();
    /// @notice The (name, vMethodId) relationship already exists.
    error RelationshipAlreadyExists();
    /// @notice The provided notAfter timestamp is invalid.
    error InvalidNotAfter();
    /// @notice expireVerificationMethod can only shorten an existing validity window.
    error ExpiryMustBeEarlier();
    /// @notice The referenced old verification method does not exist.
    error OldVMethodIdDoesNotExist();
    /// @notice The verification method has already been revoked.
    error VMethodIdAlreadyRevoked();
    /// @notice The uncompressed public key has an invalid control byte prefix.
    error InvalidControlByte();
    /// @notice The public key has an unsupported length.
    error InvalidPubKeyLength();

    event DidDocumentInserted(
        string did,
        string baseDocument,
        string vMethodId,
        bytes publicKey,
        bool isSecp256k1,
        uint256 notBefore,
        uint256 notAfter
    );

    event BaseDocumentUpdated(string did, string baseDocument);

    event ControllerAdded(string did, string controller);

    event ControllerRevoked(string did, string controller);

    event VerificationMethodAdded(string did, string vMethodId, bytes publicKey, bool isSecp256k1);

    event VerificationRelationshipAdded(string did, string name, string vMethodId, uint256 notBefore, uint256 notAfter);

    event VerificationMethodRevoked(string did, string vMethodId, uint256 notAfter);

    event VerificationMethodExpired(string did, string vMethodId, uint256 notAfter);

    event VerificationMethodRolled(
        string did,
        string vMethodId,
        bytes publicKey,
        bool isSecp256k1,
        uint256 notBefore,
        uint256 notAfter,
        string oldVMethodId,
        uint256 duration
    );

    struct RollArgs {
        string did;
        string vMethodId;
        bytes publicKey;
        bool isSecp256k1;
        uint256 notBefore;
        uint256 notAfter;
        string oldVMethodId;
        uint256 duration;
    }

    struct VMethod {
        bytes publicKey;
        bool isSecp256k1;
        bool revoked;
    }

    struct VRelationship {
        string name;
        string vMethodId;
        uint256 notBefore;
        uint256 notAfter;
        uint256 indexDid;
    }

    struct DidDocument {
        string baseDocument;
        string[] controllers;
        mapping(string => bool) controllerExist;
        mapping(string => VMethod) vMethods;
        VRelationship[] vRelationships;
        VRelationship[] capabilityInvocations;
        mapping(bytes32 => bool) vRelationshipsNameAndMethodIdTuple;
        mapping(string => uint256[]) vRelationshipsIndexes;
        mapping(string => bool) capabilityInvocationMethodIdExist;
        mapping(string => uint256) capabilityInvocationMethodIdIndex;
        mapping(address => string) vMethodIdOfAddress;
    }

    struct DidDocuments {
        mapping(string => DidDocument) didList;
        string[] dids;
    }
}
