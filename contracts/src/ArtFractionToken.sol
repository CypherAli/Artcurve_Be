// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ─────────────────────────────────────────────────────────────────────────────
//  ArtFractionToken — ERC-1155 Upgradeable cho các mảnh tranh phân mảnh
//
//  THAY ĐỔI so với phiên bản v1 (constructor-based):
//    ✗ Không còn constructor khởi tạo state
//    ✓ constructor() chỉ gọi _disableInitializers() → khoá implementation
//    ✓ initialize() thay thế constructor — gọi 1 lần duy nhất trên mỗi Clone
//    ✓ Tất cả base contracts đều dùng bản *Upgradeable
//
//  Tại sao cần Upgradeable cho Clones (ERC-1167)?
//    Clone là minimal proxy — delegatecall vào implementation.
//    Implementation's constructor chỉ chạy khi deploy implementation, KHÔNG
//    chạy khi clone được tạo. Vì vậy phải dùng initialize() pattern.
//
//  Bảo mật:
//    ✓ AccessControlUpgradeable — granular roles (MINTER ≠ ADMIN ≠ PAUSER)
//    ✓ ReentrancyGuardUpgradeable — nonReentrant trên mint/burn
//    ✓ _disableInitializers() — ngăn attacker gọi initialize() trực tiếp
//      lên implementation contract (sẽ trở thành owner/admin)
//    ✓ Không dùng tx.origin
//    ✓ Zero-address check trong mint/burn
// ─────────────────────────────────────────────────────────────────────────────

import { Initializable }              from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { ERC1155Upgradeable }         from "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import { ERC1155SupplyUpgradeable }   from "@openzeppelin/contracts-upgradeable/token/ERC1155/extensions/ERC1155SupplyUpgradeable.sol";
import { ERC1155PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC1155/extensions/ERC1155PausableUpgradeable.sol";
import { AccessControlUpgradeable }  from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title  ArtFractionToken
 * @notice ERC-1155 token đại diện cho các mảnh phân mảnh (fractions) của 1 artwork.
 *         Được deploy bởi ArtFactory dưới dạng Minimal Proxy Clone (ERC-1167).
 *         Mỗi Clone = 1 artwork. TokenId trong clone = artworkId từ ArtFactory.
 *
 * @dev    Vòng đời:
 *           1. ArtFactory deploy implementation (1 lần)
 *           2. ArtFactory clone implementation (mỗi artwork)
 *           3. ArtFactory gọi initialize() trên clone
 *           4. ArtFactory gọi setMinter(ammClone) để cấp MINTER_ROLE
 */
contract ArtFractionToken is
    Initializable,
    ERC1155Upgradeable,
    ERC1155SupplyUpgradeable,
    ERC1155PausableUpgradeable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable
{
    // ── Roles ──────────────────────────────────────────────────────────────────

    /// @notice Role dành riêng cho BondingCurveAMM clone — mint và burn fraction
    /// @dev    constant OK trong Upgradeable — lưu trong bytecode, không phải storage
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @notice Role dành cho Admin để pause/unpause (emergency stop)
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // ── Storage ────────────────────────────────────────────────────────────────

    /// @notice Per-token URI override. Nếu rỗng → fallback về baseURI của ERC1155.
    /// @dev    mapping không cần khởi tạo — mặc định rỗng là đúng.
    mapping(uint256 => string) private _tokenURIs;

    // ── Events ─────────────────────────────────────────────────────────────────

    /// @notice Emit khi MINTER_ROLE được cấp cho BondingCurveAMM
    event MinterSet(address indexed minter);

    // ── Constructor (Implementation Lock) ─────────────────────────────────────

    /**
     * @dev Khoá implementation contract — không ai có thể gọi initialize() trực tiếp.
     *      Nếu không có dòng này:
     *        Attacker deploy → gọi initialize(attacker, ...) → trở thành DEFAULT_ADMIN
     *        → gọi setMinter(attacker) → mint tokens tuỳ ý
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
     *         Thứ tự gọi __X_init() theo khuyến nghị OpenZeppelin:
     *           1. Base-most contract trước (ERC1155)
     *           2. Extensions sau
     *           3. Utility contracts cuối
     *
     * @param admin    Địa chỉ nhận DEFAULT_ADMIN_ROLE + PAUSER_ROLE (= ArtFactory)
     * @param baseUri  Base URI cho metadata, ví dụ: "ipfs://QmXxx/"
     */
    function initialize(
        address admin,
        string memory baseUri
    ) public initializer {
        // Validate — không được có address(0) làm admin
        require(admin != address(0), "ArtFractionToken: zero admin");

        // Khởi tạo base contracts theo thứ tự MRO
        __ERC1155_init(baseUri);          // set _uri storage
        __ERC1155Supply_init();           // (no-op, nhưng gọi để đúng pattern)
        __ERC1155Pausable_init();         // (no-op, nhưng gọi để đúng pattern)
        __AccessControl_init();           // (no-op)
        __ReentrancyGuard_init();         // set _status = NOT_ENTERED

        // Cấp roles cho admin (ArtFactory)
        // DEFAULT_ADMIN_ROLE: có thể grant/revoke mọi role khác
        // PAUSER_ROLE: có thể pause/unpause
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        // MINTER_ROLE: sẽ được cấp riêng bởi ArtFactory.setMinter(ammClone)
    }

    // ── Mint / Burn (MINTER_ROLE only) ─────────────────────────────────────────

    /**
     * @notice Mint `amount` fraction của artwork `tokenId` cho `to`.
     * @dev    Chỉ BondingCurveAMM clone (MINTER_ROLE) gọi được.
     *         CEI: ERC1155._mint cập nhật balances (EFFECT) rồi gọi
     *         onERC1155Received hook (INTERACTION) — nonReentrant bảo vệ.
     */
    function mint(
        address        to,
        uint256        tokenId,
        uint256        amount,
        bytes calldata data
    ) external onlyRole(MINTER_ROLE) nonReentrant whenNotPaused {
        require(to     != address(0), "ArtFractionToken: mint to zero");
        require(amount  > 0,          "ArtFractionToken: zero amount");
        _mint(to, tokenId, amount, data);
    }

    /**
     * @notice Burn `amount` fraction của artwork `tokenId` từ `from`.
     * @dev    Chỉ BondingCurveAMM clone (MINTER_ROLE) gọi được.
     *         ERC1155._burn tự revert nếu `from` không đủ balance.
     */
    function burn(
        address from,
        uint256 tokenId,
        uint256 amount
    ) external onlyRole(MINTER_ROLE) nonReentrant whenNotPaused {
        require(from   != address(0), "ArtFractionToken: burn from zero");
        require(amount  > 0,          "ArtFractionToken: zero amount");
        _burn(from, tokenId, amount);
    }

    // ── Metadata ───────────────────────────────────────────────────────────────

    /**
     * @notice Override URI riêng cho tokenId.
     *         Nếu không set → fallback về baseURI từ ERC1155Upgradeable.
     */
    function uri(uint256 tokenId)
        public
        view
        override(ERC1155Upgradeable)
        returns (string memory)
    {
        string memory specific = _tokenURIs[tokenId];
        if (bytes(specific).length > 0) {
            return specific;
        }
        return super.uri(tokenId);
    }

    /**
     * @notice Set URI riêng cho một tokenId. Chỉ DEFAULT_ADMIN_ROLE.
     */
    function setTokenURI(uint256 tokenId, string calldata newUri)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _tokenURIs[tokenId] = newUri;
        emit URI(newUri, tokenId);
    }

    // ── Access Control ─────────────────────────────────────────────────────────

    /**
     * @notice Cấp MINTER_ROLE cho BondingCurveAMM clone.
     * @dev    Gọi bởi ArtFactory ngay sau khi clone cả 2 contracts.
     *         Sau bước này: chỉ ammClone mới có thể mint/burn.
     */
    function setMinter(address minter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(minter != address(0), "ArtFractionToken: zero minter");
        _grantRole(MINTER_ROLE, minter);
        emit MinterSet(minter);
    }

    /// @notice Thu hồi MINTER_ROLE — dùng khi cần upgrade BondingCurveAMM.
    function revokeMinter(address minter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(MINTER_ROLE, minter);
    }

    /// @notice Emergency pause — dừng mọi mint/burn.
    function pause()   external onlyRole(PAUSER_ROLE) { _pause(); }

    /// @notice Resume sau khi pause.
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    // ── Internal Overrides (bắt buộc khi kế thừa nhiều contract cùng định nghĩa) ──

    /**
     * @dev Solidity yêu cầu override khi >1 parent định nghĩa _update.
     *      Cả 3 đều override: ERC1155Upgradeable, ERC1155PausableUpgradeable,
     *      ERC1155SupplyUpgradeable.
     *      `super._update(...)` theo MRO:
     *        ERC1155SupplyUpgradeable → ERC1155PausableUpgradeable → ERC1155Upgradeable
     */
    function _update(
        address          from,
        address          to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override(ERC1155Upgradeable, ERC1155PausableUpgradeable, ERC1155SupplyUpgradeable) {
        super._update(from, to, ids, values);
    }

    /**
     * @dev Solidity yêu cầu override khi >1 parent implement supportsInterface.
     *      ERC1155Upgradeable và AccessControlUpgradeable đều có.
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC1155Upgradeable, AccessControlUpgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
