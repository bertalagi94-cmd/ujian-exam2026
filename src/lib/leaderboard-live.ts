// src/lib/leaderboard-live.ts
//
// ── MESIN SKOR LEADERBOARD LIVE ─────────────────────────────────────────────
//
// Dipakai oleh /api/layar-pantau/data (dan bisa dipakai ulang oleh endpoint
// leaderboard lain nanti, mis. dashboard guru/kepsek biasa) untuk menghitung
// peringkat sementara siswa yang SEDANG mengerjakan ujian pilihan ganda.
//
// PRINSIP KEAMANAN PALING PENTING DI FILE INI:
// Kunci jawaban (`soal.kunci`) TIDAK PERNAH keluar dari fungsi ini ke
// pemanggil. Hanya hasil AGREGAT (jumlah benar, jumlah terjawab, nilai
// sementara) yang dikembalikan. Endpoint yang memanggil fungsi ini harus
// meneruskan hasil `LiveLeaderboardRow[]` apa adanya ke client — JANGAN
// pernah menambahkan field kunciMap/soal ke response JSON.
//
// Rumus nilai SAMA PERSIS dengan hitungHasilPenilaian() di
// src/lib/penilaian-ujian.ts (benar/total*100, dibulatkan), supaya angka
// yang tampil di papan live tidak pernah menyimpang dari nilai final yang
// nanti disimpan ke tabel `nilai` saat siswa submit. Bedanya: fungsi ini
// dipanggil berulang SELAMA ujian berjalan (jawaban belum final), bukan
// sekali saat submit.
//
// Essay TIDAK ikut dihitung di sini — sama seperti leaderboard SKD di tes
// CPNS/PPPK, papan live hanya mencerminkan skor objektif (pilihan ganda)
// yang bisa dihitung instan; essay dinilai manual belakangan oleh guru.

import { SupabaseClient } from '@supabase/supabase-js'
import { ambilSemuaBaris } from '@/lib/ambil-semua'

export interface LiveLeaderboardRow {
  nis: string
  nama: string
  benar: number
  terjawab: number
  totalSoal: number
  nilaiSementara: number
  selesai: boolean
  // Status siswa_ujian (AKTIF | RESET | TERKUNCI | SELESAI). RESET = baru
  // melanggar & menunggu kode dari pengawas; TERKUNCI = melewati batas
  // pelanggaran. Dipakai Layar Pantau untuk menandai baris siswa.
  status: string
}

export interface LiveLeaderboardSesi {
  sesiId: string
  kelas: string
  mapelId: string
  namaMapel: string
  waktuMulai: string
  durasi: number | null
  totalPeserta: number
  peserta: LiveLeaderboardRow[]
  // FITUR (pesan "UJIAN SELESAI" + hitung mundur di Layar Pantau): sesi yang
  // baru saja ditutup pengawas TETAP diikutkan di hasil ambilBoardsUntukViewer
  // untuk sementara (lihat JENDELA_TAMPIL_SETELAH_TUTUP_MS di route.ts),
  // supaya papan tidak langsung lenyap tanpa keterangan. statusSesi &
  // waktuSelesai dipakai FRONTEND untuk menghitung sisa detik sebelum papan
  // ini disembunyikan sendiri (client-side), bukan untuk menyembunyikan data.
  statusSesi: string
  waktuSelesai: string | null
}

interface SesiRow {
  id: string
  jadwal_id: string
  mapel_id: string
  kelas: string
  durasi: number | null
  waktu_mulai: string
  paket_soal_id: string | null
  status: string
  waktu_selesai: string | null
}

// ── CACHE BERSAMA (hemat Fluid Active CPU) ───────────────────────────────
//
// MASALAH: stream Layar Pantau (/api/layar-pantau/stream) memanggil fungsi
// ini untuk SETIAP penonton pada setiap event Realtime. Dengan 500 siswa yang
// terus menjawab, event datang terus-menerus, dan tiap penonton (guru, kepsek,
// admin, tiap tab) menarik ulang seluruh baris `jawaban` lalu menilainya
// dengan loop JavaScript -- pekerjaan yang IDENTIK untuk sesi yang sama.
//
// SOLUSI (semuanya per instance server, tanpa Redis):
//  1. Hasil papan per sesi disimpan sebentar. Penonton ke-2, ke-3, dst.
//     memakai hasil yang sama, tidak menghitung ulang.
//  2. Hitungan yang sedang berjalan digabung (dedupe): 20 penonton yang
//     meminta bersamaan hanya memicu SATU hitungan.
//  3. Event Realtime menandai papan sesi itu "kotor" (tandaiBoardKotor).
//     Papan kotor tetap dihitung ulang secepatnya (paling lambat setelah
//     JEDA_MIN_HITUNG_MS sejak hitungan sebelumnya), jadi data tidak basi.
//     Papan bersih dipakai ulang sampai TTL_BERSIH_MS.
//  4. Kunci jawaban per paket soal dan nama siswa di-cache (hampir tidak
//     pernah berubah selama ujian), sehingga 2 query per hitungan hilang.
//
// KEAMANAN: kunci jawaban tetap hanya ada di memori server dan tidak pernah
// masuk ke objek yang dikembalikan. Hasil yang di-cache sama persis dengan
// hasil sebelumnya (agregat saja).

function envMs(nama: string, bawaan: number, min: number): number {
  const n = Number(process.env[nama])
  return Number.isFinite(n) && n >= min ? Math.floor(n) : bawaan
}

/** Papan yang tidak ditandai kotor dipakai ulang selama ini. */
const TTL_BERSIH_MS = envMs('LEADERBOARD_TTL_BERSIH_MS', 5000, 0)
/** Papan kotor tidak dihitung ulang lebih sering dari ini (per sesi per instance). */
const JEDA_MIN_HITUNG_MS = envMs('LEADERBOARD_JEDA_MIN_MS', 1500, 0)
/** Kunci jawaban per paket soal. */
const TTL_KUNCI_MS = envMs('LEADERBOARD_TTL_KUNCI_MS', 60_000, 0)
/** Nama siswa per NIS. */
const TTL_NAMA_MS = envMs('LEADERBOARD_TTL_NAMA_MS', 10 * 60_000, 0)

const MAKS_ENTRI_BOARD = 300
const MAKS_ENTRI_NAMA = 5000
const MAKS_ENTRI_KUNCI = 200

interface EntriBoard { mulai: number; hasil: LiveLeaderboardSesi }
interface SedangHitung { mulai: number; janji: Promise<LiveLeaderboardSesi | null> }

const cacheBoard = new Map<string, EntriBoard>()
const sedangHitung = new Map<string, SedangHitung>()
const kotorSejak = new Map<string, number>()
let kotorSemuaSejak = 0

const cacheKunci = new Map<string, { kunciMap: Map<string, string>; exp: number }>()
const cacheNama = new Map<string, { nama: string; exp: number }>()

/** Dipanggil saat ada event Realtime untuk sesi ini: papan sesi ini perlu dihitung ulang. */
export function tandaiBoardKotor(sesiId: string): void {
  kotorSejak.set(sesiId, Date.now())
}

/** Dipanggil saat event Realtime tidak membawa sesi_id (mis. DELETE): semua papan dianggap kotor. */
export function tandaiSemuaBoardKotor(): void {
  kotorSemuaSejak = Date.now()
}

// `>=` (bukan `>`): kalau event dan awal hitungan jatuh di milidetik yang sama,
// anggap hitungan itu mungkin belum memuat event -- lebih aman dihitung ulang.
function adaPerubahanSejak(sesiId: string, waktu: number): boolean {
  return (kotorSejak.get(sesiId) ?? 0) >= waktu || kotorSemuaSejak >= waktu
}

const tidur = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

function bersihkanCache(): void {
  const sekarang = Date.now()
  if (cacheBoard.size > MAKS_ENTRI_BOARD) {
    for (const [k, v] of cacheBoard) if (sekarang - v.mulai > 60_000) cacheBoard.delete(k)
  }
  if (kotorSejak.size > MAKS_ENTRI_BOARD) {
    for (const [k, t] of kotorSejak) if (sekarang - t > 10 * 60_000) kotorSejak.delete(k)
  }
  if (cacheKunci.size > MAKS_ENTRI_KUNCI) {
    for (const [k, v] of cacheKunci) if (v.exp <= sekarang) cacheKunci.delete(k)
  }
  if (cacheNama.size > MAKS_ENTRI_NAMA) cacheNama.clear()
}

function kunciBoard(sesi: SesiRow, namaMapelMap: Record<string, string>): string {
  // Semua field sesi yang ikut tampil di hasil dimasukkan ke kunci, supaya
  // perubahan status/durasi/mapel otomatis memakai entri baru.
  return [
    sesi.id, sesi.status, sesi.waktu_selesai ?? '', sesi.durasi ?? '',
    sesi.paket_soal_id ?? '', sesi.kelas, sesi.mapel_id, sesi.waktu_mulai,
    namaMapelMap[sesi.mapel_id] ?? '',
  ].join('|')
}

async function ambilKunciSoal(
  db: SupabaseClient<any>,
  paketId: string
): Promise<{ kunciMap: Map<string, string>; ok: boolean }> {
  const sekarang = Date.now()
  const c = cacheKunci.get(paketId)
  if (c && c.exp > sekarang) return { kunciMap: c.kunciMap, ok: true }

  const { data, error } = await db.from('soal')
    .select('id, kunci')
    .eq('paket_id', paketId)
    .eq('status', 'DISETUJUI')
  const soal = (data ?? []) as { id: string; kunci: string }[]
  const kunciMap = new Map(soal.map(s => [s.id, s.kunci]))
  if (!error && TTL_KUNCI_MS > 0) cacheKunci.set(paketId, { kunciMap, exp: sekarang + TTL_KUNCI_MS })
  return { kunciMap, ok: !error }
}

async function ambilNamaSiswa(
  db: SupabaseClient<any>,
  nisList: string[]
): Promise<{ namaMap: Map<string, string>; ok: boolean }> {
  const sekarang = Date.now()
  const namaMap = new Map<string, string>()
  const kurang: string[] = []
  for (const nis of nisList) {
    const c = cacheNama.get(nis)
    if (c && c.exp > sekarang) namaMap.set(nis, c.nama)
    else kurang.push(nis)
  }
  if (kurang.length === 0) return { namaMap, ok: true }

  const { data, error } = await db.from('siswa').select('nis, nama').in('nis', kurang)
  for (const s of (data ?? []) as { nis: string; nama: string }[]) {
    namaMap.set(s.nis, s.nama)
    if (TTL_NAMA_MS > 0) cacheNama.set(s.nis, { nama: s.nama, exp: sekarang + TTL_NAMA_MS })
  }
  return { namaMap, ok: !error }
}

/**
 * Hitung papan leaderboard live untuk SATU sesi ujian yang sedang BERJALAN.
 *
 * Aman dipanggil berkali-kali oleh banyak penonton: hasilnya dibagi lewat
 * cache + dedupe di atas, jadi biaya CPU tidak naik seiring jumlah penonton.
 * Tanda tangan fungsi dan bentuk hasilnya TIDAK berubah.
 */
export async function computeLiveLeaderboardUntukSesi(
  db: SupabaseClient<any>,
  sesi: SesiRow,
  namaMapelMap: Record<string, string>
): Promise<LiveLeaderboardSesi | null> {
  // Sesi tanpa paket_soal_id: papan kosong, murah, tidak perlu cache.
  if (!sesi.paket_soal_id) {
    return papanKosong(sesi, namaMapelMap, 0)
  }

  const kunci = kunciBoard(sesi, namaMapelMap)

  for (let putaran = 0; putaran < 3; putaran++) {
    const ent = cacheBoard.get(kunci)
    if (ent) {
      const usia = Date.now() - ent.mulai
      const kotor = adaPerubahanSejak(sesi.id, ent.mulai)
      if (!kotor && usia < TTL_BERSIH_MS) return ent.hasil
      if (kotor && usia < JEDA_MIN_HITUNG_MS) {
        // Terlalu cepat untuk menghitung ulang: tunggu sebentar (semua penonton
        // yang menunggu akan berbagi SATU hitungan berikutnya), lalu cek lagi.
        await tidur(JEDA_MIN_HITUNG_MS - usia + 5)
        continue
      }
    }
    const berjalan = sedangHitung.get(kunci)
    if (berjalan) {
      // Gabung ke hitungan yang sedang berjalan kalau belum ada perubahan sejak
      // ia mulai; kalau sudah ada, tunggu selesai lalu putar lagi.
      if (!adaPerubahanSejak(sesi.id, berjalan.mulai)) return berjalan.janji
      try { await berjalan.janji } catch { /* error ditangani pemilik hitungan */ }
      continue
    }
    break
  }

  const mulai = Date.now()
  const janji: Promise<LiveLeaderboardSesi | null> = hitungBoard(db, sesi, namaMapelMap)
    .then(({ hasil, boleh }) => {
      if (boleh && hasil) {
        cacheBoard.set(kunci, { mulai, hasil })
        bersihkanCache()
      }
      return hasil
    })
    .finally(() => {
      if (sedangHitung.get(kunci)?.janji === janji) sedangHitung.delete(kunci)
    })
  sedangHitung.set(kunci, { mulai, janji })
  return janji
}

function papanKosong(
  sesi: SesiRow,
  namaMapelMap: Record<string, string>,
  totalPeserta: number
): LiveLeaderboardSesi {
  return {
    sesiId: sesi.id,
    kelas: sesi.kelas,
    mapelId: sesi.mapel_id,
    namaMapel: namaMapelMap[sesi.mapel_id] ?? sesi.mapel_id,
    waktuMulai: sesi.waktu_mulai,
    durasi: sesi.durasi,
    totalPeserta,
    peserta: [],
    statusSesi: sesi.status,
    waktuSelesai: sesi.waktu_selesai,
  }
}

/**
 * Hitungan sebenarnya (logika penilaian TIDAK diubah dari versi sebelumnya).
 * `boleh` = false bila ada query yang error: hasilnya tetap dikembalikan
 * seperti dulu, tetapi tidak disimpan di cache supaya error sesaat tidak
 * "menempel" beberapa detik.
 */
async function hitungBoard(
  db: SupabaseClient<any>,
  sesi: SesiRow,
  namaMapelMap: Record<string, string>
): Promise<{ hasil: LiveLeaderboardSesi | null; boleh: boolean }> {
  const [{ data: pesertaRows, error: errPeserta }, kunciSoal] = await Promise.all([
    db.from('siswa_ujian')
      .select('nis, status')
      .eq('sesi_id', sesi.id),
    ambilKunciSoal(db, sesi.paket_soal_id as string),
  ])

  const peserta = (pesertaRows ?? []) as { nis: string; status: string }[]
  const kunciMap = kunciSoal.kunciMap
  const totalSoal = kunciMap.size
  let boleh = !errPeserta && kunciSoal.ok

  if (peserta.length === 0 || totalSoal === 0) {
    return { hasil: papanKosong(sesi, namaMapelMap, peserta.length), boleh }
  }

  const nisList = peserta.map(p => p.nis)
  const [namaRes, { data: jawabanRows, error: errJawaban }, { data: nilaiRows, error: errNilai }] = await Promise.all([
    ambilNamaSiswa(db, nisList),
    // FIX batas 1000 baris: kelas 36 siswa x 30 soal = 1080 jawaban, bisa
    // terpotong diam-diam dan membuat nilai sementara lebih rendah. Diambil
    // per halaman dengan urutan stabil (nis, soal_id).
    ambilSemuaBaris<{ nis: string; soal_id: string; jawaban: string }>((dari, sampai) =>
      db.from('jawaban')
        .select('nis, soal_id, jawaban')
        .eq('sesi_id', sesi.id)
        .in('nis', nisList)
        .order('nis', { ascending: true })
        .order('soal_id', { ascending: true })
        .range(dari, sampai)
    ),
    // Layar Pantau HANYA memantau PG -- baris `nilai` dibuat oleh
    // /api/siswa/ujian/selesai TEPAT saat siswa submit PG, tidak peduli sesi
    // ini punya fase essay atau tidak. Jadi ini sinyal yang tepat untuk
    // "sudah selesai PG" tanpa menunggu essay.
    db.from('nilai').select('nis').eq('sesi_id', sesi.id).in('nis', nisList),
  ])
  if (!namaRes.ok || errJawaban || errNilai) boleh = false

  const namaMap = namaRes.namaMap
  const pgSelesaiSet = new Set(((nilaiRows ?? []) as { nis: string }[]).map(n => n.nis))

  // Kelompokkan jawaban per siswa
  const jawabanPerSiswa = new Map<string, { soal_id: string; jawaban: string }[]>()
  for (const j of (jawabanRows ?? []) as { nis: string; soal_id: string; jawaban: string }[]) {
    if (!jawabanPerSiswa.has(j.nis)) jawabanPerSiswa.set(j.nis, [])
    jawabanPerSiswa.get(j.nis)!.push(j)
  }

  const rows: LiveLeaderboardRow[] = peserta.map(p => {
    const jawabanSiswa = jawabanPerSiswa.get(p.nis) ?? []
    let benar = 0
    let terjawab = 0
    for (const j of jawabanSiswa) {
      if (!j.jawaban) continue
      terjawab++
      if (kunciMap.get(j.soal_id) === j.jawaban) benar++
    }
    const nilaiSementara = totalSoal > 0 ? Math.round((benar / totalSoal) * 100) : 0
    return {
      nis: p.nis,
      nama: namaMap.get(p.nis) ?? p.nis,
      benar,
      terjawab,
      totalSoal,
      nilaiSementara,
      // Badge "Selesai" = PG sudah disubmit & dinilai (baris `nilai` ada),
      // berapa pun lama essay-nya nanti.
      selesai: pgSelesaiSet.has(p.nis),
      status: p.status,
    }
  })

  // Urutkan: nilai tertinggi dulu, lalu yang sudah menjawab lebih banyak,
  // lalu nama (supaya urutan stabil dan animasi FLIP di client tidak "gemetar").
  rows.sort((a, b) =>
    b.nilaiSementara - a.nilaiSementara ||
    b.terjawab - a.terjawab ||
    a.nama.localeCompare(b.nama)
  )

  return {
    hasil: {
      sesiId: sesi.id,
      kelas: sesi.kelas,
      mapelId: sesi.mapel_id,
      namaMapel: namaMapelMap[sesi.mapel_id] ?? sesi.mapel_id,
      waktuMulai: sesi.waktu_mulai,
      durasi: sesi.durasi,
      totalPeserta: peserta.length,
      peserta: rows,
      statusSesi: sesi.status,
      waktuSelesai: sesi.waktu_selesai,
    },
    boleh,
  }
}
