import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { getTokenFromRequest } from '@/lib/auth'

// GET /api/siswa/kisi-kisi
// Mengembalikan semua kisi-kisi TERKIRIM untuk kelas siswa yang login
export async function GET(req: NextRequest) {
  const user = getTokenFromRequest(req)
  if (!user || user.role !== 'SISWA') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  if (!user.kelas) return NextResponse.json({ data: [] })

  // BUG: `user.kelas` dari token JWT siswa berisi NAMA kelas (mis. "7A"),
  // diambil langsung dari kolom `siswa.kelas` — LIHAT src/app/api/auth/login/
  // route.ts (`kelas: siswa.kelas`). Tapi kolom `kisi_kisi.kelas_id` yang
  // diisi guru saat mengirim kisi-kisi (lihat guru/kisi-kisi/route.ts) adalah
  // ID ASLI dari tabel `kelas` (dibuat lewat generateId('KLS'), contoh:
  // "KLS_1737000000_ab12cd") — BUKAN nama kelas.
  //
  // Kode lama langsung memakai `user.kelas` (nama) sebagai `kelas_id` (ID)
  // tanpa di-resolve dulu — dua nilai ini tidak pernah cocok, sehingga
  // query di bawah SELALU kosong untuk SEMUA siswa, di SEMUA kelas. Ini
  // persis pola bug yang sama yang sudah pernah diperbaiki di alur
  // penilaian ujian (lihat komentar "sesi.kelas = nama kelas, tapi
  // paket_soal.kelas_id = ID dari tabel kelas" di
  // src/app/api/siswa/ujian/selesai/route.ts) — tapi perbaikannya belum
  // sempat diterapkan di endpoint ini.
  //
  // FIX: resolve dulu nama kelas siswa → id kelas yang sebenarnya sebelum
  // dipakai untuk query. Fallback ke nama aslinya kalau baris kelas
  // ternyata tidak ditemukan (mis. data lama/tidak konsisten) — supaya
  // tidak diam-diam mengembalikan kosong tanpa alasan jelas.
  const { data: kelasRow } = await db
    .from('kelas')
    .select('id')
    .eq('nama', String(user.kelas))
    .maybeSingle()
  const kelasId = kelasRow?.id ?? String(user.kelas)

  // Ambil kisi-kisi yang sudah TERKIRIM untuk kelas siswa ini
  const { data: kisiList, error } = await db
    .from('kisi_kisi')
    .select('*')
    .eq('kelas_id', kelasId)
    .eq('status', 'TERKIRIM')
    .order('updated_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!kisiList?.length) return NextResponse.json({ data: [] })

  const mapelIds = [...new Set(kisiList.map(k => k.mapel_id))]
  const guruIds = [...new Set(kisiList.map(k => k.guru_id))]

  const [{ data: mapelList }, { data: guruList }] = await Promise.all([
    db.from('mapel').select('id, nama').in('id', mapelIds),
    db.from('users').select('username, nama').in('username', guruIds),
  ])

  const mapelMap = Object.fromEntries((mapelList ?? []).map(m => [m.id, m.nama]))
  const guruMap = Object.fromEntries((guruList ?? []).map(g => [g.username, g.nama]))

  const enriched = kisiList.map(k => ({
    id: k.id,
    mapel_id: k.mapel_id,
    nama_mapel: mapelMap[k.mapel_id] ?? k.mapel_id,
    nama_guru: guruMap[k.guru_id] ?? k.guru_id,
    konten: k.konten,
    updated_at: k.updated_at,
  }))

  return NextResponse.json({ data: enriched })
}
