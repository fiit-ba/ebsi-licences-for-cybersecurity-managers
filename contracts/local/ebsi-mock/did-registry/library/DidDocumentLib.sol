// SPDX-License-Identifier: EUPL V1.2
pragma solidity 0.8.26;

import "../interfaces/IDidDocument.sol";
import "../interfaces/IVRelationships.sol";
import "./VRelationshipsLib.sol";
import "../UtilsLib.sol";

library DidDocumentLib {
    using VRelationshipsLib for IVRelationships.VRelationships;

    string public constant AUTHENTICATION_RELATIONSHIP = "authentication";
    string public constant ASSERTION_RELATIONSHIP = "assertionMethod";
    string public constant KEY_AGREEMENT_RELATIONSHIP = "keyAgreement";
    string public constant CAPABILITY_INVOCATION_RELATIONSHIP = "capabilityInvocation";
    string public constant CAPABILITY_DELEGATION_RELATIONSHIP = "capabilityDelegation";
    uint256 public constant MAX_CONTROLLERS = 10;

    function insertDidDocument(
        IDidDocument.DidDocuments storage ds,
        IVRelationships.VRelationships storage vs,
        string memory did,
        string memory baseDocument,
        string memory vMethodId,
        bytes memory publicKey,
        bool isSecp256k1,
        uint256 notBefore,
        uint256 notAfter
    ) external returns (bool) {
        IDidDocument.DidDocument storage d = ds.didList[did];
        if (bytes(did).length == 0) revert IDidDocument.InvalidDid();
        if (bytes(baseDocument).length == 0) {
            revert IDidDocument.InvalidBaseDocument();
        }
        if (bytes(vMethodId).length == 0) {
            revert IDidDocument.InvalidVMethodId();
        }
        if (publicKey.length == 0) revert IDidDocument.InvalidPublicKey();
        if (notAfter < notBefore || notAfter <= block.timestamp) {
            revert IDidDocument.InvalidDates();
        }

        if (bytes(d.baseDocument).length != 0) {
            revert IDidDocument.DidAlreadyExists();
        }

        d.baseDocument = baseDocument;
        d.controllers.push(did);
        d.controllerExist[did] = true;
        // first vMethod should always be secp256k1 type
        d.vMethods[vMethodId] = IDidDocument.VMethod(publicKey, isSecp256k1, false);

        uint256 indexDid;

        indexDid = _addVerificationRelationship(vs, "capabilityInvocation", vMethodId, did, notBefore, notAfter);
        // insert getAddress in the did
        d.vMethodIdOfAddress[getAddress(publicKey)] = vMethodId;
        d.capabilityInvocationMethodIdExist[vMethodId] = true;
        d.capabilityInvocationMethodIdIndex[vMethodId] = d.capabilityInvocations.length;
        d.capabilityInvocations
            .push(IDidDocument.VRelationship("capabilityInvocation", vMethodId, notBefore, notAfter, indexDid));

        indexDid = _addVerificationRelationship(vs, "authentication", vMethodId, did, notBefore, notAfter);
        d.vRelationshipsIndexes[vMethodId].push(d.vRelationships.length);
        d.vRelationshipsNameAndMethodIdTuple[keccak256(abi.encode("authentication", vMethodId))] = true;
        d.vRelationships.push(IDidDocument.VRelationship("authentication", vMethodId, notBefore, notAfter, indexDid));

        ds.dids.push(did);
        return true;
    }

    function updateBaseDocument(IDidDocument.DidDocuments storage ds, string memory did, string memory baseDocument)
        external
        returns (bool)
    {
        if (bytes(baseDocument).length == 0) {
            revert IDidDocument.InvalidBaseDocument();
        }
        ds.didList[did].baseDocument = baseDocument;
        return true;
    }

    function addController(IDidDocument.DidDocuments storage ds, string memory did, string memory controller)
        external
        returns (bool)
    {
        if (bytes(ds.didList[controller].baseDocument).length == 0) {
            revert IDidDocument.ControllerDoesNotExist();
        }
        IDidDocument.DidDocument storage d = ds.didList[did];
        if (d.controllerExist[controller]) {
            revert IDidDocument.AlreadyAController();
        }
        if (d.controllers.length >= MAX_CONTROLLERS) {
            revert IDidDocument.MaxNumberOfControllers();
        }
        d.controllers.push(controller);
        d.controllerExist[controller] = true;
        return true;
    }

    function revokeController(IDidDocument.DidDocuments storage ds, string memory did, string memory controller)
        external
        returns (bool)
    {
        IDidDocument.DidDocument storage d = ds.didList[did];
        if (!d.controllerExist[controller]) {
            revert IDidDocument.ControllerNotFound();
        }
        if (d.controllers.length <= 1) {
            revert IDidDocument.CannotRemoveLastController();
        }
        for (uint256 i = 0; i < d.controllers.length; i++) {
            if (UtilsLib.equalStrings(d.controllers[i], controller)) {
                // swap with the last controller and pop the last one
                d.controllers[i] = d.controllers[d.controllers.length - 1];
                d.controllers.pop();
                d.controllerExist[controller] = false;
                break;
            }
        }
        return true;
    }

    function addVerificationMethod(
        IDidDocument.DidDocuments storage ds,
        string memory did,
        string memory vMethodId,
        bytes memory publicKey,
        bool isSecp256k1
    ) external returns (bool) {
        IDidDocument.DidDocument storage d = ds.didList[did];
        if (bytes(vMethodId).length == 0) {
            revert IDidDocument.InvalidVMethodId();
        }
        if (publicKey.length == 0) revert IDidDocument.InvalidPublicKey();
        if (d.vMethods[vMethodId].publicKey.length != 0) {
            revert IDidDocument.VMethodIdAlreadyExists();
        }

        if (isSecp256k1) {
            address keyAddress = getAddress(publicKey);
            if (bytes(d.vMethodIdOfAddress[keyAddress]).length != 0) {
                revert IDidDocument.PublicKeyAlreadyInUse();
            }
            d.vMethodIdOfAddress[keyAddress] = vMethodId;
        }

        d.vMethods[vMethodId] = IDidDocument.VMethod(publicKey, isSecp256k1, false);

        return true;
    }

    function addVerificationRelationship(
        IDidDocument.DidDocuments storage ds,
        IVRelationships.VRelationships storage vs,
        string memory did,
        string memory name,
        string memory vMethodId,
        uint256 notBefore,
        uint256 notAfter
    ) external returns (bool) {
        IDidDocument.DidDocument storage d = ds.didList[did];
        if (bytes(name).length == 0) revert IDidDocument.InvalidName();
        if (notAfter < notBefore) revert IDidDocument.InvalidDates();
        if (!isValidRelationshipName(name)) {
            revert IDidDocument.InvalidVerificationMethod();
        }
        if (d.vMethods[vMethodId].publicKey.length == 0) {
            revert IDidDocument.VMethodIdDoesNotExist();
        }
        if (d.vMethods[vMethodId].revoked) {
            revert IDidDocument.VMethodIdAlreadyRevoked();
        }

        uint256 indexDid = vs.addVerificationRelationship(
            uint256(keccak256(abi.encodePacked(name, vMethodId))), did, notBefore, notAfter
        );

        if (UtilsLib.equalStrings(name, "capabilityInvocation")) {
            // Control is address-mapped via vMethodIdOfAddress; promoting a
            // non-secp method to CI (or skipping the bind) would let the last
            // resolvable secp CI be revoked/rolled/expired and strand the DID.
            if (!d.vMethods[vMethodId].isSecp256k1) {
                revert IDidDocument.CapabilityInvocationKeyMustBeSecp256k1();
            }
            if (d.capabilityInvocationMethodIdExist[vMethodId]) {
                revert IDidDocument.CapabilityInvocationAlreadyExists();
            }
            address keyAddress = getAddress(d.vMethods[vMethodId].publicKey);
            // addVerificationMethod(isSecp256k1=true) may already have bound
            // this address to the same vMethodId — allow that; reject other uses.
            string memory boundId = d.vMethodIdOfAddress[keyAddress];
            if (bytes(boundId).length != 0 && !UtilsLib.equalStrings(boundId, vMethodId)) {
                revert IDidDocument.PublicKeyAlreadyInUse();
            }
            d.vMethodIdOfAddress[keyAddress] = vMethodId;
            d.capabilityInvocationMethodIdExist[vMethodId] = true;
            d.capabilityInvocationMethodIdIndex[vMethodId] = d.capabilityInvocations.length;
            d.capabilityInvocations
                .push(IDidDocument.VRelationship("capabilityInvocation", vMethodId, notBefore, notAfter, indexDid));
        } else {
            // is a different verification relationship

            // check that the tuple (name, vMethodId) is unique in the relationships
            bytes32 tuple = keccak256(abi.encode(name, vMethodId));
            if (d.vRelationshipsNameAndMethodIdTuple[tuple]) {
                revert IDidDocument.RelationshipAlreadyExists();
            }

            d.vRelationshipsNameAndMethodIdTuple[tuple] = true;
            d.vRelationshipsIndexes[vMethodId].push(d.vRelationships.length);
            d.vRelationships.push(IDidDocument.VRelationship(name, vMethodId, notBefore, notAfter, indexDid));
        }
        return true;
    }

    /// @notice Revokes a verification method as of `notAfter` (<= now).
    /// @dev This is NOT retroactive: it sets the method's relationship(s)
    /// `notAfter` to the given cutoff, so `getDidDocumentByTimestamp` (see
    /// its own NatSpec) continues to resolve this method for any historical
    /// `timestamp <= notAfter` -- signatures made before the cutoff are
    /// unaffected. It only prevents the method from being returned for
    /// `timestamp > notAfter`, current DID document reads, and any future
    /// use. `revoked` is also set on the method (`ds...vMethods[id].revoked`)
    /// but this flag is informational only -- it is not consulted by
    /// `getDidDocumentByTimestamp`'s historical filter.
    function revokeVerificationMethod(
        IDidDocument.DidDocuments storage ds,
        IVRelationships.VRelationships storage vs,
        string memory did,
        string memory vMethodId,
        uint256 notAfter
    ) external returns (bool) {
        if (notAfter > block.timestamp) revert IDidDocument.InvalidNotAfter();
        _revokeVerificationMethod(ds, vs, did, vMethodId, notAfter);
        ds.didList[did].vMethods[vMethodId].revoked = true;
        return true;
    }

    function expireVerificationMethod(
        IDidDocument.DidDocuments storage ds,
        IVRelationships.VRelationships storage vs,
        string memory did,
        string memory vMethodId,
        uint256 notAfter
    ) external returns (bool) {
        if (notAfter <= block.timestamp) {
            revert IDidDocument.InvalidNotAfter();
        }

        IDidDocument.DidDocument storage d = ds.didList[did];
        if (d.vMethods[vMethodId].publicKey.length == 0) {
            revert IDidDocument.VMethodIdDoesNotExist();
        }
        if (d.vMethods[vMethodId].revoked) {
            revert IDidDocument.VMethodIdAlreadyRevoked();
        }

        // Expire may only shorten the window; never extend or renew.
        (uint256 currentNotAfter, bool hasExpiry) = _minRelationshipNotAfter(d, vMethodId);
        if (!hasExpiry || notAfter >= currentNotAfter) {
            revert IDidDocument.ExpiryMustBeEarlier();
        }

        return _revokeVerificationMethod(ds, vs, did, vMethodId, notAfter);
    }

    function rollVerificationMethod(
        IDidDocument.DidDocuments storage ds,
        IVRelationships.VRelationships storage vs,
        IDidDocument.RollArgs memory args
    ) external returns (bool) {
        IDidDocument.DidDocument storage d = ds.didList[args.did];
        if (bytes(args.vMethodId).length == 0) {
            revert IDidDocument.InvalidVMethodId();
        }
        if (args.publicKey.length == 0) revert IDidDocument.InvalidPublicKey();
        if (d.vMethods[args.vMethodId].publicKey.length != 0) {
            revert IDidDocument.VMethodIdAlreadyExists();
        }
        if (d.vMethods[args.oldVMethodId].publicKey.length == 0) {
            revert IDidDocument.OldVMethodIdDoesNotExist();
        }
        if (d.vMethods[args.oldVMethodId].revoked) {
            revert IDidDocument.VMethodIdAlreadyRevoked();
        }
        // Replacement window must cover now. A closed notAfter strands the DID
        // after the old CI binding is dropped; a future notBefore leaves a gap
        // with no controller until that timestamp.
        if (args.notBefore > args.notAfter || args.notBefore > block.timestamp || args.notAfter <= block.timestamp) {
            revert IDidDocument.InvalidDates();
        }

        // Grace may only shorten the old window; never extend or renew
        // (same invariant as expireVerificationMethod).
        uint256 graceEnd = args.notBefore + args.duration;
        (uint256 currentNotAfter, bool hasExpiry) = _minRelationshipNotAfter(d, args.oldVMethodId);
        if (!hasExpiry || graceEnd >= currentNotAfter) {
            revert IDidDocument.ExpiryMustBeEarlier();
        }

        // add new verification method
        d.vMethods[args.vMethodId] = IDidDocument.VMethod(args.publicKey, args.isSecp256k1, false);

        // Unbind then bind on every secp256k1 roll (not only CI). A stale
        // key must not keep checkController or later CI promotion. Unbind
        // first so a same-key roll is not PublicKeyAlreadyInUse.
        if (d.vMethods[args.oldVMethodId].isSecp256k1) {
            address oldAddress = getAddress(d.vMethods[args.oldVMethodId].publicKey);
            if (UtilsLib.equalStrings(d.vMethodIdOfAddress[oldAddress], args.oldVMethodId)) {
                d.vMethodIdOfAddress[oldAddress] = "";
            }
        }
        if (args.isSecp256k1) {
            address newAddress = getAddress(args.publicKey);
            string memory boundId = d.vMethodIdOfAddress[newAddress];
            if (bytes(boundId).length != 0 && !UtilsLib.equalStrings(boundId, args.vMethodId)) {
                revert IDidDocument.PublicKeyAlreadyInUse();
            }
            d.vMethodIdOfAddress[newAddress] = args.vMethodId;
        }

        for (uint256 index = 0; index < d.vRelationshipsIndexes[args.oldVMethodId].length; index++) {
            uint256 i = d.vRelationshipsIndexes[args.oldVMethodId][index];
            // update the previous relationship
            vs.updateVerificationRelationship(
                uint256(keccak256(abi.encodePacked(d.vRelationships[i].name, args.oldVMethodId))),
                d.vRelationships[i].indexDid,
                graceEnd
            );
            d.vRelationships[i].notAfter = graceEnd;

            // add the new relationship
            uint256 indexDid = vs.addVerificationRelationship(
                uint256(keccak256(abi.encodePacked(d.vRelationships[i].name, args.vMethodId))),
                args.did,
                args.notBefore,
                args.notAfter
            );
            d.vRelationshipsIndexes[args.vMethodId].push(d.vRelationships.length);
            bytes32 tuple = keccak256(abi.encode(d.vRelationships[i].name, args.vMethodId));
            if (d.vRelationshipsNameAndMethodIdTuple[tuple]) {
                revert IDidDocument.RelationshipAlreadyExists();
            }
            d.vRelationshipsNameAndMethodIdTuple[tuple] = true;

            d.vRelationships
                .push(
                    IDidDocument.VRelationship(
                        d.vRelationships[i].name, args.vMethodId, args.notBefore, args.notAfter, indexDid
                    )
                );
        }

        if (d.capabilityInvocationMethodIdExist[args.oldVMethodId]) {
            // Control is address-mapped; rolling CI to a non-secp key would
            // clear the old binding and leave no resolvable controller.
            if (!args.isSecp256k1) {
                revert IDidDocument.CapabilityInvocationKeyMustBeSecp256k1();
            }

            uint256 i = d.capabilityInvocationMethodIdIndex[args.oldVMethodId];

            // update the previous relationship
            vs.updateVerificationRelationship(
                uint256(keccak256(abi.encodePacked("capabilityInvocation", args.oldVMethodId))),
                d.capabilityInvocations[i].indexDid,
                graceEnd
            );
            d.capabilityInvocations[i].notAfter = graceEnd;

            // add the new relationship
            uint256 indexDid = vs.addVerificationRelationship(
                uint256(keccak256(abi.encodePacked("capabilityInvocation", args.vMethodId))),
                args.did,
                args.notBefore,
                args.notAfter
            );
            d.capabilityInvocationMethodIdExist[args.vMethodId] = true;
            d.capabilityInvocationMethodIdIndex[args.vMethodId] = d.capabilityInvocations.length;
            d.capabilityInvocations
                .push(
                    IDidDocument.VRelationship(
                        "capabilityInvocation", args.vMethodId, args.notBefore, args.notAfter, indexDid
                    )
                );
        }

        d.vMethods[args.oldVMethodId].revoked = true;
        return true;
    }

    /// @notice Reconstructs the DID document as it stood at `timestamp`.
    /// @dev Historical filtering is governed purely by each relationship's
    /// [`notBefore`, `notAfter`] interval (see the loops below) -- it never
    /// consults `vMethods[id].revoked`. Revocation semantics follow directly
    /// from how `notAfter` is set:
    ///   - `revokeVerificationMethod`/`expireVerificationMethod` set
    ///     `notAfter` to the revocation time (see below): a relationship with
    ///     a nonzero `notAfter` therefore still matches every `timestamp` up
    ///     to and including that cutoff -- i.e. revocation is NOT
    ///     retroactive, and signatures genuinely made before the cutoff
    ///     continue to resolve to this verification method historically.
    ///   - `notAfter == 0` never satisfies `timestamp <= notAfter` for any
    ///     positive `timestamp`, so it invalidates the relationship for every
    ///     historical lookup, including ones predating the revocation.
    /// Callers that resolve a DID document to authenticate an ONLINE action
    /// (e.g. Verifiable Presentation holder authentication) MUST NOT invoke
    /// this function with an attacker/signer-controlled `timestamp` -- doing
    /// so lets a party holding a retired key select a `timestamp` at which
    /// that key was still valid. Use `timestamp = block.timestamp`-equivalent
    /// (the verifier's own current time) for that case; this function is
    /// meant for genuinely historical lookups (e.g. verifying a VC's issuer
    /// key as of the VC's claimed issuance time), where the same reasoning
    /// applies transitively: whether that use is safe depends on how
    /// trustworthy the issuance timestamp is (see `validateIssuer` in the
    /// verifiable-credential library).
    function getDidDocumentByTimestamp(IDidDocument.DidDocuments storage ds, string memory did, uint256 timestamp)
        external
        view
        returns (
            string memory baseDocument,
            string[] memory controllers,
            string[] memory vMethodIds,
            IDidDocument.VMethod[] memory vMethods,
            IDidDocument.VRelationship[] memory vRelationships
        )
    {
        IDidDocument.DidDocument storage d = ds.didList[did];
        baseDocument = d.baseDocument;
        controllers = d.controllers;
        uint256 maxLength = d.vRelationships.length + d.capabilityInvocations.length;
        string[] memory vMethodIdsAux = new string[](maxLength);
        IDidDocument.VMethod[] memory vMethodsAux = new IDidDocument.VMethod[](maxLength);
        IDidDocument.VRelationship[] memory vRelationshipsAux = new IDidDocument.VRelationship[](maxLength);
        uint256 sizeVMethods = 0;
        uint256 sizeVRelationships = 0;
        for (uint256 i = 0; i < d.vRelationships.length; i++) {
            if (timestamp < d.vRelationships[i].notBefore || timestamp > d.vRelationships[i].notAfter) {
                continue;
            }
            vRelationshipsAux[sizeVRelationships] = d.vRelationships[i];
            sizeVRelationships++;
            bool vMethodAdded = false;
            string memory vMethodId = d.vRelationships[i].vMethodId;

            for (uint256 j = 0; j < sizeVMethods; j++) {
                if (UtilsLib.equalStrings(vMethodId, vMethodIdsAux[j])) {
                    vMethodAdded = true;
                    break;
                }
            }
            if (!vMethodAdded) {
                vMethodIdsAux[sizeVMethods] = vMethodId;
                vMethodsAux[sizeVMethods] = d.vMethods[vMethodId];
                sizeVMethods++;
            }
        }

        for (uint256 i = 0; i < d.capabilityInvocations.length; i++) {
            if (timestamp < d.capabilityInvocations[i].notBefore || timestamp > d.capabilityInvocations[i].notAfter) {
                continue;
            }
            vRelationshipsAux[sizeVRelationships] = d.capabilityInvocations[i];
            sizeVRelationships++;
            bool vMethodAdded = false;
            string memory vMethodId = d.capabilityInvocations[i].vMethodId;

            for (uint256 j = 0; j < sizeVMethods; j++) {
                if (UtilsLib.equalStrings(vMethodId, vMethodIdsAux[j])) {
                    vMethodAdded = true;
                    break;
                }
            }
            if (!vMethodAdded) {
                vMethodIdsAux[sizeVMethods] = vMethodId;
                vMethodsAux[sizeVMethods] = d.vMethods[vMethodId];
                sizeVMethods++;
            }
        }

        // copy auxiliary arrays to the result
        vMethodIds = new string[](sizeVMethods);
        vMethods = new IDidDocument.VMethod[](sizeVMethods);
        vRelationships = new IDidDocument.VRelationship[](sizeVRelationships);
        for (uint256 i = 0; i < sizeVMethods; i++) {
            vMethodIds[i] = vMethodIdsAux[i];
            vMethods[i] = vMethodsAux[i];
        }
        for (uint256 i = 0; i < sizeVRelationships; i++) {
            vRelationships[i] = vRelationshipsAux[i];
        }
    }

    // internal methods

    function _addVerificationRelationship(
        IVRelationships.VRelationships storage vs,
        string memory str,
        string memory vMethodId,
        string memory did,
        uint256 notBefore,
        uint256 notAfter
    ) internal returns (uint256) {
        if (!isValidRelationshipName(str)) {
            revert IDidDocument.InvalidVerificationMethod();
        }
        return
            vs.addVerificationRelationship(
                uint256(keccak256(abi.encodePacked(str, vMethodId))), did, notBefore, notAfter
            );
    }

    function _minRelationshipNotAfter(IDidDocument.DidDocument storage d, string memory vMethodId)
        internal
        view
        returns (uint256 currentNotAfter, bool hasExpiry)
    {
        currentNotAfter = type(uint256).max;
        for (uint256 i = 0; i < d.vRelationshipsIndexes[vMethodId].length; i++) {
            uint256 stored = d.vRelationships[d.vRelationshipsIndexes[vMethodId][i]].notAfter;
            if (!hasExpiry || stored < currentNotAfter) {
                currentNotAfter = stored;
                hasExpiry = true;
            }
        }
        if (d.capabilityInvocationMethodIdExist[vMethodId]) {
            uint256 stored = d.capabilityInvocations[d.capabilityInvocationMethodIdIndex[vMethodId]].notAfter;
            if (!hasExpiry || stored < currentNotAfter) {
                currentNotAfter = stored;
                hasExpiry = true;
            }
        }
    }

    function _revokeVerificationMethod(
        IDidDocument.DidDocuments storage ds,
        IVRelationships.VRelationships storage vs,
        string memory did,
        string memory vMethodId,
        uint256 notAfter
    ) internal returns (bool) {
        IDidDocument.DidDocument storage d = ds.didList[did];
        if (d.vMethods[vMethodId].publicKey.length == 0) {
            revert IDidDocument.VMethodIdDoesNotExist();
        }
        if (d.vMethods[vMethodId].revoked) {
            revert IDidDocument.VMethodIdAlreadyRevoked();
        }

        for (uint256 i = 0; i < d.vRelationshipsIndexes[vMethodId].length; i++) {
            uint256 index = d.vRelationshipsIndexes[vMethodId][i];
            d.vRelationships[index].notAfter = notAfter;
            vs.updateVerificationRelationship(
                uint256(keccak256(abi.encodePacked(d.vRelationships[index].name, vMethodId))),
                d.vRelationships[index].indexDid,
                notAfter
            );
        }

        // Unbind secp256k1 addresses only when control ends now (revoke /
        // already-elapsed notAfter) and this method still owns the map entry.
        // A successor that reused the address (same-key roll) must keep it.
        if (d.vMethods[vMethodId].isSecp256k1 && notAfter <= block.timestamp) {
            address keyAddress = getAddress(d.vMethods[vMethodId].publicKey);
            if (UtilsLib.equalStrings(d.vMethodIdOfAddress[keyAddress], vMethodId)) {
                d.vMethodIdOfAddress[keyAddress] = "";
            }
        }

        if (d.capabilityInvocationMethodIdExist[vMethodId]) {
            uint256 i = d.capabilityInvocationMethodIdIndex[vMethodId];
            d.capabilityInvocations[i].notAfter = notAfter;
            vs.updateVerificationRelationship(
                uint256(keccak256(abi.encodePacked("capabilityInvocation", vMethodId))),
                d.capabilityInvocations[i].indexDid,
                notAfter
            );
        }
        return true;
    }

    function isValidRelationshipName(string memory _method) internal pure returns (bool) {
        return UtilsLib.equalStrings(_method, AUTHENTICATION_RELATIONSHIP)
            || UtilsLib.equalStrings(_method, ASSERTION_RELATIONSHIP)
            || UtilsLib.equalStrings(_method, KEY_AGREEMENT_RELATIONSHIP)
            || UtilsLib.equalStrings(_method, CAPABILITY_INVOCATION_RELATIONSHIP)
            || UtilsLib.equalStrings(_method, CAPABILITY_DELEGATION_RELATIONSHIP);
    }

    /**
     * @dev Derives an Ethereum address from an uncompressed secp256k1 public key
     *      (65-byte `0x04 || X || Y` or 64-byte `X || Y`).
     * @dev Does not verify that the key encodes a valid curve point. Callers must
     *      ensure key validity off-chain; malformed keys still hash to some address.
     */
    function getAddress(bytes memory publicKey) internal pure returns (address) {
        return address(uint160(uint256(keccak256(sanitizePublicKey(publicKey)))));
    }

    function sanitizePublicKey(bytes memory publicKey) internal pure returns (bytes memory) {
        if (publicKey.length == 65) {
            if (publicKey[0] != 0x04) revert IDidDocument.InvalidControlByte();
            /**
             * step 1: EC public key prefix (04)
             * Note: We can not use the built-in array slices (like publicKey[1:])
             * because it is only for calldata arrays, not storage arrays.
             * Then we have to use a loop to make the slice
             */
            bytes memory publicKeyWithoutPrefix = new bytes(publicKey.length - 1);
            for (uint256 i = 1; i < publicKey.length; i++) {
                publicKeyWithoutPrefix[i - 1] = publicKey[i];
            }
            return publicKeyWithoutPrefix;
        } else if (publicKey.length == 64) {
            return publicKey;
        } else {
            revert IDidDocument.InvalidPubKeyLength();
        }
    }
}
