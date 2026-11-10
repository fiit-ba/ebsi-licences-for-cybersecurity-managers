// SPDX-License-Identifier: EUPL V1.2

pragma solidity 0.8.26;

import "../interfaces/ISchemasRegistry.sol";

library SchemaLib {
    /// @notice Emitted when a new schema is registered.
    /// @param schemaIdHashKeccak keccak256(schemaId), computed automatically by the EVM
    ///        because `schemaId` is a dynamic type and cannot itself fit in an indexed
    ///        topic. This is NOT sha256(schemaId) — unlike schemaRevisionId/metadataId,
    ///        which are sha256 digests computed by this contract. Filter logs by
    ///        keccak256(schemaId); the raw value is available below as `schemaId`.
    event SchemaInserted(
        bytes indexed schemaIdHashKeccak,
        bytes schemaId,
        bytes schema,
        bytes32 schemaRevisionId,
        bytes metadata,
        bytes32 metadataId
    );

    /// @notice Emitted when a schema is updated with a new revision.
    /// @param schemaIdHashKeccak keccak256(schemaId), computed automatically by the EVM
    ///        because `schemaId` is a dynamic type and cannot itself fit in an indexed
    ///        topic. This is NOT sha256(schemaId) — unlike schemaRevisionId/metadataId,
    ///        which are sha256 digests computed by this contract. Filter logs by
    ///        keccak256(schemaId); the raw value is available below as `schemaId`.
    event SchemaUpdated(
        bytes indexed schemaIdHashKeccak,
        bytes schemaId,
        bytes schema,
        bytes32 schemaRevisionId,
        bytes metadata,
        bytes32 metadataId
    );

    /// @notice Emitted when metadata is added to a schema revision.
    /// @param schemaIdHashKeccak keccak256(schemaId), computed automatically by the EVM
    ///        because `schemaId` is a dynamic type and cannot itself fit in an indexed
    ///        topic. This is NOT sha256(schemaId) — unlike schemaRevisionId/metadataId,
    ///        which are sha256 digests computed by this contract. Filter logs by
    ///        keccak256(schemaId); the raw value is available below as `schemaId`.
    event MetadataUpdated(
        bytes indexed schemaIdHashKeccak, bytes schemaId, bytes32 schemaRevisionId, bytes metadata, bytes32 metadataId
    );

    /// @dev Guards a schema id argument on its own, for functions that don't
    /// also take a schema revision id.
    modifier nonEmptySchemaId(bytes calldata schemaId) {
        if (schemaId.length == 0) revert ISchemasRegistry.SchemaIdEmpty();
        _;
    }

    modifier validSchemaInputs(bytes calldata schemaId, bytes32 schemaRevisionId) {
        if (schemaId.length == 0) revert ISchemasRegistry.SchemaIdEmpty();
        if (schemaRevisionId == bytes32(0)) {
            revert ISchemasRegistry.SchemaRevisionIdEmpty();
        }
        _;
    }

    /// @dev Reverts with the single canonical `SchemaNotFound` unless `schemaId`
    /// has at least one registered revision.
    function _requireSchemaRegistered(ISchemasRegistry.Schemas storage ss, bytes calldata schemaId) private view {
        if (ss.schemaIdToRevisionIds[schemaId].length == 0) {
            revert ISchemasRegistry.SchemaNotFound();
        }
    }

    /// @dev Reverts with the single canonical `RevisionNotFound` unless
    /// `schemaRevisionId` has at least one metadata entry under `schemaId`.
    function _requireRevisionRegistered(
        ISchemasRegistry.Schemas storage ss,
        bytes calldata schemaId,
        bytes32 schemaRevisionId
    ) private view {
        if (ss.schemaIdRevisionIdToMetadataIds[schemaId][schemaRevisionId].length == 0) {
            revert ISchemasRegistry.RevisionNotFound();
        }
    }

    /// @dev Writes `value` under `key` only if nothing is stored there yet,
    /// preserving the existing content-addressed, write-once semantics.
    function _writeOnce(mapping(bytes32 => bytes) storage store, bytes32 key, bytes memory value) private {
        if (store[key].length == 0) {
            store[key] = value;
        }
    }

    /// @dev Returns the last element of a non-empty bytes32 list.
    function _latest(bytes32[] storage list) private view returns (bytes32) {
        return list[list.length - 1];
    }

    /// @dev Returns `stored` if set, otherwise the last element of `list`.
    /// Zero-pointer fallback lets schemas written before `latestRevisionId` /
    /// `latestMetadataId` existed keep resolving via the de-duplicated list
    /// until the next write backfills the pointer.
    function _head(bytes32 stored, bytes32[] storage list) private view returns (bytes32) {
        return stored != bytes32(0) ? stored : _latest(list);
    }

    /// @dev Appends `id` to `list` only if it isn't already present.
    function _pushIfNew(bytes32[] storage list, mapping(bytes32 => bool) storage exists, bytes32 id) private {
        if (!exists[id]) {
            list.push(id);
            exists[id] = true;
        }
    }

    /**
     * @dev insertSchema enables to register new schema.
     */
    function insertSchema(
        ISchemasRegistry.Schemas storage ss,
        bytes calldata schemaId,
        bytes calldata schema,
        bytes calldata metadata
    ) external nonEmptySchemaId(schemaId) returns (bytes32 schemaRevisionId) {
        if (schema.length == 0) revert ISchemasRegistry.RevisionEmpty();
        if (metadata.length == 0) revert ISchemasRegistry.MetadataEmpty();

        schemaRevisionId = sha256(schema);

        // Verify that the schema ID is not already registered (in the Schema ID To Schema Revisions IDs map)
        if (ss.schemaIdToRevisionIds[schemaId].length != 0) {
            revert ISchemasRegistry.SchemaAlreadyRegistered();
        }

        // add schema id to the list
        ss.schemaIds.push(schemaId);
        // add revision id to the list of schema
        _pushIfNew(ss.schemaIdToRevisionIds[schemaId], ss.revisionIdExists[schemaId], schemaRevisionId);
        bytes32 metadataId = sha256(metadata);
        // add metadataId to the current revisionId
        _pushIfNew(
            ss.schemaIdRevisionIdToMetadataIds[schemaId][schemaRevisionId],
            ss.metadataIdExists[schemaId][schemaRevisionId],
            metadataId
        );
        ss.latestRevisionId[schemaId] = schemaRevisionId;
        ss.latestMetadataId[schemaId][schemaRevisionId] = metadataId;
        // save metadata of revision
        _writeOnce(ss.revisionMetadataStore, metadataId, metadata);
        // save schema revision (bytes)
        _writeOnce(ss.schemaRevisionStore, schemaRevisionId, schema);

        emit SchemaInserted(schemaId, schemaId, schema, schemaRevisionId, metadata, metadataId);
    }

    /**
     * @dev getLatestSchemaRevision returns the latest schema revision by schema id.
     */
    function getLatestSchemaRevision(ISchemasRegistry.Schemas storage ss, bytes calldata schemaId)
        external
        view
        nonEmptySchemaId(schemaId)
        returns (bytes memory schemaRevision)
    {
        _requireSchemaRegistered(ss, schemaId);
        bytes32 latestSchemaRevisionId = _head(ss.latestRevisionId[schemaId], ss.schemaIdToRevisionIds[schemaId]);
        schemaRevision = ss.schemaRevisionStore[latestSchemaRevisionId];
    }

    /**
     * @dev getLatestSchemaRevisionMetadataByRevisionId returns schema revision metadata for
     * the given schema revision id.
     */
    function getLatestSchemaRevisionMetadataByRevisionId(
        ISchemasRegistry.Schemas storage ss,
        bytes calldata schemaId,
        bytes32 schemaRevisionId
    ) external view validSchemaInputs(schemaId, schemaRevisionId) returns (bytes memory metadata) {
        bytes32[] storage metadataIds = ss.schemaIdRevisionIdToMetadataIds[schemaId][schemaRevisionId];
        if (metadataIds.length == 0) revert ISchemasRegistry.NoMetadata();

        metadata = ss.revisionMetadataStore[_head(ss.latestMetadataId[schemaId][schemaRevisionId], metadataIds)];
    }

    /**
     * @dev updateSchema enables to update the existing schema.
     */
    function updateSchema(
        ISchemasRegistry.Schemas storage ss,
        bytes calldata schemaId,
        bytes calldata schema,
        bytes calldata metadata
    ) external nonEmptySchemaId(schemaId) returns (bytes32 schemaRevisionId) {
        if (schema.length == 0) revert ISchemasRegistry.RevisionEmpty();
        if (metadata.length == 0) revert ISchemasRegistry.MetadataEmpty();

        schemaRevisionId = sha256(schema);
        bytes32 metadataId = sha256(metadata);

        // Verify that the schema ID is already registered (in the Schema ID To Schema Revisions IDs map)
        _requireSchemaRegistered(ss, schemaId);

        // Insert the schema to the Schema Revisions Store
        _writeOnce(ss.schemaRevisionStore, schemaRevisionId, schema);

        // Append a new entry in the Schema ID to Schema Revisions IDs map
        _pushIfNew(ss.schemaIdToRevisionIds[schemaId], ss.revisionIdExists[schemaId], schemaRevisionId);
        // Store the metadata to the Metadata Store
        _writeOnce(ss.revisionMetadataStore, metadataId, metadata);

        // Append a new entry in the Schema Revision ID to Metadata IDs store.
        _pushIfNew(
            ss.schemaIdRevisionIdToMetadataIds[schemaId][schemaRevisionId],
            ss.metadataIdExists[schemaId][schemaRevisionId],
            metadataId
        );
        ss.latestRevisionId[schemaId] = schemaRevisionId;
        ss.latestMetadataId[schemaId][schemaRevisionId] = metadataId;

        emit SchemaUpdated(schemaId, schemaId, schema, schemaRevisionId, metadata, metadataId);
    }

    /**
     * @dev updateMetadata enables to update the existing metadata.
     */
    function updateMetadata(
        ISchemasRegistry.Schemas storage ss,
        bytes calldata schemaId,
        bytes32 schemaRevisionId,
        bytes calldata metadata
    ) external validSchemaInputs(schemaId, schemaRevisionId) returns (bytes32 metadataId) {
        if (metadata.length == 0) revert ISchemasRegistry.MetadataEmpty();
        // Verify that the Schema ID is already registered
        _requireSchemaRegistered(ss, schemaId);
        // Verify that the Schema Revision ID is already registered (in the Schema Revision ID To Metadata IDs map)
        _requireRevisionRegistered(ss, schemaId, schemaRevisionId);

        // Compute the SHA2-256 hash of the metadata
        metadataId = sha256(metadata);

        // Store the metadata to the Metadata Store
        _writeOnce(ss.revisionMetadataStore, metadataId, metadata);

        // Append a new entry in the Schema Revision ID to Metadata IDs store.
        _pushIfNew(
            ss.schemaIdRevisionIdToMetadataIds[schemaId][schemaRevisionId],
            ss.metadataIdExists[schemaId][schemaRevisionId],
            metadataId
        );
        ss.latestMetadataId[schemaId][schemaRevisionId] = metadataId;

        emit MetadataUpdated(schemaId, schemaId, schemaRevisionId, metadata, metadataId);
    }

    /**
     * @dev getSchemaRevision returns a specific schema revision for a specific SchemaRevisionId.
     */
    function getSchemaRevision(ISchemasRegistry.Schemas storage ss, bytes calldata schemaId, bytes32 schemaRevisionId)
        external
        view
        validSchemaInputs(schemaId, schemaRevisionId)
        returns (bytes memory schema)
    {
        _requireSchemaRegistered(ss, schemaId);
        _requireRevisionRegistered(ss, schemaId, schemaRevisionId);

        schema = ss.schemaRevisionStore[schemaRevisionId];
    }

    /**
     * @dev getSchemaRevisionMetadataByMetadataId returns schema revision metadata
     * for the given schema revision metadata id.
     */
    function getSchemaRevisionMetadataByMetadataId(
        ISchemasRegistry.Schemas storage ss,
        bytes calldata schemaId,
        bytes32 schemaRevisionId,
        bytes32 metadataId
    ) external view validSchemaInputs(schemaId, schemaRevisionId) returns (bytes memory metadata) {
        _requireSchemaRegistered(ss, schemaId);
        _requireRevisionRegistered(ss, schemaId, schemaRevisionId);

        if (metadataId == bytes32(0)) revert ISchemasRegistry.MetadataIdEmpty();
        if (!ss.metadataIdExists[schemaId][schemaRevisionId][metadataId]) {
            revert ISchemasRegistry.MetadataNotFound();
        }
        metadata = ss.revisionMetadataStore[metadataId];
    }
}
