import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PinataFileResponse {
  IpfsHash:  string   // e.g. "QmXyz..."
  PinSize:   number
  Timestamp: string
}

export interface Erc721Metadata {
  name:        string
  description: string
  image:       string           // ipfs://Qm.../image
  attributes?: { trait_type: string; value: string | number }[]
  external_url?: string
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class PinataService {
  private readonly logger     = new Logger(PinataService.name);
  private readonly apiKey:    string;
  private readonly secretKey: string;
  private readonly gateway:   string;

  constructor(private readonly config: ConfigService) {
    this.apiKey    = config.get<string>('PINATA_API_KEY')    ?? '';
    this.secretKey = config.get<string>('PINATA_SECRET_KEY') ?? '';
    this.gateway   = config.get<string>('PINATA_GATEWAY') ?? 'https://gateway.pinata.cloud';
  }

  /** Có key hợp lệ không — dùng để skip IPFS khi dev không cấu hình */
  get isConfigured(): boolean {
    return Boolean(this.apiKey && this.secretKey);
  }

  // ── pinFile ─────────────────────────────────────────────────────────────────

  /**
   * Upload một file buffer lên Pinata.
   * Sử dụng native Node 18 FormData + fetch (không cần thư viện ngoài).
   * @returns IPFS URI dạng `ipfs://<CID>`
   */
  async pinFile(
    buffer:   Buffer,
    filename: string,
    mimeType: string,
  ): Promise<string> {
    this.assertConfigured();

    // Native FormData (Node 18+)
    // Buffer → Uint8Array để tránh SharedArrayBuffer type conflict
    const formData = new FormData();
    const blob     = new Blob([new Uint8Array(buffer)], { type: mimeType });
    formData.append('file', blob, filename);
    formData.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));

    const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method:  'POST',
      headers: {
        'pinata_api_key':        this.apiKey,
        'pinata_secret_api_key': this.secretKey,
        // KHÔNG set Content-Type — fetch tự đặt multipart/form-data với boundary
      },
      body: formData,
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      this.logger.error(`Pinata file upload failed (${res.status}): ${err}`);
      throw new InternalServerErrorException('IPFS image upload failed');
    }

    const data = await res.json() as PinataFileResponse;
    this.logger.log(`Pinned file: ${filename} → ipfs://${data.IpfsHash}`);
    return `ipfs://${data.IpfsHash}`;
  }

  // ── pinJson ─────────────────────────────────────────────────────────────────

  /**
   * Upload metadata JSON (ERC-721 standard) lên Pinata.
   * @returns IPFS URI dạng `ipfs://<CID>`
   */
  async pinJson(metadata: Erc721Metadata, name?: string): Promise<string> {
    this.assertConfigured();

    const payload = {
      pinataOptions:  { cidVersion: 1 },
      pinataMetadata: { name: name ?? metadata.name },
      pinataContent:  metadata,
    };

    const res = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
      method:  'POST',
      headers: {
        'Content-Type':          'application/json',
        'pinata_api_key':        this.apiKey,
        'pinata_secret_api_key': this.secretKey,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      this.logger.error(`Pinata JSON upload failed (${res.status}): ${err}`);
      throw new InternalServerErrorException('IPFS metadata upload failed');
    }

    const data = await res.json() as PinataFileResponse;
    this.logger.log(`Pinned metadata "${metadata.name}" → ipfs://${data.IpfsHash}`);
    return `ipfs://${data.IpfsHash}`;
  }

  // ── resolveGatewayUrl ────────────────────────────────────────────────────────

  /**
   * Chuyển `ipfs://CID` thành URL có thể xem trực tiếp trên browser.
   */
  resolveGatewayUrl(ipfsUri: string): string {
    if (!ipfsUri.startsWith('ipfs://')) return ipfsUri;
    const cid = ipfsUri.replace('ipfs://', '');
    return `${this.gateway}/ipfs/${cid}`;
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  private assertConfigured(): void {
    if (!this.isConfigured) {
      throw new InternalServerErrorException(
        'PINATA_API_KEY và PINATA_SECRET_KEY chưa cấu hình trong .env',
      );
    }
  }
}
