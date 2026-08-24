import { SupabaseClient } from '@supabase/supabase-js'
import { generateId } from '@/lib/utils'
import { cachedFetch } from '@/lib/cache'

/**
 * Helper terpusat untuk menghitung nilai siswa dari jawaban yang sudah
 * tersimpan di DB, lalu menyimpannya ke tabel `nilai`.
 *
 * Diambil dari logika yang sebelumnya hanya ada di
 * src/app/api/siswa/ujian/selesai/route.ts, supaya bisa dipakai ulang oleh
 * endpoint lain yang perlu men-generate nilai atas nama siswa (bukan siswa
 * itu sendiri yang submit) — misalnya saat pengawas menutup paksa sesi dan
 * masih ada siswa yang belum sempat submit karena jaringan mati total.
 *
 * PENTING: fungsi ini TIDAK pernah menimpa nilai yang sudah ada (aman
 * dipanggil berkali-kali / race condition), memakai upsert+ignoreDuplicates
 * konsisten dengan UNIQUE(sesi_id, nis) di skema.
 */
export async function hitungDanSimpanNilai(
  db: SupabaseClient,
  sesiId: string,
  nis: string
): Promise<{ id: string; nilai: number; grade: string; benar: number; total: number; lulus: boolean } | null> {
  // Kalau nilai sudah ada, jangan hitung ulang — kembalikan yang sudah ada.
  const { data: nilaiExist } = await db
    .from('nilai')
    .select('id, nilai, grade, benar, total, lulus')
    .eq('sesi_id', sesiId)
    .eq('nis', nis)
    .single()

  if (nilaiExist) return nilaiExist

  const sesiCache = await cachedFetch(`selesai:sesi:${sesiId}`, 300, async () => {
    const { data: sesi } = await db
      .from('sesi_ujian')
      .select('mapel_id, kelas, durasi')
      .eq('id', sesiId)
      .single()
    if (!sesi) return null

    const { data: kelasRow } = await db
      .from('kelas')
      .select('id')
      .eq('nama', String(sesi.kelas))
      .maybeSingle()
    const kelasId = kelasRow?.id ?? String(sesi.kelas)

    const [{ data: mapel }, { data: paketData }] = await Promise.all([
      db.from('mapel').select('kkm').eq('id', sesi.mapel_id).single(),
      db.from('paket_soal')
        .select('id, jumlah_soal')
        .eq('mapel_id', sesi.mapel_id)
        .eq('kelas_id', kelasId)
        .eq('status', 'DISETUJUI')
        .limit(1)
        .single(),
    ])

    const [{ count: totalSoalCount }, { data: soalList }] = await Promise.all([
      db.from('soal')
        .select('*', { count: 'exact', head: true })
        .eq('mapel_id', sesi.mapel_id)
        .eq('status', 'DISETUJUI')
        .eq('paket_id', paketData?.id ?? ''),
      db.from('soal')
        .select('id, kunci')
        .eq('mapel_id', sesi.mapel_id)
        .eq('paket_id', paketData?.id ?? '')
        .eq('status', 'DISETUJUI'),
    ])

    return {
      sesi,
      kkm: mapel?.kkm ?? 75,
      totalSoal: totalSoalCount ?? paketData?.jumlah_soal ?? 0,
      kunciMap: Object.fromEntries((soalList ?? []).map(s => [s.id, s.kunci])) as Record<string, string>,
    }
  })

  if (!sesiCache) return null
  const { sesi, kkm, totalSoal, kunciMap } = sesiCache

  const { data: jawabanSiswa } = await db
    .from('jawaban').select('soal_id, jawaban').eq('sesi_id', sesiId).eq('nis', nis)

  let benar = 0
  const total = totalSoal > 0 ? totalSoal : (jawabanSiswa?.length ?? 0)

  if (jawabanSiswa?.length) {
    for (const j of jawabanSiswa) {
      if (j.jawaban && kunciMap[j.soal_id] === j.jawaban) benar++
    }
  }

  const nilaiAngka = total > 0 ? Math.round((benar / total) * 100) : 0
  const grade = nilaiAngka >= 90 ? 'A' : nilaiAngka >= 80 ? 'B' : nilaiAngka >= 70 ? 'C' : nilaiAngka >= 60 ? 'D' : 'E'
  const lulus = nilaiAngka >= kkm

  const nilaiData = {
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
  }

  await db.from('nilai').upsert(nilaiData, { onConflict: 'sesi_id,nis', ignoreDuplicates: true })

  const { data: nilaiTersimpan } = await db
    .from('nilai')
    .select('id, nilai, grade, benar, total, lulus')
    .eq('sesi_id', sesiId)
    .eq('nis', nis)
    .single()

  return nilaiTersimpan ?? { id: nilaiData.id, nilai: nilaiAngka, grade, benar, total, lulus }
}
