// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import { ArtFactory }       from "../src/ArtFactory.sol";
import { ArtFractionToken } from "../src/ArtFractionToken.sol";
import { BondingCurveAMM }  from "../src/BondingCurveAMM.sol";

/**
 * @title  BondingCurveAMMTest
 * @notice Kiểm thử toán học AMM, slippage guard, refund, state machine,
 *         fuzzing invariants và bảo mật.
 *
 *  Pool chuẩn của test suite này:
 *    targetCap          = 1 000 shares
 *    initialVirtualETH  = 1 ether   → giá khởi điểm ≈ 0.001 ETH/share
 *    platformFeeRate    = 200 bps   (2%)
 *    creatorFeeRate     = 100 bps   (1%)
 *    k = 1 ether × 1 000 = 1 000e18   (bất biến)
 *
 *  Mua amountOut shares:
 *    ethCost   = X × amountOut / (Y − amountOut)    [integer div, floors]
 *    totalCost = ethCost × (1 + 0.02 + 0.01)        = ethCost × 10 300 / 10 000
 *
 *  Bán amountIn shares:
 *    ethOut    = X × amountIn  / (Y + amountIn)
 *    netEthOut = ethOut × (1 − 0.02 − 0.01)         = ethOut × 9 700 / 10 000
 *
 *  Invariant quan trọng:
 *    realEthBalance += ethCost  (KHÔNG phải totalCost — fee chảy ra ngoài)
 *    realEthBalance -= ethOut   (KHÔNG phải netEthOut — fee chảy ra ngoài)
 */
contract BondingCurveAMMTest is Test {

    // ── Contracts ──────────────────────────────────────────────────────────────
    ArtFactory       public factory;
    ArtFractionToken public token;
    BondingCurveAMM  public amm;

    // ── Actors ─────────────────────────────────────────────────────────────────
    address constant ADMIN    = address(0xA0);
    address constant TREASURY = address(0xFEE1);
    address constant CREATOR  = address(0xC1);
    address constant ALICE    = address(0xAA);
    address constant BOB      = address(0xBB);

    // ── Config ─────────────────────────────────────────────────────────────────
    uint256 constant PLATFORM_FEE     = 200;        // 2%
    uint256 constant CREATOR_FEE      = 100;        // 1%
    uint256 constant TARGET_CAP       = 1_000;
    uint256 constant INITIAL_VIRT_ETH = 1 ether;    // giá ban đầu = 1e18/1000 = 0.001 ETH/share
    uint256 constant ARTWORK_ID       = 1;

    // ── Mirror events ──────────────────────────────────────────────────────────
    event Trade(
        address indexed user,
        uint256 indexed artworkId_,
        bool    isBuy,
        uint256 shareAmount,
        uint256 ethAmount,
        uint256 price
    );
    event GraduatedToDEX(uint256 indexed artworkId_, uint256 totalLiquidity);

    // ══════════════════════════════════════════════════════════════════════════
    //  SETUP
    // ══════════════════════════════════════════════════════════════════════════

    function setUp() public {
        // Deploy implementations
        ArtFractionToken tokenImpl = new ArtFractionToken();
        BondingCurveAMM  ammImpl   = new BondingCurveAMM();

        // Deploy factory
        factory = new ArtFactory(
            address(tokenImpl),
            address(ammImpl),
            PLATFORM_FEE,
            TREASURY,
            CREATOR_FEE,
            ADMIN
        );

        // Tạo artwork đầu tiên
        vm.prank(CREATOR);
        (address ammClone, address tokenClone) = factory.createArtwork(
            "QmTestArtwork001",
            TARGET_CAP,
            0  // dùng defaultCreatorFeeRate = 100
        );

        amm   = BondingCurveAMM(payable(ammClone));
        token = ArtFractionToken(tokenClone);

        // Fund Alice và Bob
        vm.deal(ALICE, 500 ether);
        vm.deal(BOB,   500 ether);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  HELPERS
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * @dev Tính ethCost và totalCost thuần theo công thức AMM.
     *      Dùng separate fee calculation để khớp chính xác với getBuyPrice() và buyShares().
     *      (integer division floor trên từng fee riêng biệt → không bao giờ lệch 1 wei)
     */
    function _calcBuyCost(
        uint256 poolX,
        uint256 poolY,
        uint256 amountOut
    ) internal pure returns (uint256 ethCost, uint256 totalCost) {
        ethCost      = (poolX * amountOut) / (poolY - amountOut);
        uint256 pFee = (ethCost * PLATFORM_FEE) / 10_000;
        uint256 cFee = (ethCost * CREATOR_FEE)  / 10_000;
        totalCost    = ethCost + pFee + cFee;
    }

    // ── Storage slot helpers ────────────────────────────────────────────────────
    // BondingCurveAMM (OZ v5 Upgradeable → EIP-7201 namespaced storage cho base contracts)
    // Contract's own variables bắt đầu từ slot 0:
    //   slot 0: fractionToken (address)
    //   slot 1: artworkId
    //   slot 2: creator
    //   slot 3: platformTreasury
    //   slot 4: initialVirtualPoolX
    //   slot 5: initialTargetCap
    //   slot 6: pool.virtualPoolX
    //   slot 7: pool.virtualPoolY
    //   slot 8: pool.targetCap
    //   slot 9: pool.soldSupply
    //   slot 10: pool.state (enum uint8)
    //   slot 11: platformFeeRate
    //   slot 12: creatorFeeRate
    //   slot 13: realEthBalance
    uint256 constant SLOT_POOL_SOLD_SUPPLY = 9;
    uint256 constant SLOT_POOL_STATE       = 10;

    /**
     * @dev Force-set pool state về TARGET_REACHED và soldSupply = targetCap.
     *      Dùng cho graduation tests vì constant product AMM không thể drain pool
     *      hoàn toàn qua normal trading (Y - amountOut = 0 → division by zero).
     */
    function _forceTargetReached(address ammAddr, uint256 cap) internal {
        vm.store(ammAddr, bytes32(SLOT_POOL_SOLD_SUPPLY), bytes32(cap));
        vm.store(ammAddr, bytes32(SLOT_POOL_STATE), bytes32(uint256(1))); // TARGET_REACHED = 1
    }

    /**
     * @dev Alice mua `amount` shares với đúng giá getBuyPrice → không có refund.
     */
    function _aliceBuys(uint256 amount) internal returns (uint256 ethCost, uint256 totalCost) {
        (ethCost, totalCost) = amm.getBuyPrice(amount);
        vm.prank(ALICE);
        amm.buyShares{value: totalCost}(amount, totalCost);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  TEST: Trạng thái Pool ban đầu
    // ══════════════════════════════════════════════════════════════════════════

    function test_InitialPoolState() public view {
        BondingCurveAMM.Pool memory p = amm.getPoolInfo();
        assertEq(p.virtualPoolX, INITIAL_VIRT_ETH, "initialVirtualPoolX");
        assertEq(p.virtualPoolY, TARGET_CAP,        "initialVirtualPoolY");
        assertEq(p.targetCap,   TARGET_CAP,         "targetCap");
        assertEq(p.soldSupply,  0,                  "soldSupply=0");
        assertEq(uint256(p.state), uint256(BondingCurveAMM.CurveState.ACTIVE), "state=ACTIVE");
        assertEq(amm.realEthBalance(), 0,           "realEthBalance=0");
    }

    function test_InitialPrice_MatchesFormula() public view {
        // Spot = virtualPoolX * 1e18 / virtualPoolY = 1e18 * 1e18 / 1000 = 1e15
        uint256 expected = (INITIAL_VIRT_ETH * 1e18) / TARGET_CAP;
        assertEq(amm.getCurrentPrice(), expected, "initial spot price");
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  TEST: buyShares — Trạng thái & toán học
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Sau khi mua `amount` shares, pool state phải cập nhật chính xác.
     */
    function test_BuyShares_UpdatesPoolState() public {
        uint256 amount = 10;
        (uint256 ethCost, uint256 totalCost) = amm.getBuyPrice(amount);

        // Cross-check getBuyPrice với công thức offline
        (uint256 offCost, uint256 offTotal) = _calcBuyCost(
            INITIAL_VIRT_ETH, TARGET_CAP, amount
        );
        assertEq(ethCost,   offCost,  "getBuyPrice ethCost matches formula");
        assertEq(totalCost, offTotal, "getBuyPrice totalCost matches formula");

        vm.prank(ALICE);
        amm.buyShares{value: totalCost}(amount, totalCost);

        BondingCurveAMM.Pool memory p = amm.getPoolInfo();
        assertEq(p.soldSupply,  amount,                        "soldSupply");
        assertEq(p.virtualPoolX, INITIAL_VIRT_ETH + ethCost,   "virtualPoolX increased");
        assertEq(p.virtualPoolY, TARGET_CAP - amount,           "virtualPoolY decreased");
        assertEq(uint256(p.state), uint256(BondingCurveAMM.CurveState.ACTIVE), "still ACTIVE");
    }

    /**
     * @notice realEthBalance chỉ tăng bằng ethCost — KHÔNG phải totalCost.
     *         Fee (platformFee + creatorFee) chảy ra ngoài ngay lập tức.
     *         Đây là bất biến bảo mật: force-send ETH không inflate được realEthBalance.
     */
    function test_BuyShares_RealEthBalance_EqualsToCostNotTotal() public {
        uint256 amount = 25;
        (uint256 ethCost, uint256 totalCost) = amm.getBuyPrice(amount);

        assertGt(totalCost, ethCost, "totalCost > ethCost (fee exists)");

        vm.prank(ALICE);
        amm.buyShares{value: totalCost}(amount, totalCost);

        // realEthBalance == ethCost (không phải totalCost)
        assertEq(amm.realEthBalance(), ethCost, "realEthBalance == ethCost only");

        // Fee đã chuyển ra: balance của treasury và creator tăng
        uint256 pFee = (ethCost * PLATFORM_FEE) / 10_000;
        uint256 cFee = (ethCost * CREATOR_FEE)  / 10_000;
        assertEq(address(TREASURY).balance, pFee, "treasury received platformFee");
        assertEq(address(CREATOR).balance,  cFee, "creator received creatorFee");
    }

    /**
     * @notice Token balance của buyer phải bằng đúng số shares mua.
     */
    function test_BuyShares_MintsFractionTokens() public {
        uint256 amount = 50;
        _aliceBuys(amount);
        assertEq(token.balanceOf(ALICE, ARTWORK_ID), amount, "alice token balance");
    }

    /**
     * @notice Bất biến k = X × Y: Sau mỗi trade, k chỉ có thể giảm hoặc giữ nguyên
     *         (do integer division floors ethCost xuống, X tăng ít hơn cần thiết).
     *         k KHÔNG BAO GIỜ tăng sau khi mua.
     */
    function test_BuyShares_KInvariant_NeverIncreases() public {
        uint256 kBefore = amm.getInvariant();
        _aliceBuys(30);
        uint256 kAfter = amm.getInvariant();

        assertLe(kAfter, kBefore, "k must not increase after buy");
    }

    /**
     * @notice Spot price PHẢI tăng sau khi mua (bonding curve).
     */
    function test_BuyShares_PriceIncreases() public {
        uint256 priceBefore = amm.getCurrentPrice();
        _aliceBuys(50);
        uint256 priceAfter = amm.getCurrentPrice();

        assertGt(priceAfter, priceBefore, "price must increase after buy");
    }

    /**
     * @notice Trade event phải emit với đúng giá trị.
     */
    function test_BuyShares_EmitsTradeEvent() public {
        uint256 amount = 10;
        (uint256 ethCost, uint256 totalCost) = amm.getBuyPrice(amount);

        // Tính spotPrice sau khi state thay đổi
        uint256 newX = INITIAL_VIRT_ETH + ethCost;
        uint256 newY = TARGET_CAP - amount;
        uint256 expectedSpot = (newX * 1e18) / newY;

        vm.expectEmit(true, true, true, true, address(amm));
        emit Trade(ALICE, ARTWORK_ID, true, amount, ethCost, expectedSpot);

        vm.prank(ALICE);
        amm.buyShares{value: totalCost}(amount, totalCost);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  TEST: Refund — Trả lại ETH thừa chính xác đến wei
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Gửi msg.value lớn hơn totalCost → contract phải hoàn lại chính xác
     *         (msg.value - totalCost) wei. Không được giữ lại 1 wei thừa.
     */
    function test_RefundMechanism_ExactToWei() public {
        uint256 amount = 10;
        (uint256 ethCost, uint256 totalCost) = amm.getBuyPrice(amount);

        uint256 extraSent   = 5 ether;
        uint256 msgValue    = totalCost + extraSent;
        uint256 aliceBefore = ALICE.balance;

        vm.prank(ALICE);
        amm.buyShares{value: msgValue}(amount, msgValue);

        uint256 aliceAfter = ALICE.balance;

        // Alice mất đúng totalCost (không mất thêm 1 wei)
        assertEq(aliceBefore - aliceAfter, totalCost, "alice net spend == totalCost");

        // realEthBalance không bị inflate bởi ETH thừa
        assertEq(amm.realEthBalance(), ethCost, "realEthBalance == ethCost");
    }

    /**
     * @notice Gửi đúng totalCost → refund == 0, không có ETH thừa.
     */
    function test_RefundMechanism_NoRefundWhenExact() public {
        uint256 amount = 10;
        (,uint256 totalCost) = amm.getBuyPrice(amount);
        uint256 aliceBefore = ALICE.balance;

        vm.prank(ALICE);
        amm.buyShares{value: totalCost}(amount, totalCost);

        assertEq(ALICE.balance, aliceBefore - totalCost, "no extra refund when exact");
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  TEST: Slippage Protection
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * @notice maxEthIn thấp hơn totalCost thực tế → revert SlippageBuy.
     *         Đây là lớp bảo vệ chính chống Sandwich Attack.
     */
    function test_SlippageProtection_Buy_RevertsWhenMaxExceeded() public {
        uint256 amount = 10;
        (,uint256 totalCost) = amm.getBuyPrice(amount);
        uint256 tooLow = totalCost - 1; // 1 wei ít hơn

        vm.expectRevert(
            abi.encodeWithSelector(
                BondingCurveAMM.SlippageBuy.selector,
                totalCost,  // cost
                tooLow      // maxAllowed
            )
        );
        vm.prank(ALICE);
        amm.buyShares{value: totalCost}(amount, tooLow);
    }

    /**
     * @notice msg.value thấp hơn totalCost → revert (không đủ ETH để trả).
     */
    function test_SlippageProtection_Buy_InsufficientMsgValue() public {
        uint256 amount = 10;
        (,uint256 totalCost) = amm.getBuyPrice(amount);

        vm.expectRevert(); // SlippageBuy
        vm.prank(ALICE);
        amm.buyShares{value: totalCost - 1}(amount, totalCost);
    }

    /**
     * @notice minEthOut cao hơn netEthOut thực tế → revert SlippageSell.
     */
    function test_SlippageProtection_Sell_RevertsWhenBelowMin() public {
        // Alice mua trước
        _aliceBuys(20);

        uint256 sellAmount = 10;
        (,uint256 netEthOut) = amm.getSellPrice(sellAmount);
        uint256 tooHigh = netEthOut + 1; // kỳ vọng cao hơn thực tế 1 wei

        vm.expectRevert(
            abi.encodeWithSelector(
                BondingCurveAMM.SlippageSell.selector,
                netEthOut,
                tooHigh
            )
        );
        vm.prank(ALICE);
        amm.sellShares(sellAmount, tooHigh);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  TEST: sellShares — Toán học & Trạng thái
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Sau khi bán, pool state và realEthBalance phải cập nhật đúng.
     *         realEthBalance giảm bằng ethOut (không phải netEthOut).
     */
    function test_SellShares_UpdatesState() public {
        uint256 buyAmt = 50;
        _aliceBuys(buyAmt); // ethCost không cần lưu — đọc trực tiếp từ realEthBalance

        uint256 sellAmt = 20;
        (uint256 ethOut, uint256 netEthOut) = amm.getSellPrice(sellAmt);

        uint256 aliceBefore   = ALICE.balance;
        uint256 realBalBefore = amm.realEthBalance(); // = ethCost của lệnh mua trước

        vm.prank(ALICE);
        amm.sellShares(sellAmt, netEthOut);

        // Token burn
        assertEq(token.balanceOf(ALICE, ARTWORK_ID), buyAmt - sellAmt, "token balance after sell");

        // realEthBalance giảm bằng ethOut (fee chảy ra ngoài)
        assertEq(amm.realEthBalance(), realBalBefore - ethOut, "realEthBalance after sell");

        // Alice nhận netEthOut
        assertEq(ALICE.balance, aliceBefore + netEthOut, "alice receives netEthOut");

        // Pool soldSupply giảm
        BondingCurveAMM.Pool memory p = amm.getPoolInfo();
        assertEq(p.soldSupply, buyAmt - sellAmt, "soldSupply after sell");
    }

    /**
     * @notice Spot price PHẢI giảm sau khi bán.
     */
    function test_SellShares_PriceDecreases() public {
        _aliceBuys(50);
        uint256 priceBefore = amm.getCurrentPrice();

        (,uint256 minEthOut) = amm.getSellPrice(20);
        vm.prank(ALICE);
        amm.sellShares(20, minEthOut);

        assertLt(amm.getCurrentPrice(), priceBefore, "price must decrease after sell");
    }

    /**
     * @notice Bán nhiều hơn balance → revert InsufficientShares.
     */
    function test_SellShares_RevertIfInsufficientBalance() public {
        _aliceBuys(10);

        vm.expectRevert(
            abi.encodeWithSelector(
                BondingCurveAMM.InsufficientShares.selector,
                10, // have
                11  // want
            )
        );
        vm.prank(ALICE);
        amm.sellShares(11, 0);
    }

    /**
     * @notice Bán 0 shares → revert ZeroAmount.
     */
    function test_SellShares_RevertOnZeroAmount() public {
        _aliceBuys(10);
        vm.expectRevert(BondingCurveAMM.ZeroAmount.selector);
        vm.prank(ALICE);
        amm.sellShares(0, 0);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  TEST: State Machine — Graduation
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Khi soldSupply = targetCap (force-set via vm.store), state = TARGET_REACHED.
     *
     * @dev    Lý do dùng vm.store thay vì mua hết shares:
     *         Constant product AMM: ethCost = X * n / (Y - n).
     *         Khi n = Y (mua tất cả), mẫu số = 0 → panic division by zero.
     *         Đây là tính chất toán học của CPAMM — pool không bao giờ bị drain hoàn toàn.
     *         Trong production, graduation sẽ được trigger bởi Factory/Admin sau khi
     *         soldSupply tiếp cận targetCap qua nhiều giao dịch nhỏ.
     */
    function test_ForceTargetReached_StateIsCorrect() public {
        _aliceBuys(10); // mua một ít để có realEthBalance
        uint256 realBal = amm.realEthBalance();

        _forceTargetReached(address(amm), TARGET_CAP);

        BondingCurveAMM.Pool memory p = amm.getPoolInfo();
        assertEq(uint256(p.state), uint256(BondingCurveAMM.CurveState.TARGET_REACHED), "TARGET_REACHED");
        assertEq(p.soldSupply, TARGET_CAP, "soldSupply = targetCap");
        // realEthBalance không bị ảnh hưởng bởi vm.store
        assertEq(amm.realEthBalance(), realBal, "realEthBalance unchanged");
    }

    /**
     * @notice Sau TARGET_REACHED, mua thêm phải revert NotActive.
     */
    function test_BuyShares_RevertWhenNotActive() public {
        _forceTargetReached(address(amm), TARGET_CAP);

        vm.expectRevert(BondingCurveAMM.NotActive.selector);
        vm.prank(BOB);
        amm.buyShares{value: 1 ether}(1, 1 ether);
    }

    /**
     * @notice graduateToDEX() chuyển state → GRADUATED khi TARGET_REACHED.
     *         Permissionless: bất kỳ ai cũng có thể trigger.
     */
    function test_GraduateToDEX_SucceedsWhenTargetReached() public {
        _forceTargetReached(address(amm), TARGET_CAP);

        amm.graduateToDEX();

        BondingCurveAMM.Pool memory p = amm.getPoolInfo();
        assertEq(uint256(p.state), uint256(BondingCurveAMM.CurveState.GRADUATED), "GRADUATED");
    }

    /**
     * @notice graduateToDEX() khi ACTIVE nhưng soldSupply < targetCap → revert NotGraduatable.
     */
    function test_GraduateToDEX_RevertWhenActive() public {
        _aliceBuys(10);

        vm.expectRevert(BondingCurveAMM.NotGraduatable.selector);
        amm.graduateToDEX();
    }

    /**
     * @notice Gọi graduateToDEX() lần 2 → revert AlreadyGraduated.
     */
    function test_GraduateToDEX_RevertWhenAlreadyGraduated() public {
        _forceTargetReached(address(amm), TARGET_CAP);
        amm.graduateToDEX(); // lần 1

        vm.expectRevert(BondingCurveAMM.AlreadyGraduated.selector);
        amm.graduateToDEX(); // lần 2
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  TEST: Force-Send ETH — Security
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Kẻ tấn công dùng selfdestruct để force-send ETH vào contract.
     *         realEthBalance KHÔNG thay đổi → không thể inflate pool.
     *         Chỉ address(amm).balance tăng, nhưng logic không dùng balance.
     */
    function test_ForceSendETH_DoesNotAffectRealEthBalance() public {
        _aliceBuys(10);
        uint256 realBefore = amm.realEthBalance();

        // Simulate selfdestruct force-send 10 ether
        vm.deal(address(amm), address(amm).balance + 10 ether);

        // realEthBalance vẫn không đổi
        assertEq(amm.realEthBalance(), realBefore, "force-send does not affect realEthBalance");
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  TEST: buyShares Amount = 0
    // ══════════════════════════════════════════════════════════════════════════

    function test_BuyShares_RevertOnZeroAmount() public {
        vm.expectRevert(BondingCurveAMM.ZeroAmount.selector);
        vm.prank(ALICE);
        amm.buyShares{value: 1 ether}(0, 1 ether);
    }

    function test_BuyShares_RevertOnExceedsTargetCap() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                BondingCurveAMM.ExceedsTargetCap.selector,
                TARGET_CAP + 1,
                TARGET_CAP
            )
        );
        vm.prank(ALICE);
        // 1 ether < Alice's 500 ether balance, ExceedsTargetCap fires trước khi ETH di chuyển
        amm.buyShares{value: 1 ether}(TARGET_CAP + 1, 1 ether);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  TEST: calculatePrice — Bonding Curve Chart
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * @notice calculatePrice(0) == getCurrentPrice() khi soldSupply == 0.
     */
    function test_CalculatePrice_AtZeroSold_MatchesInitialSpot() public view {
        uint256 initialSpot = amm.getCurrentPrice();
        uint256 calcAtZero  = amm.calculatePrice(0);
        assertEq(calcAtZero, initialSpot, "calculatePrice(0) matches initial spot");
    }

    /**
     * @notice calculatePrice tăng đơn điệu theo soldAmount.
     */
    function test_CalculatePrice_MonotonicallyIncreasing() public view {
        uint256 p100 = amm.calculatePrice(100);
        uint256 p500 = amm.calculatePrice(500);
        uint256 p900 = amm.calculatePrice(900);

        assertLt(p100, p500, "price at 100 < price at 500");
        assertLt(p500, p900, "price at 500 < price at 900");
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  FUZZ TEST: buyShares — Invariants toán học với dữ liệu ngẫu nhiên
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Fuzz test toàn diện: với mọi lượng shares hợp lệ [1, 50]:
     *   1. getBuyPrice khớp với công thức offline
     *   2. realEthBalance == ethCost sau mua (không phải totalCost)
     *   3. soldSupply tăng đúng amountOut
     *   4. virtualPoolX = initialX + ethCost
     *   5. virtualPoolY = initialY - amountOut
     *   6. k (X×Y) không tăng sau giao dịch
     *   7. Alice nhận đúng shares
     *   8. Alice trả đúng totalCost (không thêm không bớt)
     *
     * @dev Bound [1, 50]: tránh edge case gần targetCap. setUp() reset giữa mỗi run.
     */
    function testFuzz_BuyShares_AllInvariants(uint256 amount) public {
        // Bound trong khoảng an toàn — không gần targetCap để tránh overflow formula
        amount = bound(amount, 1, 50);

        // Lấy giá từ contract (sẽ dùng để so sánh)
        (uint256 ethCost, uint256 totalCost) = amm.getBuyPrice(amount);

        // Cross-check với công thức offline
        (uint256 offCost, uint256 offTotal) = _calcBuyCost(
            INITIAL_VIRT_ETH, TARGET_CAP, amount
        );
        assertEq(ethCost,   offCost,  "fuzz: getBuyPrice ethCost == formula");
        assertEq(totalCost, offTotal, "fuzz: getBuyPrice totalCost == formula");

        uint256 aliceBefore = ALICE.balance;

        vm.prank(ALICE);
        amm.buyShares{value: totalCost}(amount, totalCost);

        // 1. realEthBalance == ethCost (fee đã chảy ra)
        assertEq(amm.realEthBalance(), ethCost, "fuzz: realEthBalance == ethCost");

        // 2. Token balance
        assertEq(token.balanceOf(ALICE, ARTWORK_ID), amount, "fuzz: token balance");

        // 3. ETH chi tiêu chính xác
        assertEq(aliceBefore - ALICE.balance, totalCost, "fuzz: alice spent totalCost");

        // 4. Pool state
        BondingCurveAMM.Pool memory p = amm.getPoolInfo();
        assertEq(p.soldSupply,  amount,                      "fuzz: soldSupply");
        assertEq(p.virtualPoolX, INITIAL_VIRT_ETH + ethCost, "fuzz: virtualPoolX");
        assertEq(p.virtualPoolY, TARGET_CAP - amount,         "fuzz: virtualPoolY");

        // 5. k invariant — không bao giờ tăng (integer division)
        uint256 kExpectedMax = INITIAL_VIRT_ETH * TARGET_CAP; // k ban đầu
        assertLe(amm.getInvariant(), kExpectedMax, "fuzz: k <= initial k");
    }

    /**
     * @notice Fuzz test: amount vượt targetCap phải luôn revert ExceedsTargetCap.
     */
    function testFuzz_BuyShares_RevertsWhenExceedsTargetCap(uint256 amount) public {
        // Bound [targetCap+1, targetCap*10]
        amount = bound(amount, TARGET_CAP + 1, TARGET_CAP * 10);

        // Dùng 1 ether làm msg.value (Alice có 500 ether) — đủ để vào contract.
        // ExceedsTargetCap check xảy ra TRƯỚC khi ETH được tiêu, nên msg.value chỉ cần > 0.
        vm.expectRevert(
            abi.encodeWithSelector(
                BondingCurveAMM.ExceedsTargetCap.selector,
                amount,
                TARGET_CAP // available = targetCap - soldSupply = 1000 - 0
            )
        );
        vm.prank(ALICE);
        amm.buyShares{value: 1 ether}(amount, 1 ether);
    }

    /**
     * @notice Fuzz test: sellShares với lượng hợp lệ [1, amount] sau khi mua.
     */
    function testFuzz_SellShares_AllInvariants(uint256 buyAmt, uint256 sellAmt) public {
        buyAmt  = bound(buyAmt,  5, 50);
        sellAmt = bound(sellAmt, 1, buyAmt);

        (uint256 buyCost,) = _aliceBuys(buyAmt);
        // buyCost = ethCost của lệnh mua → bằng đúng realEthBalance sau buy
        assertEq(amm.realEthBalance(), buyCost, "fuzz: realEthBalance after buy == ethCost");

        (uint256 ethOut, uint256 netEthOut) = amm.getSellPrice(sellAmt);
        uint256 aliceBefore = ALICE.balance;

        vm.prank(ALICE);
        amm.sellShares(sellAmt, netEthOut);

        // realEthBalance giảm bằng ethOut (fee chảy ra ngoài)
        assertEq(amm.realEthBalance(), buyCost - ethOut, "fuzz: realEthBalance after sell");

        // Alice nhận netEthOut
        assertEq(ALICE.balance, aliceBefore + netEthOut, "fuzz: alice receives netEthOut");

        // Token balance
        assertEq(token.balanceOf(ALICE, ARTWORK_ID), buyAmt - sellAmt, "fuzz: token balance after sell");

        // soldSupply
        BondingCurveAMM.Pool memory p = amm.getPoolInfo();
        assertEq(p.soldSupply, buyAmt - sellAmt, "fuzz: soldSupply after sell");
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  TEST: updateFeeRates (Admin)
    // ══════════════════════════════════════════════════════════════════════════

    function test_UpdateFeeRates_OnlyOwner() public {
        vm.expectRevert();
        vm.prank(ALICE);
        amm.updateFeeRates(100, 50);
    }

    function test_UpdateFeeRates_RevertIfTooHigh() public {
        // Factory là owner của AMM
        vm.expectRevert(
            abi.encodeWithSelector(
                BondingCurveAMM.FeeTooHigh.selector,
                1001,
                1000
            )
        );
        vm.prank(address(factory));
        amm.updateFeeRates(600, 401); // 1001 > MAX_FEE_BPS
    }

    function test_UpdateFeeRates_Success_AffectsNextTrade() public {
        // Factory (owner) cập nhật fee xuống 0
        vm.prank(address(factory));
        amm.updateFeeRates(0, 0);

        uint256 amount = 10;
        (uint256 ethCost, uint256 totalCost) = amm.getBuyPrice(amount);

        // Khi fee = 0, totalCost == ethCost
        assertEq(totalCost, ethCost, "totalCost == ethCost when fee=0");
    }
}
