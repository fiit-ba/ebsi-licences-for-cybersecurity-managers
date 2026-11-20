pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {console} from "forge-std/console.sol";
import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {CertificateGovernance} from "../../contracts/CertificateGovernance.sol";
import {CertificateRegistry} from "../../contracts/CertificateRegistry.sol";
import {IGovernanceTypes} from "../../contracts/interfaces/IGovernanceTypes.sol";
import {Hashes} from "../../contracts/libraries/Hashes.sol";
import {Role, RoleSet} from "../../contracts/libraries/Roles.sol";
import {IIssuersRegistry as TIR} from "ebsi-mock/issuers-registry/interfaces/IIssuersRegistry.sol";
import {GovernanceFixture} from "../EbsiTrustChain.t.sol";

/**
 * What the loops without a bound cost, against the real EBSI registry mocks
 * (test/EbsiTrustChain.t.sol): a TI's keys and its cosigners (`roleOf` asks
 * the DID Registry once per cosigner, and the quorum asks `roleOf` once per
 * signature), and the trust chain (`isActiveTi` reads the Trusted Issuers
 * Registry once per hop). Measurements, not checks: run
 *
 *   forge test --match-path "test/gas/*" -vv
 *
 * and read the tables. Each call is measured cold, as the first of its own
 * transaction, plus the 21000 every transaction pays. The PILOT charges no
 * gas; these are for a network that does.
 */
contract WorstCaseGasTest is GovernanceFixture {
    uint256 private constant TX = 21_000;
    string private constant HEADER =
        "keys cosigners | roleOf(outsider) proposeAction lastSignature execute registerCertificate removeSigner setCosigners";
    uint256 private cases;

    struct Ti {
        bytes32 id;
        string did;
        Vm.Wallet[] keys;
        Vm.Wallet[] cosigners;
        string[] cosignerDids;
    }

    /// One test per number of keys: together they pass a test's gas limit.
    function test_Gas_3Keys() public {
        _table(3);
    }

    function test_Gas_10Keys() public {
        _table(10);
    }

    function test_Gas_30Keys() public {
        _table(30);
    }

    function test_Gas_100Keys() public {
        _table(100);
    }

    function test_Gas_100KeysAnd30Cosigners() public {
        console.log(HEADER);
        _measure(100, 30);
    }

    function _table(uint256 keys) private {
        console.log(HEADER);
        // 100 keys with 30 cosigners has a test of its own.
        uint256[4] memory cosigners = [uint256(0), 3, 10, 30];
        for (uint256 j = 0; j < (keys == 100 ? 3 : 4); j++) {
            _measure(keys, cosigners[j]);
        }
    }

    function test_Gas_TrustChainDepth() public {
        console.log("TAOs above the TI | proposeAction execute registerCertificate");
        uint256[6] memory depths = [uint256(1), 2, 4, 8, 16, 31];
        for (uint256 i = 0; i < depths.length; i++) {
            _measureChain(depths[i]);
        }
    }

    // -----------------------------------------------------------------------
    // Keys and cosigners
    // -----------------------------------------------------------------------

    /// One TI with `keyCount` keys (roles A and B in turn) and `cosignerCount`
    /// cosigner DIDs (role C), under the pilot's 2-of-3 with no timelock.
    function _measure(uint256 keyCount, uint256 cosignerCount) private {
        Ti memory ti = _ti(keyCount, cosignerCount, TAO, taoKey, taoAttr, governance);
        address outsider = vm.createWallet(string.concat("outsider", vm.toString(cases))).addr;

        uint256[7] memory gas;
        _cool(governance);
        uint256 before = gasleft();
        governance.roleOf(ti.id, outsider);
        gas[0] = before - gasleft() + TX;

        bytes32 key = _register(ti, governance);
        uint256 id;
        (id, gas[1]) = _proposeMeasured(governance, ti, key);
        // Every other key and every cosigner signs; the last is measured.
        for (uint256 i = 1; i < ti.keys.length; i++) {
            vm.prank(ti.keys[i].addr);
            governance.signProposal(id);
        }
        address last = cosignerCount > 0 ? ti.cosigners[cosignerCount - 1].addr : ti.keys[keyCount - 1].addr;
        for (uint256 i = 0; i + 1 < cosignerCount; i++) {
            vm.prank(ti.cosigners[i].addr);
            governance.signProposal(id);
        }
        if (cosignerCount > 0) gas[2] = _call(governance, last, abi.encodeCall(governance.signProposal, (id)));
        gas[3] = _call(governance, ti.keys[0].addr, abi.encodeCall(governance.execute, (id)));
        gas[4] = _registerMeasured(ti, governance);

        // The last key out: `_dropSigner` walks every key to find it.
        vm.prank(ti.keys[0].addr);
        uint256 removal = governance.proposeRemoveSigner(ti.id, ti.keys[keyCount - 1].addr);
        gas[5] = _call(governance, ti.keys[1].addr, abi.encodeCall(governance.signAdminProposal, (removal)));
        gas[6] = _call(governance, taoKey.addr, abi.encodeCall(governance.setCosigners, (ti.id, _cosigners(ti))));

        console.log(string.concat(vm.toString(keyCount), " ", vm.toString(cosignerCount), " | ", _row(gas)));
    }

    // -----------------------------------------------------------------------
    // The trust chain
    // -----------------------------------------------------------------------

    /// A chain of `depth` TAOs from the RootTAO down to the contract's TAO,
    /// which accredits the TI: `isActiveTi` reads `depth + 1` attributes.
    function _measureChain(uint256 depth) private {
        string memory parent = ROOT;
        Vm.Wallet memory parentKey = rootKey;
        bytes32 parentAttr = rootAttr;
        for (uint256 i = 0; i < depth; i++) {
            string memory did = string.concat("did:ebsi:zChain", vm.toString(depth), "x", vm.toString(i));
            Vm.Wallet memory key = vm.createWallet(did);
            _insertDid(did, key);
            parentAttr = _accreditSalted(parentKey, did, TIR.IssuerType.TAO, parent, parentAttr);
            (parent, parentKey) = (did, key);
        }
        CertificateGovernance chained = _deployUnder(parentKey.addr, parent);
        Ti memory ti = _ti(3, 0, parent, parentKey, parentAttr, chained);

        uint256[7] memory gas;
        bytes32 statusKey = _register(ti, chained);
        uint256 id;
        (id, gas[0]) = _proposeMeasured(chained, ti, statusKey);
        vm.prank(ti.keys[1].addr);
        chained.signProposal(id);
        gas[1] = _call(chained, ti.keys[0].addr, abi.encodeCall(chained.execute, (id)));
        gas[2] = _registerMeasured(ti, chained);
        console.log(
            string.concat(
                vm.toString(depth), " | ", vm.toString(gas[0]), " ", vm.toString(gas[1]), " ", vm.toString(gas[2])
            )
        );
    }

    // -----------------------------------------------------------------------
    // Setting up
    // -----------------------------------------------------------------------

    function _ti(
        uint256 keyCount,
        uint256 cosignerCount,
        string memory tao,
        Vm.Wallet memory taoWallet,
        bytes32 taoAttribute,
        CertificateGovernance target
    ) private returns (Ti memory ti) {
        uint256 n = ++cases;
        ti.did = string.concat("did:ebsi:zGasTi", vm.toString(n));
        ti.keys = new Vm.Wallet[](keyCount);
        ti.keys[0] = vm.createWallet(string.concat(ti.did, "#key-1"));
        _insertDid(ti.did, ti.keys[0]);
        for (uint256 i = 1; i < keyCount; i++) {
            ti.keys[i] = vm.createWallet(string.concat(ti.did, "#key-", vm.toString(i + 1)));
            _addKey(ti.keys[0], ti.did, string.concat("#key-", vm.toString(i + 1)), ti.keys[i]);
        }
        ti.cosigners = new Vm.Wallet[](cosignerCount);
        ti.cosignerDids = new string[](cosignerCount);
        for (uint256 i = 0; i < cosignerCount; i++) {
            ti.cosignerDids[i] = string.concat("did:ebsi:zGasCosigner", vm.toString(n), "x", vm.toString(i));
            ti.cosigners[i] = vm.createWallet(ti.cosignerDids[i]);
            _insertDid(ti.cosignerDids[i], ti.cosigners[i]);
        }
        bytes32 attribute = _accreditSalted(taoWallet, ti.did, TIR.IssuerType.TI, tao, taoAttribute);

        address[] memory signers = new address[](keyCount);
        Role[] memory roles = new Role[](keyCount);
        for (uint256 i = 0; i < keyCount; i++) {
            signers[i] = ti.keys[i].addr;
            roles[i] = i % 2 == 0 ? ROLE_A : ROLE_B;
        }
        IGovernanceTypes.Policy[4] memory policies;
        for (uint256 i = 0; i < 4; i++) {
            policies[i] = IGovernanceTypes.Policy(2, RoleSet.wrap(0), RoleSet.wrap(7), 0);
        }
        vm.prank(taoWallet.addr);
        ti.id = target.addTi(
            IGovernanceTypes.TiSetup(ti.did, attribute, signers, roles, _cosigners(ti), policies, 30 days)
        );
    }

    function _cosigners(Ti memory ti) private pure returns (IGovernanceTypes.Cosigner[] memory list) {
        list = new IGovernanceTypes.Cosigner[](ti.cosignerDids.length);
        for (uint256 i = 0; i < list.length; i++) {
            list[i] = IGovernanceTypes.Cosigner(ti.cosignerDids[i], ROLE_C);
        }
    }

    /// A TAO's governance, as Deploy.s.sol makes one: its registry behind
    /// the shared beacons.
    function _deployUnder(address owner, string memory taoDid) private returns (CertificateGovernance deployed) {
        CertificateRegistry certificates = CertificateRegistry(
            address(new BeaconProxy(address(registryBeacon), abi.encodeCall(CertificateRegistry.initialize, (owner))))
        );
        bytes memory init = abi.encodeCall(CertificateGovernance.initialize, (owner, taoDid, address(certificates)));
        deployed = CertificateGovernance(address(new BeaconProxy(address(beacon), init)));
        vm.prank(owner);
        certificates.setGovernance(address(deployed));
    }

    /// A first accreditation under a salt of the DID's own, so that one DID
    /// can be accredited in several cases.
    function _accreditSalted(
        Vm.Wallet memory by,
        string memory did,
        TIR.IssuerType kind,
        string memory parent,
        bytes32 parentAttr
    ) private returns (bytes32) {
        bytes32 salt = keccak256(bytes(did));
        vm.prank(by.addr);
        tir.setAttributeMetadata(did, salt, kind, parent, parentAttr);
        return sha256(abi.encode(did, salt, uint256(0), bytes("")));
    }

    // -----------------------------------------------------------------------
    // Measuring
    // -----------------------------------------------------------------------

    function _register(Ti memory ti, CertificateGovernance target) private returns (bytes32) {
        bytes32 idHash = Hashes.certificateIdHash(string.concat(ti.did, "/certificate"));
        CertificateRegistry certificates = CertificateRegistry(target.certificateRegistry());
        vm.prank(ti.keys[0].addr);
        return certificates.registerCertificate(idHash, ti.did, 1, 0, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID);
    }

    function _registerMeasured(Ti memory ti, CertificateGovernance target) private returns (uint256) {
        bytes32 idHash = Hashes.certificateIdHash(string.concat(ti.did, "/another"));
        CertificateRegistry certificates = CertificateRegistry(target.certificateRegistry());
        return _call(
            target,
            address(certificates),
            ti.keys[0].addr,
            abi.encodeCall(
                certificates.registerCertificate,
                (idHash, ti.did, 1, 0, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID)
            )
        );
    }

    function _proposeMeasured(CertificateGovernance target, Ti memory ti, bytes32 key)
        private
        returns (uint256 id, uint256 gas)
    {
        bytes memory data =
            abi.encodeCall(target.proposeAction, (ti.id, key, IGovernanceTypes.ActionType.SUSPEND, REASON));
        _cool(target);
        vm.prank(ti.keys[0].addr);
        uint256 before = gasleft();
        (bool ok, bytes memory result) = address(target).call(data);
        gas = before - gasleft() + TX;
        require(ok, "proposeAction reverted");
        id = abi.decode(result, (uint256));
    }

    function _call(CertificateGovernance target, address from, bytes memory data) private returns (uint256) {
        return _call(target, address(target), from, data);
    }

    /// The gas of one call, from a cold start, that must succeed.
    function _call(CertificateGovernance target, address to, address from, bytes memory data)
        private
        returns (uint256 gas)
    {
        _cool(target);
        vm.prank(from);
        uint256 before = gasleft();
        (bool ok,) = to.call(data);
        gas = before - gasleft() + TX;
        require(ok, "measured call reverted");
    }

    /// Every contract a call touches, cold again: the proxies, beacons and
    /// implementations of both contracts and of both registries.
    function _cool(CertificateGovernance target) private {
        address[8] memory touched = [
            address(target),
            address(beacon),
            beacon.implementation(),
            target.certificateRegistry(),
            address(registryBeacon),
            registryBeacon.implementation(),
            address(didr),
            address(tir)
        ];
        for (uint256 i = 0; i < touched.length; i++) {
            vm.cool(touched[i]);
        }
        vm.cool(_implementation(address(didr)));
        vm.cool(_implementation(address(tir)));
    }

    function _implementation(address proxy) private view returns (address) {
        bytes32 slot = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
        return address(uint160(uint256(vm.load(proxy, slot))));
    }

    function _row(uint256[7] memory gas) private pure returns (string memory row) {
        for (uint256 i = 0; i < gas.length; i++) {
            row = string.concat(row, i == 0 ? "" : " ", gas[i] == 0 ? "-" : vm.toString(gas[i]));
        }
    }
}
