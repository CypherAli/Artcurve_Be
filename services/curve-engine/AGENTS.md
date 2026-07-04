# AGENTS.md — artcurve-curve-engine

Engine tính giá bonding curve (Rust · tonic gRPC · port 50051).
`Artcurve_Be` gọi service này cho MỌI phép tính giá off-chain — kết quả phải khớp
tuyệt đối với `BondingCurveAMM.sol` on-chain.

## Lệnh

```bash
cargo run                    # gRPC server :50051 (env: GRPC_PORT, LOG_LEVEL)
cargo test                   # PHẢI xanh trước khi merge
cargo build --release
```

## Cấu trúc

```
proto/curve.proto     # gRPC contract — client NestJS generate từ file NÀY
src/main.rs           # bootstrap server
src/server.rs         # CurveEngineService impl
src/curve/            # logic công thức x·y=k
```

## Quy tắc bắt buộc

1. **Đồng bộ công thức với Solidity:** mọi thay đổi công thức phải khớp
   `../artcurve-contracts/src/BondingCurveAMM.sol` (nhân trước chia, cùng rounding).
   Sai lệch 1 wei giữa quote off-chain và giá on-chain = bug.
2. **Đổi `proto/curve.proto`** → phải regenerate client phía `Artcurve_Be`
   (@grpc/grpc-js) và test lại tích hợp.
3. Dùng integer arithmetic (u128/U256) cho tiền — cấm f64 trong tính giá.
4. Git: branch → merge `main`; không logo Claude / Co-Authored-By.
