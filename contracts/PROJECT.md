# PROJECT.md — artcurve-contracts (Smart Contracts)

> Lớp on-chain của ArtCurve — Solidity 0.8.24 · Foundry · OpenZeppelin Upgradeable ·
> Base L2 (Sepolia 84532 / Mainnet 8453).

## 1. Vai trò

Nguồn sự thật tài chính của toàn hệ thống: sở hữu cổ phần, giá, và tiền thật đều
nằm on-chain. Backend chỉ index/phản chiếu dữ liệu từ đây.

## 2. Ba hợp đồng

### ArtFactory.sol — "nhà máy"
- Deploy 1 lần; mỗi artwork mới → tạo **clone ERC-1167 (Minimal Proxy)** của
  BondingCurveAMM + gọi `initialize()` → tiết kiệm ~90% gas so với deploy full contract.
- Quản lý registry artwork ↔ AMM, cập nhật fee, trigger graduation.

### ArtFractionToken.sol — token cổ phần
- Token đại diện cổ phần artwork (multi-id); chỉ AMM được `mint`/`burn` (setMinter).

### BondingCurveAMM.sol — trái tim định giá
- **Mô hình Virtual AMM Constant Product:** `k = virtualPoolX × virtualPoolY` bất biến.
- Giá spot `P = X/Y`; mua: `ethCost = X·n/(Y−n)`; bán: `ethOut = X·n/(Y+n)`.
- Fee kép: `platformFee` + `creatorFee` (basis points) — nghệ sĩ ăn royalty mỗi giao dịch.
- State machine: `ACTIVE → TARGET_REACHED → GRADUATED` (migrate thanh khoản sang
  Uniswap V2 router khi bán đủ targetCap).

## 3. Bảo mật (tuân thủ checklist audit)

- CEI pattern + ReentrancyGuard trên buy/sell.
- Slippage guard (`maxEthIn`/`minEthOut`) + deadline variant.
- Nhân-trước-chia mọi phép AMM; không `tx.origin`; không tin `address(this).balance`.
- `_disableInitializers()` khoá implementation; custom errors tiết kiệm gas.
- Track `realEthBalance` riêng — miễn nhiễm force-send ETH.

## 4. Test & deploy

```
test/ArtFactory.t.sol, BondingCurveAMM.t.sol   → forge test
script/Deploy.s.sol                             → forge script --broadcast
```

## 5. Trạng thái

✅ Code + test Foundry hoàn chỉnh. Target: Base Sepolia (testnet).
⚠️ Chưa audit bên thứ ba — không dùng tiền thật trên mainnet khi chưa audit.
