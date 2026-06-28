# AI Art Detection — Integration Plan

## Status: Separate Project (Artcurve_AI)

AI art detection is developed as an independent microservice before integration into the main backend.

## Project Location

```
C:\Users\trinh\Downloads\Dự án\Artcurve_AI\
├── detector/         ← CLIP ViT + LoRA fine-tuning
├── similarity/       ← pHash + CLIP embedding
├── api/              ← FastAPI inference server
└── data/             ← Training datasets
```

## What's Already Prepared in Backend

- `artwork_type` enum: `ORIGINAL | AI_GENERATED | AI_ASSISTED`
- Database column with index (migration 1718410000000)
- API filter: `GET /artworks?artwork_type=ORIGINAL`
- FE: filter chips on marketplace + trade page
- FE: type selector in Studio create form

## Integration Architecture (Future)

```
Artist uploads artwork
       │
       ▼
POST /artworks (create DRAFT)
       │
       ▼
Auto-moderate → status = AI_MODERATING
       │
       ├── NSFW check (existing)
       │
       └── NEW: HTTP call to Artcurve_AI service
            │
            ▼
       POST http://ai-service:8000/detect
            │
            ▼
       Response: {
         "label": "AI_GENERATED",
         "confidence": 0.94
       }
            │
            ▼
       Compare with creator's self-declaration
            │
            ├── Match → approve, status = ACTIVE
            │
            └── Mismatch → flag for manual review
                (creator said ORIGINAL but AI detected AI_GENERATED)
```

## Training Plan

1. Download AI-ArtBench dataset (185K images) — Kaggle
2. Supplement with SDXL/Flux generated art
3. Fine-tune CLIP ViT-L/14 + LoRA on GPU (Coder k8s-gpu)
4. Export to ONNX for CPU inference
5. Deploy FastAPI service
6. Integrate into NestJS moderation pipeline

## GPU Requirements

- Training: NVIDIA T4/A100 (Coder workspace at coder.graphicsminer.com)
- Inference: CPU sufficient (ONNX runtime)
