import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// FITUR (Halaman profil siswa): sebelumnya biodata siswa (nama, kelas, NIS)
// hanya muncul sepintas di header dashboard — tidak ada halaman khusus
// untuk siswa melihat/memverifikasi data dirinya sendiri (tempat/tanggal
// lahir, jenis kelamin, wali kelas, kapan terakhir login, dsb). Endpoint
// ini murni READ-ONLY untuk data biodata; perubahan password ditangani
// terpisah lewat PUT /api/siswa/ganti-password.
export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const db = createAdminClient()

  const { data: siswa, error } = await db
    .from('siswa')
    .select('nis, nama, kelas, status, tempat_lahir, tanggal_lahir, jenis_kelamin, last_login, created_at')
    .eq('nis', user.nis!)
    .single()

  if (error || !siswa) {
    return NextResponse.json({ error: 'Data siswa tidak ditemukan' }, { status: 404 })
  }

  // Wali kelas: kelas.wali_kelas menyimpan username guru, bukan nama —
  // sama seperti pola lookup di halaman lain (mis. guru/wali-kelas).
  const { data: kelasRow } = await db
    .from('kelas')
    .select('id, nama, jurusan, wali_kelas')
    .eq('nama', siswa.kelas)
    .maybeSingle()

  let namaWaliKelas: string | null = null
  if (kelasRow?.wali_kelas) {
    const { data: guru } = await db
      .from('users')
      .select('nama')
      .eq('username', kelasRow.wali_kelas)
      .maybeSingle()
    namaWaliKelas = guru?.nama ?? null
  }

  return NextResponse.json({
    profil: {
      nis: siswa.nis,
      nama: siswa.nama,
      kelas: siswa.kelas,
      jurusan: kelasRow?.jurusan ?? null,
      wali_kelas: namaWaliKelas,
      status: siswa.status,
      tempat_lahir: siswa.tempat_lahir,
      tanggal_lahir: siswa.tanggal_lahir,
      jenis_kelamin: siswa.jenis_kelamin,
      last_login: siswa.last_login,
      terdaftar_sejak: siswa.created_at,
    },
  })
}
