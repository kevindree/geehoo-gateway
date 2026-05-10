import crypto from 'crypto'

/**
 * Generate a cryptographically random opaque token (URL-safe base64).
 * Returns both the raw token (to be sent over email exactly once) and
 * its sha256 hex hash (the only thing persisted to the DB).
 */
export function generateOpaqueToken(byteLen = 32): { raw: string; hash: string } {
  const raw = crypto.randomBytes(byteLen).toString('base64url')
  const hash = hashToken(raw)
  return { raw, hash }
}

export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}
