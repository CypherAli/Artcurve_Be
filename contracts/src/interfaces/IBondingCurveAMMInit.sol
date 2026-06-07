// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  IBondingCurveAMMInit
 * @notice Interface cho phiên bản Initializable của BondingCurveAMM.
 *         Dùng bởi ArtFactory để gọi initialize() trên mỗi clone mới.
 */
interface IBondingCurveAMMInit {
    /// @notice Thay thế constructor — gọi đúng 1 lần sau khi clone
    function initialize(
        address fractionToken,
        uint256 artworkId,
        address creator,
        address platformTreasury,
        uint256 targetCap,
        uint256 initialVirtualETH,
        uint256 platformFeeRate,
        uint256 creatorFeeRate,
        address admin
    ) external;
}
