// Helper dipakai oleh guru/paket/[id]/[action] (PG) dan
// guru/paket-essay/[id]/[action] (Essay).
//
// Keputusan produk: guru tidak perlu mengirim paket PG dan Essay secara
// terpisah. Begitu SALAH SATU (PG atau Essay) untuk kombinasi mapel+kelas
// yang sama diajukan ("kirim"), sistem otomatis ikut mengajukan pasangannya
// juga (kalau ada & masih berstatus DRAFT/DITOLAK dengan minimal 1 soal),
// supaya di akun admin, soal PG dan Essay muncul bersamaan untuk divalidasi.
//
// Setiap jenis paket tetap divalidasi admin secara independen (SETUJUI/TOLAK
// masing-masing sendiri) — yang digabung hanya proses PENGIRIMANNYA.

import type { SupabaseClient } from '@supabase/supabase-js'

interface CounterpartResult {
  submitted: boolean
  id?: string
}

/**
 * Mengirim (DRAFT/DITOLAK -> MENUNGGU) paket pasangan (jenis lain) untuk
 * mapel+kelas+guru yang sama, kalau ada dan sudah punya minimal 1 soal.
 */
export async function kirimPasanganPaket(
  db: SupabaseClient,
  opts: {
    mapelId: string
    kelasId: string
    guruId: string
    jenisPasangan: 'PG' | 'ESSAY'
  }
): Promise<CounterpartResult> {
  const { mapelId, kelasId, guruId, jenisPasangan } = opts

  const paketTable = jenisPasangan === 'PG' ? 'paket_soal' : 'paket_essay'
  const soalTable = jenisPasangan === 'PG' ? 'soal' : 'soal_essay'
  const soalFkCol = jenisPasangan === 'PG' ? 'paket_id' : 'paket_essay_id'

  const { data: pasangan } = await db
    .from(paketTable)
    .select('id, status')
    .eq('mapel_id', mapelId)
    .eq('kelas_id', kelasId)
    .eq('guru_id', guruId)
    .in('status', ['DRAFT', 'DITOLAK'])
    .maybeSingle()

  if (!pasangan) return { submitted: false }

  const { count } = await db
    .from(soalTable)
    .select('*', { count: 'exact', head: true })
    .eq(soalFkCol, pasangan.id)

  if (!count || count < 1) return { submitted: false }

  await db
    .from(paketTable)
    .update({ status: 'MENUNGGU', jumlah_soal: count, catatan: null, notif_dibaca: true, tanggal: new Date().toISOString() })
    .eq('id', pasangan.id)

  await db.from(soalTable).update({ status: 'MENUNGGU' }).eq(soalFkCol, pasangan.id).eq('status', 'DRAFT')

  return { submitted: true, id: pasangan.id }
}

/**
 * Menentukan konfigurasi essay (mode jawaban, durasi) untuk sesi_ujian baru
 * yang akan dibuat dari sebuah jadwal, berdasarkan paket_essay yang
 * DISETUJUI untuk kombinasi mapel+kelas jadwal tsb — meniru cara PG
 * mengambil paket_soal DISETUJUI berdasarkan mapel_id+kelas_id (lihat
 * siswa/ujian/validasi/route.ts), BUKAN lagi dari jadwal.essay_aktif /
 * essay_mode_jawaban / essay_durasi_menit (kolom lama, sudah tidak dipakai
 * untuk essay baru — lihat 08_paket_essay.sql).
 *
 * Bobot PG vs Essay (essay_bobot_pg_persen/essay_bobot_essay_persen) TETAP
 * diambil dari kolom jadwal apa adanya (default 50/50) — itu bukan bagian
 * dari bank soal, dan guru tetap menilai essay secara manual seperti biasa.
 */
export async function resolveEssayInfoJson(
  db: SupabaseClient,
  opts: { mapelId: string; kelasNama: string; bobotPgPersen?: number | null; bobotEssayPersen?: number | null; instruksi?: string | null }
): Promise<Record<string, unknown>> {
  const { data: kelasRow } = await db
    .from('kelas')
    .select('id')
    .eq('nama', String(opts.kelasNama))
    .maybeSingle()
  const kelasId = kelasRow?.id ?? String(opts.kelasNama)

  const { data: paketEssay } = await db
    .from('paket_essay')
    .select('mode_jawaban, durasi_menit')
    .eq('mapel_id', opts.mapelId)
    .eq('kelas_id', kelasId)
    .eq('status', 'DISETUJUI')
    .limit(1)
    .maybeSingle()

  if (!paketEssay) return {}

  return {
    essay_aktif: true,
    essay_mode_jawaban: paketEssay.mode_jawaban ?? 'DIGITAL',
    essay_durasi_menit: paketEssay.durasi_menit ?? 30,
    essay_bobot_pg_persen: opts.bobotPgPersen ?? 50,
    essay_bobot_essay_persen: opts.bobotEssayPersen ?? 50,
    essay_instruksi: opts.instruksi ?? null,
  }
}
