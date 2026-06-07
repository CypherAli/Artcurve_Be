// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ─────────────────────────────────────────────────────────────────────────────
//  ArtFactory — Điều phối và Deploy toàn bộ hệ sinh thái ArtCurve
//
//  KIẾN TRÚC PROXY CLONES (ERC-1167 Minimal Proxy)
//  ─────────────────────────────────────────────────
//  Vấn đề: Dùng từ khoá `new` để deploy contract tốn 500k–2M gas/artwork.
//           Với 1000 artworks, tổng gas = 500M–2B → không khả thi.
//
//  Giải pháp: ERC-1167 Minimal Proxy ("Clone") chỉ deploy 45 bytes bytecode:
//
//    Bytecode clone:
//    3d3d3d3d363d3d37363d73 <IMPL_ADDRESS_20_BYTES> 5af43d82803e903d91602b57fd5bf3
//    │                      │                       │
//    │                      Địa chỉ implementation  EIP-1167 proxy logic
//    Chỉ 45 bytes — không có business logic!
//
//  Cơ chế: Mọi lời gọi đến Clone đều được chuyển tiếp qua DELEGATECALL đến
//    implementation. Code chạy trên implementation, nhưng state (storage, ETH)
//    lưu trong Clone.
//
//  Chi phí: ~45k gas (clone) vs ~2M gas (new) → tiết kiệm 97%
//
//  Quan trọng: Vì Clones dùng DELEGATECALL, implementation KHÔNG thể dùng
//    constructor để khởi tạo state của Clone. Phải dùng initializer pattern.
//
//  Luồng triển khai (mỗi artwork):
//    ArtFactory
//      ├─ Clones.clone(artFractionTokenImpl)  → tokenClone (45 bytes proxy)
//      │    └─ tokenClone.initialize(...)     → khởi tạo ERC-1155 state
//      ├─ Clones.clone(bondingCurveAMMImpl)   → ammClone (45 bytes proxy)
//      │    └─ ammClone.initialize(...)       → khởi tạo AMM state
//      ├─ tokenClone.setMinter(ammClone)      → cấp MINTER_ROLE
//      └─ emit ArtworkCreated(...)            → backend lắng nghe
//
//  Bảo mật:
//    ✓ Factory KHÔNG giữ ETH hay token của user
//    ✓ Ownable2Step — chuyển ownership 2 bước, tránh typo mất quyền admin
//    ✓ Implementation contracts được lock (disableInitializers) sau khi deploy
//    ✓ artworkId dùng để định danh artwork trên cả on-chain lẫn off-chain
// ─────────────────────────────────────────────────────────────────────────────

import { Ownable2Step, Ownable }   from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { Clones }                  from "@openzeppelin/contracts/proxy/Clones.sol";
import { IArtFractionTokenInit }   from "./interfaces/IArtFractionTokenInit.sol";
import { IBondingCurveAMMInit }    from "./interfaces/IBondingCurveAMMInit.sol";

/**
 * @title  ArtFactory
 * @notice Registry và Factory cho toàn bộ artwork trên ArtCurve.
 *         Mỗi lần creator gọi createArtwork(), Factory clone 2 implementation
 *         contracts với chi phí gas tối thiểu (~90k gas tổng cộng).
 * @dev    Không nâng cấp được (non-upgradeable) — tradeoff đơn giản hoá audit.
 *         Nếu cần nâng cấp, deploy Factory mới và migrate implementation address.
 */
contract ArtFactory is Ownable2Step {

    using Clones for address;

    // ── Constants ──────────────────────────────────────────────────────────────

    uint256 public constant MAX_FEE_BPS      = 1_000;  // 10% — tổng fee tối đa
    uint256 public constant MAX_TARGET_CAP   = 10_000_000; // 10M shares tối đa
    uint256 public constant MIN_TARGET_CAP   = 100;    // 100 shares tối thiểu
    uint256 public constant MIN_VIRTUAL_ETH  = 0.001 ether;

    // ── Immutables — Implementation addresses (Master copies) ─────────────────

    /**
     * @notice Địa chỉ ArtFractionToken IMPLEMENTATION (không phải clone).
     * @dev    Deploy 1 lần, dùng mãi. Tất cả token clones delegatecall tới đây.
     *         PHẢI gọi _disableInitializers() trong constructor của implementation.
     */
    address public immutable artFractionTokenImpl;

    /**
     * @notice Địa chỉ BondingCurveAMM IMPLEMENTATION (không phải clone).
     * @dev    Deploy 1 lần, dùng mãi. Tất cả AMM clones delegatecall tới đây.
     *         PHẢI gọi _disableInitializers() trong constructor của implementation.
     */
    address public immutable bondingCurveAMMImpl;

    // ── Platform Config (Owner-managed) ───────────────────────────────────────

    /// @notice Platform fee rate (basis points, 100 = 1%)
    uint256 public platformFeeRate;

    /// @notice Ví nhận platform fee
    address public platformTreasury;

    /// @notice Fee mặc định cho creator nếu không truyền tham số
    uint256 public defaultCreatorFeeRate;

    /**
     * @notice Virtual ETH mặc định khi tạo pool.
     * @dev    Quyết định giá khởi điểm: initialPrice = defaultInitialVirtualETH / targetCap
     *         Mặc định 1 ether: với targetCap=1000 → giá khởi điểm = 0.001 ETH/share
     */
    uint256 public defaultInitialVirtualETH;

    // ── Artwork Registry ───────────────────────────────────────────────────────

    /// @notice Danh sách địa chỉ AMM clone theo thứ tự tạo (index = artworkId - 1)
    address[] public deployedArtworks;

    /// @notice artworkId (counter) → địa chỉ AMM clone
    mapping(uint256 => address) public artworkAMM;

    /// @notice artworkId (counter) → địa chỉ ArtFractionToken clone
    mapping(uint256 => address) public artworkToken;

    /// @notice AMM address → artworkId (reverse lookup — O(1))
    mapping(address => uint256) public ammToArtworkId;

    /// @notice creator address → danh sách artworkId của họ
    mapping(address => uint256[]) public creatorArtworks;

    /// @notice Đếm số artwork đã tạo — cũng là artworkId của artwork mới nhất
    uint256 private _artworkCounter;

    // ── Errors ─────────────────────────────────────────────────────────────────

    error ZeroAddress(string field);
    error ZeroCID();
    error InvalidTargetCap(uint256 given, uint256 min, uint256 max);
    error InvalidVirtualETH(uint256 given, uint256 min);
    error FeeTooHigh(uint256 total, uint256 max);
    error PlatformFeeRateTooHigh(uint256 given, uint256 max);

    // ── Events ─────────────────────────────────────────────────────────────────

    /**
     * @notice Emit mỗi khi một artwork mới được tạo.
     *         Backend (blockchain-event.consumer.ts) lắng nghe event này để
     *         ghi vào PostgreSQL và kích hoạt luồng xử lý tiếp theo.
     *
     * @param artworkAmm   Địa chỉ BondingCurveAMM clone — dùng làm on-chain identifier
     * @param creator      Địa chỉ creator
     * @param metadataCID  IPFS CID của metadata artwork
     * @param artworkId    ID tuần tự (1, 2, 3...) — backend map với UUID trong PostgreSQL
     * @param targetCap    Số shares tối đa
     */
    event ArtworkCreated(
        address indexed artworkAmm,
        address indexed creator,
        string          metadataCID,
        uint256 indexed artworkId,
        uint256         targetCap
    );

    event PlatformFeeRateUpdated(uint256 oldRate, uint256 newRate);
    event PlatformTreasuryUpdated(address oldTreasury, address newTreasury);
    event DefaultCreatorFeeRateUpdated(uint256 oldRate, uint256 newRate);
    event DefaultInitialVirtualETHUpdated(uint256 oldValue, uint256 newValue);

    // ── Constructor ────────────────────────────────────────────────────────────

    /**
     * @param _artFractionTokenImpl  Địa chỉ ArtFractionToken implementation (đã deploy)
     * @param _bondingCurveAMMImpl   Địa chỉ BondingCurveAMM implementation (đã deploy)
     * @param _platformFeeRate       Platform fee ban đầu (basis points)
     * @param _platformTreasury      Ví nhận platform fee
     * @param _defaultCreatorFeeRate Creator fee mặc định (basis points)
     * @param _admin                 Owner của Factory (thường là multisig)
     */
    constructor(
        address _artFractionTokenImpl,
        address _bondingCurveAMMImpl,
        uint256 _platformFeeRate,
        address _platformTreasury,
        uint256 _defaultCreatorFeeRate,
        address _admin
    ) Ownable(_admin) {
        // ── Validation ────────────────────────────────────────────────────────
        if (_artFractionTokenImpl == address(0)) revert ZeroAddress("artFractionTokenImpl");
        if (_bondingCurveAMMImpl  == address(0)) revert ZeroAddress("bondingCurveAMMImpl");
        if (_platformTreasury     == address(0)) revert ZeroAddress("platformTreasury");
        if (_admin                == address(0)) revert ZeroAddress("admin");
        if (_platformFeeRate + _defaultCreatorFeeRate > MAX_FEE_BPS)
            revert FeeTooHigh(_platformFeeRate + _defaultCreatorFeeRate, MAX_FEE_BPS);

        // ── Assign immutables ─────────────────────────────────────────────────
        artFractionTokenImpl = _artFractionTokenImpl;
        bondingCurveAMMImpl  = _bondingCurveAMMImpl;

        // ── Assign mutable state ──────────────────────────────────────────────
        platformFeeRate          = _platformFeeRate;
        platformTreasury         = _platformTreasury;
        defaultCreatorFeeRate    = _defaultCreatorFeeRate;
        defaultInitialVirtualETH = 1 ether; // giá ban đầu ≈ 0.001 ETH/share với targetCap=1000
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  CORE — createArtwork
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Tạo một artwork mới bằng cách clone 2 implementation contracts.
     * @dev    Permissionless: Bất kỳ địa chỉ nào cũng có thể gọi (creator tự do listing).
     *         Gas estimate: ~90k–120k total (clone + initialize ×2 + setMinter)
     *         vs ~2M+ nếu dùng `new` keyword.
     *
     * @param metadataCID     IPFS CID của artwork metadata (do Backend pin trước)
     * @param targetCap       Số shares tối đa — khi đạt sẽ trigger graduation
     * @param creatorFeeRate  Fee creator (basis points). 0 = dùng defaultCreatorFeeRate
     *
     * @return ammClone    Địa chỉ BondingCurveAMM clone vừa tạo
     * @return tokenClone  Địa chỉ ArtFractionToken clone vừa tạo
     */
    function createArtwork(
        string calldata metadataCID,
        uint256         targetCap,
        uint256         creatorFeeRate
    ) external returns (address ammClone, address tokenClone) {

        // ── CHECKS ────────────────────────────────────────────────────────────
        if (bytes(metadataCID).length == 0) revert ZeroCID();
        if (targetCap < MIN_TARGET_CAP || targetCap > MAX_TARGET_CAP)
            revert InvalidTargetCap(targetCap, MIN_TARGET_CAP, MAX_TARGET_CAP);

        uint256 cfRate = (creatorFeeRate == 0) ? defaultCreatorFeeRate : creatorFeeRate;
        if (platformFeeRate + cfRate > MAX_FEE_BPS)
            revert FeeTooHigh(platformFeeRate + cfRate, MAX_FEE_BPS);

        // ── Cấp artworkId mới ─────────────────────────────────────────────────
        // unchecked: overflow của uint256 sau 10^77 artwork là không thực tế
        unchecked { _artworkCounter++; }
        uint256 newArtworkId = _artworkCounter;

        // ── BƯỚC 1: Clone ArtFractionToken ───────────────────────────────────
        //
        //  Clones.clone(impl) triển khai 45-byte minimal proxy:
        //  ┌───────────────────────────────────────────────────────────┐
        //  │ EIP-1167 bytecode                                         │
        //  │ CALLER → DELEGATECALL → artFractionTokenImpl              │
        //  │ State lưu trong tokenClone's storage                      │
        //  │ Code chạy từ artFractionTokenImpl                         │
        //  └───────────────────────────────────────────────────────────┘
        //
        tokenClone = artFractionTokenImpl.clone();

        //  Khởi tạo clone (thay thế constructor):
        //  - admin = address(this) (Factory) → Factory có thể gọi setMinter sau
        //  - baseUri = "ipfs://<CID>/" → frontend append tokenId + ".json"
        IArtFractionTokenInit(tokenClone).initialize(
            address(this),
            string.concat("ipfs://", metadataCID, "/")
        );

        // ── BƯỚC 2: Clone BondingCurveAMM ────────────────────────────────────
        //
        //  Tương tự: proxy 45 bytes, delegatecall vào bondingCurveAMMImpl
        //
        ammClone = bondingCurveAMMImpl.clone();

        IBondingCurveAMMInit(ammClone).initialize(
            tokenClone,              // ArtFractionToken clone address
            newArtworkId,            // artworkId — unique on-chain identifier
            msg.sender,              // creator — nhận creator fee
            platformTreasury,        // platform treasury
            targetCap,               // max shares before graduation
            defaultInitialVirtualETH,// virtual ETH → xác định giá ban đầu
            platformFeeRate,         // locked in tại thời điểm tạo artwork
            cfRate,                  // creator fee
            address(this)            // owner = Factory (có thể update fee)
        );

        // ── BƯỚC 3: Cấp MINTER_ROLE cho AMM ──────────────────────────────────
        //
        //  Sau bước này:
        //    tokenClone.MINTER_ROLE → ammClone (và chỉ ammClone)
        //    Bất kỳ ai gọi tokenClone.mint() trực tiếp sẽ bị revert
        //
        IArtFractionTokenInit(tokenClone).setMinter(ammClone);

        // ── BƯỚC 4: Ghi vào Registry ──────────────────────────────────────────
        deployedArtworks.push(ammClone);
        artworkAMM[newArtworkId]    = ammClone;
        artworkToken[newArtworkId]  = tokenClone;
        ammToArtworkId[ammClone]    = newArtworkId;
        creatorArtworks[msg.sender].push(newArtworkId);

        // ── BƯỚC 5: Emit event cho Backend ────────────────────────────────────
        //
        //  Backend (blockchain-event.consumer.ts) bắt event này để:
        //    1. Ghi artwork mới vào PostgreSQL (status = ACTIVE)
        //    2. Cache price vào Redis
        //    3. Cập nhật artworks.contract_address = ammClone
        //
        emit ArtworkCreated(ammClone, msg.sender, metadataCID, newArtworkId, targetCap);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  ADMIN — Owner-only config (Ownable2Step: 2-step ownership transfer)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Cập nhật platform fee rate cho các artwork TẠO MỚI.
     * @dev    Không ảnh hưởng đến artwork đã deploy (fee đã locked trong AMM clone).
     *         Ownable2Step: owner hiện tại gọi transferOwnership() →
     *           owner mới gọi acceptOwnership() → mới có hiệu lực.
     *         Tránh mất quyền do typo địa chỉ.
     */
    function updatePlatformFeeRate(uint256 newFeeRate) external onlyOwner {
        if (newFeeRate > MAX_FEE_BPS)
            revert PlatformFeeRateTooHigh(newFeeRate, MAX_FEE_BPS);
        emit PlatformFeeRateUpdated(platformFeeRate, newFeeRate);
        platformFeeRate = newFeeRate;
    }

    /**
     * @notice Cập nhật ví nhận platform fee.
     * @dev    Có hiệu lực ngay lập tức cho tất cả AMM clones đang chạy
     *         vì AMM clones gọi platformTreasury từ Storage của chính chúng
     *         (đã được set khi initialize). Admin cần gọi updateFeeRates()
     *         trên từng AMM để áp dụng treasury mới — xem updateAMMTreasury().
     */
    function updatePlatformTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress("platformTreasury");
        emit PlatformTreasuryUpdated(platformTreasury, newTreasury);
        platformTreasury = newTreasury;
    }

    /// @notice Cập nhật defaultCreatorFeeRate — áp dụng cho artwork tạo mới
    function updateDefaultCreatorFeeRate(uint256 newRate) external onlyOwner {
        if (platformFeeRate + newRate > MAX_FEE_BPS)
            revert FeeTooHigh(platformFeeRate + newRate, MAX_FEE_BPS);
        emit DefaultCreatorFeeRateUpdated(defaultCreatorFeeRate, newRate);
        defaultCreatorFeeRate = newRate;
    }

    /// @notice Cập nhật defaultInitialVirtualETH — ảnh hưởng giá khởi điểm của artwork mới
    function updateDefaultInitialVirtualETH(uint256 newValue) external onlyOwner {
        if (newValue < MIN_VIRTUAL_ETH) revert InvalidVirtualETH(newValue, MIN_VIRTUAL_ETH);
        emit DefaultInitialVirtualETHUpdated(defaultInitialVirtualETH, newValue);
        defaultInitialVirtualETH = newValue;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  VIEW — Query functions
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Tổng số artwork đã tạo (= artworkId của artwork mới nhất)
    function getTotalArtworks() external view returns (uint256) {
        return _artworkCounter;
    }

    /// @notice Thông tin đầy đủ của một artwork theo artworkId
    function getArtworkInfo(uint256 artworkId)
        external
        view
        returns (address amm, address token)
    {
        return (artworkAMM[artworkId], artworkToken[artworkId]);
    }

    /**
     * @notice Danh sách artworkId của một creator (dùng cho profile page)
     * @dev    Trả về mảng — cẩn thận với gas nếu creator có nhiều artwork.
     *         Frontend nên dùng event log thay vì gọi hàm này nếu count > 100.
     */
    function getCreatorArtworks(address creator)
        external
        view
        returns (uint256[] memory)
    {
        return creatorArtworks[creator];
    }

    /**
     * @notice Lấy danh sách AMM theo page (tránh OOG nếu deployedArtworks lớn)
     * @param offset  Bắt đầu từ index nào
     * @param limit   Số lượng kết quả tối đa
     */
    function getDeployedArtworks(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory result)
    {
        uint256 total = deployedArtworks.length;
        if (offset >= total) return new address[](0);

        uint256 end = offset + limit;
        if (end > total) end = total;

        result = new address[](end - offset);
        for (uint256 i = offset; i < end;) {
            result[i - offset] = deployedArtworks[i];
            unchecked { i++; }
        }
    }

    /// @notice Kiểm tra địa chỉ có phải là AMM clone do Factory deploy không
    function isArtworkAMM(address candidate) external view returns (bool) {
        return ammToArtworkId[candidate] != 0;
    }
}
