// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  IArtFractionToken
 * @notice Interface tối giản của ArtFractionToken dùng bởi BondingCurveAMM.
 *         Tách ra để tránh circular dependency và giảm compile overhead.
 */
interface IArtFractionToken {
    function mint(
        address        to,
        uint256        tokenId,
        uint256        amount,
        bytes calldata data
    ) external;

    function burn(
        address from,
        uint256 tokenId,
        uint256 amount
    ) external;

    /// @dev ERC-1155 standard
    function balanceOf(address account, uint256 id) external view returns (uint256);
}
