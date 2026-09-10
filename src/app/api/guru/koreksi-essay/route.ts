// Taruh di: src/app/api/guru/koreksi-essay/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// GET ?sesiId=... — daftar siswa yang SUDAH_KIRIM essay di sesi ini,
// beserta jawaban (teks untuk DIGITAL, url foto untuk KERTAS) dan nilai_pg.
export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const sesiId = searchParams.get('sesiId')
  if (!sesiId) return NextResponse.json({ error: 'sesiId diperlukan' }, { status: 400 })

  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('id, jadwal_id, mapel_id, kelas, info_json')
    .eq('id', sesiId)
    .single()
  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })

  // FIX BUG (koreksi essay tidak tampil bagi guru pengampu): sebelumnya hanya
  // pengawas ruangan (jadwal.pengawas) yang boleh membuka koreksi essay,
  // padahal guru yang MENGAJAR mapel (mapel.guru_id) sering kali bukan guru
  // yang bertugas mengawas ruangan ujian tsb. Sekarang akses diberikan kalau
  // salah satu terpenuhi: dia pengawas sesi ATAU dia guru pengampu mapel ini.
  const [{ data: jadwal }, { data: mapel }] = await Promise.all([
    db.from('jadwal').select('id, pengawas, essay_bobot_pg_persen, essay_bobot_essay_persen').eq('id', sesi.jadwal_id).maybeSingle(),
    db.from('mapel').select('id, guru_id').eq('id', sesi.mapel_id).maybeSingle(),
  ])
  const isPengawas = jadwal?.pengawas === user.username
  const isGuruPengampu = mapel?.guru_id === user.username
  if (!isPengawas && !isGuruPengampu) {
    return NextResponse.json({ error: 'Anda bukan pengawas maupun guru pengampu sesi ini' }, { status: 403 })
  }

  // UX (menghindari kebingungan skala nilai essay): sertakan bobot PG:Essay
  // yang berlaku untuk sesi ini di response, supaya UI koreksi bisa
  // menampilkan pratinjau nilai total dengan jelas.
  const bobotPg = sesi.info_json?.essay_bobot_pg_persen ?? jadwal?.essay_bobot_pg_persen ?? 50
  const bobotEssay = sesi.info_json?.essay_bobot_essay_persen ?? jadwal?.essay_bobot_essay_persen ?? 50

  const modeJawaban = sesi.info_json?.essay_mode_jawaban

  // Soal essay sekarang berupa bank per mapel+kelas (paket_essay), sama
  // seperti soal PG — bukan lagi melekat ke jadwal_id. Lihat 08_paket_essay.sql.
  const { data: kelasRow } = await db
    .from('kelas')
    .select('id')
    .eq('nama', String(sesi.kelas))
    .maybeSingle()
  const kelasId = kelasRow?.id ?? String(sesi.kelas)

  // FIX BUG (fitur essay): filter status = 'DISETUJUI' — sebelumnya soal
  // DRAFT ikut dihitung di totalBobotMaks, padahal soal DRAFT itu TIDAK
  // pernah benar-benar dikerjakan siswa (lihat FIX di essay/soal/route.ts).
  // CATATAN: sejak skala nilai essay diubah jadi 0-100 bebas (lihat PUT di
  // bawah), totalBobotMaks di sini TIDAK lagi dipakai untuk mengonversi
  // nilai — nilai_maks per soal cuma ditampilkan di UI sebagai panduan
  // bobot/rubrik untuk membantu guru menimbang skor holistiknya.
  const { data: soalEssayList } = await db
    .from('soal_essay')
    .select('id, teks, bobot_maks, urutan')
    .eq('mapel_id', sesi.mapel_id)
    .eq('kelas_id', kelasId)
    .eq('status', 'DISETUJUI')
    .order('urutan', { ascending: true })

  const totalBobotMaks = (soalEssayList ?? []).reduce((sum, s) => sum + Number(s.bobot_maks), 0)

  // FIX BUG (siswa hilang dari antrean koreksi essay setelah sesi ditutup
  // paksa): sebelumnya filter di sini HANYA mengambil status_essay yang
  // sudah "final" (SUDAH_KIRIM / TIDAK_MENGERJAKAN). Tapi siswa yang sesinya
  // ditutup paksa (POST /api/guru/mode-pengawas/tutup atau
  // /api/admin/sesi/[id]/tutup-paksa) SAAT MASIH mengerjakan PG, di halaman
  // info essay, atau di tengah mengerjakan essay — status_essay mereka
  // berhenti di null/'BELUM_MULAI'/'MENGERJAKAN' selamanya (penutupan paksa
  // hanya menghitung nilai PG lewat finalisasiNilaiPaksa, lihat
  // src/lib/finalisasi-nilai.ts — TIDAK PERNAH menyentuh status_essay).
  // Akibatnya siswa itu TIDAK PERNAH muncul di halaman koreksi ini, guru
  // tidak punya cara menandai "Tidak Mengerjakan" untuk mereka (karena
  // mereka bukan bagian dari peserta list sama sekali), dan nilai_total
  // mereka tidak akan pernah bisa dirilis lewat UI.
  //
  // FIX: sertakan juga siswa yang siswa_ujian.status sudah 'SELESAI'
  // (mencakup baik yang menyelesaikan essay sendiri maupun yang sesinya
  // ditutup paksa) meskipun status_essay-nya belum final — supaya guru
  // tetap melihat mereka di daftar (jawaban essay yang sempat ter-autosave
  // ikut ditampilkan jika ada) dan bisa memakai tombol "Tidak Mengerjakan"
  // atau input nilai seperti biasa untuk menuntaskan nilai_total mereka.
  const { data: pesertaList } = await db
    .from('siswa_ujian')
    .select('nis, status, status_essay, waktu_kirim_essay')
    .eq('sesi_id', sesiId)
    .or('status_essay.in.(SUDAH_KIRIM,TIDAK_MENGERJAKAN),status.eq.SELESAI')

  const nisList = (pesertaList ?? []).map(p => p.nis)
  if (nisList.length === 0) {
    return NextResponse.json({ soalEssay: soalEssayList ?? [], totalBobotMaks, peserta: [], modeJawaban, bobotPg, bobotEssay })
  }

  const [{ data: siswaList }, { data: nilaiList }] = await Promise.all([
    db.from('siswa').select('nis, nama').in('nis', nisList),
    db.from('nilai').select('nis, benar, total, kkm, nilai, nilai_essay, nilai_total, dinilai_pada, dirilis').eq('sesi_id', sesiId).in('nis', nisList),
  ])
  const namaMap = Object.fromEntries((siswaList ?? []).map(s => [s.nis, s.nama]))
  const nilaiMap = Object.fromEntries((nilaiList ?? []).map(n => [n.nis, n]))

  let jawabanMap: Record<string, { soal_essay_id: string; jawaban_teks: string }[]> = {}
  let fotoMap: Record<string, string> = {}

  if (modeJawaban === 'DIGITAL') {
    const { data: jawabanList } = await db
      .from('jawaban_essay')
      .select('nis, soal_essay_id, jawaban_teks')
      .eq('sesi_id', sesiId)
      .in('nis', nisList)
    for (const j of jawabanList ?? []) {
      if (!jawabanMap[j.nis]) jawabanMap[j.nis] = []
      jawabanMap[j.nis].push({ soal_essay_id: j.soal_essay_id, jawaban_teks: j.jawaban_teks })
    }
  } else {
    const { data: fotoList } = await db
      .from('jawaban_essay_foto')
      .select('nis, foto_url')
      .eq('sesi_id', sesiId)
      .in('nis', nisList)
    fotoMap = Object.fromEntries((fotoList ?? []).map(f => [f.nis, f.foto_url]))
  }

  const peserta = (pesertaList ?? []).map(p => ({
    nis: p.nis,
    nama: namaMap[p.nis] ?? p.nis,
    statusEssay: p.status_essay,
    waktuKirimEssay: p.waktu_kirim_essay,
    jawabanTeks: modeJawaban === 'DIGITAL' ? (jawabanMap[p.nis] ?? []) : undefined,
    fotoUrl: modeJawaban === 'KERTAS' ? (fotoMap[p.nis] ?? null) : undefined,
    nilaiPg: nilaiMap[p.nis] ? { benar: nilaiMap[p.nis].benar, total: nilaiMap[p.nis].total, kkm: nilaiMap[p.nis].kkm, nilai: nilaiMap[p.nis].nilai } : null,
    nilaiEssay: nilaiMap[p.nis]?.nilai_essay ?? null,
    nilaiTotal: nilaiMap[p.nis]?.nilai_total ?? null,
    sudahDinilai: nilaiMap[p.nis]?.dinilai_pada != null || p.status_essay === 'TIDAK_MENGERJAKAN',
    dirilis: nilaiMap[p.nis]?.dirilis ?? false,
  }))

  return NextResponse.json({ soalEssay: soalEssayList ?? [], totalBobotMaks, peserta, modeJawaban, bobotPg, bobotEssay })
}

// PUT { sesiId, nis, nilaiEssay } — input/ubah nilai essay 1 siswa & hitung nilai_total.
// Kalau ingin menandai "Tidak Mengerjakan", kirim { sesiId, nis, tidakMengerjakan: true } sebagai ganti nilaiEssay.
export async function PUT(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { sesiId, nis, nilaiEssay, tidakMengerjakan } = await req.json()
  if (!sesiId || !nis) return NextResponse.json({ error: 'sesiId dan nis diperlukan' }, { status: 400 })

  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('id, jadwal_id, mapel_id, kelas, info_json')
    .eq('id', sesiId)
    .single()
  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })

  // FIX BUG (sama seperti di GET): izinkan pengawas ATAU guru pengampu mapel.
  const [{ data: jadwal }, { data: mapel }] = await Promise.all([
    db.from('jadwal').select('id, pengawas, essay_bobot_pg_persen, essay_bobot_essay_persen').eq('id', sesi.jadwal_id).maybeSingle(),
    db.from('mapel').select('id, guru_id').eq('id', sesi.mapel_id).maybeSingle(),
  ])
  const isPengawas = jadwal?.pengawas === user.username
  const isGuruPengampu = mapel?.guru_id === user.username
  if (!jadwal || (!isPengawas && !isGuruPengampu)) {
    return NextResponse.json({ error: 'Anda bukan pengawas maupun guru pengampu sesi ini' }, { status: 403 })
  }

  // FIX (bobot PG:Essay): sejak sesi dibuka, bobot SELALU sudah tersalin ke
  // sesi.info_json dari paket_essay saat itu (lihat resolveEssayInfoJson di
  // src/lib/gabungKirim.ts) — fallback ke kolom jadwal di bawah ini HANYA
  // relevan untuk sesi yang dibuat SEBELUM migrasi bobot ke paket_essay
  // (lihat 09_bobot_paket_essay.sql), supaya nilai lama tidak berubah tiba-tiba.
  const bobotPg = sesi.info_json?.essay_bobot_pg_persen ?? jadwal.essay_bobot_pg_persen ?? 50
  const bobotEssay = sesi.info_json?.essay_bobot_essay_persen ?? jadwal.essay_bobot_essay_persen ?? 50

  const { data: nilaiRow } = await db
    .from('nilai')
    .select('id, nilai, kkm')
    .eq('sesi_id', sesiId)
    .eq('nis', nis)
    .single()

  if (!nilaiRow) {
    return NextResponse.json({ error: 'Nilai PG siswa ini belum ada — siswa belum submit ujian PG.' }, { status: 404 })
  }

  let finalNilaiEssay = 0
  let statusEssayUpdate: string | undefined

  if (tidakMengerjakan) {
    finalNilaiEssay = 0
    statusEssayUpdate = 'TIDAK_MENGERJAKAN'
  } else {
    // UX (skala nilai essay bebas 0-100, bukan lagi 0-totalBobotMaks):
    // sebelumnya guru harus input "poin dari X maksimal" (mis. 0-30) yang
    // lalu dikonversi proporsional ke skala 100 — ini sumber kebingungan
    // utama karena angka yang diinput guru ≠ angka yang muncul di rekap
    // (mis. input 30 bisa jadi tampil 100 setelah dikonversi). Sekarang
    // guru langsung menilai dalam skala 0-100 (standar, sama seperti nilai
    // PG), tidak ada konversi tersembunyi lagi. `bobot_maks` per soal tetap
    // disimpan & ditampilkan di UI sebagai PANDUAN bobot/rubrik per soal
    // untuk membantu guru menimbang skor holistiknya — tapi TIDAK lagi
    // dipakai dalam rumus penghitungan nilai_total.
    const nilaiEssayAngka = Number(nilaiEssay)
    if (isNaN(nilaiEssayAngka) || nilaiEssayAngka < 0 || nilaiEssayAngka > 100) {
      return NextResponse.json({ error: 'Nilai essay harus antara 0 dan 100' }, { status: 400 })
    }
    finalNilaiEssay = Math.round(nilaiEssayAngka)
  }

  const nilaiPg = nilaiRow.nilai ?? 0
  const nilaiTotal = Math.round(nilaiPg * (bobotPg / 100) + finalNilaiEssay * (bobotEssay / 100))

  // BUG FIX (rekap nilai belum menyesuaikan fitur essay — akar masalah):
  // kolom `nilai.lulus` sebelumnya HANYA dihitung sekali saat siswa submit
  // PG (lihat hitungHasilPenilaian di penilaian-ujian.ts, yang murni
  // membandingkan nilai PG vs kkm) dan TIDAK PERNAH dihitung ulang di sini
  // setelah nilai_total (PG+Essay) terbentuk. Akibatnya status Lulus/Tidak
  // Lulus yang ditampilkan di semua rekap (admin/guru/kepsek) tetap
  // berdasarkan skor PG murni walau nilai akhir yang dirilis ke siswa
  // (nilai_total) bisa membuat siswa yang tadinya tidak lulus jadi lulus,
  // atau sebaliknya. Di sini `lulus` ikut di-update memakai nilai_total
  // begitu essay dinilai, supaya kolom itu jadi satu-satunya sumber
  // kebenaran status kelulusan tanpa perlu logika tambahan di tiap halaman
  // rekap.
  const lulusBaru = nilaiTotal >= (nilaiRow.kkm ?? 0)

  const { error: nilaiError } = await db
    .from('nilai')
    .update({
      nilai_essay: finalNilaiEssay,
      nilai_total: nilaiTotal,
      lulus: lulusBaru,
      dinilai_pada: new Date().toISOString(),
      dinilai_oleh: user.username,
    })
    .eq('id', nilaiRow.id)

  if (nilaiError) return NextResponse.json({ error: nilaiError.message }, { status: 500 })

  if (statusEssayUpdate) {
    await db.from('siswa_ujian').update({ status_essay: statusEssayUpdate }).eq('sesi_id', sesiId).eq('nis', nis)
  }

  return NextResponse.json({ message: 'Nilai essay berhasil disimpan', nilaiEssay: finalNilaiEssay, nilaiTotal })
}
