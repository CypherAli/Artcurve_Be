// ─────────────────────────────────────────────────────────────────────────────
//  ArtFactory ABI — chỉ khai báo các event mà Blockchain Indexer cần lắng nghe.
//  Full ABI có thể lấy từ artcurve-contracts/out/ArtFactory.sol/ArtFactory.json
//
//  Event ArtworkCreated:
//    artworkAmm  — địa chỉ BondingCurveAMM clone vừa deploy
//    creator     — ví của người tạo artwork
//    metadataCID — IPFS CID của metadata
//    artworkId   — sequential ID on-chain (1, 2, 3...)
//    targetCap   — số shares tối đa (supply cap)
// ─────────────────────────────────────────────────────────────────────────────

export const ART_FACTORY_ABI = [
  {
    type: 'event',
    name: 'ArtworkCreated',
    inputs: [
      { name: 'artworkAmm',   type: 'address', indexed: true  },
      { name: 'creator',      type: 'address', indexed: true  },
      { name: 'metadataCID',  type: 'string',  indexed: false },
      { name: 'artworkId',    type: 'uint256', indexed: true  },
      { name: 'targetCap',    type: 'uint256', indexed: false },
    ],
  },
] as const;
