// Helpers for local scripts/tests: authenticator-app (TOTP) codes without a phone.
import crypto from 'node:crypto'

/** Current 6-digit code for a base32 authenticator secret (RFC 6238, 30 s, SHA-1). */
export function totp(secretB32, t = Date.now()) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of secretB32.replace(/=+$/, '').toUpperCase()) bits += A.indexOf(c).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(t / 30000)))
  const h = crypto.createHmac('sha1', key).update(counter).digest()
  const o = h[h.length - 1] & 15
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0')
}

/** First-time setup: registers an authenticator for a password-signed-in client and verifies it. Returns the secret. */
export async function enrollTotp(client) {
  const enr = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator', issuer: 'Sai Space CRM' })
  if (enr.error) throw new Error('authenticator setup: ' + enr.error.message)
  const v = await client.auth.mfa.challengeAndVerify({ factorId: enr.data.id, code: totp(enr.data.totp.secret) })
  if (v.error) throw new Error('authenticator verify: ' + v.error.message)
  return enr.data.totp.secret
}

/** Every later sign-in: completes two-step verification with the saved secret. */
export async function verifyTotp(client, secret) {
  const { data } = await client.auth.mfa.listFactors()
  const factor = data?.totp.find((f) => f.status === 'verified')
  if (!factor) throw new Error('no authenticator registered for this account')
  const v = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp(secret) })
  if (v.error) throw new Error('authenticator verify: ' + v.error.message)
}
