import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { signToken } from '@/lib/auth'
import { requireRoleAktif } from '@/lib/status-akun'

// Ganti password SENDIRI untuk akun staf (ADMIN / GURU / KEPSEK). Siswa memakai
// /api/siswa/ganti-password. Endpoint ini satu-satunya yang lolos requireRole
// walau token masih berklaim gantiPassword (password bawaan = username), dan
// menerbitkan TOKEN BARU tanpa klaim itu supaya pengguna tidak perlu login ulang.
// Password lama TIDAK diminta (supaya guru yang lupa password lama tetap bisa
// menggantinya); yang menjadi bukti identitas adalah sesi login yang sah.
const PANJANG_MIN_PASSWORD = 8

export async function PUT(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['ADMIN', 'GURU', 'KEPSEK'], { izinkanWajibGanti: true })
  if ('error' in auth) return auth.error
  const { user } = auth

  const body = await req.json().catch(() => null) as { passwordBaru?: unknown } | null
  const passwordBaru = body?.passwordBaru
  if (typeof passwordBaru !== 'string' || !passwordBaru) {
    return NextResponse.json({ error: 'Password baru wajib diisi' }, { status: 400 })
  }
  if (passwordBaru.length < PANJANG_MIN_PASSWORD) {
    return NextResponse.json({ error: `Password baru minimal ${PANJANG_MIN_PASSWORD} karakter` }, { status: 400 })
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

  // Tanpa meminta password lama, tetap cegah "ganti" ke password yang sama dengan saat ini.
  const samaDenganSekarang = await bcrypt.compare(passwordBaru, akun.password_hash)
  if (samaDenganSekarang) {
    return NextResponse.json({ error: 'Password baru tidak boleh sama dengan password saat ini' }, { status: 400 })
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
