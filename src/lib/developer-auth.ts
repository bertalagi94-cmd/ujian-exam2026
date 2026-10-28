/**
 * Autentikasi akun developer — SENGAJA terpisah dari src/lib/auth.ts.
 *
 * Dinding keamanan:
 *   - Token developer ditandatangani dengan kunci TURUNAN (HMAC dari
 *     JWT_SECRET + label 'developer'), bukan JWT_SECRET itu sendiri. Akibatnya
 *     verifyToken() milik sekolah (src/lib/auth.ts) menganggap token developer
 *     TIDAK VALID di semua rute sekolah: developer tidak punya jalan ke data
 *     siswa, jawaban, atau nilai mana pun.
 *   - Sebaliknya, token admin/guru/siswa tidak valid di rute developer.
 *   - Token developer tidak memuat yayasanId; tidak ada rute sekolah yang
 *     akan memprosesnya.
 */
import jwt from 'jsonwebtoken'
import { createHmac } from 'crypto'
import { NextRequest } from 'next/server'

const AUDIENCE = 'developer-panel'
const MASA_BERLAKU = '4h'

export interface DeveloperPayload {
  username: string
  nama: string
  peran: 'developer'
  iat?: number
  exp?: number
}

function kunciDeveloper(): string {
  const raw = process.env.JWT_SECRET
  if (!raw || raw.length < 16) {
    throw new Error('JWT_SECRET tidak diset atau terlalu pendek (minimal 16 karakter).')
  }
  return createHmac('sha256', raw).update('developer-token-v1').digest('hex')
}

export function signDeveloperToken(p: { username: string; nama: string }): string {
  const payload: Omit<DeveloperPayload, 'iat' | 'exp'> = { username: p.username, nama: p.nama, peran: 'developer' }
  return jwt.sign(payload, kunciDeveloper(), { expiresIn: MASA_BERLAKU, audience: AUDIENCE })
}

export function verifyDeveloperToken(token: string): DeveloperPayload | null {
  try {
    const p = jwt.verify(token, kunciDeveloper(), { audience: AUDIENCE }) as DeveloperPayload
    return p.peran === 'developer' ? p : null
  } catch {
    return null
  }
}

/** Penjaga semua /api/developer/* (kecuali login). */
export function requireDeveloper(
  req: NextRequest
): { user: DeveloperPayload } | { error: Response } {
  const auth = req.headers.get('authorization')
  const user = auth?.startsWith('Bearer ') ? verifyDeveloperToken(auth.slice(7)) : null
  if (!user) {
    return {
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      }),
    }
  }
  return { user }
}
