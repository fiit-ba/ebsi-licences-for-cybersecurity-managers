// SPDX-License-Identifier: EUPL V1.2

pragma solidity 0.8.26;
// solhint-disable-next-line max-line-length
import "./interfaces/ISchemasRegistry.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "../policies-registry/interfaces/IPoliciesRegistry.sol";
import "../bootstrap/utils/Pagination.sol";
import {ImplementationInitSelector} from "../bootstrap/utils/introspection/ImplementationInitSelector.sol";
import "./libraries/SchemaLib.sol";

contract SchemasRegistry is ISchemasRegistry, Initializable, ImplementationInitSelector {
    using SchemaLib for Schemas;
    using Pagination for uint256;
    IPoliciesRegistry public policiesRegistryContract;

    Schemas internal schemas;

    modifier validSchemaInputs(bytes calldata schemaId, bytes32 schemaRevisionId) {
        if (schemaId.length == 0) revert SchemaIdEmpty();
        if (schemaRevisionId == bytes32(0)) revert SchemaRevisionIdEmpty();
        _;
    }

    /// @dev Requires the caller to hold `attribute` in the Policies Registry.
    modifier requiresPolicy(string memory attribute) {
        if (!policiesRegistryContract.checkPolicy(attribute, msg.sender)) {
            revert PolicyAttributeMissing(attribute);
        }
        _;
    }

    /// @dev Shared pagination bounds check for every paginated getter.
    modifier validPagination(uint256 page, uint256 pageSize) {
        _requirePagination(page, pageSize);
        _;
    }

    /// @dev Canonical pagination check. Exposed as a plain function, not just
    /// through {validPagination}, so functions that already carry too many
    /// modifier parameters to compile without `viaIR` can call it directly
    /// in the body instead of adding another modifier frame.
    function _requirePagination(uint256 page, uint256 pageSize) private pure {
        if (pageSize > 50) revert PageSizeTooLarge();
        if (pageSize == 0) revert PageSizeZero();
        if (page == 0) revert PageZero();
    }

    /// @dev Guards a schema id argument on its own, for functions that don't
    /// also take a schema revision id.
    modifier nonEmptySchemaId(bytes calldata schemaId) {
        if (schemaId.length == 0) revert SchemaIdEmpty();
        _;
    }

    /// @dev Requires `schemaId` to already have at least one registered
    /// revision. A plain function rather than a modifier to keep stack usage
    /// down on the functions with the most parameters; call it as the first
    /// statement of the body, after any preceding id/pagination checks, to
    /// preserve the original check order.
    function _requireSchemaExists(bytes calldata schemaId) private view {
        if (schemas.schemaIdToRevisionIds[schemaId].length == 0) {
            revert SchemaNotFound();
        }
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _policiesRegistryAddress) external initializer {
        if (_policiesRegistryAddress == address(0)) revert ZeroAddress();
        policiesRegistryContract = IPoliciesRegistry(_policiesRegistryAddress);
    }

    /**
     * @notice Returns the initializer selector for this implementation.
     */
    function getImplementationInitSelector() external pure override returns (bytes4) {
        return this.initialize.selector;
    }

    /**
     * @dev insertSchema enables to register new schema.
     */
    function insertSchema(bytes calldata schemaId, bytes calldata schema, bytes calldata metadata)
        external
        requiresPolicy("SchemasRegistry:insertSchema")
        returns (bytes32 schemaRevisionId)
    {
        schemaRevisionId = schemas.insertSchema(schemaId, schema, metadata);
    }

    /**
     * @dev getSchemaIds returns a paginated list of registered schema ids.
     */
    function getSchemaIds(uint256 page, uint256 pageSize)
        external
        view
        validPagination(page, pageSize)
        returns (bytes[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next)
    {
        uint256[] memory ids;
        (ids, total, howMany, prev, next) = schemas.schemaIds.length.paginate(page, pageSize);
        items = new bytes[](howMany);
        for (uint256 i = 0; i < howMany; i++) {
            items[i] = schemas.schemaIds[ids[i]];
        }
    }

    /**
     * @dev updateSchema enables to update the existing schema.
     */
    function updateSchema(bytes calldata schemaId, bytes calldata schema, bytes calldata metadata)
        external
        requiresPolicy("SchemasRegistry:updateSchema")
        returns (bytes32 schemaRevisionId)
    {
        schemaRevisionId = schemas.updateSchema(schemaId, schema, metadata);
    }

    /**
     * @dev updateMetadata enables to update the existing metadata.
     */
    function updateMetadata(bytes calldata schemaId, bytes32 schemaRevisionId, bytes calldata metadata)
        external
        requiresPolicy("SchemasRegistry:updateMetadata")
        returns (bytes32 metadataId)
    {
        metadataId = schemas.updateMetadata(schemaId, schemaRevisionId, metadata);
    }

    /**
     * @dev getLatestSchemaRevision returns the latest schema revision by schema id.
     */
    function getLatestSchemaRevision(bytes calldata schemaId) external view returns (bytes memory schema) {
        schema = schemas.getLatestSchemaRevision(schemaId);
    }

    /**
     * @dev getSchemaRevisionIds returns a paginated list of schema revision ids for the given schema id.
     */
    function getSchemaRevisionIds(bytes calldata schemaId, uint256 page, uint256 pageSize)
        external
        view
        nonEmptySchemaId(schemaId)
        returns (bytes32[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next)
    {
        _requirePagination(page, pageSize);
        _requireSchemaExists(schemaId);
        bytes32[] storage revisionIds = schemas.schemaIdToRevisionIds[schemaId];
        uint256[] memory ids;
        (ids, total, howMany, prev, next) = revisionIds.length.paginate(page, pageSize);
        items = new bytes32[](howMany);
        for (uint256 i = 0; i < howMany; i++) {
            items[i] = revisionIds[ids[i]];
        }
    }

    /**
     * @dev getSchemaRevision returns a specific schema revision for a specific SchemaRevisionId.
     */
    function getSchemaRevision(bytes calldata schemaId, bytes32 schemaRevisionId)
        external
        view
        returns (bytes memory schema)
    {
        schema = schemas.getSchemaRevision(schemaId, schemaRevisionId);
    }

    /**
     * @dev getLatestSchemaRevisionMetadataByRevisionId returns schema revision metadata for the given schema revision id.
     */
    function getLatestSchemaRevisionMetadataByRevisionId(bytes calldata schemaId, bytes32 schemaRevisionId)
        external
        view
        returns (bytes memory metadata)
    {
        metadata = schemas.getLatestSchemaRevisionMetadataByRevisionId(schemaId, schemaRevisionId);
    }

    /**
     * @dev getSchemaRevisionMetadataIds returns a paginated list of schema revision metadata ids, for a specific SchemaRevisionId
     */
    function getSchemaRevisionMetadataIds(
        bytes calldata schemaId,
        bytes32 schemaRevisionId,
        uint256 page,
        uint256 pageSize
    )
        external
        view
        validSchemaInputs(schemaId, schemaRevisionId)
        returns (bytes32[] memory items, uint256 total, uint256 howMany, uint256 prev, uint256 next)
    {
        _requirePagination(page, pageSize);
        _requireSchemaExists(schemaId);
        bytes32[] storage metadataIds = schemas.schemaIdRevisionIdToMetadataIds[schemaId][schemaRevisionId];
        if (metadataIds.length == 0) revert RevisionNotFound();
        uint256[] memory ids;
        (ids, total, howMany, prev, next) = metadataIds.length.paginate(page, pageSize);
        items = new bytes32[](howMany);
        for (uint256 i = 0; i < howMany; i++) {
            items[i] = metadataIds[ids[i]];
        }
    }

    /**
     * @dev getSchemaRevisionMetadataByMetadataId returns schema revision metadata for the given schema revision metadata id.
     */
    function getSchemaRevisionMetadataByMetadataId(
        bytes calldata schemaId,
        bytes32 schemaRevisionId,
        bytes32 metadataId
    ) external view returns (bytes memory metadata) {
        metadata = schemas.getSchemaRevisionMetadataByMetadataId(schemaId, schemaRevisionId, metadataId);
    }

    uint256[50] private __gap;
}
