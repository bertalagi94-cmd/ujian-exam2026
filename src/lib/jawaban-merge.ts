// FIX BUG P1 (audit: "merge timestamp client vs server tidak setara"):
//
// Sebelumnya (mergeJawabanDenganWaktu di page.tsx) resolusi konflik saat
// resume/reload membandingkan:
//   - waktu LOKAL: Date.now() di client saat siswa mengubah jawaban
//   - waktu SERVER: kapan server MENERIMA request sync (bukan kapan siswa
//     mengubah jawaban)
// Dua jam ini bukan hal yang sama. Skenario nyata yang bisa terjadi:
//   1. Siswa pilih A. Autosync mulai mengirim A (request lambat).
//   2. Sebelum request A selesai, siswa ganti jadi C. C hanya tersimpan
//      lokal dulu.
//   3. Request A yang lama akhirnya sampai server, updated_at server = SAAT
//      ITU (lebih baru dari timestamp lokal C yang dibuat sebelumnya).
//   4. Reload -> merge membandingkan jam -> server (A, jam lebih baru)
//      menang, padahal C adalah jawaban yang sebenarnya lebih baru.
//
// PERBAIKAN: setiap perubahan jawaban di client mendapat nomor REVISI yang
// naik monoton (1, 2, 3, ...), independen dari jam manapun. Server menolak
// revisi yang lebih kecil dari yang sudah tersimpan (lihat
// sync_jawaban_revisi() di supabase/20_pg_offline_dan_revisi_jawaban.sql).
// Merge di client memakai revisi yang sama sebagai sumber kebenaran, dan
// HANYA jatuh ke perbandingan jam untuk data lama yang belum punya revisi
// (kompatibilitas mundur, mis. sebelum migrasi dijalankan / baris lama).

export interface EntriServer {
  jawaban: string
  /** Revisi tersimpan di server. undefined = data lama / server belum mengirim revisi (migrasi belum jalan). */
  revisi?: number
  /** updated_at server, dipakai sebagai fallback kalau revisi tidak tersedia sama sekali di kedua sisi. */
  updatedAtMs?: number
}

export interface EntriLokal {
  jawaban: string
  /** Revisi yang dibuat client saat siswa mengubah jawaban ini (lihat nextRevisi()). */
  revisi: number
  /** Date.now() saat perubahan lokal ini dibuat — hanya dipakai sebagai fallback. */
  tsMs: number
}

export interface HasilMergeSoal {
  jawaban: string
  revisi: number
  /** Sumber kemenangan, untuk keperluan debug/telemetri. */
  sumber: 'server' | 'lokal'
  /** true kalau keputusan diambil lewat fallback jam (bukan revisi) — layak dipantau, seharusnya makin jarang seiring migrasi berjalan. */
  viaFallbackJam: boolean
}

/**
 * Merge jawaban server vs lokal berdasarkan REVISI (bukan jam wall-clock).
 * Untuk soal yang hanya ada di satu sisi, sisi itu langsung dipakai. Untuk
 * soal yang ada di kedua sisi:
 *   - revisi lebih besar yang menang, apa pun urutan kedatangan request atau
 *     selisih jam client/server.
 *   - kalau revisi SAMA (termasuk sama-sama tidak terdefinisi/0 -- data
 *     lama), baru jatuh ke perbandingan jam sebagai pemutus terakhir, sama
 *     seperti perilaku lama, supaya data yang belum bermigrasi tidak rusak.
 */
export function mergeJawabanRevisi(
  server: Record<string, EntriServer>,
  lokal: Record<string, EntriLokal>
): { merged: Record<string, string>; revisi: Record<string, number>; detail: Record<string, HasilMergeSoal> } {
  const merged: Record<string, string> = {}
  const revisi: Record<string, number> = {}
  const detail: Record<string, HasilMergeSoal> = {}

  const semuaKey = new Set([...Object.keys(server), ...Object.keys(lokal)])

  semuaKey.forEach(k => {
    const s = server[k]
    const l = lokal[k]

    if (s && l) {
      const rS = s.revisi ?? 0
      const rL = l.revisi ?? 0

      let hasil: HasilMergeSoal
      if (rL > rS) {
        hasil = { jawaban: l.jawaban, revisi: rL, sumber: 'lokal', viaFallbackJam: false }
      } else if (rS > rL) {
        hasil = { jawaban: s.jawaban, revisi: rS, sumber: 'server', viaFallbackJam: false }
      } else {
        // Revisi seri (termasuk 0 vs 0 untuk data lama). Fallback: jam,
        // dengan server menang kalau seri juga di jam (ground truth default).
        const tServer = s.updatedAtMs ?? 0
        const tLokal = l.tsMs ?? 0
        if (tLokal > tServer) {
          hasil = { jawaban: l.jawaban, revisi: rL, sumber: 'lokal', viaFallbackJam: true }
        } else {
          hasil = { jawaban: s.jawaban, revisi: rS, sumber: 'server', viaFallbackJam: true }
        }
      }
      merged[k] = hasil.jawaban
      revisi[k] = hasil.revisi
      detail[k] = hasil
    } else if (l) {
      merged[k] = l.jawaban
      revisi[k] = l.revisi ?? 0
      detail[k] = { jawaban: l.jawaban, revisi: l.revisi ?? 0, sumber: 'lokal', viaFallbackJam: false }
    } else if (s) {
      merged[k] = s.jawaban
      revisi[k] = s.revisi ?? 0
      detail[k] = { jawaban: s.jawaban, revisi: s.revisi ?? 0, sumber: 'server', viaFallbackJam: false }
    }
  })

  return { merged, revisi, detail }
}

/**
 * Nomor revisi berikutnya untuk satu soal. Dipanggil setiap kali siswa
 * mengubah jawaban (lihat pilihJawaban() di page.tsx). Naik monoton per
 * soal per device — tidak pernah dibandingkan dengan jam.
 */
export function nextRevisi(revisiSaatIni: Record<string, number>, soalId: string): number {
  return (revisiSaatIni[soalId] ?? 0) + 1
}
