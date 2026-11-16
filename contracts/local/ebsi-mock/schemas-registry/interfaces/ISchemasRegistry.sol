// SPDX-License-Identifier: EUPL V1.2
pragma solidity 0.8.26;

/**
 * @title ISchemasRegistry
 * @notice Types and events for the Schemas Registry storage layout and lifecycle.
 */
interface ISchemasRegistry {
    // --- Errors ---
    /// @notice Thrown when a required address argument is the zero address.
    error ZeroAddress();
    /// @notice Thrown when the caller does not hold the required policy attribute.
    /// @param attribute The policy attribute the caller is missing.
    error PolicyAttributeMissing(string attribute);
    /// @notice Thrown when the requested page size exceeds the maximum of 50.
    error PageSizeTooLarge();
    /// @notice Thrown when the requested page size is zero.
    error PageSizeZero();
    /// @notice Thrown when the requested page number is zero.
    error PageZero();
    /// @notice Thrown when the provided schema id is empty.
    error SchemaIdEmpty();
    /// @notice Thrown when the provided schema revision is empty.
    error RevisionEmpty();
    /// @notice Thrown when the provided metadata is empty.
    error MetadataEmpty();
    /// @notice Thrown when the provided schema revision id is empty.
    error SchemaRevisionIdEmpty();
    /// @notice Thrown when the provided metadata id is empty.
    error MetadataIdEmpty();
    /// @notice Thrown when the schema does not exist in the registry.
    error SchemaNotFound();
    /// @notice Thrown when the schema revision does not exist in the registry.
    error RevisionNotFound();
    /// @notice Thrown when the metadata does not exist in the registry.
    error MetadataNotFound();
    /// @notice Thrown when the schema revision has no associated metadata.
    error NoMetadata();
    /// @notice Thrown when inserting a schema id that is already registered.
    error SchemaAlreadyRegistered();

    /// @notice Storage layout for registered schemas, revisions, and metadata.
    struct Schemas {
        uint256 _version;
        // An ordered list of registered schema IDs
        bytes[] schemaIds;
        // Schema ID to Schema Revisions ID
        mapping(bytes => bytes32[]) schemaIdToRevisionIds;
        // Schema ID + RevisionId to MetadataIDs
        mapping(bytes => mapping(bytes32 => bytes32[])) schemaIdRevisionIdToMetadataIds;
        // Schema Revision Store
        // key is SHA2-256 hash of the given schema revision
        // value is serialized and encoded
        mapping(bytes32 => bytes) schemaRevisionStore;
        // Schema Metadata Store
        // key is SHA2-256 hash of the given schema metadata
        // value is serialized and encoded
        mapping(bytes32 => bytes) revisionMetadataStore;
        // Schema ID to Schema Revision IDs membership
        mapping(bytes => mapping(bytes32 => bool)) revisionIdExists;
        // Schema ID + RevisionId to Metadata IDs membership
        mapping(bytes => mapping(bytes32 => mapping(bytes32 => bool))) metadataIdExists;
        // Schema ID to the current latest revision id. Updated on every
        // insert/update, including republish of a known revision. Distinct from
        // the de-duplicated schemaIdToRevisionIds list, whose last element is
        // not a reliable head pointer. Zero means "unset" (pre-upgrade
        // schemas); getters fall back to the list tip.
        mapping(bytes => bytes32) latestRevisionId;
        // Schema ID + RevisionId to the current latest metadata id. Same
        // semantics as latestRevisionId. Zero means "unset".
        mapping(bytes => mapping(bytes32 => bytes32)) latestMetadataId;
    }

    /// @notice Emitted when a new schema is registered.
    /// @param schemaIdHashKeccak keccak256(schemaId), computed automatically by the EVM
    event SchemaInserted(
        bytes indexed schemaIdHashKeccak,
        bytes schemaId,
        bytes schema,
        bytes32 schemaRevisionId,
        bytes metadata,
        bytes32 metadataId
    );

    /// @notice Emitted when an existing schema revision is updated.
    /// @param schemaIdHashKeccak keccak256(schemaId), computed automatically by the EVM
    event SchemaUpdated(
        bytes indexed schemaIdHashKeccak,
        bytes schemaId,
        bytes schema,
        bytes32 schemaRevisionId,
        bytes metadata,
        bytes32 metadataId
    );

    /// @notice Emitted when metadata for a schema revision is updated.
    /// @param schemaIdHashKeccak keccak256(schemaId), computed automatically by the EVM
    event MetadataUpdated(
        bytes indexed schemaIdHashKeccak, bytes schemaId, bytes32 schemaRevisionId, bytes metadata, bytes32 metadataId
    );
}
