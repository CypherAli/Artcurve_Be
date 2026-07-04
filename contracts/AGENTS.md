# AGENTS.md — artcurve-contracts

Smart contracts của ArtCurve (Solidity 0.8.24 · Foundry · Base L2).
Kiến trúc toàn hệ thống: xem `../docs/PROJECT.md`.

## Lệnh

```bash
forge build              # compile
forge test               # PHẢI xanh trước khi merge
forge test -vvv          # debug trace khi test fail
forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast   # deploy testnet
```

## Cấu trúc

```
src/
├── ArtFactory.sol         # Factory: deploy AMM clone (ERC-1167) + token cho mỗi artwork
├── ArtFractionToken.sol   # Token cổ phần (ERC-1155 style)
├── BondingCurveAMM.sol    # TRÁI TIM: virtual AMM x·y=k, buy/sell/graduate
└── interfaces/
script/Deploy.s.sol        # deploy script
test/                      # ArtFactory.t.sol, BondingCurveAMM.t.sol
```

## Quy tắc bắt buộc (bảo mật DeFi)

1. **Nhân TRƯỚC khi chia** trong mọi phép tính AMM — tránh mất precision integer.
2. **CEI pattern** (Checks-Effects-Interactions) + `nonReentrant` trên mọi hàm đổi state.
3. **Không dùng `tx.origin`**, không dựa vào `address(this).balance` làm invariant.
4. **Custom errors** thay cho `require(string)` — tiết kiệm gas.
5. Contract dùng pattern **Clone (ERC-1167) + initialize()** — KHÔNG thêm constructor
   có state, không thêm `immutable` (không tương thích với clone).
6. Slippage guard (`maxEthIn`/`minEthOut`) bắt buộc trên buy/sell.
7. Đổi ABI → phải cập nhật client ở `Artcurve_Be` (viem) và `Artcurve_Fe` (wagmi).

## Công thức lõi (BondingCurveAMM)

- Bất biến: `k = virtualPoolX × virtualPoolY`
- Mua: `ethCost = X·n / (Y−n)` → X↑ Y↓ → giá tăng
- Bán: `ethOut = X·n / (Y+n)` → X↓ Y↑ → giá giảm
- Fee: `platformFee + creatorFee` theo basis points (/10_000)

## Mạng

| Network | Chain ID |
|---|---|
| Base Sepolia (testnet) | 84532 |
| Base Mainnet | 8453 |

Git: branch → merge `main`; không logo Claude / Co-Authored-By trong commit.
