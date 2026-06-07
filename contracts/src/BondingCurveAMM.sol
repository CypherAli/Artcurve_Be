// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ─────────────────────────────────────────────────────────────────────────────
//  BondingCurveAMM — Trái tim của hệ thống ArtCurve
//
//  Mô hình toán học: Virtual AMM Constant Product
//  ─────────────────────────────────────────────
//  Bất biến: k = virtualPoolX * virtualPoolY = hằng số
//    virtualPoolX (X) — Virtual ETH reserve (wei)
//    virtualPoolY (Y) — Virtual Share reserve (đơn vị nguyên, không scale)
//
//  Giá spot: P = X / Y  (ETH per share, scaled x 1e18)
//
//  Mua `amountOut` shares:
//    ethCost = X * amountOut / (Y - amountOut)     ← nhân TRƯỚC khi chia
//    Y' = Y - amountOut;   X' = k / Y'
//
//  Bán `amountIn` shares:
//    ethOut  = X * amountIn  / (Y + amountIn)      ← nhân TRƯỚC khi chia
//    Y' = Y + amountIn;    X' = k / Y'
//
//  THAY ĐỔI so với phiên bản v1 (constructor-based):
//    ✗ Không còn constructor khởi tạo state
//    ✓ constructor() chỉ gọi _disableInitializers() → khoá implementation
//    ✓ initialize() thay thế constructor — gọi 1 lần duy nhất trên mỗi Clone
//    ✓ Không còn immutable — dùng storage thường (bắt buộc với ERC-1167 Clones)
//    ✓ Tất cả base contracts đều dùng bản *Upgradeable
//
//  Bảo mật tuân thủ (skills: smart-contract-vulnerabilities, web3-audit):
//    ✓ CEI (Checks-Effects-Interactions) trên mọi state-changing function
//    ✓ ReentrancyGuardUpgradeable — nonReentrant trên buyShares + sellShares
//    ✓ Không dùng tx.origin (chỉ msg.sender)
//    ✓ Slippage guard: maxEthIn (buy) / minEthOut (sell) → revert nếu vượt
//    ✓ Refund ETH thừa (pull-compatible, dùng call thay transfer/send)
//    ✓ State machine guard: chỉ ACTIVE mới cho trade
//    ✓ Custom errors thay vì require(string) → tiết kiệm gas
//    ✓ Nhân trước chia trong mọi phép tính AMM — tránh integer underflow
//    ✓ Không dựa vào address(this).balance làm invariant (tránh force-send ETH)
//    ✓ _disableInitializers() — ngăn attacker gọi initialize() trực tiếp
//      lên implementation contract
// ─────────────────────────────────────────────────────────────────────────────

import { Initializable }              from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import { OwnableUpgradeable }         from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { IArtFractionToken }          from "./interfaces/IArtFractionToken.sol";

/**
 * @title  BondingCurveAMM
 * @notice Virtual AMM điều phối việc mua/bán fraction của 1 artwork cụ thể.
 *         Được deploy bởi ArtFactory dưới dạng Minimal Proxy Clone (ERC-1167).
 *         Mỗi Clone = 1 artwork.
 * @dev    Owner = ArtFactory (có thể cập nhật fee hoặc trigger graduation).
 *
 *         Vòng đời:
 *           1. ArtFactory deploy implementation (1 lần)
 *           2. ArtFactory clone implementation (mỗi artwork)
 *           3. ArtFactory gọi initialize() trên clone
 *           4. ArtFactory gọi setMinter(ammClone) trên ArtFractionToken
 */
contract BondingCurveAMM is Initializable, ReentrancyGuardUpgradeable, OwnableUpgradeable {

    // ── Enums ──────────────────────────────────────────────────────────────────

    /// @notice Vòng đời của AMM pool theo State Machine Diagram
    enum CurveState {
        ACTIVE,          // vAMM đang chạy, cho phép buy/sell
        TARGET_REACHED,  // soldSupply == targetCap, tạm ngừng giao dịch
        GRADUATED        // Đã migrate sang DEX, vAMM kết thúc
    }

    // ── Structs ────────────────────────────────────────────────────────────────

    /**
     * @notice Trạng thái pool tại mọi thời điểm.
     * @dev    virtualPoolX và virtualPoolY đủ để tính lại k bất kỳ lúc nào.
     *         k = initialVirtualPoolX * targetCap = bất biến trong suốt lifecycle.
     */
    struct Pool {
        uint256    virtualPoolX;   // Virtual ETH reserve (wei) — tăng khi buy
        uint256    virtualPoolY;   // Virtual Share reserve   — giảm khi buy
        uint256    targetCap;      // Tổng số shares cần bán để graduate
        uint256    soldSupply;     // Số shares đã bán (0 → targetCap)
        CurveState state;
    }

    // ── Constants ──────────────────────────────────────────────────────────────

    uint256 public constant PRECISION   = 1e18;  // Scale cho giá (ETH per share)
    uint256 public constant MAX_FEE_BPS = 1_000; // Fee tối đa: 10% (1000 bps)

    // ── Storage (thay thế immutable — bắt buộc với ERC-1167 Clones) ───────────
    // Lý do: immutable được nhúng vào bytecode của implementation; clone chỉ
    // delegatecall vào implementation nên không có bytecode riêng → mọi clone
    // sẽ đọc cùng 1 immutable value từ implementation. Dùng storage thường
    // để mỗi clone có state riêng biệt.

    IArtFractionToken public fractionToken;      // ArtFractionToken contract của artwork này
    uint256           public artworkId;          // Token ID trong ERC-1155
    address           public creator;            // Người tạo artwork — nhận creator fee
    address           public platformTreasury;   // Ví thu platform fee
    uint256           public initialVirtualPoolX;// Virtual ETH ban đầu (để tính calculatePrice)
    uint256           public initialTargetCap;   // targetCap ban đầu (để tính calculatePrice)

    // ── Mutable state ──────────────────────────────────────────────────────────

    Pool    public pool;
    uint256 public platformFeeRate; // basis points (vd: 100 = 1%)
    uint256 public creatorFeeRate;  // basis points (vd: 100 = 1%)

    // Tracking real ETH — không dùng address(this).balance trực tiếp
    // vì force-send ETH (selfdestruct) có thể inflate balance (SOLIDITY_VULN_PATTERNS §7)
    uint256 public realEthBalance;

    // ── Custom Errors (gas-efficient hơn require(string)) ─────────────────────

    error NotActive();
    error NotGraduatable();
    error AlreadyGraduated();
    error ZeroAmount();
    error ExceedsTargetCap(uint256 requested, uint256 available);
    error SlippageBuy(uint256 cost, uint256 maxAllowed);
    error SlippageSell(uint256 received, uint256 minRequired);
    error InsufficientShares(uint256 have, uint256 want);
    error InsufficientPoolLiquidity(uint256 poolHas, uint256 needsTo);
    error ETHTransferFailed(address recipient, uint256 amount);
    error ZeroAddress(string field);
    error FeeTooHigh(uint256 total, uint256 max);

    // ── Events ─────────────────────────────────────────────────────────────────

    /**
     * @notice Event chính mà Backend (blockchain-event.consumer.ts) lắng nghe.
     * @param user        Địa chỉ người trade
     * @param artworkId_  ID artwork (trùng với storage artworkId để index được)
     * @param isBuy       true = mua, false = bán
     * @param shareAmount Số shares được mua/bán
     * @param ethAmount   ETH cost (buy) hoặc ETH nhận net (sell), không tính fee
     * @param price       Spot price SAU giao dịch (wei per share, scaled x 1e18)
     */
    event Trade(
        address indexed user,
        uint256 indexed artworkId_,
        bool    isBuy,
        uint256 shareAmount,
        uint256 ethAmount,
        uint256 price
    );

    /// @notice Emit khi pool đạt targetCap và được migrate sang DEX
    event GraduatedToDEX(
        uint256 indexed artworkId_,
        uint256 totalLiquidity   // ETH thực trong pool tại thời điểm graduation
    );

    /// @notice Emit khi fee được thu
    event FeeCollected(address indexed recipient, uint256 amount, bool isPlatform);

    /// @notice Emit khi fee rate thay đổi
    event FeeRateUpdated(uint256 newPlatformFee, uint256 newCreatorFee);

    // ── Constructor (Implementation Lock) ─────────────────────────────────────

    /**
     * @dev Khoá implementation contract — không ai có thể gọi initialize() trực tiếp.
     *      Nếu không có dòng này:
     *        Attacker deploy → gọi initialize(attacker, ...) → trở thành Owner
     *        → updateFeeRates → drain fee revenue
     *
     * @custom:oz-upgrades-unsafe-allow constructor
     */
    constructor() {
        _disableInitializers();
    }

    // ── Initialize (thay thế constructor cho Clone) ────────────────────────────

    /**
     * @notice Khởi tạo Clone. Gọi đúng 1 lần bởi ArtFactory ngay sau khi clone.
     * @dev    Modifier `initializer` (từ Initializable) đảm bảo chỉ gọi được 1 lần.
     *
     * @param _fractionToken      Địa chỉ ArtFractionToken clone của artwork này
     * @param _artworkId          Token ID trong ERC-1155
     * @param _creator            Địa chỉ creator — nhận creator fee
     * @param _platformTreasury   Ví platform — nhận platform fee
     * @param _targetCap          Số shares tối đa (ví dụ: 1000)
     * @param _initialVirtualETH  Virtual ETH ban đầu (xác định giá khởi điểm)
     *                            Ví dụ: 1 ether → giá ban đầu = 1e18 / targetCap
     * @param _platformFeeRate    Fee nền tảng (basis points, 100 = 1%)
     * @param _creatorFeeRate     Fee creator (basis points, 100 = 1%)
     * @param _admin              Owner của contract (thường là ArtFactory)
     */
    function initialize(
        address _fractionToken,
        uint256 _artworkId,
        address _creator,
        address _platformTreasury,
        uint256 _targetCap,
        uint256 _initialVirtualETH,
        uint256 _platformFeeRate,
        uint256 _creatorFeeRate,
        address _admin
    ) public initializer {
        // ── Khởi tạo base contracts ───────────────────────────────────────────
        __ReentrancyGuard_init();
        __Ownable_init(_admin);

        // ── Validation ────────────────────────────────────────────────────────
        if (_fractionToken    == address(0)) revert ZeroAddress("fractionToken");
        if (_creator          == address(0)) revert ZeroAddress("creator");
        if (_platformTreasury == address(0)) revert ZeroAddress("platformTreasury");
        if (_admin            == address(0)) revert ZeroAddress("admin");
        require(_targetCap         > 0, "BondingCurveAMM: zero targetCap");
        require(_initialVirtualETH > 0, "BondingCurveAMM: zero initialVirtualETH");
        if (_platformFeeRate + _creatorFeeRate > MAX_FEE_BPS)
            revert FeeTooHigh(_platformFeeRate + _creatorFeeRate, MAX_FEE_BPS);

        // ── Assign storage (thay thế immutable) ──────────────────────────────
        fractionToken       = IArtFractionToken(_fractionToken);
        artworkId           = _artworkId;
        creator             = _creator;
        platformTreasury    = _platformTreasury;
        initialVirtualPoolX = _initialVirtualETH;
        initialTargetCap    = _targetCap;

        // ── Assign fee rates ──────────────────────────────────────────────────
        platformFeeRate = _platformFeeRate;
        creatorFeeRate  = _creatorFeeRate;

        // ── Khởi tạo Pool ─────────────────────────────────────────────────────
        // k = _initialVirtualETH * _targetCap = hằng số
        // Giá ban đầu = _initialVirtualETH * 1e18 / _targetCap
        pool = Pool({
            virtualPoolX: _initialVirtualETH,  // Virtual ETH (không phải real ETH)
            virtualPoolY: _targetCap,           // Tất cả shares bắt đầu ở trạng thái "available"
            targetCap:    _targetCap,
            soldSupply:   0,
            state:        CurveState.ACTIVE
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WRITE — Hàm giao dịch
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Mua `amountOut` shares của artwork này.
     * @dev    Tuân thủ CEI: Checks → Effects → Interactions
     *         Security: nonReentrant, slippage guard, refund excess ETH
     *
     * @param amountOut   Số shares muốn mua (>0)
     * @param maxEthIn    Tối đa ETH chấp nhận trả — bảo vệ chống MEV/slippage.
     *                    Frontend tính bằng getBuyPrice() + slippage %, gọi với msg.value = maxEthIn.
     */
    function buyShares(
        uint256 amountOut,
        uint256 maxEthIn
    ) external payable nonReentrant {

        // ── CHECKS ────────────────────────────────────────────────────────────
        Pool storage p = pool; // 1 SLOAD
        if (p.state != CurveState.ACTIVE) revert NotActive();
        if (amountOut == 0)               revert ZeroAmount();

        uint256 available = p.targetCap - p.soldSupply;
        if (amountOut > available) revert ExceedsTargetCap(amountOut, available);

        // ── Tính giá theo Constant Product AMM ───────────────────────────────
        // ethCost = X * amountOut / (Y - amountOut)
        // QUY TẮC: Nhân trước khi chia (tránh integer underflow)
        uint256 ethCost = (p.virtualPoolX * amountOut) / (p.virtualPoolY - amountOut);

        // Fee tính trên ethCost (ngoài cost, cộng thêm vào)
        uint256 platformFee = (ethCost * platformFeeRate) / 10_000;
        uint256 creatorFee  = (ethCost * creatorFeeRate)  / 10_000;
        uint256 totalCost   = ethCost + platformFee + creatorFee;

        // Slippage protection: tổng chi phí không được vượt maxEthIn
        if (totalCost > maxEthIn)   revert SlippageBuy(totalCost, maxEthIn);
        // msg.value phải đủ trả totalCost
        if (msg.value < totalCost)  revert SlippageBuy(msg.value, totalCost);

        // ── EFFECTS (state changes TRƯỚC interactions) ────────────────────────
        // Cập nhật virtual pool theo công thức constant product:
        // X' = X + ethCost  (virtual ETH tăng)
        // Y' = Y - amountOut (virtual shares giảm)
        // k = X * Y = X' * Y' (bất biến, kiểm tra bằng getInvariant())
        p.virtualPoolX += ethCost;
        p.virtualPoolY -= amountOut;
        p.soldSupply   += amountOut;

        // Track real ETH (chỉ ethCost — không phải fee vì fee sẽ chuyển ra ngay)
        realEthBalance += ethCost;

        // Spot price sau giao dịch (scaled x 1e18 để backend đọc được)
        uint256 spotPrice = (p.virtualPoolX * PRECISION) / p.virtualPoolY;

        // Graduation condition: sold tất cả targetCap
        bool shouldGraduate = (p.soldSupply >= p.targetCap);
        if (shouldGraduate) {
            p.state = CurveState.TARGET_REACHED;
        }

        // ── INTERACTIONS (external calls SAU state changes) ───────────────────
        // 1. Mint fraction tokens cho buyer
        fractionToken.mint(msg.sender, artworkId, amountOut, "");

        // 2. Phân phối fee (pull pattern: dùng call, không dùng transfer)
        if (platformFee > 0) _safeTransferETH(platformTreasury, platformFee);
        if (creatorFee  > 0) _safeTransferETH(creator, creatorFee);

        // 3. Hoàn ETH thừa cho người mua
        uint256 refund = msg.value - totalCost;
        if (refund > 0) _safeTransferETH(msg.sender, refund);

        // 4. Emit events
        emit Trade(msg.sender, artworkId, true, amountOut, ethCost, spotPrice);

        if (shouldGraduate) {
            emit GraduatedToDEX(artworkId, realEthBalance);
        }
    }

    /**
     * @notice Bán `amountIn` shares để nhận ETH.
     * @dev    Tuân thủ CEI: Checks → Effects → Interactions
     *         Security: nonReentrant, slippage guard
     *
     * @param amountIn   Số shares muốn bán (>0)
     * @param minEthOut  Tối thiểu ETH muốn nhận — bảo vệ chống slippage.
     *                   Frontend tính bằng getSellPrice() - slippage %.
     */
    function sellShares(
        uint256 amountIn,
        uint256 minEthOut
    ) external nonReentrant {

        // ── CHECKS ────────────────────────────────────────────────────────────
        Pool storage p = pool;
        if (p.state != CurveState.ACTIVE) revert NotActive();
        if (amountIn == 0)                revert ZeroAmount();

        // Kiểm tra balance người bán
        uint256 sellerBalance = fractionToken.balanceOf(msg.sender, artworkId);
        if (sellerBalance < amountIn) revert InsufficientShares(sellerBalance, amountIn);

        // ── Tính ETH trả về theo Constant Product AMM ────────────────────────
        // ethOut = X * amountIn / (Y + amountIn)
        // QUY TẮC: Nhân trước khi chia
        uint256 ethOut = (p.virtualPoolX * amountIn) / (p.virtualPoolY + amountIn);

        // Fee lấy từ ethOut (trừ vào trước khi trả seller)
        uint256 platformFee = (ethOut * platformFeeRate) / 10_000;
        uint256 creatorFee  = (ethOut * creatorFeeRate)  / 10_000;
        uint256 netEthOut   = ethOut - platformFee - creatorFee;

        // Slippage protection
        if (netEthOut < minEthOut) revert SlippageSell(netEthOut, minEthOut);

        // Kiểm tra pool có đủ ETH thực để trả
        // Dùng realEthBalance (không phải address(this).balance) để tránh force-send attack
        if (realEthBalance < ethOut) revert InsufficientPoolLiquidity(realEthBalance, ethOut);

        // ── EFFECTS ───────────────────────────────────────────────────────────
        p.virtualPoolX -= ethOut;    // Virtual ETH giảm
        p.virtualPoolY += amountIn;  // Virtual shares tăng
        p.soldSupply   -= amountIn;

        realEthBalance -= ethOut;

        uint256 spotPrice = (p.virtualPoolX * PRECISION) / p.virtualPoolY;

        // ── INTERACTIONS ──────────────────────────────────────────────────────
        // 1. Burn tokens TRƯỚC khi gửi ETH (CEI — ngăn reentrancy từ ERC-1155)
        fractionToken.burn(msg.sender, artworkId, amountIn);

        // 2. Fee
        if (platformFee > 0) _safeTransferETH(platformTreasury, platformFee);
        if (creatorFee  > 0) _safeTransferETH(creator, creatorFee);

        // 3. Gửi ETH cho người bán
        _safeTransferETH(msg.sender, netEthOut);

        // 4. Emit
        emit Trade(msg.sender, artworkId, false, amountIn, netEthOut, spotPrice);
    }

    /**
     * @notice Chuyển pool sang trạng thái GRADUATED — kết thúc vòng đời vAMM.
     * @dev    Có thể gọi khi state == TARGET_REACHED.
     *         Phase 2: sẽ tích hợp migrate thanh khoản sang Uniswap V2/V3.
     *         Hiện tại: chỉ đổi state + emit event.
     *
     *         Ai được gọi? Owner (ArtFactory) hoặc bất kỳ ai nếu đã TARGET_REACHED
     *         → thiết kế permissionless graduation, tránh factory bị DoS
     */
    function graduateToDEX() external {
        Pool storage p = pool;

        if (p.state == CurveState.GRADUATED) revert AlreadyGraduated();

        // Cho phép gọi khi TARGET_REACHED
        // Hoặc khi ACTIVE mà soldSupply đã đạt targetCap (edge case: graduation bị bỏ lỡ)
        if (p.state == CurveState.ACTIVE && p.soldSupply < p.targetCap) {
            revert NotGraduatable();
        }

        // ── EFFECTS ───────────────────────────────────────────────────────────
        p.state = CurveState.GRADUATED;

        // ── Placeholder: Migrate Liquidity (Phase 2) ──────────────────────────
        // TODO Phase 2:
        //   1. Wrap ETH → WETH
        //   2. Approve Uniswap V2 Router
        //   3. addLiquidityETH() → tạo LP pair (FractionToken / ETH)
        //   4. Burn LP tokens (chống rug-pull theo State Machine Diagram)

        emit GraduatedToDEX(artworkId, realEthBalance);
    }

    // ── Admin ──────────────────────────────────────────────────────────────────

    /**
     * @notice Cập nhật fee rate — chỉ Owner (ArtFactory) gọi được.
     * @dev    Không ảnh hưởng retroactively đến giao dịch đang xử lý.
     */
    function updateFeeRates(
        uint256 newPlatformFeeRate,
        uint256 newCreatorFeeRate
    ) external onlyOwner {
        if (newPlatformFeeRate + newCreatorFeeRate > MAX_FEE_BPS)
            revert FeeTooHigh(newPlatformFeeRate + newCreatorFeeRate, MAX_FEE_BPS);
        platformFeeRate = newPlatformFeeRate;
        creatorFeeRate  = newCreatorFeeRate;
        emit FeeRateUpdated(newPlatformFeeRate, newCreatorFeeRate);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // READ — View functions (cho Frontend + Backend)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Tính chi phí ETH để mua `amountOut` shares (bao gồm fee).
     * @return ethCost    ETH cost thuần (không fee) — cũng là ethAmount trong Trade event
     * @return totalCost  Tổng ETH cần gửi (ethCost + fees) — dùng làm msg.value
     */
    function getBuyPrice(uint256 amountOut)
        external
        view
        returns (uint256 ethCost, uint256 totalCost)
    {
        Pool storage p = pool;
        if (p.state != CurveState.ACTIVE)           return (0, 0);
        if (amountOut == 0)                         return (0, 0);
        if (amountOut > p.targetCap - p.soldSupply) return (0, 0);

        ethCost   = (p.virtualPoolX * amountOut) / (p.virtualPoolY - amountOut);
        // Tính fee riêng từng loại — khớp chính xác với buyShares (tránh off-by-1 do int div)
        uint256 pFee = (ethCost * platformFeeRate) / 10_000;
        uint256 cFee = (ethCost * creatorFeeRate)  / 10_000;
        totalCost = ethCost + pFee + cFee;
    }

    /**
     * @notice Tính ETH nhận được khi bán `amountIn` shares (sau fee).
     * @return ethOut     ETH trả về trước fee
     * @return netEthOut  ETH thực nhận sau fee — dùng làm minEthOut
     */
    function getSellPrice(uint256 amountIn)
        external
        view
        returns (uint256 ethOut, uint256 netEthOut)
    {
        Pool storage p = pool;
        if (p.state != CurveState.ACTIVE) return (0, 0);
        if (amountIn == 0)               return (0, 0);

        ethOut    = (p.virtualPoolX * amountIn) / (p.virtualPoolY + amountIn);
        // Tính fee riêng từng loại — khớp chính xác với sellShares (tránh off-by-1 do int div)
        uint256 pFee = (ethOut * platformFeeRate) / 10_000;
        uint256 cFee = (ethOut * creatorFeeRate)  / 10_000;
        uint256 totalFee = pFee + cFee;
        netEthOut = ethOut > totalFee ? ethOut - totalFee : 0;
    }

    /**
     * @notice Giá spot hiện tại (ETH per share, scaled x PRECISION).
     * @dev    Dùng để hiển thị giá real-time trên frontend.
     *         Backend (Redis) cache giá này sau mỗi Trade event.
     */
    function getCurrentPrice() external view returns (uint256) {
        Pool storage p = pool;
        if (p.virtualPoolY == 0) return type(uint256).max;
        return (p.virtualPoolX * PRECISION) / p.virtualPoolY;
    }

    /**
     * @notice Tính spot price tại một mức supply cụ thể.
     * @dev    Dùng để vẽ bonding curve chart trên frontend (không cần contract call lúc trade).
     *         Công thức: k = initialX * targetCap
     *                    X_at_sold = k / (targetCap - sold)
     *                    price     = X_at_sold * PRECISION / (targetCap - sold)
     *                              = k * PRECISION / (targetCap - sold)^2
     * @param soldAmount  Số shares đã bán (0 → targetCap - 1)
     */
    function calculatePrice(uint256 soldAmount) external view returns (uint256) {
        uint256 remaining = initialTargetCap - soldAmount;
        if (remaining == 0) return type(uint256).max;

        // k = initialVirtualPoolX * initialTargetCap
        // X_at_sold = k / remaining = initialVirtualPoolX * initialTargetCap / remaining
        // price = X_at_sold * PRECISION / remaining
        //       = initialVirtualPoolX * initialTargetCap * PRECISION / remaining^2
        // RULE: nhân trước chia
        uint256 k        = initialVirtualPoolX * initialTargetCap;
        uint256 xAtSold  = k / remaining;
        return (xAtSold * PRECISION) / remaining;
    }

    /**
     * @notice Kiểm tra hằng số k = X * Y có được giữ nguyên.
     * @dev    Dùng để test invariant (forge invariant test).
     */
    function getInvariant() external view returns (uint256) {
        return pool.virtualPoolX * pool.virtualPoolY;
    }

    /**
     * @notice Trả về toàn bộ Pool struct — dùng cho backend hoặc frontend.
     */
    function getPoolInfo() external view returns (Pool memory) {
        return pool;
    }

    // ── Internal helpers ───────────────────────────────────────────────────────

    /**
     * @dev Safe ETH transfer dùng low-level call (không giới hạn gas như transfer).
     *      CEI: Caller phải cập nhật state TRƯỚC khi gọi hàm này.
     *      Vulnerability note: ERC-1155 onERC1155Received có thể re-enter →
     *      ReentrancyGuard đã bảo vệ tầng ngoài.
     */
    function _safeTransferETH(address to, uint256 amount) internal {
        (bool success, ) = payable(to).call{value: amount}("");
        if (!success) revert ETHTransferFailed(to, amount);
    }

    // ── Receive ETH ────────────────────────────────────────────────────────────

    /**
     * @dev Cho phép contract nhận ETH trực tiếp (từ ArtFactory hoặc seed liquidity).
     *      Không cập nhật realEthBalance ở đây — chỉ buyShares mới cập nhật.
     */
    receive() external payable {}
}
