// SPDX-License-Identifier: EUPL V1.2
pragma solidity 0.8.26;

interface IVRelationships {
    struct DidWithPeriod {
        string did;
        uint256 notBefore;
        uint256 notAfter;
    }

    struct VRelationships {
        mapping(uint256 => DidWithPeriod[]) didsByVRelationship;
    }
}
