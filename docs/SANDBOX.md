# Sandbox & Testing — 3 lớp môi trường test của ArtCurve

ArtCurve có 3 lớp sandbox, từ nhanh-nhất đến giống-production-nhất. Chọn lớp theo câu hỏi bạn cần trả lời:

| Lớp | Trả lời câu hỏi | Coin | Tốc độ |
|---|---|---|---|
| **1. Foundry test** (`forge test`) | "Logic contract có đúng không?" | `vm.deal()` — vô hạn | mili-giây |
| **2. Anvil sandbox** (`sandbox.ps1`) | "Bấm trên UI thật thì thế nào?" | `anvil_setBalance` — **tùy ý** | tức thì |
| **3. Base Sepolia testnet** | "Trên chain công khai chạy ổn không?" | ETH faucet — nhỏ giọt | ~2s/block |

---

## Lớp 1 — Foundry test (EVM in-memory)

Mỗi lần `forge test`, Forge dựng một EVM sạch trong bộ nhớ. 52 test + fuzz 10.000 runs
(seed cố định trong `foundry.toml`) chạy trong ~1 giây. Muốn ví có số dư bất kỳ trong test:

```solidity
vm.deal(user, 1234 ether); // một dòng — ví test có 1234 ETH
```

```powershell
cd contracts
forge test          # toàn bộ
forge test -vvv     # xem trace khi fail
```

## Lớp 2 — Anvil sandbox (chain local, MỘT LỆNH)

Anvil là node local nằm sẵn trong Foundry (tương đương Hardhat Network — dự án dùng
Foundry nên **không cần Hardhat**). Đây là lớp duy nhất cho phép **test số coin tùy chỉnh
trên web UI thật**: testnet công khai không ai được tự đặt số dư (faucet nhỏ giọt),
còn chain Anvil là của bạn — muốn ví có bao nhiêu ETH cũng được.

```powershell
cd contracts
.\sandbox.ps1                                        # chain 31337 + deploy contract
.\sandbox.ps1 -Wallet 0xVI_METAMASK -Eth 50000       # + nạp 50.000 ETH cho ví bạn
```

Script tự làm: bật Anvil (port 8545, chain-id 31337) → deploy ArtFactory + BondingCurveAMM
+ ArtFractionToken → xác minh bytecode on-chain → nạp ETH ví bạn. Chạy lại khi chain đang
sống thì tự bỏ qua deploy (địa chỉ giữ nguyên).

**Địa chỉ deterministic** (chain sạch + key Anvil #0 → lần nào cũng y hệt, đã hardcode
sẵn trong FE `src/web3/contracts/index.ts` key `foundry`):

```
ArtFactory       0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
AMM impl         0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
Token impl       0x5FbDB2315678afecb367f032d93F642f64180aa3
```

### Xem sandbox trên web (frontend thật)

1. **MetaMask** → Add network thủ công: RPC `http://127.0.0.1:8545`, Chain ID `31337`, currency `ETH`.
2. **Frontend**: trong `Artcurve_Fe/.env.local` đặt `NEXT_PUBLIC_CHAIN_ID=31337` → `npm run dev`.
   FE đã hỗ trợ sẵn chain này (`wagmi-config.ts`).
3. **Full-stack** (marketplace/trade cần data từ BE): trong `Artcurve_Be/.env` đặt
   `CHAIN_ID=31337`, `RPC_URL=http://127.0.0.1:8545`, `WS_RPC_URL=ws://127.0.0.1:8545`,
   `CONTRACT_ART_FACTORY_SEPOLIA=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0`
   rồi chạy `docker-compose up -d postgres redis rabbitmq` + `npm run start:dev` + seed.

Lệnh hữu ích (chạy từ `contracts/`):

```powershell
# nạp thêm ETH cho ví bất kỳ, bất kỳ lúc nào
cast rpc anvil_setBalance DIA_CHI_VI $(cast to-hex $(cast to-wei 5000 ether)) --rpc-url http://127.0.0.1:8545

# xem số dư
cast balance DIA_CHI_VI --rpc-url http://127.0.0.1:8545 --ether

# tua thời gian (test deadline, vesting...)
cast rpc evm_increaseTime 86400 --rpc-url http://127.0.0.1:8545
```

Reset chain sạch: tắt cửa sổ Anvil → chạy lại `sandbox.ps1`.

### Lưu ý kỹ thuật (Windows)

- `sandbox.ps1` mirror contracts sang `%TEMP%\artcurve-sandbox` trước khi chạy forge —
  **cố ý**, vì forge/solc vỡ pipe (os error 232) trong đường dẫn có ký tự Unicode ("Dự án").
- Mirror loại trừ `contracts/.env` để forge không vô tình dùng PRIVATE_KEY thật;
  key deploy sandbox là key Anvil #0 công khai — không bao giờ dùng ngoài local.

## Lớp 3 — Base Sepolia (testnet công khai)

Contracts đã deploy (địa chỉ trong FE `contracts/index.ts` key `baseSepolia`).
ETH test xin từ faucet (Coinbase Developer / Alchemy — cần đăng nhập). Deploy lại:

```powershell
cd contracts
.\deploy.ps1 sepolia          # dry-run (an toàn, không broadcast)
.\deploy.ps1 sepolia -send    # broadcast thật
```

Sepolia dùng để demo public (FE trên Vercel trỏ vào đây) — còn phát triển/test hàng ngày
thì dùng lớp 1 và 2.
