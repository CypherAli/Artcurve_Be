// ─────────────────────────────────────────────────────────────────
//  constants/error.constants.ts
//  Centralised error messages — prevents typos scattered across modules
// ─────────────────────────────────────────────────────────────────

export const ERR = {
  // Auth
  AUTH_MISSING_TOKEN:   'Authorization header không tìm thấy. Format: Authorization: Bearer <token>',
  AUTH_INVALID_TOKEN:   'JWT không hợp lệ hoặc đã hết hạn.',
  AUTH_REVOKED_TOKEN:   'Token đã bị thu hồi. Vui lòng đăng nhập lại.',
  AUTH_INVALID_NONCE:   'Nonce không hợp lệ hoặc đã hết hạn.',
  AUTH_INVALID_SIG:     'Chữ ký EIP-191 không hợp lệ.',

  // Users
  USER_NOT_FOUND:       'Người dùng không tồn tại.',
  USER_FORBIDDEN:       'Không có quyền thực hiện thao tác này.',

  // Artworks
  ARTWORK_NOT_FOUND:    'Tác phẩm không tồn tại.',
  ARTWORK_FORBIDDEN:    'Bạn không phải creator của tác phẩm này.',
  ARTWORK_INVALID_STATE:'Trạng thái tác phẩm không hợp lệ cho thao tác này.',
  ARTWORK_UPLOAD_FAIL:  'Upload ảnh lên IPFS thất bại.',

  // Blockchain
  CHAIN_UNSUPPORTED:    'Chain không được hỗ trợ.',
  TX_NOT_FOUND:         'Giao dịch không tìm thấy.',

  // General
  RATE_LIMIT_EXCEEDED:  'Quá nhiều yêu cầu. Vui lòng thử lại sau.',
  INTERNAL_ERROR:       'Lỗi hệ thống. Vui lòng thử lại.',
} as const

export type ErrorKey = keyof typeof ERR
