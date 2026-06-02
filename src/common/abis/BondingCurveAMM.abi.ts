// ─────────────────────────────────────────────────────────────────────────────
//  BondingCurveAMM ABI — chỉ khai báo các event cần thiết cho Indexer.
//  Full ABI: artcurve-contracts/out/BondingCurveAMM.sol/BondingCurveAMM.json
//
//  Event Trade (emit bởi mỗi BondingCurveAMM clone):
//    user        — trader address
//    artworkId_  — on-chain sequential ID (không phải DB UUID)
//    isBuy       — true = mua, false = bán
//    shareAmount — số shares mua/bán
//    ethAmount   — ETH thực (trước fee) đã thanh toán/nhận về
//    price       — giá per-share tại thời điểm trade (wei)
//
//  Event GraduatedToDEX:
//    artworkId_      — on-chain sequential ID
//    totalLiquidity  — ETH thực trong pool tại thời điểm graduation
// ─────────────────────────────────────────────────────────────────────────────

export const BONDING_CURVE_AMM_ABI = [
  {
    type: 'event',
    name: 'Trade',
    inputs: [
      { name: 'user',        type: 'address', indexed: true  },
      { name: 'artworkId_',  type: 'uint256', indexed: true  },
      { name: 'isBuy',       type: 'bool',    indexed: false },
      { name: 'shareAmount', type: 'uint256', indexed: false },
      { name: 'ethAmount',   type: 'uint256', indexed: false },
      { name: 'price',       type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'GraduatedToDEX',
    inputs: [
      { name: 'artworkId_',     type: 'uint256', indexed: true  },
      { name: 'totalLiquidity', type: 'uint256', indexed: false },
    ],
  },
] as const;
