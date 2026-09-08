// Taruh di: src/app/api/siswa/ujian/essay/kirim/route.ts
//
// Ini titik akhir alur essay siswa. Setelah endpoint ini sukses:
//   - status_essay = SUDAH_KIRIM
//   - siswa_ujian.status = SELESAI (BARU sekarang, bukan di selesai/route.ts
//     lagi — lihat patch di part5_patch_existing/selesai_route.ts)
//   - nilai PG (yang sudah dihitung & disimpan sebelumnya oleh
//     selesai/route.ts) BARU dikirim ke response di sini, supaya frontend
//     bisa tampilkan hasil + lepas fullscreen, sesuai desain yang disepakati.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const nis = user.nis!

  const db = createAdminClient()
  const { sesiId } = await req.json()
  if (!sesiId) return NextResponse.json({ error: 'sesiId diperlukan' }, { status: 400 })

  const { data: sesi } = await db.from('sesi_ujian').select('info_json').eq('id', sesiId).single()
  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })
  const modeJawaban = sesi.info_json?.essay_mode_jawaban

  const { data: siswaUjian } = await db
    .from('siswa_ujian')
    .select('status, status_essay, akses_kirim_essay_dibuka')
    .eq('sesi_id', sesiId)
    .eq('nis', nis)
    .single()

  if (!siswaUjian) return NextResponse.json({ error: 'Data ujian Anda tidak ditemukan' }, { status: 404 })

  // Idempotent: kalau sudah pernah kirim, kembalikan nilai yang sudah ada
  // (pola sama seperti early-return di selesai/route.ts untuk PG) — supaya
  // klik ganda / retry jaringan tidak error, cukup tampilkan hasil yang sama.
  if (siswaUjian.status_essay === 'SUDAH_KIRIM') {
    const { data: nilaiSudahAda } = await db
      .from('nilai')
      .select('id, benar, total, kkm')
      .eq('sesi_id', sesiId)
      .eq('nis', nis)
      .single()
    return NextResponse.json({
      sudahDikirim: true,
      nilaiPg: nilaiSudahAda
        ? { id: nilaiSudahAda.id, benar: nilaiSudahAda.benar, total: nilaiSudahAda.total, kkm: nilaiSudahAda.kkm }
        : null,
    })
  }

  if (siswaUjian.status_essay !== 'MENGERJAKAN') {
    return NextResponse.json({ error: 'Essay belum dimulai, tidak bisa dikirim.' }, { status: 409 })
  }

  // MODE KERTAS: wajib menunggu pengawas membuka akses kirim terlebih dahulu.
  if (modeJawaban === 'KERTAS' && !siswaUjian.akses_kirim_essay_dibuka) {
    return NextResponse.json(
      { error: 'Menunggu pengawas membuka akses kirim jawaban essay.' },
      { status: 403 }
    )
  }

  // MODE KERTAS: pastikan foto sudah diupload sebelum boleh kirim.
  if (modeJawaban === 'KERTAS') {
    const { data: foto } = await db
      .from('jawaban_essay_foto')
      .select('id')
      .eq('sesi_id', sesiId)
      .eq('nis', nis)
      .maybeSingle()
    if (!foto) {
      return NextResponse.json({ error: 'Upload foto lembar jawaban terlebih dahulu.' }, { status: 400 })
    }
  }

  const waktuKirim = new Date().toISOString()

  // Upsert dengan ignoreDuplicates TIDAK relevan di sini (kita UPDATE baris
  // yang sudah pasti ada, bukan insert baru) — tapi tetap pakai kondisi
  // .eq('status_essay', 'MENGERJAKAN') di WHERE supaya race 2 request
  // bersamaan tidak menjalankan blok ini dua kali (hanya 1 yang match).
  const { data: updated, error } = await db
    .from('siswa_ujian')
    .update({
      status_essay: 'SUDAH_KIRIM',
      waktu_kirim_essay: waktuKirim,
      status: 'SELESAI',
      waktu_selesai: waktuKirim,
    })
    .eq('sesi_id', sesiId)
    .eq('nis', nis)
    .eq('status_essay', 'MENGERJAKAN')
    .select('nis')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!updated || updated.length === 0) {
    // Kalah race — request lain sudah lebih dulu menandai SUDAH_KIRIM.
    // Perlakukan sebagai sukses idempotent (lihat blok early-return di atas).
    const { data: nilaiSudahAda } = await db
      .from('nilai')
      .select('id, benar, total, kkm')
      .eq('sesi_id', sesiId)
      .eq('nis', nis)
      .single()
    return NextResponse.json({
      sudahDikirim: true,
      nilaiPg: nilaiSudahAda
        ? { id: nilaiSudahAda.id, benar: nilaiSudahAda.benar, total: nilaiSudahAda.total, kkm: nilaiSudahAda.kkm }
        : null,
    })
  }

  // Nilai PG SUDAH dihitung & disimpan sebelumnya oleh selesai/route.ts —
  // di sinilah nilai itu baru "dibuka" ke siswa (nilai_total tetap kosong
  // sampai guru koreksi essay & merilis).
  const { data: nilai } = await db
    .from('nilai')
    .select('id, benar, total, kkm')
    .eq('sesi_id', sesiId)
    .eq('nis', nis)
    .single()

  return NextResponse.json({
    sudahDikirim: true,
    nilaiPg: nilai ? { id: nilai.id, benar: nilai.benar, total: nilai.total, kkm: nilai.kkm } : null,
    pesan: 'Jawaban essay terkirim. Nilai akhir akan dirilis guru setelah dikoreksi.',
  })
}
