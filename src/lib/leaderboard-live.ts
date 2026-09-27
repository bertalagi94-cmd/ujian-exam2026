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

export interface LiveLeaderboardRow {
  nis: string
  nama: string
  benar: number
  terjawab: number
  totalSoal: number
  nilaiSementara: number
  selesai: boolean
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

/**
 * Hitung papan leaderboard live untuk SATU sesi ujian yang sedang BERJALAN.
 * Aman dipanggil berkali-kali (tiap beberapa detik) — semua query di sini
 * murah (terbatas ke satu sesi_id) dan tidak pernah menyentuh tabel `nilai`
 * final.
 */
export async function computeLiveLeaderboardUntukSesi(
  db: SupabaseClient<any>,
  sesi: SesiRow,
  namaMapelMap: Record<string, string>
): Promise<LiveLeaderboardSesi | null> {
  // Sesi tanpa paket_soal_id (belum ada snapshot) belum bisa dinilai —
  // tampilkan papan kosong daripada menebak-nebak kunci dari sumber lain.
  if (!sesi.paket_soal_id) {
    return {
      sesiId: sesi.id,
      kelas: sesi.kelas,
      mapelId: sesi.mapel_id,
      namaMapel: namaMapelMap[sesi.mapel_id] ?? sesi.mapel_id,
      waktuMulai: sesi.waktu_mulai,
      durasi: sesi.durasi,
      totalPeserta: 0,
      peserta: [],
      statusSesi: sesi.status,
      waktuSelesai: sesi.waktu_selesai,
    }
  }

  const [{ data: pesertaRows }, { data: soalRows }] = await Promise.all([
    db.from('siswa_ujian')
      .select('nis, status')
      .eq('sesi_id', sesi.id),
    db.from('soal')
      .select('id, kunci')
      .eq('paket_id', sesi.paket_soal_id)
      .eq('status', 'DISETUJUI'),
  ])

  const peserta = (pesertaRows ?? []) as { nis: string; status: string }[]
  const soal = (soalRows ?? []) as { id: string; kunci: string }[]
  const totalSoal = soal.length
  // Kunci HANYA dipakai secara lokal di dalam fungsi ini untuk mencocokkan
  // jawaban — tidak pernah dimasukkan ke object yang dikembalikan.
  const kunciMap = new Map(soal.map(s => [s.id, s.kunci]))

  if (peserta.length === 0 || totalSoal === 0) {
    return {
      sesiId: sesi.id,
      kelas: sesi.kelas,
      mapelId: sesi.mapel_id,
      namaMapel: namaMapelMap[sesi.mapel_id] ?? sesi.mapel_id,
      waktuMulai: sesi.waktu_mulai,
      durasi: sesi.durasi,
      totalPeserta: peserta.length,
      peserta: [],
      statusSesi: sesi.status,
      waktuSelesai: sesi.waktu_selesai,
    }
  }

  const nisList = peserta.map(p => p.nis)
  const [{ data: siswaRows }, { data: jawabanRows }, { data: nilaiRows }] = await Promise.all([
    db.from('siswa').select('nis, nama').in('nis', nisList),
    db.from('jawaban')
      .select('nis, soal_id, jawaban')
      .eq('sesi_id', sesi.id)
      .in('nis', nisList),
    // Layar Pantau HANYA memantau PG — baris `nilai` dibuat oleh
    // /api/siswa/ujian/selesai TEPAT saat siswa submit PG, TIDAK PEDULI
    // sesi ini punya fase essay aktif atau tidak (lihat komentar di sana:
    // essay yang menggantung sengaja TIDAK menahan penulisan baris ini,
    // hanya menahan siswa_ujian.status jadi SELESAI). Jadi ini sinyal yang
    // tepat untuk "sudah selesai PG" tanpa ikut menunggu essay, berbeda
    // dari siswa_ujian.status yang baru berubah setelah essay juga dikirim.
    db.from('nilai').select('nis').eq('sesi_id', sesi.id).in('nis', nisList),
  ])

  const namaMap = new Map(((siswaRows ?? []) as { nis: string; nama: string }[]).map(s => [s.nis, s.nama]))
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
      // FIX (Layar Pantau harus fokus PG saja): sebelumnya pakai
      // `p.status === 'SELESAI'`, yang di sesi ber-essay baru menjadi
      // true SETELAH siswa juga mengirim essay (lihat komentar di
      // selesai/route.ts) -- padahal essay tidak relevan untuk papan ini.
      // Sekarang badge "Selesai" murni menandakan PG sudah disubmit &
      // dinilai (baris `nilai` sudah ada), berapa pun lama essay-nya nanti.
      selesai: pgSelesaiSet.has(p.nis),
    }
  })

  // Urutkan: nilai tertinggi dulu, lalu yang sudah menjawab lebih banyak
  // (tie-breaker wajar untuk siswa dengan skor sama tapi progres beda),
  // lalu nama (supaya urutan stabil kalau benar-benar identik — penting
  // untuk animasi FLIP di client agar baris tidak "gemetar" tanpa alasan).
  rows.sort((a, b) =>
    b.nilaiSementara - a.nilaiSementara ||
    b.terjawab - a.terjawab ||
    a.nama.localeCompare(b.nama)
  )

  return {
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
  }
}
