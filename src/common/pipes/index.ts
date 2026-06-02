// ─────────────────────────────────────────────────────────────────
//  common/pipes/index.ts
//  Reusable validation / transform pipes
// ─────────────────────────────────────────────────────────────────

import {
  PipeTransform, Injectable, ArgumentMetadata, BadRequestException,
} from '@nestjs/common'
import { validate } from 'class-validator'
import { plainToInstance } from 'class-transformer'

// ── ParseUUIDPipe ─────────────────────────────────────────────────
// Validates that a param is a valid UUID v4
@Injectable()
export class ParseUUIDPipe implements PipeTransform<string> {
  private readonly UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

  transform(value: string, metadata: ArgumentMetadata): string {
    if (!this.UUID_REGEX.test(value)) {
      throw new BadRequestException(
        `${metadata.data ?? 'Parameter'} phải là UUID hợp lệ.`,
      )
    }
    return value.toLowerCase()
  }
}

// ── ParseEthAddressPipe ───────────────────────────────────────────
// Validates and normalises an Ethereum address param
@Injectable()
export class ParseEthAddressPipe implements PipeTransform<string> {
  transform(value: string): string {
    if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
      throw new BadRequestException('Địa chỉ ví không hợp lệ. Cần dạng 0x + 40 ký tự hex.')
    }
    return value.toLowerCase()
  }
}

// ── ParsePositiveIntPipe ──────────────────────────────────────────
// Validates that a query param is a positive integer
@Injectable()
export class ParsePositiveIntPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    const n = parseInt(value, 10)
    if (isNaN(n) || n < 1) {
      throw new BadRequestException('Giá trị phải là số nguyên dương.')
    }
    return n
  }
}
