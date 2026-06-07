// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  IArtFractionTokenInit
 * @notice Interface cho phiên bản Initializable của ArtFractionToken.
 *         Dùng bởi ArtFactory để gọi initialize() + setMinter() trên mỗi clone mới.
 */
interface IArtFractionTokenInit {
    /// @notice Thay thế constructor — gọi đúng 1 lần sau khi clone
    function initialize(address admin, string memory baseUri) external;

    /// @notice Cấp MINTER_ROLE cho BondingCurveAMM — gọi ngay sau initialize
    function setMinter(address minter) external;
}
