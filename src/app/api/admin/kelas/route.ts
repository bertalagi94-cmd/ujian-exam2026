import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

/**
 * GET — daftar kelas diambil otomatis dari tabel siswa.
 * Info tambahan (wali_kelas, jurusan) digabung dari tabel kelas jika ada.
 */
export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN', 'GURU', 'PENGAWAS', 'KEPSEK'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()

  // 1. Hitung jumlah siswa aktif per kelas
  const { data: siswaData, error: siswaError } = await db
    .from('siswa')
    .select('kelas')
    .neq('is_tester', 'YES')

  if (siswaError) return NextResponse.json({ error: siswaError.message }, { status: 500 })

  const kelasCount: Record<string, number> = {}
  for (const s of siswaData ?? []) {
    if (s.kelas) kelasCount[s.kelas] = (kelasCount[s.kelas] ?? 0) + 1
  }

  // Jika tidak ada siswa sama sekali, kembalikan array kosong
  if (Object.keys(kelasCount).length === 0) {
    return NextResponse.json({ data: [] })
  }

  // 2. Ambil info wali_kelas & jurusan dari tabel kelas (opsional)
  const { data: kelasInfo } = await db.from('kelas').select('*')
  const infoMap: Record<string, { id: string; wali_kelas?: string; jurusan?: string }> =
    Object.fromEntries((kelasInfo ?? []).map((k) => [k.nama, k]))

  // 3. Gabungkan
  const result = Object.entries(kelasCount)
    .map(([nama, jumlah]) => ({
      id: infoMap[nama]?.id ?? nama,
      nama,
      jumlah,
      wali_kelas: infoMap[nama]?.wali_kelas ?? null,
      jurusan: infoMap[nama]?.jurusan ?? null,
    }))
    .sort((a, b) => a.nama.localeCompare(b.nama, 'id', { numeric: true }))

  return NextResponse.json({ data: result })
}

/**
 * PUT — simpan/update wali kelas & jurusan ke tabel kelas (upsert by nama).
 */
export async function PUT(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const body = await req.json()
  const { nama, wali_kelas, jurusan } = body

  if (!nama) return NextResponse.json({ error: 'Nama kelas diperlukan' }, { status: 400 })

  // Cek apakah sudah ada record untuk kelas ini
  const { data: existing } = await db.from('kelas').select('id').eq('nama', nama).maybeSingle()

  if (existing) {
    // Update
    const { error } = await db
      .from('kelas')
      .update({ wali_kelas: wali_kelas || null, jurusan: jurusan || '-' })
      .eq('nama', nama)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    // Insert baru (kelas belum pernah punya wali)
    const { error } = await db.from('kelas').insert({
      id: nama, // gunakan nama sebagai id agar sederhana
      nama,
      wali_kelas: wali_kelas || null,
      jurusan: jurusan || '-',
      jumlah: 0,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ message: 'Wali kelas berhasil disimpan' })
}

/**
 * DELETE — hapus kelas beserta SEMUA siswa yang ada di kelas tersebut.
 * Body: { nama: string }  (nama kelas, bukan id)
 */
export async function DELETE(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const { nama } = await req.json()
  if (!nama) return NextResponse.json({ error: 'Nama kelas diperlukan' }, { status: 400 })

  // 1. Hapus semua siswa di kelas ini
  const { error: siswaError } = await db.from('siswa').delete().eq('kelas', nama)
  if (siswaError) return NextResponse.json({ error: siswaError.message }, { status: 500 })

  // 2. Hapus info kelas dari tabel kelas (jika ada)
  await db.from('kelas').delete().eq('nama', nama)

  return NextResponse.json({ message: `Kelas ${nama} dan semua siswanya berhasil dihapus` })
}
