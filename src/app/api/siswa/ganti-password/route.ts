import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// FITUR (Ganti password sendiri): sebelumnya HANYA admin yang bisa mereset
// password siswa (lihat /api/admin/siswa/[nis]/reset-password — hasilnya
// SELALU dikembalikan ke NIS siswa itu sendiri). Ini merepotkan admin untuk
// hal sepele, dan juga risiko keamanan: siapa pun yang tahu NIS seorang
// siswa (gampang ditebak/diketahui teman sekelas) otomatis tahu password
// default akun itu selama siswa tidak pernah menggantinya. Endpoint ini
// membiarkan siswa mengganti password AKUNNYA SENDIRI, dengan tetap
// mewajibkan password lama supaya kalau HP/laptop siswa lain sedang login
// (lupa logout), orang lain tidak bisa diam-diam mengganti passwordnya.
const PANJANG_MIN_PASSWORD = 6

export async function PUT(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  let body: { passwordLama?: string; passwordBaru?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body request tidak valid' }, { status: 400 })
  }

  const { passwordLama, passwordBaru } = body
  if (!passwordLama || !passwordBaru) {
    return NextResponse.json({ error: 'Password lama dan password baru wajib diisi' }, { status: 400 })
  }
  if (String(passwordBaru).length < PANJANG_MIN_PASSWORD) {
    return NextResponse.json({ error: `Password baru minimal ${PANJANG_MIN_PASSWORD} karakter` }, { status: 400 })
  }
  if (passwordLama === passwordBaru) {
    return NextResponse.json({ error: 'Password baru tidak boleh sama dengan password lama' }, { status: 400 })
  }

  const db = createAdminClient()

  const { data: siswa, error: fetchError } = await db
    .from('siswa')
    .select('nis, password_hash')
    .eq('nis', user.nis!)
    .single()

  if (fetchError || !siswa) {
    return NextResponse.json({ error: 'Data akun tidak ditemukan' }, { status: 404 })
  }

  const cocok = await bcrypt.compare(String(passwordLama), siswa.password_hash)
  if (!cocok) {
    return NextResponse.json({ error: 'Password lama tidak sesuai' }, { status: 401 })
  }

  const password_hash = await bcrypt.hash(String(passwordBaru), 10)
  const { error: updateError } = await db
    .from('siswa')
    .update({ password_hash })
    .eq('nis', siswa.nis)

  if (updateError) {
    return NextResponse.json({ error: 'Gagal menyimpan password baru' }, { status: 500 })
  }

  return NextResponse.json({ message: 'Password berhasil diganti' })
}
