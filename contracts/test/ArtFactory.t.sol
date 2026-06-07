// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import { ArtFactory }       from "../src/ArtFactory.sol";
import { ArtFractionToken } from "../src/ArtFractionToken.sol";
import { BondingCurveAMM }  from "../src/BondingCurveAMM.sol";
import { IAccessControl }   from "@openzeppelin/contracts/access/IAccessControl.sol";

/**
 * @title  ArtFactoryTest
 * @notice Kiểm thử luồng khởi tạo Minimal Proxy và phân quyền AccessControl.
 *
 *  Coverage:
 *    ✓ createArtwork() emit ArtworkCreated đúng chuẩn
 *    ✓ Registry (artworkAMM, artworkToken, getTotalArtworks, creatorArtworks)
 *    ✓ AMM clone nắm MINTER_ROLE trên Token clone
 *    ✓ Factory (admin) nắm DEFAULT_ADMIN_ROLE trên Token clone
 *    ✓ Bên thứ ba KHÔNG có MINTER_ROLE
 *    ✓ Revert khi CID rỗng
 *    ✓ Revert khi targetCap vượt giới hạn
 *    ✓ Revert khi tổng fee > MAX_FEE_BPS
 *    ✓ Double-initialize bị chặn
 *    ✓ Implementation bị lock (không ai gọi initialize trực tiếp được)
 *    ✓ isArtworkAMM() đúng với clone, sai với địa chỉ tùy tiện
 *    ✓ Ownable2Step — transferOwnership cần 2 bước
 */
contract ArtFactoryTest is Test {

    // ── Contracts ──────────────────────────────────────────────────────────────
    ArtFactory       public factory;
    ArtFractionToken public tokenImpl;
    BondingCurveAMM  public ammImpl;

    // ── Actors ─────────────────────────────────────────────────────────────────
    address constant ADMIN    = address(0xA0);
    address constant CREATOR  = address(0xC1);
    address constant TREASURY = address(0xFEE1);
    address constant STRANGER = address(0x9999);

    // ── Config ─────────────────────────────────────────────────────────────────
    uint256 constant PLATFORM_FEE = 200;   // 2%
    uint256 constant CREATOR_FEE  = 100;   // 1%
    uint256 constant TARGET_CAP   = 1_000;
    string  constant CID          = "QmArtCurveTestArtwork001";

    // ── Role constants (mirror contract) ───────────────────────────────────────
    bytes32 constant MINTER_ROLE        = keccak256("MINTER_ROLE");
    bytes32 constant DEFAULT_ADMIN_ROLE = bytes32(0); // OZ default

    // ── Mirror ArtFactory events ────────────────────────────────────────────────
    // Khai báo lại để dùng với vm.expectEmit
    event ArtworkCreated(
        address indexed artworkAmm,
        address indexed creator,
        string          metadataCID,
        uint256 indexed artworkId,
        uint256         targetCap
    );
    event PlatformFeeRateUpdated(uint256 oldRate, uint256 newRate);

    // ══════════════════════════════════════════════════════════════════════════
    //  SETUP
    // ══════════════════════════════════════════════════════════════════════════

    function setUp() public {
        // 1. Deploy implementations (sẽ bị lock bởi _disableInitializers)
        tokenImpl = new ArtFractionToken();
        ammImpl   = new BondingCurveAMM();

        // 2. Deploy factory
        factory = new ArtFactory(
            address(tokenImpl),
            address(ammImpl),
            PLATFORM_FEE,
            TREASURY,
            CREATOR_FEE,
            ADMIN
        );
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  LUỒNG createArtwork — Event
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * @notice ArtworkCreated phải emit với creator, artworkId, targetCap đúng.
     * @dev    checkTopic1=false vì không biết địa chỉ ammClone trước khi gọi.
     *         checkTopic2=true (creator), checkTopic3=true (artworkId=1), checkData=true.
     */
    function test_CreateArtwork_EmitsEvent() public {
        vm.expectEmit(false, true, true, true, address(factory));
        emit ArtworkCreated(
            address(0), // artworkAmm — bỏ qua (checkTopic1=false)
            CREATOR,
            CID,
            1,          // artworkId đầu tiên
            TARGET_CAP
        );

        vm.prank(CREATOR);
        factory.createArtwork(CID, TARGET_CAP, 0);
    }

    /**
     * @notice Gọi createArtwork lần 2 phải emit artworkId=2.
     */
    function test_CreateArtwork_SecondArtwork_EmitsId2() public {
        vm.prank(CREATOR);
        factory.createArtwork(CID, TARGET_CAP, 0);

        vm.expectEmit(false, true, true, true, address(factory));
        emit ArtworkCreated(address(0), CREATOR, "QmSecond", 2, TARGET_CAP);

        vm.prank(CREATOR);
        factory.createArtwork("QmSecond", TARGET_CAP, 0);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  LUỒNG createArtwork — Registry
    // ══════════════════════════════════════════════════════════════════════════

    function test_CreateArtwork_Registry() public {
        vm.prank(CREATOR);
        (address ammClone, address tokenClone) = factory.createArtwork(CID, TARGET_CAP, 0);

        // artworkId bắt đầu từ 1
        assertEq(factory.getTotalArtworks(), 1, "total artworks");

        // Registry forward lookups
        assertEq(factory.artworkAMM(1),   ammClone,   "artworkAMM[1]");
        assertEq(factory.artworkToken(1), tokenClone, "artworkToken[1]");

        // Registry reverse lookup
        assertEq(factory.ammToArtworkId(ammClone), 1, "ammToArtworkId");

        // Creator registry
        uint256[] memory ids = factory.getCreatorArtworks(CREATOR);
        assertEq(ids.length, 1);
        assertEq(ids[0], 1);

        // getArtworkInfo helper
        (address amm, address token) = factory.getArtworkInfo(1);
        assertEq(amm,   ammClone);
        assertEq(token, tokenClone);

        // isArtworkAMM
        assertTrue(factory.isArtworkAMM(ammClone));
        assertFalse(factory.isArtworkAMM(STRANGER));
    }

    function test_CreateArtwork_DeployedArtworksList() public {
        vm.prank(CREATOR);
        (address amm1,) = factory.createArtwork("QmA", TARGET_CAP, 0);
        vm.prank(CREATOR);
        (address amm2,) = factory.createArtwork("QmB", TARGET_CAP, 0);

        // getDeployedArtworks pagination
        address[] memory page = factory.getDeployedArtworks(0, 10);
        assertEq(page.length, 2);
        assertEq(page[0], amm1);
        assertEq(page[1], amm2);

        // Offset vượt ra ngoài → mảng rỗng
        address[] memory empty = factory.getDeployedArtworks(5, 10);
        assertEq(empty.length, 0);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  PHÂN QUYỀN — AccessControl
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * @notice AMM clone PHẢI có MINTER_ROLE trên Token clone.
     *         Đây là bất biến quan trọng nhất: chỉ AMM mới mint/burn được.
     */
    function test_Permissions_AMMHasMinterRole() public {
        vm.prank(CREATOR);
        (address ammClone, address tokenClone) = factory.createArtwork(CID, TARGET_CAP, 0);

        assertTrue(
            IAccessControl(tokenClone).hasRole(MINTER_ROLE, ammClone),
            "AMM must hold MINTER_ROLE"
        );
    }

    /**
     * @notice Factory (admin) PHẢI có DEFAULT_ADMIN_ROLE trên Token clone.
     *         Cần để gọi setMinter hoặc pause trong tương lai.
     */
    function test_Permissions_FactoryHasAdminRole() public {
        vm.prank(CREATOR);
        (,address tokenClone) = factory.createArtwork(CID, TARGET_CAP, 0);

        assertTrue(
            IAccessControl(tokenClone).hasRole(DEFAULT_ADMIN_ROLE, address(factory)),
            "Factory must hold DEFAULT_ADMIN_ROLE"
        );
    }

    /**
     * @notice Bên thứ ba (STRANGER) KHÔNG được có MINTER_ROLE.
     */
    function test_Permissions_StrangerHasNoMinterRole() public {
        vm.prank(CREATOR);
        (,address tokenClone) = factory.createArtwork(CID, TARGET_CAP, 0);

        assertFalse(
            IAccessControl(tokenClone).hasRole(MINTER_ROLE, STRANGER),
            "Stranger must NOT hold MINTER_ROLE"
        );
    }

    /**
     * @notice Creator KHÔNG được có MINTER_ROLE (chỉ AMM mới được phép).
     */
    function test_Permissions_CreatorHasNoMinterRole() public {
        vm.prank(CREATOR);
        (,address tokenClone) = factory.createArtwork(CID, TARGET_CAP, 0);

        assertFalse(
            IAccessControl(tokenClone).hasRole(MINTER_ROLE, CREATOR),
            "Creator must NOT hold MINTER_ROLE"
        );
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  REVERT CASES
    // ══════════════════════════════════════════════════════════════════════════

    function test_CreateArtwork_RevertOnZeroCID() public {
        vm.expectRevert(ArtFactory.ZeroCID.selector);
        vm.prank(CREATOR);
        factory.createArtwork("", TARGET_CAP, 0);
    }

    function test_CreateArtwork_RevertOnTargetCapTooLow() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                ArtFactory.InvalidTargetCap.selector,
                99,                          // given
                factory.MIN_TARGET_CAP(),    // min
                factory.MAX_TARGET_CAP()     // max
            )
        );
        vm.prank(CREATOR);
        factory.createArtwork(CID, 99, 0);
    }

    function test_CreateArtwork_RevertOnTargetCapTooHigh() public {
        uint256 tooBig = factory.MAX_TARGET_CAP() + 1;
        vm.expectRevert(
            abi.encodeWithSelector(
                ArtFactory.InvalidTargetCap.selector,
                tooBig,
                factory.MIN_TARGET_CAP(),
                factory.MAX_TARGET_CAP()
            )
        );
        vm.prank(CREATOR);
        factory.createArtwork(CID, tooBig, 0);
    }

    function test_CreateArtwork_RevertOnFeeTooHigh() public {
        // platformFee=200, nếu creatorFee=850 → tổng=1050 > MAX_FEE_BPS=1000
        vm.expectRevert(
            abi.encodeWithSelector(
                ArtFactory.FeeTooHigh.selector,
                200 + 850,
                factory.MAX_FEE_BPS()
            )
        );
        vm.prank(CREATOR);
        factory.createArtwork(CID, TARGET_CAP, 850);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  SECURITY — Chống double-initialize và implementation lock
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Gọi initialize() lần 2 trên clone phải revert.
     *         OZ Initializable v5 throw InvalidInitialization().
     */
    function test_DoubleInitialize_TokenClone_Reverts() public {
        vm.prank(CREATOR);
        (,address tokenClone) = factory.createArtwork(CID, TARGET_CAP, 0);

        // Cố tình gọi lại — phải revert
        vm.expectRevert();
        ArtFractionToken(tokenClone).initialize(STRANGER, "ipfs://evil/");
    }

    function test_DoubleInitialize_AMMClone_Reverts() public {
        vm.prank(CREATOR);
        (address ammClone, address tokenClone) = factory.createArtwork(CID, TARGET_CAP, 0);

        vm.expectRevert();
        BondingCurveAMM(payable(ammClone)).initialize(
            tokenClone, 999, STRANGER, STRANGER,
            TARGET_CAP, 1 ether, 200, 100, STRANGER
        );
    }

    /**
     * @notice Implementation contract bị lock — kẻ tấn công không thể gọi
     *         initialize() trực tiếp lên implementation để chiếm quyền admin.
     */
    function test_ImplementationLock_Token() public {
        vm.expectRevert();
        tokenImpl.initialize(STRANGER, "ipfs://attack/");
    }

    function test_ImplementationLock_AMM() public {
        vm.expectRevert();
        ammImpl.initialize(
            address(tokenImpl), 1, STRANGER, STRANGER,
            1_000, 1 ether, 200, 100, STRANGER
        );
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  ADMIN — Ownable2Step
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Non-owner không được gọi updatePlatformFeeRate.
     */
    function test_Admin_OnlyOwnerCanUpdateFee() public {
        vm.expectRevert();
        vm.prank(STRANGER);
        factory.updatePlatformFeeRate(300);
    }

    /**
     * @notice Ownable2Step: transferOwnership() cần acceptOwnership() từ người nhận.
     *         Nếu chỉ gọi transferOwnership() mà không acceptOwnership() thì owner
     *         vẫn là người cũ.
     */
    function test_Ownable2Step_RequiresAccept() public {
        vm.prank(ADMIN);
        factory.transferOwnership(STRANGER);

        // owner vẫn là ADMIN cho đến khi STRANGER gọi acceptOwnership
        assertEq(factory.owner(), ADMIN, "owner still ADMIN before accept");

        // STRANGER accept
        vm.prank(STRANGER);
        factory.acceptOwnership();
        assertEq(factory.owner(), STRANGER, "owner is STRANGER after accept");
    }

    /**
     * @notice Emit PlatformFeeRateUpdated khi owner cập nhật fee thành công.
     */
    function test_Admin_UpdatePlatformFeeRate_EmitsEvent() public {
        vm.expectEmit(true, true, true, true, address(factory));
        emit PlatformFeeRateUpdated(PLATFORM_FEE, 300);

        vm.prank(ADMIN);
        factory.updatePlatformFeeRate(300);
        assertEq(factory.platformFeeRate(), 300);
    }
}
