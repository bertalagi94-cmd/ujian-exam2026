// ── HITUNG SESI UJIAN YANG SUDAH DIBUKA PENGAWAS TAPI BELUM DIIKUTI SISWA ───
// Dipakai untuk badge angka di menu "Beranda" & "Mulai Ujian" (sidebar siswa),
// lewat GET /api/notif (yang sudah dipoll sidebar tiap 30 detik).
//
// Definisi — sebuah jadwal untuk kelas siswa dihitung bila:
//   1. punya sesi_ujian berstatus BERJALAN (artinya sudah dibuka pengawas), dan
//   2. siswa ini BELUM selesai mengikutinya.
//
// "Belum selesai" memakai aturan yang SAMA dengan `sudah_ikut` di
// /api/siswa/jadwal: sudah selesai = ada baris `nilai` DAN tidak ada fase
// essay yang masih menggantung. Jadi siswa yang sudah submit PG tetapi belum
// mengirim essay tetap dihitung (ia masih punya pekerjaan di ujian itu).

import type { createAdminClient } from '@/lib/supabase'

type Db = ReturnType<typeof createAdminClient>

export async function hitungUjianDibukaSiswa(db: Db, kelas: string, nis: string): Promise<number> {
  const { data: jadwalList } = await db
    .from('jadwal')
    .select('id')
    .eq('kelas', kelas)
    .eq('status', 'BERJALAN')
  const jadwalIds = (jadwalList ?? []).map(j => j.id as string)
  if (jadwalIds.length === 0) return 0

  const { data: sesiList } = await db
    .from('sesi_ujian')
    .select('id, jadwal_id, status, info_json')
    .in('jadwal_id', jadwalIds)
  const sesi = sesiList ?? []

  // Jadwal yang benar-benar sudah dibuka pengawas (ada sesi BERJALAN).
  const dibuka = new Set(sesi.filter(s => s.status === 'BERJALAN').map(s => s.jadwal_id as string))
  if (dibuka.size === 0) return 0

  const sesiIds = sesi.map(s => s.id as string)
  const sesiKeJadwal = Object.fromEntries(sesi.map(s => [s.id as string, s.jadwal_id as string]))

  const [{ data: nilaiList }, { data: suList }] = await Promise.all([
    db.from('nilai').select('sesi_id').in('sesi_id', sesiIds).eq('nis', nis),
    db.from('siswa_ujian').select('sesi_id, status_essay').in('sesi_id', sesiIds).eq('nis', nis),
  ])

  const adaNilai = new Set((nilaiList ?? []).map(n => sesiKeJadwal[n.sesi_id as string]).filter(Boolean))

  const sesiById = Object.fromEntries(sesi.map(s => [s.id as string, s]))
  const essayMenggantung = new Set<string>()
  for (const su of suList ?? []) {
    const s = sesiById[su.sesi_id as string]
    if (!s || s.status !== 'BERJALAN') continue
    const essayAktif = !!(s.info_json as { essay_aktif?: boolean } | null)?.essay_aktif
    if (essayAktif && (su.status_essay === 'BELUM_MULAI' || su.status_essay === 'MENGERJAKAN')) {
      essayMenggantung.add(s.jadwal_id as string)
    }
  }

  let jumlah = 0
  for (const id of dibuka) {
    const sudahIkut = adaNilai.has(id) && !essayMenggantung.has(id)
    if (!sudahIkut) jumlah++
  }
  return jumlah
}
