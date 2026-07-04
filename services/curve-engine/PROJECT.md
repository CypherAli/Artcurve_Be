# PROJECT.md — artcurve-curve-engine (Price Engine)

> Service tính giá bonding curve — Rust · tonic (gRPC) · tokio. Port **:50051**.

## 1. Vai trò

"Máy tính" giá off-chain của hệ thống. Backend NestJS gọi service này mỗi khi cần
quote giá (preview mua/bán, hiển thị chart, validate lệnh) **trước khi** user ký
transaction thật — tránh phải gọi RPC blockchain cho mọi request.

## 2. Vì sao tách riêng bằng Rust?

- Tính toán tài chính đòi hỏi **integer arithmetic chính xác tuyệt đối** (u128) —
  kết quả phải khớp từng wei với `BondingCurveAMM.sol` on-chain.
- Hiệu năng: hàng nghìn quote/giây khi thị trường sôi động; Rust không GC pause.
- Cô lập rủi ro: sai công thức chỉ ảnh hưởng 1 service nhỏ, dễ test đối chiếu.

## 3. API (proto/curve.proto)

CurveEngine gRPC service — các phép chính:
- Quote mua: `ethCost = X·n / (Y−n)` (+ fee)
- Quote bán: `ethOut = X·n / (Y+n)` (− fee)
- Spot price: `P = X/Y`
NestJS generate client từ chính file proto này (@grpc/grpc-js).

## 4. Cấu trúc

```
proto/curve.proto   # gRPC contract (nguồn sự thật interface)
src/main.rs         # bootstrap :50051
src/server.rs       # service implementation
src/curve/          # thuật toán x·y=k
```

## 5. Trạng thái

✅ Hoàn chỉnh, có unit test (`cargo test`).
🔗 Ràng buộc quan trọng: mọi sửa đổi công thức PHẢI đồng bộ với
`artcurve-contracts/src/BondingCurveAMM.sol` — lệch 1 wei là bug.
