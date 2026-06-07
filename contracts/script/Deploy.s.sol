// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ─────────────────────────────────────────────────────────────────────────────
//  ArtCurve - Production Deployment Script
//
//  Thứ tự triển khai (bắt buộc - Clones pattern yêu cầu Implementations trước):
//
//    [1] Deploy ArtFractionToken Implementation
//          └─ Constructor gọi _disableInitializers() → khoá, không thể bị chiếm
//
//    [2] Deploy BondingCurveAMM Implementation
//          └─ Constructor gọi _disableInitializers() → khoá, không thể bị chiếm
//
//    [3] Deploy ArtFactory
//          ├─ Nhận địa chỉ hai Implementation vừa deploy
//          ├─ Thiết lập platformFeeRate, platformTreasury, defaultCreatorFeeRate
//          └─ Owner = ADMIN_ADDRESS (multisig khuyến nghị)
//
//  Sau khi deploy:
//    ✓ ArtFactory.createArtwork() clone 2 implementation với ~90k gas
//    ✓ Implementation contracts bị lock - không ai gọi initialize() được
//    ✓ Factory là owner của tất cả AMM clones
//
//  Biến môi trường bắt buộc (xem .env.example):
//    PRIVATE_KEY               - Khóa riêng tư deployer
//    ADMIN_ADDRESS             - Địa chỉ admin/multisig nhận Factory ownership
//    PLATFORM_TREASURY_ADDRESS - Ví nhận platform fee (có thể = ADMIN_ADDRESS ban đầu)
//    PLATFORM_FEE_BPS          - Platform fee (basis points, 100 = 1%)
//    DEFAULT_CREATOR_FEE_BPS   - Creator fee mặc định (basis points)
//
//  Cách chạy (Sepolia testnet):
//    forge script script/Deploy.s.sol \
//      --rpc-url $SEPOLIA_RPC_URL \
//      --broadcast \
//      --verify \
//      --etherscan-api-key $ETHERSCAN_API_KEY \
//      -vvvv
//
//  Dry-run (không broadcast):
//    forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL -vvvv
// ─────────────────────────────────────────────────────────────────────────────

import { Script, console } from "forge-std/Script.sol";
import { ArtFractionToken } from "../src/ArtFractionToken.sol";
import { BondingCurveAMM }  from "../src/BondingCurveAMM.sol";
import { ArtFactory }       from "../src/ArtFactory.sol";

contract DeployArtCurve is Script {

    // ── Giới hạn bảo vệ - revert nếu config sai trước khi broadcast ───────────
    uint256 constant MAX_FEE_BPS       = 1_000;  // 10%
    uint256 constant MIN_PLATFORM_FEE  = 0;
    uint256 constant DEFAULT_INIT_VETH = 1 ether; // giá ban đầu = initVETH / targetCap

    // ── Kết quả deploy - lưu để xác thực post-deploy ──────────────────────────
    ArtFractionToken public tokenImpl;
    BondingCurveAMM  public ammImpl;
    ArtFactory       public factory;

    // ══════════════════════════════════════════════════════════════════════════
    //  ENTRY POINT
    // ══════════════════════════════════════════════════════════════════════════

    function run() external {

        // ── ĐỌC BIẾN MÔI TRƯỜNG ───────────────────────────────────────────────
        //
        //  Tất cả env vars được validate trước khi broadcast.
        //  Nếu bất kỳ var nào thiếu hoặc sai → revert ngay, không tốn gas.
        //
        uint256 deployerPrivateKey       = vm.envUint("PRIVATE_KEY");
        address adminAddress             = vm.envAddress("ADMIN_ADDRESS");
        address platformTreasuryAddress  = vm.envAddress("PLATFORM_TREASURY_ADDRESS");
        uint256 platformFeeBps           = vm.envUint("PLATFORM_FEE_BPS");
        uint256 defaultCreatorFeeBps     = vm.envUint("DEFAULT_CREATOR_FEE_BPS");

        // ── Địa chỉ deployer (tính từ private key) ────────────────────────────
        address deployerAddress = vm.addr(deployerPrivateKey);

        // ── PRE-FLIGHT VALIDATION (chạy trước broadcast - không tốn gas) ──────
        _validateConfig(
            deployerAddress,
            adminAddress,
            platformTreasuryAddress,
            platformFeeBps,
            defaultCreatorFeeBps
        );

        // ── IN THÔNG TIN PRE-DEPLOY ───────────────────────────────────────────
        console.log("\n========================================");
        console.log("    ARTCURVE DEPLOYMENT - PRE-FLIGHT    ");
        console.log("========================================");
        console.log("Network          : ", _getChainName(block.chainid));
        console.log("Chain ID         : ", block.chainid);
        console.log("Deployer         : ", deployerAddress);
        console.log("Admin (Owner)    : ", adminAddress);
        console.log("Platform Treasury: ", platformTreasuryAddress);
        console.log("Platform Fee (bps): ", platformFeeBps);
        console.log("Creator Fee (bps) : ", defaultCreatorFeeBps);
        console.log("Initial VirtETH   :  1 ether (default)");
        console.log("----------------------------------------\n");

        // ══════════════════════════════════════════════════════════════════════
        //  BROADCAST - Mọi lệnh bên trong được ký bởi deployerPrivateKey
        // ══════════════════════════════════════════════════════════════════════
        vm.startBroadcast(deployerPrivateKey);

        // ── BƯỚC 2.1: Deploy Implementations ─────────────────────────────────
        //
        //  ArtFractionToken Implementation:
        //    - Constructor gọi _disableInitializers()
        //    - Contract bị lock hoàn toàn sau deploy
        //    - KHÔNG gọi initialize() - sẽ revert nếu cố tình
        //
        tokenImpl = new ArtFractionToken();

        //  BondingCurveAMM Implementation:
        //    - Tương tự - constructor gọi _disableInitializers()
        //
        ammImpl = new BondingCurveAMM();

        // ── BƯỚC 2.2: Deploy ArtFactory ───────────────────────────────────────
        //
        //  Factory nhận địa chỉ 2 implementation làm immutable.
        //  Sau này, mỗi createArtwork() sẽ clone từ 2 địa chỉ này.
        //
        //  Tham số:
        //    [0] artFractionTokenImpl - implementation ArtFractionToken
        //    [1] bondingCurveAMMImpl  - implementation BondingCurveAMM
        //    [2] platformFeeRate      - basis points
        //    [3] platformTreasury     - ví nhận platform fee
        //    [4] defaultCreatorFeeRate- basis points
        //    [5] admin                - owner (nên là multisig)
        //
        factory = new ArtFactory(
            address(tokenImpl),         // [0]
            address(ammImpl),           // [1]
            platformFeeBps,             // [2]
            platformTreasuryAddress,    // [3]
            defaultCreatorFeeBps,       // [4]
            adminAddress                // [5] - owner của Factory
        );

        // ── BƯỚC 2.3: Cấu hình mặc định ──────────────────────────────────────
        //
        //  defaultInitialVirtualETH được set = 1 ether trong constructor của Factory.
        //  Không cần gọi thêm gì vì đây là giá trị hợp lý cho mainnet.
        //
        //  Nếu muốn thay đổi (ví dụ: testnet dùng 0.01 ether để giảm giá ban đầu):
        //    factory.updateDefaultInitialVirtualETH(0.01 ether);
        //  Nhưng chỉ owner mới gọi được. Nếu deployer != admin:
        //    → Admin phải gọi thủ công sau khi accept ownership.
        //
        //  Ownable2Step NOTE:
        //    Factory owner = adminAddress ngay từ constructor (không cần acceptOwnership
        //    vì Ownable2Step.constructor gọi _transferOwnership trực tiếp cho msg.sender
        //    → owner = admin ngay lập tức).

        vm.stopBroadcast();

        // ══════════════════════════════════════════════════════════════════════
        //  POST-DEPLOY VERIFICATION (đọc state, không tốn gas)
        // ══════════════════════════════════════════════════════════════════════
        _verifyDeployment(adminAddress, platformTreasuryAddress, platformFeeBps, defaultCreatorFeeBps);

        // ── LOG OUTPUT ────────────────────────────────────────────────────────
        _printDeploymentSummary(deployerAddress, adminAddress);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  INTERNAL - Validation
    // ══════════════════════════════════════════════════════════════════════════

    function _validateConfig(
        address deployer,
        address admin,
        address treasury,
        uint256 platformFee,
        uint256 creatorFee
    ) internal pure {
        require(deployer  != address(0), "Deploy: zero deployer");
        require(admin     != address(0), "Deploy: zero admin - set ADMIN_ADDRESS");
        require(treasury  != address(0), "Deploy: zero treasury - set PLATFORM_TREASURY_ADDRESS");

        require(
            platformFee + creatorFee <= MAX_FEE_BPS,
            "Deploy: total fee exceeds 10% (MAX_FEE_BPS)"
        );

        // Warning: nếu deployer == admin trên mainnet → khuyến nghị dùng multisig
        // (không revert - chỉ cảnh báo qua log)
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  INTERNAL - Post-deploy state verification
    // ══════════════════════════════════════════════════════════════════════════

    function _verifyDeployment(
        address expectedAdmin,
        address expectedTreasury,
        uint256 expectedPlatformFee,
        uint256 expectedCreatorFee
    ) internal view {

        // 1. Implementation addresses được lưu đúng trong Factory
        require(
            factory.artFractionTokenImpl() == address(tokenImpl),
            "Verify FAILED: artFractionTokenImpl mismatch"
        );
        require(
            factory.bondingCurveAMMImpl() == address(ammImpl),
            "Verify FAILED: bondingCurveAMMImpl mismatch"
        );

        // 2. Owner của Factory đúng
        require(
            factory.owner() == expectedAdmin,
            "Verify FAILED: factory owner mismatch"
        );

        // 3. Platform treasury đúng
        require(
            factory.platformTreasury() == expectedTreasury,
            "Verify FAILED: platformTreasury mismatch"
        );

        // 4. Fee rates đúng
        require(
            factory.platformFeeRate() == expectedPlatformFee,
            "Verify FAILED: platformFeeRate mismatch"
        );
        require(
            factory.defaultCreatorFeeRate() == expectedCreatorFee,
            "Verify FAILED: defaultCreatorFeeRate mismatch"
        );

        // 5. defaultInitialVirtualETH = 1 ether (set trong Factory constructor)
        require(
            factory.defaultInitialVirtualETH() == DEFAULT_INIT_VETH,
            "Verify FAILED: defaultInitialVirtualETH mismatch"
        );

        // 6. Không có artwork nào sau deploy (counter = 0)
        require(
            factory.getTotalArtworks() == 0,
            "Verify FAILED: expected 0 artworks at deploy"
        );
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  INTERNAL - Console output
    // ══════════════════════════════════════════════════════════════════════════

    function _printDeploymentSummary(address deployer, address admin) internal view {
        console.log("\n========================================");
        console.log("    === ARTCURVE DEPLOYMENT ===         ");
        console.log("========================================");
        console.log("");
        console.log("  ArtFractionToken Implementation:");
        console.log("    ", address(tokenImpl));
        console.log("");
        console.log("  BondingCurveAMM Implementation:");
        console.log("    ", address(ammImpl));
        console.log("");
        console.log("  ArtFactory Address:");
        console.log("    ", address(factory));
        console.log("");
        console.log("  Deployer Address:");
        console.log("    ", deployer);
        console.log("");
        console.log("  Admin / Owner:");
        console.log("    ", admin);
        console.log("");
        console.log("  Platform Fee   : ", factory.platformFeeRate(), " bps");
        console.log("  Creator Fee    : ", factory.defaultCreatorFeeRate(), " bps");
        console.log("  Platform Treasury:");
        console.log("    ", factory.platformTreasury());
        console.log("");
        console.log("  [OK] All post-deploy verifications passed.");
        console.log("========================================");
        console.log("");
        console.log("  NEXT STEPS:");
        console.log("  1. Copy addresses above to .env (ARTFACTORY_ADDRESS, etc.)");
        console.log("  2. Update artcurve-backend/.env with contract addresses");
        console.log("  3. Verify contracts on Etherscan (see --verify flag)");
        console.log("  4. If admin != deployer: admin calls acceptOwnership()");
        console.log("     (not needed - Ownable constructor sets owner directly)");
        console.log("  5. Test createArtwork() on testnet before mainnet");
        console.log("========================================\n");
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  INTERNAL - Chain name helper
    // ══════════════════════════════════════════════════════════════════════════

    function _getChainName(uint256 chainId) internal pure returns (string memory) {
        if (chainId == 1)         return "Ethereum Mainnet";
        if (chainId == 11155111)  return "Sepolia Testnet";
        if (chainId == 17000)     return "Holesky Testnet";
        if (chainId == 137)       return "Polygon Mainnet";
        if (chainId == 8453)      return "Base Mainnet";
        if (chainId == 84532)     return "Base Sepolia";
        if (chainId == 42161)     return "Arbitrum One";
        if (chainId == 421614)    return "Arbitrum Sepolia";
        if (chainId == 31337)     return "Anvil (Local)";
        return "Unknown Network";
    }
}
