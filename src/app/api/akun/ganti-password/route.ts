import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRole, signToken } from '@/lib/auth'
import { cacheGet, cacheSet } from '@/lib/cache'

// Ganti password SENDIRI untuk akun staf (ADMIN / GURU / KEPSEK). Siswa memakai
// /api/siswa/ganti-password. Endpoint ini satu-satunya yang lolos requireRole
// walau token masih berklaim gantiPassword (password bawaan = username), dan
// menerbitkan TOKEN BARU tanpa klaim itu supaya pengguna tidak perlu login ulang.
const PANJANG_MIN_PASSWORD = 8
const MAKS_PERCOBAAN = 5
const WINDOW_DETIK = 10 * 60

export async function PUT(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN', 'GURU', 'KEPSEK'], { izinkanWajibGanti: true })
  if ('error' in auth) return auth.error
  const { user } = auth

  // Batasi tebakan password lama (mis. token curian): 5 percobaan / 10 menit per akun.
  const kunci = `ganti-pw:${user.username}`
  const pernah = cacheGet<number>(kunci) ?? 0
  if (pernah >= MAKS_PERCOBAAN) {
    return NextResponse.json({ error: 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.' }, { status: 429 })
  }

  const body = await req.json().catch(() => null) as { passwordLama?: unknown; passwordBaru?: unknown } | null
  const passwordLama = body?.passwordLama
  const passwordBaru = body?.passwordBaru
  if (typeof passwordLama !== 'string' || typeof passwordBaru !== 'string' || !passwordLama || !passwordBaru) {
    return NextResponse.json({ error: 'Password lama dan password baru wajib diisi' }, { status: 400 })
  }
  if (passwordBaru.length < PANJANG_MIN_PASSWORD) {
    return NextResponse.json({ error: `Password baru minimal ${PANJANG_MIN_PASSWORD} karakter` }, { status: 400 })
  }
  if (passwordBaru === passwordLama) {
    return NextResponse.json({ error: 'Password baru tidak boleh sama dengan password lama' }, { status: 400 })
  }
  if (passwordBaru.toLowerCase() === user.username.toLowerCase()) {
    return NextResponse.json({ error: 'Password baru tidak boleh sama dengan username' }, { status: 400 })
  }

  const db = tenantDb(yayasanIdDari(user))
  const { data: akun, error: fetchError } = await db
    .from('users')
    .select('username, password_hash')
    .eq('username', user.username)
    .single()
  if (fetchError || !akun) {
    return NextResponse.json({ error: 'Data akun tidak ditemukan' }, { status: 404 })
  }

  const cocok = await bcrypt.compare(passwordLama, akun.password_hash)
  if (!cocok) {
    cacheSet(kunci, pernah + 1, WINDOW_DETIK)
    return NextResponse.json({ error: 'Password lama tidak sesuai' }, { status: 401 })
  }

  const password_hash = await bcrypt.hash(passwordBaru, 10)
  const { error: updateError } = await db
    .from('users')
    .update({ password_hash })
    .eq('username', akun.username)
  if (updateError) {
    return NextResponse.json({ error: 'Gagal menyimpan password baru' }, { status: 500 })
  }

  // Token baru tanpa klaim gantiPassword.
  const token = signToken({
    username: user.username,
    nama: user.nama,
    role: user.role,
    yayasanId: user.yayasanId,
  })
  return NextResponse.json({ message: 'Password berhasil diganti', token })
}
