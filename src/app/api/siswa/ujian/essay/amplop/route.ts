// Taruh di: src/app/api/siswa/ujian/essay/amplop/route.ts
// GET ?sesiId=...&deviceId=... — kirim soal essay dalam bentuk TERENKRIPSI
// ("amplop") ke perangkat siswa, SEDINI mungkin (begitu siswa mulai PG),
// supaya kalau internet mati total sebelum pengawas membuka gerbang essay,
// siswa tetap bisa membuka essay lewat kode darurat dari pengawas.
//
// Aman dikirim lebih awal: isinya TIDAK terbaca tanpa kode darurat, dan kode
// itu tidak pernah dikirim ke perangkat siswa (lihat
// src/lib/essay-amplop-server.ts). Endpoint ini TIDAK membuka gerbang
// akses_mulai_essay_dibuka — jalur online (essay/info → essay/mulai →
// essay/soal) sama sekali tidak berubah.
//
// Respons:
//   { ada: false, alasan }    — TANPA_ESSAY | SUDAH_LEWAT (berhenti mencoba) atau
//                               BELUM_ADA_SOAL (coba lagi nanti)
//   { ada: true, amplop }     — simpan di perangkat (localStorage)
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { cacheGet, cacheSet } from '@/lib/cache'
import { buatAmplop } from '@/lib/essay-amplop-server'
import type { EssayAmplop, IsiAmplopEssay } from '@/lib/essay-amplop-shared'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const sesiId = searchParams.get('sesiId')
  const deviceId = searchParams.get('deviceId')
  if (!sesiId) return NextResponse.json({ error: 'sesiId diperlukan' }, { status: 400 })

  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('id, jadwal_id, mapel_id, kelas, status, info_json, paket_essay_id')
    .eq('id', sesiId)
    .single()

  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })
  if (!sesi.info_json?.essay_aktif) return NextResponse.json({ ada: false, alasan: 'TANPA_ESSAY' })
  if (sesi.status !== 'BERJALAN') {
    return NextResponse.json({ error: 'Sesi ujian sudah tidak berjalan.' }, { status: 409 })
  }

  // Guard yang sama dengan essay/info, essay/mulai, essay/soal: siswa harus
  // terdaftar di sesi, tidak TERKUNCI/RESET, dan di perangkat yang sama
  // (kebijakan satu siswa satu perangkat — kalau device_id belum tercatat,
  // data lama, lewati pengecekan).
  const { data: siswaUjian } = await db
    .from('siswa_ujian')
    .select('status, status_essay, device_id')
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)
    .single()

  if (!siswaUjian) return NextResponse.json({ error: 'Data ujian Anda tidak ditemukan' }, { status: 404 })
  // FIX BUG (pola lama, pesan tidak dibedakan): lihat catatan yang sama di
  // essay/info/route.ts — RESET bersifat sementara, TERKUNCI permanen.
  if (siswaUjian.status === 'RESET') {
    return NextResponse.json(
      { error: 'Akses ujian Anda sedang menunggu kode reset dari pengawas. Akan lanjut otomatis begitu kode diproses.', sementara: true },
      { status: 403 }
    )
  }
  if (siswaUjian.status === 'TERKUNCI') {
    return NextResponse.json({ error: 'Akses ujian Anda dikunci oleh pengawas.' }, { status: 403 })
  }
  if (siswaUjian.device_id && siswaUjian.device_id !== deviceId) {
    return NextResponse.json({ error: 'Sesi ujian Anda sedang aktif di perangkat lain.' }, { status: 409 })
  }
  // Sudah mulai/selesai essay lewat jalur online → amplop tidak diperlukan lagi.
  if (['MENGERJAKAN', 'SUDAH_KIRIM', 'TIDAK_MENGERJAKAN'].includes(siswaUjian.status_essay ?? '')) {
    return NextResponse.json({ ada: false, alasan: 'SUDAH_LEWAT' })
  }

  // ── Tentukan paket & soal — logika SAMA dengan essay/mulai supaya soal di
  // amplop identik dengan yang nanti dilayani essay/soal. ──────────────────
  const { data: kelasRow } = sesi.paket_essay_id
    ? { data: null }
    : await db.from('kelas').select('id').eq('nama', String(sesi.kelas)).maybeSingle()
  const kelasId = kelasRow?.id ?? String(sesi.kelas)

  const soalQuery = sesi.paket_essay_id
    ? db.from('soal_essay').select('id, teks, gambar_url, urutan, paket_essay_id').eq('paket_essay_id', sesi.paket_essay_id).eq('status', 'DISETUJUI')
    : db.from('soal_essay').select('id, teks, gambar_url, urutan, paket_essay_id').eq('mapel_id', sesi.mapel_id).eq('kelas_id', kelasId).eq('status', 'DISETUJUI').order('paket_essay_id', { ascending: true }).order('id', { ascending: true })

  const { data: soalMentah, error: soalError } = await soalQuery
  if (soalError) return NextResponse.json({ error: soalError.message }, { status: 500 })
  if (!soalMentah || soalMentah.length === 0) {
    // Belum ada soal disetujui: bukan error, cukup belum ada yang bisa dibungkus.
    // Client tetap mencoba lagi nanti (guru bisa saja menyetujui soal belakangan).
    return NextResponse.json({ ada: false, alasan: 'BELUM_ADA_SOAL' })
  }

  // Kunci paket ke sesi (sekali, hanya kalau masih NULL) — sama seperti
  // essay/mulai. Efek samping yang disengaja: snapshot paket kini terjadi saat
  // siswa PERTAMA mulai PG, bukan saat siswa pertama mulai essay, karena
  // amplop harus berisi paket yang SAMA dengan yang akan dilayani essay/soal.
  let paketEssayId: string | null = sesi.paket_essay_id ?? null
  let soalFinal = soalMentah
  if (!paketEssayId) {
    const paketEssayIdTerdeteksi = soalMentah[0]?.paket_essay_id ?? null
    if (paketEssayIdTerdeteksi) {
      // FASE 2 FIX (audit lanjutan): sebelumnya update ini tidak dicek
      // error-nya sama sekali — kalau gagal, `paketEssayId` tetap memakai
      // nilai lokal yang TIDAK BENAR-BENAR tersimpan di DB, tapi amplop
      // (yang dienkripsi & diserahkan ke siswa untuk offline) tetap dibuat
      // memakai nilai itu. Kalau nanti essay/mulai atau siswa lain
      // me-resolve ulang snapshot dan bank soal essay sudah berubah, amplop
      // yang sudah beredar di client bisa mereferensikan paket yang berbeda
      // dari yang akhirnya benar-benar dilayani essay/soal. Sekarang:
      // fail-closed — kalau update gagal, jangan keluarkan amplop sama
      // sekali.
      const { error: snapshotError } = await db.from('sesi_ujian')
        .update({ paket_essay_id: paketEssayIdTerdeteksi })
        .eq('id', sesiId)
        .is('paket_essay_id', null)

      if (snapshotError) {
        console.error('[essay/amplop] gagal menulis snapshot paket_essay_id:', snapshotError.message)
        return NextResponse.json(
          { error: 'Sistem gagal mengunci paket soal essay untuk sesi ini. Amplop belum bisa disiapkan. Coba lagi beberapa saat.' },
          { status: 500 }
        )
      }

      // Baca ulang untuk memastikan nilai yang BENAR-BENAR tersimpan —
      // baik untuk konfirmasi write kita sendiri berhasil, maupun untuk
      // kasus race di mana siswa lain sudah mengunci paket lain lebih dulu.
      const { data: sesiBaru, error: verifikasiError } = await db
        .from('sesi_ujian')
        .select('paket_essay_id')
        .eq('id', sesiId)
        .single()

      if (verifikasiError || !sesiBaru?.paket_essay_id) {
        console.error(
          '[essay/amplop] verifikasi snapshot paket_essay_id gagal setelah update:',
          verifikasiError?.message ?? 'paket_essay_id masih NULL setelah update'
        )
        return NextResponse.json(
          { error: 'Sistem gagal memastikan paket soal essay terkunci untuk sesi ini. Amplop belum bisa disiapkan. Coba lagi beberapa saat.' },
          { status: 500 }
        )
      }

      paketEssayId = sesiBaru.paket_essay_id
      soalFinal = soalMentah.filter(s => s.paket_essay_id === paketEssayId)
      if (soalFinal.length === 0) {
        const { data: soalPaket } = await db.from('soal_essay')
          .select('id, teks, gambar_url, urutan, paket_essay_id')
          .eq('paket_essay_id', paketEssayId).eq('status', 'DISETUJUI')
        soalFinal = soalPaket ?? []
      }
    } else {
      // Ada soal essay DISETUJUI (soalMentah tidak kosong) tapi semuanya
      // punya paket_essay_id NULL — data tidak konsisten, jangan keluarkan
      // amplop tanpa snapshot paket yang jelas.
      console.error(`[essay/amplop] sesi ${sesiId}: soal essay ditemukan tapi paket_essay_id kosong pada semuanya.`)
      return NextResponse.json({ ada: false, alasan: 'BELUM_ADA_SOAL' })
    }
  }
  soalFinal = [...soalFinal].sort((a, b) => (a.urutan ?? 0) - (b.urutan ?? 0))
  if (soalFinal.length === 0) return NextResponse.json({ ada: false, alasan: 'BELUM_ADA_SOAL' })

  // Isi amplop sama untuk semua siswa di sesi ini → cache singkat supaya 300
  // siswa yang mulai PG serentak tidak memicu 300 kali query + enkripsi.
  const cacheKey = `essay-amplop:${sesiId}:${paketEssayId ?? 'none'}`
  let amplop = cacheGet<EssayAmplop>(cacheKey)
  if (!amplop) {
    const [{ data: jadwal }, { data: mapel }] = await Promise.all([
      db.from('jadwal').select('pengawas').eq('id', sesi.jadwal_id).single(),
      db.from('mapel').select('nama').eq('id', sesi.mapel_id).single(),
    ])
    let namaGuru: string | null = null
    if (jadwal?.pengawas) {
      const { data: guru } = await db.from('users').select('nama').eq('username', jadwal.pengawas).single()
      namaGuru = guru?.nama ?? jadwal.pengawas
    }

    const isi: IsiAmplopEssay = {
      info: {
        namaMapel: mapel?.nama ?? sesi.mapel_id,
        namaGuru,
        jumlahSoal: soalFinal.length,
        durasiMenit: sesi.info_json.essay_durasi_menit,
        modeJawaban: sesi.info_json.essay_mode_jawaban,
        instruksi: sesi.info_json.essay_instruksi ?? null,
      },
      soal: soalFinal.map(s => ({ id: s.id, teks: s.teks, gambar_url: s.gambar_url ?? null, urutan: s.urutan })),
    }
    amplop = await buatAmplop(sesiId, isi)
    cacheSet(cacheKey, amplop, 60)
  }

  // Catat bahwa siswa ini SUDAH memegang amplop (ignoreDuplicates supaya
  // pengiriman ulang tidak menimpa dikirim_at/hitungan yang sudah ada).
  await db.from('essay_amplop_offline').upsert(
    { sesi_id: sesiId, nis: user.nis!, paket_essay_id: paketEssayId },
    { onConflict: 'sesi_id,nis', ignoreDuplicates: true }
  )

  const res = NextResponse.json({ ada: true, amplop })
  res.headers.set('Cache-Control', 'no-store')
  return res
}
