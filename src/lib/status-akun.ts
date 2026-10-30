/**
 * Pengecekan status akun + yayasan PER REQUEST (temuan audit #4).
 *
 * MASALAH: requireRole() (src/lib/auth.ts) hanya memverifikasi tanda tangan
 * JWT. Akun yang dinonaktifkan / dihapus, atau yayasan yang dinonaktifkan,
 * tetap bisa memakai token lama sampai habis (10 jam).
 *
 * SOLUSI: requireRoleAktif() = requireRole() + cek ke database (status akun
 * dan status yayasan, aturan yang SAMA dengan login/route.ts).
 *
 * KEPUTUSAN DESAIN
 *  - Hasil di-cache TTL_DETIK per akun (per instance server) supaya ujian
 *    serentak tidak menambah 1 query per request. Akun yang dinonaktifkan
 *    kehilangan akses paling lambat TTL_DETIK (+ TTL cache yayasan, 60 dtk).
 *  - FAIL-OPEN saat database error: kegagalan sesaat tidak boleh
 *    mengeluarkan semua siswa di tengah ujian. Hasil error TIDAK di-cache.
 *    (Ini kebalikan dari penilaian: di sana salah-nol merusak data; di sini
 *    salah-tolak memutus ujian.)
 *  - Token "Lihat sebagai" (viewAs) dilewati: itu token admin yang membawa
 *    identitas target, dan sudah read-only.
 *
 * YANG TIDAK DICAKUP: password yang baru direset belum membatalkan token
 * lama. Itu butuh kolom baru (mis. users.password_changed_at) + migrasi.
 */
import { requireRole, type JWTPayload } from '@/lib/auth'
import { cacheGet, cacheSet } from '@/lib/cache'
import { createAdminClient } from '@/lib/supabase'
import { cariYayasanById, YAYASAN_AWAL_ID } from '@/lib/tenant'
import type { NextRequest } from 'next/server'

export const TTL_DETIK = 30

export type HasilStatusAkun = { aktif: true } | { aktif: false; pesan: string }

const PESAN_AKUN_NONAKTIF = 'Akun Anda sudah tidak aktif. Hubungi administrator sekolah.'
const PESAN_YAYASAN_NONAKTIF = 'Sekolah ini sedang dinonaktifkan. Hubungi administrator aplikasi.'

const AKTIF: HasilStatusAkun = { aktif: true }

export async function periksaAkunMasihAktif(user: JWTPayload): Promise<HasilStatusAkun> {
  if (user.viewAs) return AKTIF

  const kunciAkun = user.role === 'SISWA' ? user.nis : user.username
  if (!kunciAkun) return AKTIF // token tanpa identitas ditangani requireRole/endpoint

  const kunciCache = `akun-aktif:${user.role}:${kunciAkun}`
  const dariCache = cacheGet<HasilStatusAkun>(kunciCache)
  if (dariCache) return dariCache

  try {
    const supabase = createAdminClient()
    const { data, error } = user.role === 'SISWA'
      ? await supabase.from('siswa').select('status, yayasan_id').eq('nis', kunciAkun).maybeSingle()
      : await supabase.from('users').select('status, yayasan_id').eq('username', kunciAkun).maybeSingle()

    if (error) return AKTIF // fail-open, tidak di-cache

    let hasil: HasilStatusAkun
    if (!data || data.status !== 'AKTIF') {
      hasil = { aktif: false, pesan: PESAN_AKUN_NONAKTIF }
    } else {
      const yayasanId: string = data.yayasan_id ?? YAYASAN_AWAL_ID
      const yys = await cariYayasanById(yayasanId) // melempar kalau DB error -> fail-open di catch
      hasil = yys?.status === 'AKTIF'
        ? AKTIF
        : { aktif: false, pesan: PESAN_YAYASAN_NONAKTIF }
    }

    cacheSet(kunciCache, hasil, TTL_DETIK)
    return hasil
  } catch {
    return AKTIF // fail-open, tidak di-cache
  }
}

/**
 * Pengganti requireRole() untuk route API: pemakaian sama, hanya perlu `await`.
 *   const auth = await requireRoleAktif(req, ['ADMIN'])
 *   if ('error' in auth) return auth.error
 */
export async function requireRoleAktif(
  req: NextRequest,
  allowedRoles: JWTPayload['role'][],
  opts?: { izinkanWajibGanti?: boolean }
): Promise<{ user: JWTPayload } | { error: Response }> {
  const auth = requireRole(req, allowedRoles, opts)
  if ('error' in auth) return auth

  const status = await periksaAkunMasihAktif(auth.user)
  if (!status.aktif) {
    return {
      error: new Response(
        JSON.stringify({ error: status.pesan, kode: 'AKUN_NONAKTIF' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      ),
    }
  }
  return auth
}
