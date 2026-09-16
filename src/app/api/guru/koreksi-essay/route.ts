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

  // FIX ARSITEKTUR KRITIS: sertakan paket_essay_id — koreksi WAJIB memakai
  // paket yang benar-benar dikerjakan siswa (di-snapshot oleh
  // /api/siswa/ujian/essay/mulai), bukan resolusi ulang berdasarkan status
  // DISETUJUI saat ini (lihat FIX lengkap di essay/mulai/route.ts).
  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('id, jadwal_id, mapel_id, kelas, info_json, is_darurat, siswa_diizinkan, paket_essay_id')
    .eq('id', sesiId)
    .single()
  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })

  // KEBIJAKAN: hanya GURU PENGAMPU mapel (mapel.guru_id) yang boleh menilai
  // essay — bukan pengawas ruangan/pengganti. Pengawas hanya bertugas
  // mengawasi jalannya ujian (buka akses mulai essay, dsb), sedangkan
  // menilai jawaban adalah wewenang guru yang memang mengajar mapel
  // tersebut. jadwal tetap diambil untuk fallback bobot PG:Essay lama
  // (lihat di bawah), bukan untuk cek kepemilikan sesi lagi.
  const [{ data: jadwal }, { data: mapel }] = await Promise.all([
    db.from('jadwal').select('id, essay_bobot_pg_persen, essay_bobot_essay_persen').eq('id', sesi.jadwal_id).maybeSingle(),
    db.from('mapel').select('id, guru_id').eq('id', sesi.mapel_id).maybeSingle(),
  ])
  const isGuruPengampu = mapel?.guru_id === user.username
  if (!isGuruPengampu) {
    return NextResponse.json({ error: 'Anda bukan guru pengampu mapel ini' }, { status: 403 })
  }

  // UX (menghindari kebingungan skala nilai essay): sertakan bobot PG:Essay
  // yang berlaku untuk sesi ini di response, supaya UI koreksi bisa
  // menampilkan pratinjau nilai total dengan jelas.
  const bobotPg = sesi.info_json?.essay_bobot_pg_persen ?? jadwal?.essay_bobot_pg_persen ?? 50
  const bobotEssay = sesi.info_json?.essay_bobot_essay_persen ?? jadwal?.essay_bobot_essay_persen ?? 50

  const modeJawaban = sesi.info_json?.essay_mode_jawaban

  // FIX BUG (fitur essay): filter status = 'DISETUJUI' — sebelumnya soal
  // DRAFT ikut dihitung di totalBobotMaks, padahal soal DRAFT itu TIDAK
  // pernah benar-benar dikerjakan siswa (lihat FIX di essay/soal/route.ts).
  // CATATAN (diperbarui): `bobot_maks` per soal SEKARANG dipakai lagi untuk
  // menghitung nilai_essay (lihat PUT di bawah & 12_skor_per_soal_essay.sql)
  // — bukan cuma panduan visual. totalBobotMaks di sini tetap dikirim untuk
  // ditampilkan sebagai konteks di UI.
  //
  // FIX ARSITEKTUR KRITIS: kalau sesi sudah punya snapshot paket_essay_id,
  // pakai ITU LANGSUNG (bank soal yang benar-benar dikerjakan siswa) —
  // JANGAN cari ulang berdasarkan mapel+kelas+status DISETUJUI, karena bank
  // yang disetujui SEKARANG bisa saja sudah berbeda dari yang dikerjakan
  // siswa dulu. Fallback ke resolusi lama hanya untuk sesi lama yang belum
  // punya snapshot (dibuat sebelum migrasi 14_snapshot_paket_dan_transaksi_atomik.sql).
  const soalEssayQuery = sesi.paket_essay_id
    ? db.from('soal_essay').select('id, teks, bobot_maks, urutan').eq('paket_essay_id', sesi.paket_essay_id).eq('status', 'DISETUJUI').order('urutan', { ascending: true })
    : (async () => {
        // Soal essay sekarang berupa bank per mapel+kelas (paket_essay),
        // sama seperti soal PG — bukan lagi melekat ke jadwal_id. Lihat
        // 08_paket_essay.sql.
        const { data: kelasRow } = await db.from('kelas').select('id').eq('nama', String(sesi.kelas)).maybeSingle()
        const kelasId = kelasRow?.id ?? String(sesi.kelas)
        return db.from('soal_essay').select('id, teks, bobot_maks, urutan')
          .eq('mapel_id', sesi.mapel_id).eq('kelas_id', kelasId).eq('status', 'DISETUJUI')
          .order('urutan', { ascending: true })
      })()

  const { data: soalEssayList } = await soalEssayQuery

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
  //
  // FIX BUG (siswa TERKUNCI permanen di sesi ber-essay tidak pernah bisa
  // dinilai/dikirim ke wali kelas): siswa yang dikunci permanen karena
  // pelanggaran (lihat reset-siswa/route.ts) atau dikunci manual admin
  // (admin/pelanggaran/route.ts, aksi kunci_permanen) SENGAJA dipertahankan
  // status = 'TERKUNCI' (bukan 'SELESAI') supaya guard akses ujian tetap
  // memblokirnya — tapi status_essay mereka tidak pernah disentuh, sehingga
  // sebelumnya tidak masuk kondisi manapun di filter ini dan tidak pernah
  // muncul di halaman koreksi. Akibatnya guru tidak punya cara menandai
  // "Tidak Mengerjakan" untuk mereka, dan nilai_essay/nilai_total/dirilis
  // pada baris nilainya selamanya kosong — nilai mereka macet, tidak pernah
  // bisa dikirim ke wali kelas lewat kirim-nilai/route.ts. FIX: sertakan
  // juga status = 'TERKUNCI' supaya guru bisa melihat & menandai siswa ini.
  const { data: pesertaList } = await db
    .from('siswa_ujian')
    .select('nis, status, status_essay, waktu_kirim_essay')
    .eq('sesi_id', sesiId)
    .or('status_essay.in.(SUDAH_KIRIM,TIDAK_MENGERJAKAN),status.in.(SELESAI,TERKUNCI)')

  // FIX BUG (badge "Belum Menjawab" selalu 0): sebelumnya frontend menghitung
  // "belum menjawab" dari `peserta.length - sudahMenjawab`, padahal `peserta`
  // di sini HANYA berisi siswa yang statusnya sudah final (SUDAH_KIRIM /
  // TIDAK_MENGERJAKAN / status sesi SELESAI) — siswa yang belum login sama
  // sekali atau masih mengerjakan tidak pernah masuk ke `peserta`. Akibatnya
  // secara matematis "belum menjawab" versi frontend selalu 0. FIX: hitung
  // di sini total siswa TARGET sesi ini (pola sama dengan
  // /api/pengawas/sesi/[id]/siswa) — untuk sesi susulan pakai
  // siswa_diizinkan, untuk sesi reguler pakai siswa AKTIF di kelas tsb —
  // lalu kirim sebagai totalTargetSiswa supaya frontend bisa menghitung
  // "belum menjawab" = totalTargetSiswa - sudahMenjawab dengan benar.
  let totalTargetSiswa = 0
  if (sesi.is_darurat && Array.isArray(sesi.siswa_diizinkan) && sesi.siswa_diizinkan.length > 0) {
    totalTargetSiswa = sesi.siswa_diizinkan.length
  } else if (sesi.kelas) {
    const { count } = await db
      .from('siswa')
      .select('nis', { count: 'exact', head: true })
      .eq('kelas', sesi.kelas)
      .eq('status', 'AKTIF')
    totalTargetSiswa = count ?? 0
  }

  const nisList = (pesertaList ?? []).map(p => p.nis)
  if (nisList.length === 0) {
    return NextResponse.json({ soalEssay: soalEssayList ?? [], totalBobotMaks, peserta: [], modeJawaban, bobotPg, bobotEssay, totalTargetSiswa })
  }

  const [{ data: siswaList }, { data: nilaiList }] = await Promise.all([
    db.from('siswa').select('nis, nama').in('nis', nisList),
    db.from('nilai').select('nis, benar, total, kkm, nilai, nilai_essay, nilai_total, dinilai_pada, dirilis').eq('sesi_id', sesiId).in('nis', nisList),
  ])
  const namaMap = Object.fromEntries((siswaList ?? []).map(s => [s.nis, s.nama]))
  const nilaiMap = Object.fromEntries((nilaiList ?? []).map(n => [n.nis, n]))

  let jawabanMap: Record<string, { soal_essay_id: string; jawaban_teks: string }[]> = {}
  let fotoMap: Record<string, string | null> = {}

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
    // FIX BUG (foto lembar jawaban pakai public URL permanen): foto_url yang
    // tersimpan sekarang adalah PATH di bucket privat 'jawaban-essay' (lihat
    // FIX di essay/upload-foto/route.ts), bukan URL langsung — jadi harus
    // ditukar jadi signed URL berumur pendek di sini, tepat sebelum dikirim
    // ke guru. Baris LAMA (diunggah sebelum fix ini) masih menyimpan public
    // URL penuh (diawali "http") — ditampilkan apa adanya karena memang
    // sudah pernah publik saat diunggah, tidak bisa "ditarik" retroaktif;
    // ini hanya menutup celah untuk foto yang diunggah SETELAH fix ini.
    const fotoEntries = await Promise.all(
      (fotoList ?? []).map(async (f) => {
        if (!f.foto_url) return [f.nis, null] as const
        if (f.foto_url.startsWith('http')) return [f.nis, f.foto_url] as const
        const { data: signed } = await db.storage
          .from('jawaban-essay')
          .createSignedUrl(f.foto_url, 600)
        return [f.nis, signed?.signedUrl ?? null] as const
      })
    )
    fotoMap = Object.fromEntries(fotoEntries)
  }

  // FIX (penilaian berbasis rubrik): ambil skor per soal yang sudah pernah
  // disimpan guru (lihat 12_skor_per_soal_essay.sql), supaya form koreksi
  // bisa menampilkan kembali angka per soal saat dibuka ulang — bukan cuma
  // angka gabungan 0-100 seperti sebelumnya.
  const { data: skorList } = await db
    .from('skor_essay_siswa')
    .select('nis, soal_essay_id, skor')
    .eq('sesi_id', sesiId)
    .in('nis', nisList)
  const skorMap: Record<string, Record<string, number>> = {}
  for (const s of skorList ?? []) {
    if (!skorMap[s.nis]) skorMap[s.nis] = {}
    skorMap[s.nis][s.soal_essay_id] = Number(s.skor)
  }

  const peserta = (pesertaList ?? []).map(p => ({
    nis: p.nis,
    nama: namaMap[p.nis] ?? p.nis,
    statusSiswa: p.status,
    terkunciPelanggaran: p.status === 'TERKUNCI',
    statusEssay: p.status_essay,
    waktuKirimEssay: p.waktu_kirim_essay,
    jawabanTeks: modeJawaban === 'DIGITAL' ? (jawabanMap[p.nis] ?? []) : undefined,
    fotoUrl: modeJawaban === 'KERTAS' ? (fotoMap[p.nis] ?? null) : undefined,
    nilaiPg: nilaiMap[p.nis] ? { benar: nilaiMap[p.nis].benar, total: nilaiMap[p.nis].total, kkm: nilaiMap[p.nis].kkm, nilai: nilaiMap[p.nis].nilai } : null,
    nilaiEssay: nilaiMap[p.nis]?.nilai_essay ?? null,
    nilaiTotal: nilaiMap[p.nis]?.nilai_total ?? null,
    sudahDinilai: nilaiMap[p.nis]?.dinilai_pada != null || p.status_essay === 'TIDAK_MENGERJAKAN',
    dirilis: nilaiMap[p.nis]?.dirilis ?? false,
    // FIX (penilaian berbasis rubrik): skor per soal yang sudah tersimpan,
    // supaya form koreksi bisa menampilkannya lagi saat dibuka ulang.
    skorPerSoal: skorMap[p.nis] ?? {},
  }))

  return NextResponse.json({ soalEssay: soalEssayList ?? [], totalBobotMaks, peserta, modeJawaban, bobotPg, bobotEssay, totalTargetSiswa })
}

// PUT { sesiId, nis, skorPerSoal } — input/ubah skor essay 1 siswa PER SOAL
// (sesuai bobot_maks masing-masing, lihat soal_essay.bobot_maks), backend
// yang menjumlahkan & mengonversi ke skala 0-100 sebagai nilai.nilai_essay,
// lalu menghitung nilai_total. Kirim { sesiId, nis, tidakMengerjakan: true }
// sebagai ganti skorPerSoal untuk menandai siswa tidak mengerjakan.
//
// FIX (kembali ke penilaian berbasis rubrik, lihat 12_skor_per_soal_essay.sql):
// versi sebelumnya menerima satu `nilaiEssay` 0-100 langsung dan bobot_maks
// per soal diabaikan sama sekali (cuma "panduan" visual, tidak pernah
// dipakai menghitung). Ini tidak sesuai kaidah Standar Penilaian Pendidikan
// (instrumen uraian WAJIB dilengkapi pedoman penskoran yang benar-benar
// dipakai menghitung skor — lihat Permendikbud 66/2013 & 104/2014, prinsip
// yang sama berlanjut di era Kurikulum Merdeka), dan tidak bisa diaudit per
// butir soal kalau ada yang mempertanyakan nilai. Sekarang guru mengisi
// skor per soal, backend yang menjumlah & mengonversi (tidak ada lagi
// konversi tersembunyi di kepala guru) — dan setiap skor per soal disimpan
// sebagai jejak audit di skor_essay_siswa.
export async function PUT(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { sesiId, nis, skorPerSoal, tidakMengerjakan } = await req.json()
  if (!sesiId || !nis) return NextResponse.json({ error: 'sesiId dan nis diperlukan' }, { status: 400 })

  // FIX ARSITEKTUR KRITIS: sertakan paket_essay_id, sama seperti GET di atas.
  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('id, jadwal_id, mapel_id, kelas, info_json, paket_essay_id')
    .eq('id', sesiId)
    .single()
  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })

  // KEBIJAKAN (sama seperti GET): hanya GURU PENGAMPU mapel yang boleh
  // menilai essay, bukan pengawas ruangan/pengganti.
  const [{ data: jadwal }, { data: mapel }] = await Promise.all([
    db.from('jadwal').select('id, essay_bobot_pg_persen, essay_bobot_essay_persen').eq('id', sesi.jadwal_id).maybeSingle(),
    db.from('mapel').select('id, guru_id').eq('id', sesi.mapel_id).maybeSingle(),
  ])
  const isGuruPengampu = mapel?.guru_id === user.username
  if (!isGuruPengampu) {
    return NextResponse.json({ error: 'Anda bukan guru pengampu mapel ini' }, { status: 403 })
  }

  // FIX (bobot PG:Essay): sejak sesi dibuka, bobot SELALU sudah tersalin ke
  // sesi.info_json dari paket_essay saat itu (lihat resolveEssayInfoJson di
  // src/lib/gabungKirim.ts) — fallback ke kolom jadwal di bawah ini HANYA
  // relevan untuk sesi yang dibuat SEBELUM migrasi bobot ke paket_essay
  // (lihat 09_bobot_paket_essay.sql), supaya nilai lama tidak berubah tiba-tiba.
  const bobotPg = sesi.info_json?.essay_bobot_pg_persen ?? jadwal?.essay_bobot_pg_persen ?? 50
  const bobotEssay = sesi.info_json?.essay_bobot_essay_persen ?? jadwal?.essay_bobot_essay_persen ?? 50

  const { data: nilaiRow } = await db
    .from('nilai')
    .select('id, nilai, kkm, dirilis')
    .eq('sesi_id', sesiId)
    .eq('nis', nis)
    .single()

  if (!nilaiRow) {
    return NextResponse.json({ error: 'Nilai PG siswa ini belum ada — siswa belum submit ujian PG.' }, { status: 404 })
  }

  let finalNilaiEssay = 0
  let statusEssayUpdate: string | undefined
  const skorUntukDisimpan: { soal_essay_id: string; skor: number }[] = []

  if (tidakMengerjakan) {
    finalNilaiEssay = 0
    statusEssayUpdate = 'TIDAK_MENGERJAKAN'
  } else {
    // FIX ARSITEKTUR KRITIS: ambil soal essay dari paket yang SUDAH DI-
    // SNAPSHOT ke sesi ini (paket_essay_id), bukan resolusi ulang
    // berdasarkan mapel+kelas+status DISETUJUI — jadi acuan bobot_maks yang
    // dipakai menghitung nilai_essay selalu konsisten dengan soal yang
    // benar-benar dikerjakan siswa, sama seperti dipakai GET di atas.
    // Fallback ke resolusi lama hanya untuk sesi tanpa snapshot (dibuat
    // sebelum migrasi 14_snapshot_paket_dan_transaksi_atomik.sql).
    let soalEssayList: { id: string; bobot_maks: number }[] | null = null
    if (sesi.paket_essay_id) {
      const { data } = await db
        .from('soal_essay')
        .select('id, bobot_maks')
        .eq('paket_essay_id', sesi.paket_essay_id)
        .eq('status', 'DISETUJUI')
      soalEssayList = data
    } else {
      const { data: kelasRow } = await db
        .from('kelas')
        .select('id')
        .eq('nama', String(sesi.kelas))
        .maybeSingle()
      const kelasId = kelasRow?.id ?? String(sesi.kelas)

      const { data } = await db
        .from('soal_essay')
        .select('id, bobot_maks')
        .eq('mapel_id', sesi.mapel_id)
        .eq('kelas_id', kelasId)
        .eq('status', 'DISETUJUI')
      soalEssayList = data
    }

    if (!soalEssayList || soalEssayList.length === 0) {
      return NextResponse.json({ error: 'Tidak ada soal essay disetujui untuk mapel & kelas ini' }, { status: 400 })
    }
    if (!skorPerSoal || typeof skorPerSoal !== 'object') {
      return NextResponse.json({ error: 'skorPerSoal diperlukan (skor tiap soal essay)' }, { status: 400 })
    }

    let totalSkor = 0
    const totalBobotMaks = soalEssayList.reduce((sum, s) => sum + Number(s.bobot_maks), 0)

    for (const soal of soalEssayList) {
      const skorMentah = (skorPerSoal as Record<string, unknown>)[soal.id]
      if (skorMentah === undefined || skorMentah === null || skorMentah === '') {
        return NextResponse.json({ error: 'Isi skor untuk semua soal essay terlebih dahulu' }, { status: 400 })
      }
      const skorAngka = Number(skorMentah)
      const maksSoal = Number(soal.bobot_maks)
      if (isNaN(skorAngka) || skorAngka < 0 || skorAngka > maksSoal) {
        return NextResponse.json({ error: `Skor soal ini harus antara 0 dan ${maksSoal}` }, { status: 400 })
      }
      totalSkor += skorAngka
      skorUntukDisimpan.push({ soal_essay_id: soal.id, skor: skorAngka })
    }

    // Konversi total skor rubrik ke skala 0-100 — ini SATU-SATUNYA tempat
    // konversi terjadi, dan hasilnya langsung ditampilkan ke guru sebagai
    // pratinjau di frontend SEBELUM tombol Simpan ditekan (lihat halaman
    // koreksi-essay), supaya tidak ada lagi "angka yang diketik guru ≠
    // angka yang muncul di rekap" seperti masalah versi sebelumnya.
    finalNilaiEssay = totalBobotMaks > 0 ? Math.round((totalSkor / totalBobotMaks) * 100) : 0
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

  // FIX BUG (nilai yang sudah dirilis bisa berubah tanpa rilis ulang):
  // sebelumnya update di sini TIDAK PERNAH menyentuh `dirilis`, padahal
  // siswa hanya boleh melihat nilai_essay/nilai_total kalau `dirilis === true`
  // (lihat guard di /api/siswa/nilai & /api/siswa/nilai/[id]). Akibatnya kalau
  // guru mengoreksi ULANG nilai essay siswa yang nilainya SUDAH pernah
  // dirilis (mis. salah input, lalu dibetulkan), angka baru itu LANGSUNG
  // terlihat oleh siswa tanpa guru sempat meninjau/menekan tombol "Rilis"
  // lagi — padahal alur yang dimaksud (lihat guru/kirim-nilai/route.ts) guru
  // memang harus me-review dulu sebelum merilis. Sekarang setiap kali nilai
  // essay (di)simpan/diubah di sini, `dirilis` di-reset ke false (dan
  // `dirilis_pada` dikosongkan) supaya guru WAJIB menekan Rilis lagi sebelum
  // nilai terbaru ini boleh tampil ke siswa.
  const sudahPernahDirilis = nilaiRow.dirilis === true

  const { error: nilaiError } = await db
    .from('nilai')
    .update({
      nilai_essay: finalNilaiEssay,
      nilai_total: nilaiTotal,
      lulus: lulusBaru,
      dinilai_pada: new Date().toISOString(),
      dinilai_oleh: user.username,
      dirilis: false,
      dirilis_pada: null,
    })
    .eq('id', nilaiRow.id)

  if (nilaiError) return NextResponse.json({ error: nilaiError.message }, { status: 500 })

  // FIX (jejak audit rubrik): simpan rincian skor per soal — kosong kalau
  // "tidak mengerjakan" karena memang tidak ada skor untuk kasus itu.
  if (skorUntukDisimpan.length > 0) {
    const { error: skorError } = await db.from('skor_essay_siswa').upsert(
      skorUntukDisimpan.map(s => ({
        sesi_id: sesiId,
        nis,
        soal_essay_id: s.soal_essay_id,
        skor: s.skor,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: 'sesi_id,nis,soal_essay_id' }
    )
    if (skorError) return NextResponse.json({ error: skorError.message }, { status: 500 })
  }

  if (statusEssayUpdate) {
    await db.from('siswa_ujian').update({ status_essay: statusEssayUpdate }).eq('sesi_id', sesiId).eq('nis', nis)
  }

  return NextResponse.json({
    message: sudahPernahDirilis
      ? 'Nilai essay berhasil diubah. Nilai ini sudah dirilis sebelumnya, jadi otomatis ditarik kembali (belum terlihat siswa) — silakan Rilis ulang.'
      : 'Nilai essay berhasil disimpan',
    nilaiEssay: finalNilaiEssay,
    nilaiTotal,
    perluRilisUlang: sudahPernahDirilis,
  })
}

// PATCH { sesiId, bobotPg, bobotEssay } — ubah bobot PG:Essay untuk sesi ini
// (disimpan di sesi_ujian.info_json, TIDAK mengubah paket_essay/jadwal —
// jadi hanya berlaku untuk sesi ini). Semua baris `nilai` di sesi ini yang
// SUDAH pernah dinilai essay-nya (dinilai_pada != null) langsung dihitung
// ulang nilai_total & lulus-nya memakai bobot baru, supaya nilai yang
// tampil ke guru/wali/siswa selalu konsisten dengan bobot yang berlaku
// saat ini — bukan bobot lama yang "membeku" di data lama.
export async function PATCH(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { sesiId, bobotPg, bobotEssay } = await req.json()
  if (!sesiId) return NextResponse.json({ error: 'sesiId diperlukan' }, { status: 400 })

  const pgAngka = Number(bobotPg)
  const essayAngka = Number(bobotEssay)
  if (
    isNaN(pgAngka) || isNaN(essayAngka) ||
    pgAngka < 0 || pgAngka > 100 || essayAngka < 0 || essayAngka > 100 ||
    pgAngka + essayAngka !== 100
  ) {
    return NextResponse.json({ error: 'Bobot PG + Essay harus berjumlah tepat 100' }, { status: 400 })
  }

  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('id, mapel_id, info_json')
    .eq('id', sesiId)
    .single()
  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })

  // KEBIJAKAN (sama seperti GET/PUT): hanya GURU PENGAMPU mapel yang boleh
  // mengubah bobot PG:Essay, bukan pengawas ruangan/pengganti.
  const { data: mapel } = await db.from('mapel').select('id, guru_id').eq('id', sesi.mapel_id).maybeSingle()
  const isGuruPengampu = mapel?.guru_id === user.username
  if (!isGuruPengampu) {
    return NextResponse.json({ error: 'Anda bukan guru pengampu mapel ini' }, { status: 403 })
  }

  const infoJsonBaru = { ...(sesi.info_json ?? {}), essay_bobot_pg_persen: pgAngka, essay_bobot_essay_persen: essayAngka }
  const { error: sesiError } = await db
    .from('sesi_ujian')
    .update({ info_json: infoJsonBaru })
    .eq('id', sesiId)
  if (sesiError) return NextResponse.json({ error: sesiError.message }, { status: 500 })

  // Hitung ulang nilai siswa yang essay-nya SUDAH dinilai (nilai_essay != null
  // & dinilai_pada != null) supaya nilai_total langsung mengikuti bobot baru.
  const { data: nilaiSudahDinilai } = await db
    .from('nilai')
    .select('id, nilai, nilai_essay, kkm, dirilis')
    .eq('sesi_id', sesiId)
    .not('dinilai_pada', 'is', null)

  let jumlahDiperbarui = 0
  let jumlahRilisDitarik = 0
  for (const n of nilaiSudahDinilai ?? []) {
    const nilaiPg = n.nilai ?? 0
    const nilaiEssay = n.nilai_essay ?? 0
    const nilaiTotalBaru = Math.round(nilaiPg * (pgAngka / 100) + nilaiEssay * (essayAngka / 100))
    const lulusBaru = nilaiTotalBaru >= (n.kkm ?? 0)
    // FIX BUG (nilai yang sudah dirilis bisa berubah tanpa rilis ulang):
    // sama seperti FIX di PUT di atas — mengubah bobot PG:Essay bisa mengubah
    // nilai_total baris yang SUDAH dirilis ke siswa (mis. 80 → 75) tanpa guru
    // sempat meninjau ulang. Sebelumnya update di sini hanya menyentuh
    // nilai_total & lulus, TIDAK menyentuh dirilis — sehingga angka baru
    // langsung terlihat siswa seolah sudah "disetujui". Sekarang setiap
    // baris yang terkena hitung ulang bobot juga ditarik rilisnya, konsisten
    // dengan alur "harus rilis ulang" di PUT.
    await db.from('nilai').update({
      nilai_total: nilaiTotalBaru,
      lulus: lulusBaru,
      dirilis: false,
      dirilis_pada: null,
    }).eq('id', n.id)
    jumlahDiperbarui++
    if (n.dirilis === true) jumlahRilisDitarik++
  }

  return NextResponse.json({
    message: jumlahRilisDitarik > 0
      ? `Bobot berhasil diperbarui. ${jumlahRilisDitarik} nilai yang sudah dirilis ikut ditarik kembali (belum terlihat siswa) karena angkanya berubah — silakan Rilis ulang.`
      : 'Bobot berhasil diperbarui',
    bobotPg: pgAngka,
    bobotEssay: essayAngka,
    jumlahNilaiDiperbarui: jumlahDiperbarui,
    jumlahRilisDitarik,
  })
}
