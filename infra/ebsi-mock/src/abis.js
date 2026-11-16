// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
/**
 * The parts of EBSI's registry contracts (contracts/local/ebsi-mock) this
 * service reads, and whose writes its Ledger API checks against a token's
 * scope. Human-readable fragments, so the image needs nothing from contracts/.
 */

const PAGE = 'uint256 total, uint256 howMany, uint256 prev, uint256 next';

const DID_ERRORS = [
  'error ZeroAddress()',
  'error FirstPublicKeyMustBeSecp256k1()',
  'error CapabilityInvocationKeyMustBeSecp256k1()',
  'error PageSizeTooLarge()',
  'error PageSizeZero()',
  'error PageZero()',
  'error ControllerDoesNotExist()',
  'error DidDoesNotExist()',
  'error NotControllerNorAuthorisedForPolicy(string policy)',
  'error InvalidDid()',
  'error InvalidBaseDocument()',
  'error InvalidVMethodId()',
  'error InvalidPublicKey()',
  'error InvalidDates()',
  'error DidAlreadyExists()',
  'error AlreadyAController()',
  'error MaxNumberOfControllers()',
  'error ControllerNotFound()',
  'error CannotRemoveLastController()',
  'error VMethodIdAlreadyExists()',
  'error PublicKeyAlreadyInUse()',
  'error InvalidName()',
  'error InvalidVerificationMethod()',
  'error VMethodIdDoesNotExist()',
  'error CapabilityInvocationAlreadyExists()',
  'error RelationshipAlreadyExists()',
  'error InvalidNotAfter()',
  'error ExpiryMustBeEarlier()',
  'error OldVMethodIdDoesNotExist()',
  'error VMethodIdAlreadyRevoked()',
  'error InvalidControlByte()',
  'error InvalidPubKeyLength()',
];

const DID_DOCUMENT =
  'string baseDocument, string[] controllerList, string[] vMethodIds, ' +
  'tuple(bytes publicKey, bool isSecp256k1, bool revoked)[] vMethods, ' +
  'tuple(string name, string vMethodId, uint256 notBefore, uint256 notAfter, uint256 indexDid)[] vRelationshipList';

export const DID_REGISTRY_ABI = [
  'function insertDidDocument(string did, string baseDocument, string vMethodId, bytes publicKey, bool isSecp256k1, uint256 notBefore, uint256 notAfter) returns (bool)',
  'function updateBaseDocument(string did, string baseDocument) returns (bool)',
  'function addController(string did, string controller) returns (bool)',
  'function revokeController(string did, string controller) returns (bool)',
  'function addVerificationMethod(string did, string vMethodId, bytes publicKey, bool isSecp256k1) returns (bool)',
  'function addVerificationRelationship(string did, string name, string vMethodId, uint256 notBefore, uint256 notAfter) returns (bool)',
  'function revokeVerificationMethod(string did, string vMethodId, uint256 notAfter) returns (bool)',
  'function expireVerificationMethod(string did, string vMethodId, uint256 notAfter) returns (bool)',
  'function rollVerificationMethod(tuple(string did, string vMethodId, bytes publicKey, bool isSecp256k1, uint256 notBefore, uint256 notAfter, string oldVMethodId, uint256 duration) args) returns (bool)',
  `function getDids(uint256 page, uint256 pageSize) view returns (string[] items, ${PAGE})`,
  `function getDidDocument(string did) view returns (${DID_DOCUMENT})`,
  `function getDidDocumentByTimestamp(string did, uint256 timestamp) view returns (${DID_DOCUMENT})`,
  'function checkController(string did, address controller) view returns (bool)',
  ...DID_ERRORS,
];

const ATTRIBUTE =
  'tuple(string did, bytes32 attributeId, bytes attribData, string tao, string rootTao, uint8 issuerType, bytes32 parentAttributeId)';

export const ISSUERS_REGISTRY_ABI = [
  'function setAttributeMetadata(string did, bytes32 revisionId, uint8 issuerType, string taoDid, bytes32 attributeIdTao)',
  'function setAttributeData(string did, bytes32 attributeId, bytes attributeData)',
  'function addIssuerProxy(string did, string proxyData)',
  'function updateIssuerProxy(string did, bytes32 proxyId, string proxyData)',
  'function removeIssuerProxy(string did, bytes32 proxyId)',
  'function getIssuer(string did) view returns (bool noAttributesAccepted, uint256 totalAttributes)',
  `function getIssuers(uint256 page, uint256 pageSize) view returns (string[] items, ${PAGE})`,
  `function getIssuerAttributes(string did, uint256 page, uint256 pageSize) view returns (bytes32[] items, ${PAGE})`,
  `function getIssuerAttributeRevisions(string did, bytes32 anyAttrVersHash, uint256 page, uint256 pageSize) view returns (bytes32[] items, ${PAGE})`,
  'function getLatestRevisionAttributeId(string did, bytes32 attributeId) view returns (bytes32)',
  `function getRevisionAttribute(string did, bytes32 attributeId, bytes32 revisionId) view returns (${ATTRIBUTE})`,
  `function getLatestRevisionAttribute(string issuerDid, bytes32 attributeId) view returns (${ATTRIBUTE})`,
  'function getIssuerProxyById(string did, bytes32 proxyId) view returns (string)',
  `function getIssuerProxies(string did, uint256 page, uint256 pageSize) view returns (bytes32[] items, ${PAGE})`,
  'error IssuerDoesNotExist()',
  'error AttributeNotFound()',
  'error RevisionNotFound()',
  'error RevisionAlreadyStored()',
  'error AttributeAlreadyStored()',
  'error AttributeAlreadyRevoked()',
  'error InvalidIssuerType()',
  'error InvalidDid()',
  'error NotTheIssuerItself()',
  'error PolicyAttributeMissing(string policy)',
  'error PolicyNotTaoOrRootTao(string policy)',
  'error PolicyNotTaoOrRootTaoOfDid(string did, string policy)',
  'error PolicyRootTaoDiffers(string taoDid, string did, string citedRootTaoDid, string attributeRootTaoDid)',
  'error TrustChainBroken(string reason)',
  'error InvalidProxyData()',
  'error ProxyAlreadyStored()',
  'error ProxyNotFound()',
  'error PolicyNotControllerOfDid(string did, string policy)',
];

/** The TIR's IssuerType, by index, as its REST API names them. */
export const ISSUER_TYPES = ['Undefined', 'RootTAO', 'TAO', 'TI', 'Revoked'];

export const SCHEMAS_REGISTRY_ABI = [
  'function insertSchema(bytes schemaId, bytes schema, bytes metadata) returns (bytes32)',
  'function updateSchema(bytes schemaId, bytes schema, bytes metadata) returns (bytes32)',
  'function updateMetadata(bytes schemaId, bytes32 schemaRevisionId, bytes metadata) returns (bytes32)',
  `function getSchemaIds(uint256 page, uint256 pageSize) view returns (bytes[] items, ${PAGE})`,
  'function getLatestSchemaRevision(bytes schemaId) view returns (bytes)',
  `function getSchemaRevisionIds(bytes schemaId, uint256 page, uint256 pageSize) view returns (bytes32[] items, ${PAGE})`,
  'function getSchemaRevision(bytes schemaId, bytes32 schemaRevisionId) view returns (bytes)',
  'function getLatestSchemaRevisionMetadataByRevisionId(bytes schemaId, bytes32 schemaRevisionId) view returns (bytes)',
  'error SchemaNotFound()',
  'error SchemaAlreadyRegistered()',
  'error RevisionNotFound()',
  'error PolicyAttributeMissing(string attribute)',
];

const HASH = 'tuple(uint256 algorithm, bytes value)';

export const TIMESTAMP_ABI = [
  'function commitTimestampHashes(bytes32 commitment)',
  'function computeTimestampCommitment(address committedBy, uint256[] hashAlgorithmIds, bytes[] hashValues, bytes[] timestampData, bytes32 salt) view returns (bytes32)',
  'function getTimestampCommitmentBlock(address committedBy, bytes32 commitment) view returns (uint64)',
  'function timestampHashes(uint256[] hashAlgorithmIds, bytes[] hashValues, bytes[] timestampData, bytes32 salt) returns (bytes32[])',
  'function timestampVersionHashes(bytes versionHash, uint256[] hashAlgorithmIds, bytes[] hashValues, bytes[] timestampData, bytes versionInfo, bytes32 salt)',
  'function timestampRecordHashes(uint256[] hashAlgorithmIds, bytes[] hashValues, bytes[] timestampData, bytes versionInfo, bytes32 salt) returns (bytes32)',
  'function timestampRecordVersionHashes(bytes32 recordId, uint256[] hashAlgorithmIds, bytes[] hashValues, bytes[] timestampData, bytes versionInfo, bytes32 salt)',
  'function appendRecordVersionHashes(bytes32 recordId, uint256 versionId, uint256[] hashAlgorithmIds, bytes[] hashValues, bytes[] timestampData, bytes versionInfo, bytes32 salt)',
  'function insertRecordVersionInfo(bytes32 recordId, uint256 versionId, bytes versionInfo)',
  'function detachRecordVersionHash(bytes32 recordId, uint256 versionId, bytes hashValue)',
  'function insertRecordOwner(bytes32 recordId, string ownerId, uint256 notBefore, uint256 notAfter)',
  'function revokeRecordOwner(bytes32 recordId, string ownerId)',
  'function insertHashAlgorithm(uint256 outputLength, string ianaName, string oid, uint8 status, string multiHash)',
  'function updateHashAlgorithm(uint256 hashAlgorithmId, uint256 outputLength, string ianaName, string oid, uint8 status, string multiHash)',
  `function getTimestamps(uint256 page, uint256 pageSize) view returns (bytes32[] items, ${PAGE})`,
  `function getTimestamp(bytes hashValue) view returns (${HASH} hash, address timestampedBy, uint256 blockNumber, bytes data)`,
  `function getTimestampById(bytes32 timestampId) view returns (${HASH} hash, address timestampedBy, uint256 blockNumber, bytes data)`,
  'function TIMESTAMP_COMMITMENT_MATURITY() view returns (uint64)',
  'function getHashAlgorithmById(uint256 hashAlgorithmId) view returns (uint256 outputLength, string ianaName, string oid, uint8 status, string multiHash)',
  'function getHashAlgorithms(uint256 page, uint256 pageSize) view returns (uint256[] items, uint256 total, uint256 howMany, uint256 prev, uint256 next)',
];

export const POLICIES_REGISTRY_ABI = [
  'function insertPolicy(string policyName, string description)',
  'function insertUserAttributes(address user, string[] attributes)',
  'function checkPolicy(string policyName, address user) view returns (bool)',
];

/**
 * Which Core API v1 scope may call which function on which registry
 * (hub.ebsi.eu/api/migration-guide, "Scope-to-function mapping").
 */
export const SCOPE_FUNCTIONS = {
  didRegistry: {
    'did-registry:invite': ['insertDidDocument'],
    'did-registry:write': [
      'addController',
      'addVerificationMethod',
      'addVerificationRelationship',
      'expireVerificationMethod',
      'revokeController',
      'revokeVerificationMethod',
      'rollVerificationMethod',
      'updateBaseDocument',
    ],
  },
  issuersRegistry: {
    'issuers-registry:invite': ['addIssuerProxy', 'removeIssuerProxy', 'updateIssuerProxy', 'setAttributeData', 'setAttributeMetadata'],
    'issuers-registry:write': ['addIssuerProxy', 'removeIssuerProxy', 'updateIssuerProxy', 'setAttributeData', 'setAttributeMetadata'],
  },
  schemasRegistry: {
    'schemas-registry:write': ['insertSchema', 'updateSchema', 'updateMetadata'],
  },
  timestamp: {
    'timestamp:write': [
      'commitTimestampHashes',
      'timestampHashes',
      'timestampRecordHashes',
      'timestampVersionHashes',
      'timestampRecordVersionHashes',
      'appendRecordVersionHashes',
      'detachRecordVersionHash',
      'insertRecordVersionInfo',
      'insertRecordOwner',
      'revokeRecordOwner',
      'insertHashAlgorithm',
      'updateHashAlgorithm',
    ],
  },
};

/** The ABI each registry name above is read with. */
export const REGISTRY_ABIS = {
  didRegistry: DID_REGISTRY_ABI,
  issuersRegistry: ISSUERS_REGISTRY_ABI,
  schemasRegistry: SCHEMAS_REGISTRY_ABI,
  timestamp: TIMESTAMP_ABI,
};
