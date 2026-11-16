// SPDX-License-Identifier: EUPL V1.2
pragma solidity 0.8.26;

import "../interfaces/IVRelationships.sol";

library VRelationshipsLib {
    function addVerificationRelationship(
        IVRelationships.VRelationships storage vs,
        uint256 vrId,
        string memory did,
        uint256 notBefore,
        uint256 notAfter
    ) external returns (uint256) {
        uint256 indexDid = vs.didsByVRelationship[vrId].length;
        vs.didsByVRelationship[vrId].push(IVRelationships.DidWithPeriod(did, notBefore, notAfter));
        return indexDid;
    }

    /**
     * @dev sets only the notAfter timestamp for a relation
     */

    function updateVerificationRelationship(
        IVRelationships.VRelationships storage vs,
        uint256 vrId,
        uint256 indexDid,
        uint256 notAfter
    ) external returns (bool) {
        vs.didsByVRelationship[vrId][indexDid].notAfter = notAfter;
        return true;
    }
}
