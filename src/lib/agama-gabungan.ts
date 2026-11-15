// src/lib/agama-gabungan.ts
//
// ── UJIAN AGAMA GABUNGAN ────────────────────────────────────────────────────
// Dalam satu kelas siswa bisa berbeda agama, sedangkan sekolah hanya
// menyediakan SATU pengawas per kelas dan SATU slot waktu untuk Pendidikan
// Agama. Mapel agama sudah dipisah per agama (mapel.agama, lihat agama.ts),
// masing-masing dengan paket soal dan jadwal sendiri. Yang sebelumnya
// menghalangi hanyalah aturan "satu kelas / satu pengawas tidak boleh punya dua
// ujian pada jam yang sama".
//
// Fitur ini melonggarkan aturan itu HANYA untuk jadwal "sekutu agama":
//   - kelas, tanggal, jam mulai, jam selesai, dan pengawasnya SAMA persis;
//   - kedua mapel adalah mapel khusus agama;
//   - daftar agama kedua mapel TIDAK beririsan (tidak ada agama yang sama).
// Mapel umum tetap memakai aturan lama (ketat). Tidak ada kolom/tabel baru:
// keanggotaan grup dihitung langsung dari data jadwal.
//
// Pemakaian:
//   - admin/jadwal      : cariBentrokNyata()      (jadwal sekutu bukan bentrok)
//   - sesi-kelas.ts     : cekSesiBentrokKelas()   (sesi sekutu bukan bentrok)
//   - mode-pengawas     : idJadwalSekutu(), cariJadwalSekutu() (sekali "Mulai"
//                         membuka semua sesi sekutu)
//   - siswa/ujian/validasi: arahkanSiswaKeSesiAgama() (satu kode untuk semua,
//                         siswa diarahkan ke sesi sesuai agamanya)

import type { createAdminClient } from '@/lib/supabase'
import { cachedFetch } from '@/lib/cache'
import { ambilAgamaMapelBanyak, ambilAgamaSiswa, type Agama } from '@/lib/agama'
import { cariSesiKelasBerjalan } from '@/lib/sesi-utama'

type DbClient = ReturnType<typeof createAdminClient>

/** Kolom jadwal yang dibutuhkan untuk menilai apakah dua jadwal sekutu. */
export const KOLOM_JADWAL_GRUP = 'id, mapel_id, kelas, tanggal, jam_mulai, jam_selesai, pengawas'

export interface JadwalGrup {
  id?: string
  mapel_id?: string | null
  kelas?: string | number | null
  tanggal?: string | null
  jam_mulai?: string | null
  jam_selesai?: string | null
  pengawas?: string | null
}

const teks = (v: unknown): string => String(v ?? '').trim()
const tgl = (v: unknown): string => String(v ?? '').slice(0, 10)

/** Kelas, tanggal, jam, dan pengawas sama persis (pengawas wajib terisi). */
export function waktuKelasPengawasSama(a: JadwalGrup, b: JadwalGrup): boolean {
  return (
    teks(a.kelas) !== '' &&
    teks(a.kelas) === teks(b.kelas) &&
    tgl(a.tanggal) !== '' &&
    tgl(a.tanggal) === tgl(b.tanggal) &&
    teks(a.jam_mulai) !== '' &&
    teks(a.jam_mulai) === teks(b.jam_mulai) &&
    teks(a.jam_selesai) !== '' &&
    teks(a.jam_selesai) === teks(b.jam_selesai) &&
    teks(a.pengawas) !== '' &&
    teks(a.pengawas) === teks(b.pengawas)
  )
}

/** Dua daftar agama tidak kosong dan tidak ada agama yang sama. */
export function tidakBeririsan(a: readonly Agama[], b: readonly Agama[]): boolean {
  return a.length > 0 && b.length > 0 && !a.some((x) => b.includes(x))
}

/**
 * Dari daftar jadwal yang jamnya bertabrakan dengan `baru`, kembalikan yang
 * BENAR-BENAR bentrok (bukan sekutu agama), atau null kalau semuanya sekutu.
 * Tanpa jadwal bertabrakan sama sekali -> null tanpa query.
 */
export async function cariBentrokNyata<T extends JadwalGrup>(
  db: DbClient,
  baru: JadwalGrup,
  bentrok: readonly T[]
): Promise<T | null> {
  if (bentrok.length === 0) return null
  // Hanya jadwal dengan waktu/kelas/pengawas sama yang mungkin sekutu.
  const kandidat = bentrok.filter((j) => waktuKelasPengawasSama(baru, j))
  if (kandidat.length !== bentrok.length) {
    // Ada jadwal yang pasti bentrok nyata (waktu/kelas/pengawas beda).
    return bentrok.find((j) => !waktuKelasPengawasSama(baru, j)) ?? null
  }
  const peta = await ambilAgamaMapelBanyak(db, [baru.mapel_id, ...bentrok.map((j) => j.mapel_id)])
  const agamaBaru = baru.mapel_id ? peta.get(baru.mapel_id) ?? [] : []
  if (agamaBaru.length === 0) return bentrok[0] ?? null // mapel umum: aturan lama
  for (const j of bentrok) {
    const agamaJ = j.mapel_id ? peta.get(j.mapel_id) ?? [] : []
    if (!tidakBeririsan(agamaBaru, agamaJ)) return j
  }
  return null
}

/**
 * Subset `kandidat` (jadwal lain) yang sekutu agama dengan `jadwal`:
 * sama kelas/tanggal/jam/pengawas dan agama tidak beririsan.
 * Mengembalikan kumpulan id. Tanpa kandidat yang waktunya sama -> tanpa query.
 */
export async function idJadwalSekutu(
  db: DbClient,
  jadwal: JadwalGrup,
  kandidat: readonly JadwalGrup[]
): Promise<Set<string>> {
  const hasil = new Set<string>()
  const sewaktu = kandidat.filter((k) => k.id && k.id !== jadwal.id && waktuKelasPengawasSama(jadwal, k))
  if (sewaktu.length === 0) return hasil
  const peta = await ambilAgamaMapelBanyak(db, [jadwal.mapel_id, ...sewaktu.map((k) => k.mapel_id)])
  const agamaJadwal = jadwal.mapel_id ? peta.get(jadwal.mapel_id) ?? [] : []
  if (agamaJadwal.length === 0) return hasil
  for (const k of sewaktu) {
    const agamaK = k.mapel_id ? peta.get(k.mapel_id) ?? [] : []
    if (tidakBeririsan(agamaJadwal, agamaK)) hasil.add(String(k.id))
  }
  return hasil
}

/**
 * Semua jadwal sekutu agama untuk `jadwal` (tanpa jadwal itu sendiri),
 * dengan SEMUA kolom (dipakai untuk membuka sesinya). Biasanya kosong dan
 * hanya memakai satu query.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function cariJadwalSekutu(db: DbClient, jadwal: any): Promise<any[]> {
  if (!jadwal?.id || !teks(jadwal.pengawas) || !teks(jadwal.kelas) || !tgl(jadwal.tanggal)) return []
  const { data } = await db
    .from('jadwal')
    .select('*')
    .eq('kelas', String(jadwal.kelas))
    .eq('tanggal', tgl(jadwal.tanggal))
    .eq('jam_mulai', jadwal.jam_mulai)
    .eq('jam_selesai', jadwal.jam_selesai)
    .eq('pengawas', jadwal.pengawas)
    .neq('id', jadwal.id)
  const kandidat = (data ?? []) as Array<JadwalGrup & { id: string }>
  if (kandidat.length === 0) return []
  const idSekutu = await idJadwalSekutu(db, jadwal, kandidat)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (kandidat as any[]).filter((k) => idSekutu.has(String(k.id)))
}

// ── Sisi siswa: satu kode, diarahkan ke sesi sesuai agama ───────────────────

interface AnggotaGrupSesi {
  jadwalId: string
  agama: Agama[]
  /** id sesi kelas yang sedang BERJALAN untuk jadwal ini, null kalau belum dibuka. */
  sesiId: string | null
}

/**
 * Anggota grup agama dari sebuah sesi KELAS (termasuk sesi itu sendiri).
 * Panjang <= 1 berarti bukan ujian agama gabungan.
 * Hasil di-cache 10 detik per sesi: ratusan siswa masuk serentak memakai hasil
 * yang sama, dan ujian biasa (non-agama) hanya membayar dua query per 10 detik.
 */
async function ambilGrupSesiAgama(
  db: DbClient,
  yayasanKey: string,
  sesi: { id: string; jadwal_id: string | null }
): Promise<AnggotaGrupSesi[]> {
  if (!sesi.jadwal_id) return []
  return cachedFetch<AnggotaGrupSesi[]>(`grup-agama:${yayasanKey}:${sesi.id}`, 10, async () => {
    const { data: asal } = await db
      .from('jadwal')
      .select(KOLOM_JADWAL_GRUP)
      .eq('id', sesi.jadwal_id as string)
      .maybeSingle()
    const jadwalAsal = asal as (JadwalGrup & { id: string }) | null
    if (!jadwalAsal || !teks(jadwalAsal.pengawas)) return []

    const { data: serumpun } = await db
      .from('jadwal')
      .select(KOLOM_JADWAL_GRUP)
      .eq('kelas', String(jadwalAsal.kelas))
      .eq('tanggal', tgl(jadwalAsal.tanggal))
      .eq('jam_mulai', jadwalAsal.jam_mulai as string)
      .eq('jam_selesai', jadwalAsal.jam_selesai as string)
      .eq('pengawas', jadwalAsal.pengawas as string)
      .neq('id', jadwalAsal.id)
    const kandidat = (serumpun ?? []) as Array<JadwalGrup & { id: string }>
    if (kandidat.length === 0) return []

    const idSekutu = await idJadwalSekutu(db, jadwalAsal, kandidat)
    const sekutu = kandidat.filter((k) => idSekutu.has(k.id))
    if (sekutu.length === 0) return []

    const peta = await ambilAgamaMapelBanyak(db, [jadwalAsal.mapel_id, ...sekutu.map((k) => k.mapel_id)])
    const anggota: AnggotaGrupSesi[] = [
      { jadwalId: jadwalAsal.id, agama: jadwalAsal.mapel_id ? peta.get(jadwalAsal.mapel_id) ?? [] : [], sesiId: sesi.id },
    ]
    for (const k of sekutu) {
      const s = await cariSesiKelasBerjalan(db, k.id, 'id')
      anggota.push({
        jadwalId: k.id,
        agama: k.mapel_id ? peta.get(k.mapel_id) ?? [] : [],
        sesiId: s?.id ?? null,
      })
    }
    return anggota
  })
}

export type HasilArahSesiAgama =
  | { tipe: 'biasa' }
  | { tipe: 'tetap' }
  | { tipe: 'pindah'; sesiId: string }
  | { tipe: 'tolak'; pesan: string }

/**
 * Dipanggil validasi token setelah sesi ditemukan dari kode. Kalau sesi itu
 * bagian dari ujian agama gabungan, siswa diarahkan ke sesi yang mapelnya
 * sesuai agama siswa (siapa pun kode sesi yang diketik, selama satu kelas).
 *  - biasa  : bukan ujian agama gabungan -> alur lama, tidak ada perubahan.
 *  - tetap  : sesi yang diketik sudah sesuai agama siswa.
 *  - pindah : pakai sesi lain (sesiId) yang sesuai agama siswa.
 *  - tolak  : tidak bisa ditentukan / belum dibuka (pesan untuk siswa).
 */
export async function arahkanSiswaKeSesiAgama(
  db: DbClient,
  yayasanKey: string,
  sesi: { id: string; jadwal_id: string | null; is_darurat?: boolean | null; ruang_khusus_id?: string | null },
  nis: string
): Promise<HasilArahSesiAgama> {
  // Sesi susulan & sesi ruang khusus punya aturan sendiri: jangan disentuh.
  if (sesi.is_darurat || sesi.ruang_khusus_id) return { tipe: 'biasa' }

  const anggota = await ambilGrupSesiAgama(db, yayasanKey, sesi)
  if (anggota.length <= 1) return { tipe: 'biasa' }

  const agamaSiswa = (await ambilAgamaSiswa(db, [nis])).get(nis) ?? null
  if (!agamaSiswa) {
    return {
      tipe: 'tolak',
      pesan:
        'Agama Anda belum terisi di data siswa, sehingga sistem belum bisa menentukan ujian Pendidikan Agama untuk Anda. ' +
        'Hubungi wali kelas atau admin untuk melengkapi data agama, lalu coba lagi.',
    }
  }

  const tujuan = anggota.find((a) => a.agama.includes(agamaSiswa))
  if (!tujuan) {
    return {
      tipe: 'tolak',
      pesan: `Tidak ada ujian Pendidikan Agama untuk agama ${agamaSiswa} pada sesi ini. Hubungi pengawas atau admin. Jika data agama Anda keliru, hubungi wali kelas.`,
    }
  }
  if (!tujuan.sesiId) {
    return {
      tipe: 'tolak',
      pesan: 'Sesi ujian untuk agama Anda belum dibuka. Minta pengawas membuka sesinya, lalu coba lagi.',
    }
  }
  return tujuan.sesiId === sesi.id ? { tipe: 'tetap' } : { tipe: 'pindah', sesiId: tujuan.sesiId }
}
