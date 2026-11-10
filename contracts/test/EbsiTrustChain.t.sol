// SPDX-License-Identifier: EUPL-1.2
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry.
pragma solidity 0.8.26;

import {Test, Vm} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {CertificateGovernance} from "../contracts/CertificateGovernance.sol";
import {CertificateRegistry} from "../contracts/CertificateRegistry.sol";
import {IGovernanceTypes} from "../contracts/interfaces/IGovernanceTypes.sol";
import {Hashes} from "../contracts/libraries/Hashes.sol";
import {ITiAccreditation} from "../contracts/interfaces/ITiAccreditation.sol";
import {Role, RoleSet} from "../contracts/libraries/Roles.sol";
import {StubDidRegistry} from "./RegistryStubs.sol";
import {PoliciesRegistry} from "ebsi-mock/policies-registry/PolicyRegistry.sol";
import {DidRegistry} from "ebsi-mock/did-registry/DidRegistry.sol";
import {IssuersRegistry} from "ebsi-mock/issuers-registry/IssuersRegistry.sol";
import {IIssuersRegistry as TIR} from "ebsi-mock/issuers-registry/interfaces/IIssuersRegistry.sol";
import {IDidDocument} from "ebsi-mock/did-registry/interfaces/IDidDocument.sol";

/// The real EBSI mocks, wired as SetupEBSIInfrastructure.s.sol wires them: a
/// RootTAO, two TAOs and a TI, each acting by the key that controls its DID.
abstract contract EbsiFixture is Test {
    string internal constant ROOT = "did:ebsi:zRoot";
    string internal constant TAO = "did:ebsi:zTao";
    string internal constant OTHER_TAO = "did:ebsi:zOtherTao";
    string internal constant TI = "did:ebsi:zTi";

    bytes32 internal constant SALT = keccak256("salt");

    DidRegistry internal didr;
    IssuersRegistry internal tir;

    Vm.Wallet internal rootKey;
    Vm.Wallet internal taoKey;
    Vm.Wallet internal otherTaoKey;
    Vm.Wallet internal tiKey;

    bytes32 internal rootAttr;
    bytes32 internal taoAttr;
    bytes32 internal otherTaoAttr;

    function setUp() public virtual {
        rootKey = vm.createWallet("root");
        taoKey = vm.createWallet("tao");
        otherTaoKey = vm.createWallet("otherTao");
        tiKey = vm.createWallet("ti");

        PoliciesRegistry policies = PoliciesRegistry(
            address(
                new ERC1967Proxy(
                    address(new PoliciesRegistry()),
                    abi.encodeCall(PoliciesRegistry.initialize, (address(this), address(this)))
                )
            )
        );
        didr = DidRegistry(
            address(new ERC1967Proxy(address(new DidRegistry()), abi.encodeCall(DidRegistry.initialize, (address(policies)))))
        );
        tir = IssuersRegistry(
            address(
                new ERC1967Proxy(
                    address(new IssuersRegistry()),
                    abi.encodeCall(IssuersRegistry.initialize, (address(policies), address(didr)))
                )
            )
        );

        _insertDid(ROOT, rootKey);
        _insertDid(TAO, taoKey);
        _insertDid(OTHER_TAO, otherTaoKey);
        _insertDid(TI, tiKey);

        // Only the RootTAO's bootstrap takes a policy.
        string memory bootstrap = "IssuersRegistry:setAttributeMetadata";
        policies.insertPolicy(bootstrap, "bootstrap");
        string[] memory attributes = new string[](1);
        attributes[0] = bootstrap;
        policies.insertUserAttributes(rootKey.addr, attributes);

        vm.prank(rootKey.addr);
        tir.setAttributeMetadata(ROOT, SALT, TIR.IssuerType.RootTAO, ROOT, bytes32(0));
        rootAttr = _attributeId(ROOT);
        policies.deleteUserAttributes(rootKey.addr, attributes);

        taoAttr = _accredit(rootKey, TAO, TIR.IssuerType.TAO, ROOT, rootAttr);
        otherTaoAttr = _accredit(rootKey, OTHER_TAO, TIR.IssuerType.TAO, ROOT, rootAttr);
    }

    function _accredit(Vm.Wallet memory by, string memory did, TIR.IssuerType kind, string memory parent, bytes32 parentAttr)
        internal
        returns (bytes32 attributeId)
    {
        vm.prank(by.addr);
        tir.setAttributeMetadata(did, SALT, kind, parent, parentAttr);
        attributeId = _attributeId(did);
    }

    function _revoke(Vm.Wallet memory by, string memory did, bytes32 attributeId, string memory parent, bytes32 parentAttr)
        internal
    {
        vm.prank(by.addr);
        tir.setAttributeMetadata(did, attributeId, TIR.IssuerType.Revoked, parent, parentAttr);
    }

    /// The id a first accreditation with SALT gets (IssuersRegistry._deriveRevisionId).
    function _attributeId(string memory did) internal pure returns (bytes32) {
        return sha256(abi.encode(did, SALT, uint256(0), bytes("")));
    }

    function _insertDid(string memory did, Vm.Wallet memory key) internal {
        bytes memory publicKey = abi.encodePacked(bytes1(0x04), key.publicKeyX, key.publicKeyY);
        didr.insertDidDocument(
            did, "{}", string.concat(did, "#key-1"), publicKey, true, block.timestamp, block.timestamp + 365 days
        );
    }
}

/// What a TAO can do in the Trusted Issuers Registry, and what the registry
/// tells about a TI afterwards.
contract TaoInTheIssuersRegistryTest is EbsiFixture {
    function test_ATaoAccreditsATi() public {
        bytes32 attr = _accredit(taoKey, TI, TIR.IssuerType.TI, TAO, taoAttr);
        TIR.Attribute memory a = tir.getLatestRevisionAttribute(TI, attr);
        assertEq(uint8(a.issuerType), uint8(TIR.IssuerType.TI));
        assertEq(a.tao, TAO);
        assertEq(a.parentAttributeId, taoAttr);
    }

    function test_ATaoRevokesItsOwnTiForGood() public {
        bytes32 attr = _accredit(taoKey, TI, TIR.IssuerType.TI, TAO, taoAttr);
        _revoke(taoKey, TI, attr, TAO, taoAttr);
        assertEq(uint8(tir.getLatestRevisionAttribute(TI, attr).issuerType), uint8(TIR.IssuerType.Revoked));

        vm.prank(taoKey.addr);
        vm.expectRevert(TIR.AttributeAlreadyRevoked.selector);
        tir.setAttributeMetadata(TI, attr, TIR.IssuerType.TI, TAO, taoAttr);
    }

    function test_ARevokedTiComesBackOnlyAsANewAttribute() public {
        bytes32 attr = _accredit(taoKey, TI, TIR.IssuerType.TI, TAO, taoAttr);
        _revoke(taoKey, TI, attr, TAO, taoAttr);

        vm.prank(taoKey.addr);
        tir.setAttributeMetadata(TI, keccak256("another salt"), TIR.IssuerType.TI, TAO, taoAttr);
        assertEq(uint8(tir.getLatestRevisionAttribute(TI, attr).issuerType), uint8(TIR.IssuerType.Revoked));
    }

    function test_RevertWhen_ATaoRevokesAnotherTaosTi() public {
        bytes32 attr = _accredit(taoKey, TI, TIR.IssuerType.TI, TAO, taoAttr);
        vm.prank(otherTaoKey.addr);
        vm.expectRevert();
        tir.setAttributeMetadata(TI, attr, TIR.IssuerType.Revoked, OTHER_TAO, otherTaoAttr);
    }

    function test_AnotherTaoCanStillAccreditTheSameDid() public {
        _accredit(taoKey, TI, TIR.IssuerType.TI, TAO, taoAttr);
        vm.prank(otherTaoKey.addr);
        tir.setAttributeMetadata(TI, keccak256("another salt"), TIR.IssuerType.TI, OTHER_TAO, otherTaoAttr);
        (, uint256 total) = tir.getIssuer(TI);
        assertEq(total, 2);
    }

    function test_RevertWhen_TheCallerDoesNotControlTheTaosDid() public {
        vm.prank(tiKey.addr);
        vm.expectRevert();
        tir.setAttributeMetadata(TI, SALT, TIR.IssuerType.TI, TAO, taoAttr);
    }

    function test_RevertWhen_ARevokedTaoAccredits() public {
        _revoke(rootKey, TAO, taoAttr, ROOT, rootAttr);
        vm.prank(taoKey.addr);
        vm.expectRevert();
        tir.setAttributeMetadata(TI, SALT, TIR.IssuerType.TI, TAO, taoAttr);
    }

    function test_RevokingATaoLeavesItsTiLookingAccredited() public {
        bytes32 attr = _accredit(taoKey, TI, TIR.IssuerType.TI, TAO, taoAttr);
        _revoke(rootKey, TAO, taoAttr, ROOT, rootAttr);
        assertEq(uint8(tir.getLatestRevisionAttribute(TI, attr).issuerType), uint8(TIR.IssuerType.TI));
    }

    function test_AnAccreditedTiHasNotAcceptedUntilItWritesItsData() public {
        bytes32 attr = _accredit(taoKey, TI, TIR.IssuerType.TI, TAO, taoAttr);
        (bool notAccepted,) = tir.getIssuer(TI);
        assertTrue(notAccepted);

        vm.prank(tiKey.addr);
        tir.setAttributeData(TI, attr, hex"01");
        (notAccepted,) = tir.getIssuer(TI);
        assertFalse(notAccepted);
    }

    function test_ATaoCanAccreditADidThatIsNotInTheDidRegistry() public {
        string memory ghost = "did:ebsi:zNoDocument";
        bytes32 attr = _accredit(taoKey, ghost, TIR.IssuerType.TI, TAO, taoAttr);
        assertEq(uint8(tir.getLatestRevisionAttribute(ghost, attr).issuerType), uint8(TIR.IssuerType.TI));

        vm.expectRevert(IDidDocument.DidDoesNotExist.selector);
        didr.checkController(bytes(ghost), taoKey.addr);
    }

    function test_TheControllerCheckFollowsTheKeysValidity() public {
        assertTrue(didr.checkController(bytes(TAO), taoKey.addr));
        vm.warp(block.timestamp + 366 days);
        assertFalse(didr.checkController(bytes(TAO), taoKey.addr));
    }
}

/// The contract against the real registries: a TI with keys for roles A and
/// B under its one DID, and NBÚ cosigning from a DID of its own as role C.
abstract contract GovernanceFixture is EbsiFixture {
    string internal constant NBU = "did:ebsi:zNbu";
    string internal constant TI2 = "did:ebsi:zTi2";
    Role internal constant ROLE_A = Role.wrap(1);
    Role internal constant ROLE_B = Role.wrap(2);
    Role internal constant ROLE_C = Role.wrap(3);
    bytes32 internal constant CREDENTIAL_HASH = keccak256("credential");
    bytes32 internal constant REASON = keccak256("reason");

    CertificateGovernance internal governance;
    CertificateRegistry internal registry;
    // Computed ahead: sha256 is a call, and would take a pending prank.
    bytes32 internal ID_HASH;
    bytes32 internal KEY;
    bytes32 internal KEY2;
    UpgradeableBeacon internal beacon;
    UpgradeableBeacon internal registryBeacon;
    Vm.Wallet internal secondKey;
    Vm.Wallet internal nbuKey;
    Vm.Wallet internal ti2Key;
    bytes32 internal tiAttr;
    bytes32 internal ti2Attr;
    bytes32 internal tiId;
    bytes32 internal ti2Id;

    function setUp() public virtual override {
        super.setUp();
        secondKey = vm.createWallet("second");
        nbuKey = vm.createWallet("nbu");
        ti2Key = vm.createWallet("ti2");
        _insertDid(NBU, nbuKey);
        _insertDid(TI2, ti2Key);
        _addKey(tiKey, TI, "#key-2", secondKey);
        tiAttr = _accredit(taoKey, TI, TIR.IssuerType.TI, TAO, taoAttr);
        ti2Attr = _accredit(taoKey, TI2, TIR.IssuerType.TI, TAO, taoAttr);
        beacon = new UpgradeableBeacon(address(new CertificateGovernance()), address(this));
        registryBeacon = new UpgradeableBeacon(address(new CertificateRegistry()), address(this));
        ID_HASH = Hashes.certificateIdHash("urn:uuid:1");
        KEY = Hashes.statusKey(TI, ID_HASH);
        KEY2 = Hashes.statusKey(TI2, ID_HASH);
        governance = _deploy(taoKey.addr);
        tiId = governance.computeTiId(TI);
        ti2Id = governance.computeTiId(TI2);
    }

    function _deploy(address owner) internal returns (CertificateGovernance deployed) {
        CertificateRegistry certificates = CertificateRegistry(
            address(new BeaconProxy(address(registryBeacon), abi.encodeCall(CertificateRegistry.initialize, (owner))))
        );
        bytes memory init = abi.encodeCall(
            CertificateGovernance.initialize, (owner, TAO, address(didr), address(tir), address(certificates))
        );
        deployed = CertificateGovernance(address(new BeaconProxy(address(beacon), init)));
        vm.prank(owner);
        certificates.setGovernance(address(deployed));
        registry = certificates;
    }

    function _addKey(Vm.Wallet memory by, string memory did, string memory suffix, Vm.Wallet memory key) internal {
        bytes memory publicKey = abi.encodePacked(bytes1(0x04), key.publicKeyX, key.publicKeyY);
        string memory id = string.concat(did, suffix);
        vm.startPrank(by.addr);
        didr.addVerificationMethod(did, id, publicKey, true);
        didr.addVerificationRelationship(did, "capabilityInvocation", id, block.timestamp, block.timestamp + 365 days);
        vm.stopPrank();
    }

    function _policies() internal pure returns (IGovernanceTypes.Policy[4] memory policies) {
        for (uint256 i = 0; i < 4; i++) {
            policies[i] = IGovernanceTypes.Policy(2, RoleSet.wrap(0), RoleSet.wrap(7), 0);
        }
    }

    function _setup() internal view returns (IGovernanceTypes.TiSetup memory) {
        address[] memory signers = new address[](2);
        (signers[0], signers[1]) = (tiKey.addr, secondKey.addr);
        Role[] memory roles = new Role[](2);
        (roles[0], roles[1]) = (ROLE_A, ROLE_B);
        IGovernanceTypes.Cosigner[] memory cosigners = new IGovernanceTypes.Cosigner[](1);
        cosigners[0] = IGovernanceTypes.Cosigner(NBU, ROLE_C);
        return IGovernanceTypes.TiSetup(TI, tiAttr, signers, roles, cosigners, _policies(), 30 days);
    }

    function _setup2() internal view returns (IGovernanceTypes.TiSetup memory) {
        address[] memory signers = new address[](1);
        signers[0] = ti2Key.addr;
        Role[] memory roles = new Role[](1);
        roles[0] = ROLE_A;
        IGovernanceTypes.Cosigner[] memory cosigners = new IGovernanceTypes.Cosigner[](1);
        cosigners[0] = IGovernanceTypes.Cosigner(NBU, ROLE_C);
        return IGovernanceTypes.TiSetup(TI2, ti2Attr, signers, roles, cosigners, _policies(), 30 days);
    }

    /// With a certificate of the TI on record, for its proposals. Does nothing
    /// more when the TI could not be set up: a test expected that.
    function _addTi(IGovernanceTypes.TiSetup memory setup) internal {
        vm.prank(taoKey.addr);
        governance.addTi(setup);
        if (setup.signers.length == 0) return;
        vm.prank(setup.signers[0]);
        try registry.registerCertificate(ID_HASH, setup.did, 1, 0, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID) {}
        catch {}
    }

    function _propose(address by, bytes32 id, IGovernanceTypes.ActionType action) internal returns (uint256 proposalId) {
        vm.prank(by);
        proposalId = governance.proposeAction(id, id == ti2Id ? KEY2 : KEY, action, REASON);
    }

    function _sign(address by, uint256 proposalId) internal {
        vm.prank(by);
        governance.signProposal(proposalId);
    }
}

/// isActiveTi against the real registries.
contract IsActiveTiTest is GovernanceFixture {
    function test_ALiveTiIsActive() public view {
        assertTrue(governance.isActiveTi(TI, tiAttr));
    }

    function test_ARevokedTiIsNot() public {
        _revoke(taoKey, TI, tiAttr, TAO, taoAttr);
        assertFalse(governance.isActiveTi(TI, tiAttr));
    }

    function test_ATiOfARevokedTaoIsNotThoughTheRegistryStillSaysTi() public {
        _revoke(rootKey, TAO, taoAttr, ROOT, rootAttr);
        assertEq(uint8(tir.getLatestRevisionAttribute(TI, tiAttr).issuerType), uint8(TIR.IssuerType.TI));
        assertFalse(governance.isActiveTi(TI, tiAttr));
    }

    function test_ATiOfAnotherTaoIsNot() public {
        bytes32 salt = keccak256("another salt");
        vm.prank(otherTaoKey.addr);
        tir.setAttributeMetadata(TI, salt, TIR.IssuerType.TI, OTHER_TAO, otherTaoAttr);
        assertFalse(governance.isActiveTi(TI, sha256(abi.encode(TI, salt, uint256(0), bytes("")))));
    }

    function test_ATaoIsNotATi() public view {
        assertFalse(governance.isActiveTi(TAO, taoAttr));
    }

    function test_AnUnknownDidOrAttributeIsNotActive() public view {
        assertFalse(governance.isActiveTi("did:ebsi:zUnknown", tiAttr));
        assertFalse(governance.isActiveTi(TI, keccak256("no such attribute")));
    }
}

/// Setting up a TI.
contract AddTiTest is GovernanceFixture {
    function test_SetsUpASignerPerRoleAndACosignerByDid() public {
        _addTi(_setup());
        IGovernanceTypes.TiView memory ti = governance.getTi(tiId);
        assertEq(ti.did, TI);
        assertEq(ti.attributeId, tiAttr);
        assertEq(ti.signers.length, 2);
        assertEq(ti.cosigners[0].did, NBU);
        assertEq(RoleSet.unwrap(ti.rolesPresentMask), 7);
        assertEq(Role.unwrap(governance.roleOf(tiId, secondKey.addr)), 2);
        assertEq(Role.unwrap(governance.roleOf(tiId, nbuKey.addr)), 3);
    }

    function test_RevertWhen_TheCallerIsNotTheOwner() public {
        IGovernanceTypes.TiSetup memory setup = _setup();
        vm.prank(tiKey.addr);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, tiKey.addr));
        governance.addTi(setup);
    }

    function test_RevertWhen_TheOwnerNoLongerControlsTheTaosDid() public {
        IGovernanceTypes.TiSetup memory setup = _setup();
        vm.warp(block.timestamp + 366 days);
        vm.prank(taoKey.addr);
        vm.expectRevert(IGovernanceTypes.NotDidController.selector);
        governance.addTi(setup);
    }

    function test_RevertWhen_TheTiIsSetUpTwice() public {
        _addTi(_setup());
        IGovernanceTypes.TiSetup memory setup = _setup();
        vm.prank(taoKey.addr);
        vm.expectRevert(IGovernanceTypes.TiAlreadyConfigured.selector);
        governance.addTi(setup);
    }

    function test_RevertWhen_TheTiIsRevoked() public {
        _revoke(taoKey, TI, tiAttr, TAO, taoAttr);
        IGovernanceTypes.TiSetup memory setup = _setup();
        vm.prank(taoKey.addr);
        vm.expectRevert(IGovernanceTypes.TiNotActive.selector);
        governance.addTi(setup);
    }

    function test_RevertWhen_AnotherTaoAccreditedTheTi() public {
        bytes32 salt = keccak256("another salt");
        vm.prank(otherTaoKey.addr);
        tir.setAttributeMetadata(TI, salt, TIR.IssuerType.TI, OTHER_TAO, otherTaoAttr);
        IGovernanceTypes.TiSetup memory setup = _setup();
        setup.attributeId = sha256(abi.encode(TI, salt, uint256(0), bytes("")));
        vm.prank(taoKey.addr);
        vm.expectRevert(IGovernanceTypes.TiNotActive.selector);
        governance.addTi(setup);
    }

    function test_RevertWhen_TheDidIsAccreditedButNotInTheDidRegistry() public {
        string memory ghost = "did:ebsi:zNoDocument";
        IGovernanceTypes.TiSetup memory setup = _setup();
        setup.did = ghost;
        setup.attributeId = _accredit(taoKey, ghost, TIR.IssuerType.TI, TAO, taoAttr);
        vm.prank(taoKey.addr);
        vm.expectRevert(IGovernanceTypes.NotDidController.selector);
        governance.addTi(setup);
    }

    function test_RevertWhen_ASignerIsNotAKeyOfTheTisDid() public {
        IGovernanceTypes.TiSetup memory setup = _setup();
        setup.signers[1] = otherTaoKey.addr;
        vm.prank(taoKey.addr);
        vm.expectRevert(IGovernanceTypes.NotDidController.selector);
        governance.addTi(setup);
    }

    function test_RevertWhen_TheTiCosignsItself() public {
        IGovernanceTypes.TiSetup memory setup = _setup();
        setup.cosigners[0].did = TI;
        vm.prank(taoKey.addr);
        vm.expectRevert(IGovernanceTypes.InvalidCosigner.selector);
        governance.addTi(setup);
    }

    function test_RevertWhen_ACosignerIsNamedTwice() public {
        _addTi(_setup());
        IGovernanceTypes.Cosigner[] memory cosigners = new IGovernanceTypes.Cosigner[](2);
        cosigners[0] = IGovernanceTypes.Cosigner(NBU, ROLE_B);
        cosigners[1] = IGovernanceTypes.Cosigner(NBU, ROLE_C);
        vm.prank(taoKey.addr);
        vm.expectRevert(IGovernanceTypes.InvalidCosigner.selector);
        governance.setCosigners(tiId, cosigners);
    }

    function test_FollowsATiToANewAccreditationAndOnlyTheTaoDoes() public {
        _addTi(_setup());
        _revoke(taoKey, TI, tiAttr, TAO, taoAttr);
        bytes32 salt = keccak256("another salt");
        vm.prank(taoKey.addr);
        tir.setAttributeMetadata(TI, salt, TIR.IssuerType.TI, TAO, taoAttr);
        bytes32 renewed = sha256(abi.encode(TI, salt, uint256(0), bytes("")));

        vm.prank(tiKey.addr);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, tiKey.addr));
        governance.setTiAttribute(tiId, renewed);

        vm.prank(tiKey.addr);
        vm.expectRevert(IGovernanceTypes.TiNotActive.selector);
        governance.proposeAction(tiId, KEY, IGovernanceTypes.ActionType.SUSPEND, REASON);

        vm.prank(taoKey.addr);
        governance.setTiAttribute(tiId, renewed);
        _propose(tiKey.addr, tiId, IGovernanceTypes.ActionType.SUSPEND);
    }

    function test_RevertWhen_ChangingCosignersLeavesAPolicyOutOfReach() public {
        IGovernanceTypes.TiSetup memory setup = _setup();
        setup.policies[uint8(IGovernanceTypes.PolicyKind.REVOKE)].requiredRoleMask = RoleSet.wrap(4); // role C, NBÚ
        _addTi(setup);

        IGovernanceTypes.Cosigner[] memory none = new IGovernanceTypes.Cosigner[](0);
        vm.prank(taoKey.addr);
        vm.expectRevert(IGovernanceTypes.Unsatisfiable.selector);
        governance.setCosigners(tiId, none);
    }

    function test_TheTaoReplacesACosigner() public {
        _addTi(_setup());
        IGovernanceTypes.Cosigner[] memory cosigners = new IGovernanceTypes.Cosigner[](1);
        cosigners[0] = IGovernanceTypes.Cosigner(OTHER_TAO, ROLE_C);
        vm.prank(taoKey.addr);
        governance.setCosigners(tiId, cosigners);
        assertFalse(governance.isSigner(tiId, nbuKey.addr));
        assertTrue(governance.isSigner(tiId, otherTaoKey.addr));
    }
}

/// What the registries decide about a TI's proposals, live.
contract LiveRegistriesTest is GovernanceFixture {
    function setUp() public override {
        super.setUp();
        _addTi(_setup());
    }

    function test_ACosignerSignsWithAnyKeyOfItsDid() public {
        uint256 id = _propose(tiKey.addr, tiId, IGovernanceTypes.ActionType.SUSPEND);
        _sign(nbuKey.addr, id);
        assertEq(uint8(governance.stateOf(id)), uint8(IGovernanceTypes.ProposalState.APPROVED));
    }

    function test_ACosignersNewKeyWorksWithoutTouchingThisContract() public {
        Vm.Wallet memory rotated = vm.createWallet("nbu rotated");
        _addKey(nbuKey, NBU, "#key-2", rotated);
        uint256 id = _propose(tiKey.addr, tiId, IGovernanceTypes.ActionType.SUSPEND);
        _sign(rotated.addr, id);
        assertEq(uint8(governance.stateOf(id)), uint8(IGovernanceTypes.ProposalState.APPROVED));
    }

    function test_AKeyRevokedInTheDidRegistryAfterSigningDoesNotCount() public {
        uint256 id = _propose(tiKey.addr, tiId, IGovernanceTypes.ActionType.SUSPEND);
        _sign(secondKey.addr, id);

        vm.prank(tiKey.addr);
        didr.revokeVerificationMethod(TI, string.concat(TI, "#key-2"), block.timestamp);
        assertFalse(governance.isSigner(tiId, secondKey.addr));

        vm.prank(tiKey.addr);
        vm.expectRevert(IGovernanceTypes.QuorumNotReached.selector);
        governance.execute(id);
    }

    function test_ARevokedTiCanNeitherProposeNorExecute() public {
        uint256 id = _propose(tiKey.addr, tiId, IGovernanceTypes.ActionType.SUSPEND);
        _sign(secondKey.addr, id);
        _revoke(taoKey, TI, tiAttr, TAO, taoAttr);

        vm.prank(tiKey.addr);
        vm.expectRevert(IGovernanceTypes.TiNotActive.selector);
        governance.execute(id);

        vm.prank(tiKey.addr);
        vm.expectRevert(IGovernanceTypes.TiNotActive.selector);
        governance.proposeAction(tiId, keccak256("other"), IGovernanceTypes.ActionType.SUSPEND, REASON);
    }

    function test_RevokingTheTaoStopsItsTisToo() public {
        uint256 id = _propose(tiKey.addr, tiId, IGovernanceTypes.ActionType.SUSPEND);
        _sign(secondKey.addr, id);
        _revoke(rootKey, TAO, taoAttr, ROOT, rootAttr);

        vm.prank(tiKey.addr);
        vm.expectRevert(IGovernanceTypes.TiNotActive.selector);
        governance.execute(id);
    }

    function test_ARevokedTiStillSuspendsItsCertificates() public {
        _revoke(taoKey, TI, tiAttr, TAO, taoAttr);
        vm.prank(tiKey.addr);
        registry.suspendNow(KEY, REASON);
        assertEq(uint8(registry.certificateStatus(KEY).standing), uint8(IGovernanceTypes.Standing.SUSPENDED));
    }

    function test_ARevokedTiRegistersNothing() public {
        _revoke(taoKey, TI, tiAttr, TAO, taoAttr);
        vm.prank(tiKey.addr);
        vm.expectRevert(IGovernanceTypes.TiNotActive.selector);
        registry.registerCertificate(
            ID_HASH, TI, 1, 0, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID);
    }
}

/// Two TIs on one contract.
contract IsolationTest is GovernanceFixture {
    function setUp() public override {
        super.setUp();
        _addTi(_setup());
        _addTi(_setup2());
    }

    function test_AKeyOfOneTiCannotSignForAnother() public {
        uint256 id = _propose(tiKey.addr, tiId, IGovernanceTypes.ActionType.SUSPEND);
        vm.prank(ti2Key.addr);
        vm.expectRevert(IGovernanceTypes.NotASigner.selector);
        governance.signProposal(id);
    }

    function test_ACosignerServesEveryTiThatNamesIt() public {
        _sign(nbuKey.addr, _propose(tiKey.addr, tiId, IGovernanceTypes.ActionType.SUSPEND));
        _sign(nbuKey.addr, _propose(ti2Key.addr, ti2Id, IGovernanceTypes.ActionType.SUSPEND));
    }

    function test_RevertWhen_ATiRegistersInAnothersName() public {
        vm.prank(tiKey.addr);
        vm.expectRevert(IGovernanceTypes.NotASigner.selector);
        registry.registerCertificate(
            ID_HASH, TI2, 1, 0, CREDENTIAL_HASH, IGovernanceTypes.Standing.VALID);
    }

    function test_RevertWhen_ATiProposesAgainstAnothersCertificate() public {
        vm.prank(tiKey.addr);
        vm.expectRevert(IGovernanceTypes.NotCertificateIssuer.selector);
        governance.proposeAction(tiId, KEY2, IGovernanceTypes.ActionType.REVOKE, REASON);
    }

    function test_TheSameIdAtTwoTisIsTwoCertificates() public {
        _propose(tiKey.addr, tiId, IGovernanceTypes.ActionType.SUSPEND);
        _propose(ti2Key.addr, ti2Id, IGovernanceTypes.ActionType.SUSPEND);
        assertEq(governance.openProposalFor(KEY), 1);
        assertEq(governance.openProposalFor(KEY2), 2);
    }

    function test_RevertWhen_ASuspensionComesFromAnotherTi() public {
        vm.prank(tiKey.addr);
        vm.expectRevert(IGovernanceTypes.NotASigner.selector);
        registry.suspendNow(KEY2, REASON);
    }

    function test_EachTiHasItsOwnPolicy() public {
        vm.prank(ti2Key.addr);
        uint256 id = governance.proposePolicy(ti2Id, IGovernanceTypes.PolicyKind.SUSPEND, 1, RoleSet.wrap(0), RoleSet.wrap(7), 0);
        _admin(id);
        assertEq(governance.getPolicy(ti2Id, IGovernanceTypes.PolicyKind.SUSPEND).threshold, 1);
        assertEq(governance.getPolicy(tiId, IGovernanceTypes.PolicyKind.SUSPEND).threshold, 2);
    }

    function _admin(uint256 id) private {
        vm.prank(nbuKey.addr);
        governance.signAdminProposal(id);
    }
}

/// Repointing the contract at other registries.
contract SetRegistriesTest is GovernanceFixture {
    function test_TheTaoRepointsTheContractAtOnce() public {
        address newDidRegistry = address(new StubDidRegistry());
        vm.prank(taoKey.addr);
        vm.expectEmit(address(governance));
        emit ITiAccreditation.RegistriesChanged(newDidRegistry, address(tir));
        governance.setRegistries(newDidRegistry, address(tir));
        assertEq(governance.didRegistry(), newDidRegistry);
    }

    function test_ANewIssuersRegistryDecidesWhoIsActive() public {
        assertTrue(governance.isActiveTi(TI, tiAttr));
        IssuersRegistry empty = IssuersRegistry(
            address(
                new ERC1967Proxy(
                    address(new IssuersRegistry()),
                    abi.encodeCall(IssuersRegistry.initialize, (address(didr.policiesRegistryContract()), address(didr)))
                )
            )
        );
        vm.prank(taoKey.addr);
        governance.setRegistries(address(didr), address(empty));
        assertFalse(governance.isActiveTi(TI, tiAttr));
    }

    function test_ABrokenDidRegistryCanStillBeReplaced() public {
        address newDidRegistry = address(new StubDidRegistry());
        vm.etch(address(didr), hex"fe");
        vm.prank(taoKey.addr);
        governance.setRegistries(newDidRegistry, address(tir));
        assertEq(governance.didRegistry(), newDidRegistry);
    }

    function test_RevertWhen_TheCallerIsNotTheTao() public {
        vm.prank(tiKey.addr);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, tiKey.addr));
        governance.setRegistries(address(didr), address(tir));
    }

    function test_RevertWhen_ARegistryHasNoCode() public {
        vm.prank(taoKey.addr);
        vm.expectRevert(IGovernanceTypes.InvalidRegistry.selector);
        governance.setRegistries(tiKey.addr, address(tir));
    }

    function test_RevertWhen_TheNewDidRegistryDoesNotKnowTheTao() public {
        DidRegistry empty = DidRegistry(
            address(
                new ERC1967Proxy(
                    address(new DidRegistry()),
                    abi.encodeCall(DidRegistry.initialize, (address(didr.policiesRegistryContract())))
                )
            )
        );
        vm.prank(taoKey.addr);
        vm.expectRevert(IGovernanceTypes.NotDidController.selector);
        governance.setRegistries(address(empty), address(tir));
        assertEq(governance.didRegistry(), address(didr));
    }
}
