// src/lib/finalisasi-nilai.ts
//
// ── FALLBACK PENILAIAN SAAT SESI DITUTUP PAKSA ──────────────────────────────
// BUG SEBELUMNYA: kalau jaringan siswa mati TOTAL dan tidak pernah pulih
// sampai pengawas menutup sesi (POST /api/guru/mode-pengawas/tutup), siswa
// itu hanya diubah statusnya jadi SELESAI di tabel `siswa_ujian` — endpoint
// tsb TIDAK PERNAH menghitung/menyimpan baris di tabel `nilai`, karena
// perhitungan nilai selama ini HANYA terjadi di
// POST /api/siswa/ujian/selesai, yang justru tidak pernah sempat dipanggil
// siswa tsb. Akibatnya siswa itu hilang dari rekap nilai guru/wali kelas
// tanpa jejak yang jelas — beda dengan kasus "3x pelanggaran → dikunci
// permanen" di reset-siswa/route.ts yang sudah punya fallback nilai 0.
//
// FIX: helper ini dipanggil setelah sesi ditutup paksa, untuk siswa yang
// statusnya masih AKTIF/RESET saat itu. Nilai dihitung dari jawaban yang
// SEMPAT tersinkron ke server sebelum jaringan putus (bukan asal nilai 0
// — supaya siswa tetap dinilai adil dari apa yang sudah dia kerjakan), dan
// baris nilai diberi catatan otomatis di `catatan_guru` supaya guru tahu
// hasil ini perlu ditinjau (dan bisa memutuskan ujian susulan bila perlu).
//
// Siswa yang KEBETULAN sempat submit sendiri detik-detik terakhir sebelum
// sesi ditutup (race condition) TIDAK ditimpa — dicek dulu apakah baris
// nilai sudah ada.

import { createAdminClient } from '@/lib/supabase'
import { generateId } from '@/lib/utils'
import { ambilDataSesiUntukPenilaian, hitungHasilPenilaian } from '@/lib/penilaian-ujian'

type DbClient = ReturnType<typeof createAdminClient>

export async function finalisasiNilaiPaksa(
  db: DbClient,
  sesiId: string,
  nisList: string[]
): Promise<void> {
  if (!nisList.length) return

  const sesiCache = await ambilDataSesiUntukPenilaian(db, sesiId)
  if (!sesiCache) return
  const { sesi, kkm, totalSoal, kunciMap } = sesiCache

  // FIX BUG #12 (status_essay tidak pernah difinalisasi saat sesi ditutup
  // paksa): sebelumnya fungsi ini HANYA peduli tabel `nilai` — begitu semua
  // NIS di `nisList` sudah punya baris nilai (mis. karena mereka sempat
  // submit PG sendiri lalu macet di TENGAH fase essay saat jaringan putus),
  // fungsi langsung `return` di baris "if (!perluDinilai.length) return" di
  // bawah TANPA PERNAH menyentuh siswa_ujian.status_essay siswa tsb. Padahal
  // `nisList` di sini persis daftar siswa yang statusnya baru saja dipaksa
  // AKTIF/RESET → SELESAI oleh pemanggil (mode-pengawas/tutup atau
  // admin tutup-paksa) — kelompok siswa yang PALING butuh status_essay
  // final, karena essai mereka tidak akan pernah dikirim sendiri lagi.
  // Akibatnya: mereka memang tetap muncul di antrean koreksi (lewat filter
  // status.in.(SELESAI,TERKUNCI) di koreksi-essay/route.ts) dan BISA dinilai
  // satu-satu, tapi endpoint rilis massal (aksi 'rilis_essay_sekaligus' di
  // guru/kirim-nilai/route.ts) memfilter siswa wajib-dinilai HANYA dari
  // status_essay IN (SUDAH_KIRIM, TIDAK_MENGERJAKAN) — siswa yang
  // status_essay-nya masih menggantung (null/BELUM_MULAI/MENGERJAKAN)
  // selamanya tidak ikut terhitung di rilis massal walau nilai_essay-nya
  // sudah diisi guru, jadi harus dirilis manual satu-satu tanpa guru sadar.
  //
  // FIX: kalau sesi ini essayAktif, set status_essay = 'TIDAK_MENGERJAKAN'
  // untuk SEMUA siswa di nisList yang belum berada di status essay final
  // (SUDAH_KIRIM/TIDAK_MENGERJAKAN) — terlepas dari apakah mereka perlu
  // baris nilai baru atau tidak. Ini AMAN untuk jawaban essay yang sempat
  // ter-autosave: koreksi-essay/route.ts mengambil jawabanMap dari tabel
  // jawaban_essay secara independen dari status_essay, jadi draft mereka
  // tetap terlihat & tetap bisa dinilai guru seperti biasa — status ini
  // hanya menandai "fase essay sudah final/tertutup", bukan menghapus draft.
  const essayAktif = !!sesi.info_json?.essay_aktif
  if (essayAktif) {
    // Filter di JS (bukan `.not('status_essay','in',...)` di query) supaya
    // tidak bergantung pada perilaku NULL di operator NOT IN PostgREST/SQL —
    // lebih eksplisit dan tidak diam-diam melewatkan baris dengan status
    // essay yang belum pernah diisi.
    const { data: statusEssaySaatIni } = await db
      .from('siswa_ujian')
      .select('nis, status_essay')
      .eq('sesi_id', sesiId)
      .in('nis', nisList)
    const nisPerluFinalisasiEssay = (statusEssaySaatIni ?? [])
      .filter(s => s.status_essay !== 'SUDAH_KIRIM' && s.status_essay !== 'TIDAK_MENGERJAKAN')
      .map(s => s.nis)
    if (nisPerluFinalisasiEssay.length) {
      await db
        .from('siswa_ujian')
        .update({ status_essay: 'TIDAK_MENGERJAKAN' })
        .eq('sesi_id', sesiId)
        .in('nis', nisPerluFinalisasiEssay)
    }
  }

  // Jangan timpa siswa yang kebetulan sudah punya baris nilai (mis. sempat
  // submit sendiri tepat sebelum sesi ditutup).
  const { data: nilaiAda } = await db
    .from('nilai')
    .select('nis')
    .eq('sesi_id', sesiId)
    .in('nis', nisList)
  const sudahAdaSet = new Set((nilaiAda ?? []).map(n => n.nis))
  const perluDinilai = nisList.filter(nis => !sudahAdaSet.has(nis))
  if (!perluDinilai.length) return

  const { data: semuaJawaban } = await db
    .from('jawaban')
    .select('nis, soal_id, jawaban')
    .eq('sesi_id', sesiId)
    .in('nis', perluDinilai)

  const jawabanPerSiswa = new Map<string, { soal_id: string; jawaban: string }[]>()
  for (const j of semuaJawaban ?? []) {
    if (!jawabanPerSiswa.has(j.nis)) jawabanPerSiswa.set(j.nis, [])
    jawabanPerSiswa.get(j.nis)!.push(j)
  }

  const rows = perluDinilai.map(nis => {
    const jawabanSiswa = jawabanPerSiswa.get(nis) ?? []
    const { benar, total, nilai: nilaiAngka, grade, lulus } = hitungHasilPenilaian(jawabanSiswa, kunciMap, totalSoal, kkm)

    const catatan = jawabanSiswa.length > 0
      ? 'Dinilai otomatis oleh sistem — sesi ditutup paksa oleh pengawas sebelum siswa sempat menekan "Selesai" sendiri (kemungkinan jaringan terputus total). Nilai dihitung dari jawaban terakhir yang berhasil tersinkron ke server. Mohon ditinjau.'
      : 'Dinilai otomatis oleh sistem — sesi ditutup paksa dan TIDAK ADA jawaban yang berhasil tersinkron dari siswa ini (kemungkinan jaringan terputus sejak awal ujian). Mohon ditinjau, pertimbangkan kebijakan ujian susulan.'

    return {
      id: generateId('NIL'),
      sesi_id: sesiId,
      nis,
      mapel_id: sesi.mapel_id,
      kelas: sesi.kelas,
      benar,
      total,
      nilai: nilaiAngka,
      grade,
      lulus,
      kkm,
      timestamp: new Date().toISOString(),
      catatan_guru: catatan,
    }
  })

  // upsert + ignoreDuplicates: sama seperti di selesai/route.ts, konsisten
  // dengan UNIQUE(sesi_id, nis) di skema — aman kalau ada race condition.
  await db.from('nilai').upsert(rows, { onConflict: 'sesi_id,nis', ignoreDuplicates: true })
}
