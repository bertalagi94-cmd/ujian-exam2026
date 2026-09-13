import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { petakanEssayAktifPerSesi } from '@/app/api/guru/kirim-nilai/route'

// Rincian hasil ujian per nomor soal.
//
// PENTING (privasi antar siswa saat ujian masih berjalan):
// Endpoint ini HANYA mengembalikan status benar/salah per soal — TIDAK PERNAH
// mengirim kunci jawaban maupun jawaban yang dipilih siswa ke client. Tujuannya
// supaya siswa yang sudah selesai ujian tidak bisa membocorkan ke siswa lain
// (yang masih ujian) opsi mana yang benar untuk soal tertentu.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const db = createAdminClient()

  const { id } = params

  // Ambil baris nilai — sekaligus pastikan baris ini benar milik siswa yang
  // login (bukan NIS siswa lain), supaya siswa A tidak bisa intip rincian
  // siswa B hanya dengan menebak/mengganti id di URL.
  // FIX (bug nilai essay tidak tampil di siswa): sebelumnya select ini TIDAK
  // menyertakan nilai_essay/nilai_total/dirilis sama sekali, sehingga
  // halaman rincian nilai siswa tidak mungkin menampilkan nilai gabungan
  // PG+essay walau guru sudah merilisnya. Kolom essay di-mask sama seperti
  // di /api/siswa/nilai — hanya boleh dilihat siswa kalau dirilis === true.
  const { data: nilai, error: nilaiError } = await db
    .from('nilai')
    .select('id, sesi_id, nis, mapel_id, kelas, benar, total, nilai, grade, lulus, kkm, timestamp, nilai_essay, nilai_total, dirilis, dinilai_pada')
    .eq('id', id)
    .eq('nis', user.nis!)
    .single()

  if (nilaiError || !nilai) {
    return NextResponse.json({ error: 'Data nilai tidak ditemukan' }, { status: 404 })
  }

  const essayDirilis = nilai.dirilis === true
  const essayAktifMap = await petakanEssayAktifPerSesi(db, [nilai.sesi_id])
  const essayAktif = nilai.sesi_id ? (essayAktifMap.get(nilai.sesi_id) ?? false) : false
  const nilaiMasked = {
    ...nilai,
    nilai_essay: essayDirilis ? nilai.nilai_essay : null,
    nilai_total: essayDirilis ? nilai.nilai_total : null,
    dinilai_pada: essayDirilis ? nilai.dinilai_pada : null,
    essay_belum_dirilis: essayAktif && !essayDirilis,
  }

  // FITUR (Rincian jawaban essay per soal): sebelumnya halaman rincian nilai
  // siswa hanya menampilkan rincian soal PG — jawaban essay siswa dan skor
  // per soal (dari skor_essay_siswa, lihat 12_skor_per_soal_essay.sql) tidak
  // pernah dikirim ke client, padahal datanya sudah ada sejak guru menilai
  // lewat /api/guru/koreksi-essay. Sengaja HANYA dikirim setelah
  // `essayDirilis === true` — sama seperti masking nilai_essay/nilai_total
  // di atas — supaya siswa tidak bisa mengintip skor per soal sebelum guru
  // benar-benar merilis nilai akhir.
  let rincianEssay: {
    no: number
    teks: string
    gambar_url: string | null
    bobot_maks: number
    jawaban_teks: string | null
    skor: number | null
  }[] | null = null
  let essayFotoUrl: string | null = null
  let essayModeJawaban: string | null = null

  if (essayAktif && essayDirilis && nilai.sesi_id) {
    const { data: sesi } = await db
      .from('sesi_ujian')
      .select('id, info_json')
      .eq('id', nilai.sesi_id)
      .maybeSingle()
    essayModeJawaban = sesi?.info_json?.essay_mode_jawaban ?? 'DIGITAL'

    // Resolusi kelasId mengikuti pola yang sama dengan
    // /api/guru/koreksi-essay (kelas.nama → kelas.id, fallback ke nilai.kelas
    // mentah), supaya soal essay yang diambil konsisten dengan yang dipakai
    // guru saat menilai.
    const { data: kelasRow } = await db
      .from('kelas')
      .select('id')
      .eq('nama', String(nilai.kelas))
      .maybeSingle()
    const kelasId = kelasRow?.id ?? String(nilai.kelas)

    const { data: soalEssayList } = await db
      .from('soal_essay')
      .select('id, teks, gambar_url, bobot_maks, urutan')
      .eq('mapel_id', nilai.mapel_id)
      .eq('kelas_id', kelasId)
      .eq('status', 'DISETUJUI')
      .order('urutan', { ascending: true })

    const { data: skorList } = await db
      .from('skor_essay_siswa')
      .select('soal_essay_id, skor')
      .eq('sesi_id', nilai.sesi_id)
      .eq('nis', nilai.nis)
    const skorMap = Object.fromEntries((skorList ?? []).map(s => [s.soal_essay_id, Number(s.skor)]))

    if (essayModeJawaban === 'KERTAS') {
      const { data: foto } = await db
        .from('jawaban_essay_foto')
        .select('foto_url')
        .eq('sesi_id', nilai.sesi_id)
        .eq('nis', nilai.nis)
        .maybeSingle()
      essayFotoUrl = foto?.foto_url ?? null
    }

    let jawabanMap: Record<string, string> = {}
    if (essayModeJawaban === 'DIGITAL') {
      const { data: jawabanList } = await db
        .from('jawaban_essay')
        .select('soal_essay_id, jawaban_teks')
        .eq('sesi_id', nilai.sesi_id)
        .eq('nis', nilai.nis)
      jawabanMap = Object.fromEntries((jawabanList ?? []).map(j => [j.soal_essay_id, j.jawaban_teks]))
    }

    rincianEssay = (soalEssayList ?? []).map((s, i) => ({
      no: i + 1,
      teks: s.teks,
      gambar_url: s.gambar_url ?? null,
      bobot_maks: Number(s.bobot_maks),
      jawaban_teks: essayModeJawaban === 'DIGITAL' ? (jawabanMap[s.id] ?? null) : null,
      skor: skorMap[s.id] ?? null,
    }))
  }

  const { data: mapel } = await db.from('mapel').select('nama').eq('id', nilai.mapel_id).single()

  // Jawaban siswa untuk sesi ini — soal_id + jawaban dipakai SERVER-SIDE saja
  // untuk menghitung benar/salah, tidak diteruskan ke response.
  const { data: jawabanSiswa } = await db
    .from('jawaban')
    .select('soal_id, jawaban')
    .eq('sesi_id', nilai.sesi_id)
    .eq('nis', nilai.nis)

  const soalIds = (jawabanSiswa ?? []).map(j => j.soal_id)
  const jawabanMap = Object.fromEntries((jawabanSiswa ?? []).map(j => [j.soal_id, j.jawaban]))

  const { data: soalList } = await db
    .from('soal')
    .select('id, teks, opsi_a, opsi_b, opsi_c, opsi_d, opsi_e, jumlah_opsi, kunci, gambar_pertanyaan, gambar_opsi_a, gambar_opsi_b, gambar_opsi_c, gambar_opsi_d, gambar_opsi_e')
    .in('id', soalIds.length ? soalIds : ['__'])

  const rincian = (soalList ?? [])
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((s, i) => ({
      no: i + 1,
      teks: s.teks,
      jumlah_opsi: s.jumlah_opsi,
      opsi_a: s.opsi_a,
      opsi_b: s.opsi_b,
      opsi_c: s.opsi_c,
      opsi_d: s.opsi_d,
      opsi_e: s.opsi_e,
      gambar_pertanyaan: (s as any).gambar_pertanyaan ?? null,
      gambar_opsi_a: (s as any).gambar_opsi_a ?? null,
      gambar_opsi_b: (s as any).gambar_opsi_b ?? null,
      gambar_opsi_c: (s as any).gambar_opsi_c ?? null,
      gambar_opsi_d: (s as any).gambar_opsi_d ?? null,
      gambar_opsi_e: (s as any).gambar_opsi_e ?? null,
      // Hanya status benar/salah. TIDAK ADA field kunci atau jawaban siswa
      // di sini — sengaja tidak pernah dikirim ke client.
      benar: Boolean(jawabanMap[s.id]) && jawabanMap[s.id] === s.kunci,
    }))

  return NextResponse.json({
    nilai: {
      ...nilaiMasked,
      nama_mapel: mapel?.nama ?? nilai.mapel_id,
    },
    rincian,
    rincianEssay,
    essayFotoUrl,
    essayModeJawaban,
  })
}
