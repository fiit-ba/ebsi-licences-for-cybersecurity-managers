pragma solidity 0.8.26;

import {IEbsiIssuersRegistry} from "../../contracts/interfaces/IEbsiRegistries.sol";
import {GovernanceTest} from "../GovernanceTest.sol";

/**
 * `isActiveTi` on any trust chain the Trusted Issuers Registry may hold: of
 * any length up to past MAX_TRUST_CHAIN_DEPTH, with a link of the wrong kind,
 * a link missing, a loop, or a TI accredited by another TAO. The reference
 * walks the same chain as indexes: TI, then TAOs, up to a RootTAO.
 */
contract TrustChainFuzzTest is GovernanceTest {
    string private constant DID = "did:ebsi:zFuzzedTi";
    bytes32 private constant ATTRIBUTE = keccak256("fuzzed ti attribute");

    struct TrustChain {
        uint256 length; // links above the TI; link 0 is the contract's TAO
        IEbsiIssuersRegistry.IssuerType[] kind;
        uint256[] next; // the link each one names as its parent; `length` for none
        bool[] missing; // not in the registry at all
        IEbsiIssuersRegistry.IssuerType tiKind;
        bool otherTao;
    }

    function testFuzz_ATiIsActiveExactlyWhenItsChainEndsAtARootTao(
        uint8 length,
        uint256 kinds,
        uint8 tiSeed,
        uint8 loopSeed,
        uint8 missingSeed
    ) public {
        TrustChain memory chain = _chain(length, kinds, tiSeed, loopSeed, missingSeed);
        _record(chain);
        assertEq(governance.isActiveTi(DID, ATTRIBUTE), _reference(chain));
    }

    /// The limit itself: a chain of exactly MAX_TRUST_CHAIN_DEPTH links holds,
    /// one more does not.
    function test_AChainAsLongAsTheLimitHoldsAndOneLongerDoesNot() public {
        uint256 max = governance.MAX_TRUST_CHAIN_DEPTH();
        TrustChain memory chain = _chain(uint8(max), 0, 0, 0, 0);
        _record(chain);
        assertTrue(governance.isActiveTi(DID, ATTRIBUTE), "at the limit");

        chain = _chain(uint8(max + 1), 0, 0, 0, 0);
        _record(chain);
        assertFalse(governance.isActiveTi(DID, ATTRIBUTE), "past the limit");
    }

    // -----------------------------------------------------------------------

    /// Mostly TAOs up to a RootTAO, so that long chains are common; the rare
    /// cases are on seeds other than 0.
    function _chain(uint8 length, uint256 kinds, uint8 tiSeed, uint8 loopSeed, uint8 missingSeed)
        private
        view
        returns (TrustChain memory chain)
    {
        uint256 n = bound(length, 1, governance.MAX_TRUST_CHAIN_DEPTH() + 3);
        chain.length = n;
        chain.kind = new IEbsiIssuersRegistry.IssuerType[](n);
        chain.next = new uint256[](n);
        chain.missing = new bool[](n);
        IEbsiIssuersRegistry.IssuerType[4] memory odd = [
            IEbsiIssuersRegistry.IssuerType.TI,
            IEbsiIssuersRegistry.IssuerType.RootTAO,
            IEbsiIssuersRegistry.IssuerType.Revoked,
            IEbsiIssuersRegistry.IssuerType.Undefined
        ];
        for (uint256 i = 0; i < n; i++) {
            uint256 bits = (kinds >> (3 * (i % 60))) & 7;
            chain.kind[i] = bits == 7 ? odd[(kinds >> (180 + 2 * (i % 30))) & 3] : IEbsiIssuersRegistry.IssuerType.TAO;
            chain.next[i] = i + 1;
        }
        // The top: a RootTAO, or now and then a TAO with nothing above it.
        chain.kind[n - 1] =
            (kinds >> 252) & 7 == 7 ? IEbsiIssuersRegistry.IssuerType.TAO : IEbsiIssuersRegistry.IssuerType.RootTAO;
        if (loopSeed % 8 == 7) {
            chain.kind[n - 1] = IEbsiIssuersRegistry.IssuerType.TAO;
            chain.next[n - 1] = (loopSeed >> 3) % n;
        }
        if (missingSeed % 8 == 7) chain.missing[(missingSeed >> 3) % n] = true;
        chain.tiKind = tiSeed % 8 == 7 ? odd[(tiSeed >> 3) & 3] : IEbsiIssuersRegistry.IssuerType.TI;
        chain.otherTao = (tiSeed >> 5) % 8 == 7;
    }

    function _record(TrustChain memory chain) private {
        issuers.accredit(DID, ATTRIBUTE, chain.tiKind, chain.otherTao ? "did:ebsi:zOtherTao" : taoDid, _attribute(0));
        for (uint256 i = 0; i < chain.length; i++) {
            if (chain.missing[i] || chain.kind[i] == IEbsiIssuersRegistry.IssuerType.Undefined) continue;
            uint256 parent = chain.next[i];
            issuers.accredit(_did(i), _attribute(i), chain.kind[i], _did(parent), _attribute(parent));
        }
    }

    function _reference(TrustChain memory chain) private view returns (bool) {
        if (chain.tiKind != IEbsiIssuersRegistry.IssuerType.TI || chain.otherTao) return false;
        uint256 link = 0;
        for (uint256 depth = 0; depth < governance.MAX_TRUST_CHAIN_DEPTH(); depth++) {
            if (link >= chain.length || chain.missing[link]) return false;
            IEbsiIssuersRegistry.IssuerType kind = chain.kind[link];
            if (kind == IEbsiIssuersRegistry.IssuerType.RootTAO) return true;
            if (kind != IEbsiIssuersRegistry.IssuerType.TAO) return false;
            link = chain.next[link];
        }
        return false;
    }

    /// Link 0 is the contract's own TAO, under an attribute of the fuzz's.
    function _did(uint256 i) private view returns (string memory) {
        return i == 0 ? taoDid : string.concat("did:ebsi:zLink", vm.toString(i));
    }

    function _attribute(uint256 i) private pure returns (bytes32) {
        return keccak256(abi.encode("fuzzed link", i));
    }
}
