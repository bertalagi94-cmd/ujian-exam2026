import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { petakanEssayAktifPerSesi } from '@/app/api/guru/kirim-nilai/route'
import { hitungGrade } from '@/lib/utils'

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
  // BUG FIX (nilai remedial tidak masuk ke akun siswa): tambahkan
  // nilai_edit/grade_edit/lulus_edit/catatan_guru — sebelumnya kolom ini
  // sama sekali tidak diambil, jadi halaman rincian tidak mungkin tahu ada
  // nilai remedial (lihat perhitungan nilai_final di bawah).
  const { data: nilai, error: nilaiError } = await db
    .from('nilai')
    .select('id, sesi_id, nis, mapel_id, kelas, benar, total, nilai, grade, lulus, kkm, timestamp, nilai_essay, nilai_total, dirilis, dinilai_pada, nilai_edit, grade_edit, lulus_edit, catatan_guru')
    .eq('id', id)
    .eq('nis', user.nis!)
    .single()

  if (nilaiError || !nilai) {
    return NextResponse.json({ error: 'Data nilai tidak ditemukan' }, { status: 404 })
  }

  // P0 FIX (audit brief "nilai 0 tapi rincian ada jawaban benar"): status
  // TERKUNCI di siswa_ujian adalah SUMBER KEBENARAN untuk menjelaskan kenapa
  // nilai akhir 0 padahal ada jawaban benar — jangan menebak dari nilai==0
  // saja (nilai wajar bisa 0 karena semua salah, bukan karena pelanggaran).
  const { data: siswaUjianRow } = await db
    .from('siswa_ujian')
    .select('status')
    .eq('sesi_id', nilai.sesi_id)
    .eq('nis', nilai.nis)
    .maybeSingle()
  const dihentikanPelanggaran = siswaUjianRow?.status === 'TERKUNCI'

  // FASE 3 FIX (audit lanjutan): endpoint ini sebelumnya HANYA memeriksa
  // bahwa baris `nilai` ini milik siswa yang login sendiri — tidak pernah
  // memeriksa status SESI (sesi_ujian.status). Karena baris `nilai` dibuat
  // begitu SISWA INI selesai (lihat finalisasi_pg_atomik), seorang siswa
  // yang submit lebih awal bisa saja membuka halaman rincian ini dan
  // melihat status benar/salah jawabannya sendiri PER SOAL saat sesi kelas
  // masih BERJALAN untuk siswa lain. Endpoint memang sengaja tidak pernah
  // mengirim field kunci maupun field jawaban siswa (lihat komentar di
  // atas), tapi siswa yang bersangkutan tetap tahu jawaban APA yang dia
  // pilih untuk tiap nomor (dia yang mengerjakannya) — dikombinasikan
  // dengan status benar/salah dari endpoint ini, itu tetap cukup untuk
  // membocorkan kunci jawaban ke teman yang masih mengerjakan.
  //
  // Sekarang: rincian jawaban PG & essay (opsi, teks, status benar/salah)
  // HANYA dikirim kalau sesi sudah SELESAI. Selama sesi masih BERJALAN,
  // field `nilai` ringkasan (skor total dsb.) tetap boleh tampil seperti
  // biasa, tapi `rincian`/`rincianEssay` dikosongkan dengan flag yang
  // jelas supaya frontend bisa menampilkan pesan yang sesuai. Fail-closed:
  // kalau baris sesi_ujian gagal diambil / statusnya tidak diketahui,
  // rincian JUGA tidak dikirim (default aman = jangan tampilkan).
  const { data: sesi, error: sesiError } = await db
    .from('sesi_ujian')
    .select('id, status, info_json, paket_soal_id, paket_essay_id')
    .eq('id', nilai.sesi_id)
    .maybeSingle()
  const sesiSelesai = !sesiError && sesi?.status === 'SELESAI'

  const essayDirilis = nilai.dirilis === true
  const essayAktifMap = await petakanEssayAktifPerSesi(db, [nilai.sesi_id])
  const essayAktif = nilai.sesi_id ? (essayAktifMap.get(nilai.sesi_id) ?? false) : false

  // BUG FIX (nilai remedial guru tidak masuk ke akun siswa): logika & urutan
  // prioritas sama persis dengan enrich di /api/siswa/nilai/route.ts — lihat
  // komentar panjang di sana untuk penjelasan lengkapnya.
  const adaRemedial = nilai.nilai_edit !== null && nilai.nilai_edit !== undefined
  const nilaiEfektifSiswa = (essayAktif && essayDirilis && nilai.nilai_total != null) ? nilai.nilai_total : nilai.nilai
  const nilaiFinal = adaRemedial ? (nilai.nilai_edit as number) : nilaiEfektifSiswa
  const gradeFinal = adaRemedial
    ? (nilai.grade_edit ?? hitungGrade(nilaiFinal))
    : (essayDirilis && essayAktif && nilai.nilai_total != null ? hitungGrade(nilai.nilai_total) : nilai.grade)
  const lulusFinal = adaRemedial
    ? (nilai.lulus_edit ?? (nilaiFinal >= nilai.kkm))
    : (essayDirilis && essayAktif && nilai.nilai_total != null ? nilai.nilai_total >= nilai.kkm : nilai.lulus)

  const nilaiMasked = {
    ...nilai,
    nilai_essay: essayDirilis ? nilai.nilai_essay : null,
    nilai_total: essayDirilis ? nilai.nilai_total : null,
    dinilai_pada: essayDirilis ? nilai.dinilai_pada : null,
    essay_belum_dirilis: essayAktif && !essayDirilis,
    ada_remedial: adaRemedial,
    nilai_final: nilaiFinal,
    grade_final: gradeFinal,
    lulus_final: lulusFinal,
    dihentikan_pelanggaran: dihentikanPelanggaran,
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

  if (essayAktif && essayDirilis && sesiSelesai && nilai.sesi_id) {
    essayModeJawaban = sesi?.info_json?.essay_mode_jawaban ?? 'DIGITAL'

    // FASE 4 FIX (audit lanjutan): sebelumnya soal essay untuk rincian
    // SELALU diambil dari bank soal LIVE (mapel_id + kelas_id + status
    // DISETUJUI) — bukan dari paket_essay_id yang sudah di-snapshot ke
    // sesi ini (lihat essay/mulai, essay/amplop). Kalau bank soal berubah
    // setelah ujian (soal baru disetujui/lama ditarik untuk mapel+kelas
    // yang sama), rincian yang ditampilkan ke siswa bisa berbeda dari soal
    // yang SEBENARNYA dikerjakan & dinilai (skor_essay_siswa tetap
    // mengacu ke soal_essay_id yang benar, tapi teks/urutan yang
    // ditampilkan bisa salah/hilang). Sekarang: utamakan snapshot
    // `sesi.paket_essay_id`. Fallback ke resolusi mapel+kelas HANYA untuk
    // sesi lama yang dibuat sebelum kolom snapshot ini ada (paket_essay_id
    // masih NULL) — sama seperti pola fallback yang sudah dipakai di
    // guru/koreksi-essay/route.ts untuk kasus yang sama.
    let soalEssayList: { id: string; teks: string; gambar_url: string | null; bobot_maks: number; urutan: number }[] | null = null
    if (sesi?.paket_essay_id) {
      const { data } = await db
        .from('soal_essay')
        .select('id, teks, gambar_url, bobot_maks, urutan')
        .eq('paket_essay_id', sesi.paket_essay_id)
        .eq('status', 'DISETUJUI')
        .order('urutan', { ascending: true })
      soalEssayList = data
    } else {
      // Resolusi kelasId mengikuti pola yang sama dengan
      // /api/guru/koreksi-essay (kelas.nama → kelas.id, fallback ke
      // nilai.kelas mentah) — dipakai HANYA untuk sesi lama tanpa snapshot.
      const { data: kelasRow } = await db
        .from('kelas')
        .select('id')
        .eq('nama', String(nilai.kelas))
        .maybeSingle()
      const kelasId = kelasRow?.id ?? String(nilai.kelas)

      const { data } = await db
        .from('soal_essay')
        .select('id, teks, gambar_url, bobot_maks, urutan')
        .eq('mapel_id', nilai.mapel_id)
        .eq('kelas_id', kelasId)
        .eq('status', 'DISETUJUI')
        .order('urutan', { ascending: true })
      soalEssayList = data
    }

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
      // FIX BUG (foto lembar jawaban pakai public URL permanen): sama seperti
      // FIX di guru/koreksi-essay/route.ts — foto_url sekarang berupa PATH di
      // bucket privat 'jawaban-essay', ditukar jadi signed URL berumur
      // pendek di sini. Baris lama yang masih public URL penuh ("http...")
      // ditampilkan apa adanya (sudah pernah publik saat diunggah).
      if (foto?.foto_url) {
        if (foto.foto_url.startsWith('http')) {
          essayFotoUrl = foto.foto_url
        } else {
          const { data: signed } = await db.storage
            .from('jawaban-essay')
            .createSignedUrl(foto.foto_url, 600)
          essayFotoUrl = signed?.signedUrl ?? null
        }
      }
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

  // FASE 3 + FASE 5 FIX (audit lanjutan):
  //   FASE 3 — rincian PG (termasuk status benar/salah) hanya dibangun kalau
  //   sesi sudah SELESAI (lihat `sesiSelesai` di atas). Selama sesi masih
  //   BERJALAN, `rincian` dikirim sebagai null dengan flag penjelas, supaya
  //   siswa yang sudah submit duluan tidak bisa memakai endpoint ini untuk
  //   memverifikasi ke teman lain jawaban mana yang benar.
  //
  //   FASE 5 — sebelumnya daftar soal untuk rincian HANYA diambil dari
  //   soal_id yang ADA di tabel `jawaban` siswa ini (`soalIds =
  //   jawabanSiswa.map(...)`), lalu diurutkan berdasarkan `soal.id`
  //   (alfanumerik) — bukan urutan paket. Akibatnya: (a) soal yang TIDAK
  //   dijawab sama sekali tidak pernah muncul di rincian (padahal siswa
  //   perlu tahu ada soal yang terlewat), dan (b) urutan tampil tidak
  //   konsisten dengan urutan soal di paket. Sekarang: ambil SELURUH soal
  //   dari `sesi.paket_soal_id` (snapshot paket yang benar-benar dipakai
  //   sesi ini), LEFT JOIN ke jawaban siswa, urutkan deterministik
  //   berdasarkan `created_at` lalu `id` (urutan pembuatan soal di paket —
  //   satu-satunya kolom urutan yang tersedia di skema `soal`; acak
  //   per-siswa saat mengerjakan tidak disimpan permanen). Soal yang tidak
  //   dijawab tetap tampil dengan `dijawab: false, benar: false`.
  let rincian: {
    no: number
    teks: string
    jumlah_opsi: number
    opsi_a: string | null
    opsi_b: string | null
    opsi_c: string | null
    opsi_d: string | null
    opsi_e: string | null
    gambar_pertanyaan: string | null
    gambar_opsi_a: string | null
    gambar_opsi_b: string | null
    gambar_opsi_c: string | null
    gambar_opsi_d: string | null
    gambar_opsi_e: string | null
    dijawab: boolean
    benar: boolean
  }[] | null = null

  if (sesiSelesai && sesi?.paket_soal_id) {
    // Jawaban siswa untuk sesi ini — soal_id + jawaban dipakai SERVER-SIDE
    // saja untuk menghitung benar/salah, tidak diteruskan ke response.
    const { data: jawabanSiswa } = await db
      .from('jawaban')
      .select('soal_id, jawaban')
      .eq('sesi_id', nilai.sesi_id)
      .eq('nis', nilai.nis)

    const jawabanMap = Object.fromEntries((jawabanSiswa ?? []).map(j => [j.soal_id, j.jawaban]))

    const { data: soalList } = await db
      .from('soal')
      .select('id, teks, opsi_a, opsi_b, opsi_c, opsi_d, opsi_e, jumlah_opsi, kunci, gambar_pertanyaan, gambar_opsi_a, gambar_opsi_b, gambar_opsi_c, gambar_opsi_d, gambar_opsi_e, created_at')
      .eq('paket_id', sesi.paket_soal_id)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })

    rincian = (soalList ?? []).map((s, i) => {
      const dijawab = Object.prototype.hasOwnProperty.call(jawabanMap, s.id)
      return {
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
        // Hanya status dijawab/benar-salah. TIDAK ADA field kunci atau
        // jawaban siswa di sini — sengaja tidak pernah dikirim ke client.
        dijawab,
        benar: dijawab && jawabanMap[s.id] === s.kunci,
      }
    })
  }

  return NextResponse.json({
    nilai: {
      ...nilaiMasked,
      nama_mapel: mapel?.nama ?? nilai.mapel_id,
    },
    rincian,
    rincian_belum_tersedia: !sesiSelesai,
    rincianEssay,
    essayFotoUrl,
    essayModeJawaban,
  })
}
