// Taruh di: src/app/api/siswa/ujian/essay/mulai/route.ts
// POST { sesiId } — mulai timer essay (idempotent: kalau sudah MENGERJAKAN, kembalikan waktu_mulai_essay yang sudah ada, jangan reset timer)
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { kodeDaruratCocok } from '@/lib/essay-amplop-server'
import { MAKS_PERCOBAAN_SERVER } from '@/lib/essay-amplop-shared'

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  // `kodeDarurat`, `waktuMulaiClient`, `percobaanSalah` HANYA diisi client kalau
  // siswa membuka essay secara OFFLINE lewat amplop terenkripsi + kode darurat
  // dari pengawas (lihat src/lib/essay-amplop-server.ts) dan sekarang melapor
  // setelah internet pulih. Jalur online biasa tidak mengirim ketiganya.
  const { sesiId, deviceId, kodeDarurat, waktuMulaiClient, percobaanSalah } = await req.json()
  if (!sesiId) return NextResponse.json({ error: 'sesiId diperlukan' }, { status: 400 })

  const { data: siswaUjian } = await db
    .from('siswa_ujian')
    .select('status, status_essay, waktu_mulai_essay, device_id')
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)
    .single()

  if (!siswaUjian) return NextResponse.json({ error: 'Data ujian Anda tidak ditemukan' }, { status: 404 })

  if (siswaUjian.status === 'TERKUNCI' || siswaUjian.status === 'RESET') {
    return NextResponse.json(
      { error: 'Akses ujian Anda sedang dikunci/menunggu reset.' },
      { status: 403 }
    )
  }

  // FIX BUG (essay/mulai tidak memeriksa deviceId): kebijakan "satu siswa
  // satu perangkat" sudah ditegakkan di essay/jawab dan essay/kirim, tapi
  // titik masuk fase essay ini (yang menetapkan waktu_mulai_essay pertama
  // kali) sebelumnya tidak mengecek device_id sama sekali. Akibatnya Device
  // B (NIS sama) bisa memanggil endpoint ini langsung dan menjadi yang
  // "menang" menetapkan waktu_mulai_essay/status_essay=MENGERJAKAN duluan,
  // mencuri start timer essay dari Device A tanpa sepengetahuannya — bahkan
  // sebelum Device A sempat menekan "Mulai". Pola guard sama persis dengan
  // essay/jawab & essay/kirim: kalau device_id belum pernah tercatat (data
  // lama), lewati pengecekan supaya tidak memblokir siswa yang sah.
  if (siswaUjian.device_id && siswaUjian.device_id !== deviceId) {
    return NextResponse.json(
      { error: 'Sesi ujian Anda sedang aktif di perangkat lain. Essay tidak bisa dimulai dari perangkat ini.' },
      { status: 409 }
    )
  }

  if (siswaUjian.status_essay === 'SUDAH_KIRIM' || siswaUjian.status_essay === 'TIDAK_MENGERJAKAN') {
    return NextResponse.json({ error: 'Essay sudah selesai dikerjakan' }, { status: 409 })
  }

  // Idempotent: kalau sudah pernah mulai (mis. refresh halaman), JANGAN reset
  // waktu_mulai_essay — ini referensi timer yang tidak boleh berubah, sama
  // seperti pola waktu_mulai_awal untuk PG.
  if (siswaUjian.status_essay === 'MENGERJAKAN' && siswaUjian.waktu_mulai_essay) {
    return NextResponse.json({ waktuMulaiEssay: siswaUjian.waktu_mulai_essay })
  }

  // Gerbang toggle "Akses Soal Essay" (lihat 11_akses_mulai_essay.sql) —
  // dicek ULANG di server (bukan cuma disabled di tombol UI) supaya tidak
  // bisa di-bypass dengan memanggil endpoint ini langsung sebelum pengawas
  // menyalakan aksesnya.
  // FIX ARSITEKTUR KRITIS: sertakan paket_essay_id — sama seperti paket PG
  // (lihat FIX di validasi/route.ts & penilaian-ujian.ts), koreksi essay
  // WAJIB memakai paket yang benar-benar dikerjakan siswa, bukan resolusi
  // ulang berdasarkan status DISETUJUI saat guru mengoreksi.
  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('status, akses_mulai_essay_dibuka, mapel_id, kelas, paket_essay_id')
    .eq('id', sesiId)
    .single()

  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })

  // FIX BUG (essay bisa dimulai walau sesi sudah ditutup): sebelumnya
  // endpoint ini hanya mengecek status siswa (TERKUNCI/RESET) dan gerbang
  // akses_mulai_essay_dibuka, TIDAK PERNAH mengecek sesi_ujian.status.
  // Padahal endpoint autosave (essay/jawab/route.ts) dan endpoint soal
  // (essay/soal/route.ts — lihat fix terkait di bawah) sama-sama menolak
  // kalau sesi.status !== 'BERJALAN'. Akibatnya siswa bisa mendapat
  // status_essay = 'MENGERJAKAN' + waktu_mulai_essay untuk sesi yang
  // sebenarnya sudah ditutup (SELESAI/dibatalkan), lalu macet total karena
  // tidak bisa autosave/kirim jawaban sama sekali. Sekarang dicek di sini
  // juga, konsisten dengan endpoint lain.
  if (sesi.status !== 'BERJALAN') {
    return NextResponse.json(
      { error: 'Sesi ujian sudah tidak berjalan, essay tidak bisa dimulai.' },
      { status: 409 }
    )
  }

  // ── JALUR DARURAT (offline → rekonsiliasi) ────────────────────────────────
  // Siswa yang sudah membuka essay di perangkatnya (dekripsi amplop dengan
  // kode dari pengawas) melapor ke sini begitu internet pulih. Bukti yang
  // diminta server: kode darurat yang BENAR untuk sesi ini + siswa ini memang
  // pernah menerima amplop. Kode tidak pernah dikirim ke client dari server,
  // jadi hanya siswa yang benar-benar mendapat kode dari pengawas (jalur
  // manusia) yang bisa lolos — bukan siapa pun yang memanggil endpoint ini.
  //
  // Anti tebak-tebakan via API: hitungan percobaan dinaikkan ATOMIK di database
  // SEBELUM kode dibandingkan (baca-lalu-tulis biasa bisa ditembus request
  // paralel). Lewat MAKS_PERCOBAAN_SERVER → ditolak permanen untuk siswa ini.
  let jalurDarurat = false
  let batasBawahDarurat: number | null = null
  if (kodeDarurat !== undefined && kodeDarurat !== null && kodeDarurat !== '') {
    const { data: hitungan, error: hitungErr } = await db.rpc('essay_amplop_hitung_percobaan', {
      p_sesi_id: sesiId,
      p_nis: user.nis!,
    })
    if (hitungErr) return NextResponse.json({ error: hitungErr.message }, { status: 500 })
    if (hitungan === null || hitungan === undefined) {
      return NextResponse.json(
        { error: 'Perangkat ini tidak pernah menerima soal essay terenkripsi. Kode darurat tidak dapat dipakai — hubungi pengawas.' },
        { status: 403 }
      )
    }
    if (Number(hitungan) > MAKS_PERCOBAAN_SERVER) {
      return NextResponse.json(
        { error: 'Terlalu banyak percobaan kode darurat. Hubungi pengawas.' },
        { status: 429 }
      )
    }
    if (!kodeDaruratCocok(String(sesiId), kodeDarurat)) {
      return NextResponse.json({ error: 'Kode darurat tidak valid.' }, { status: 403 })
    }
    jalurDarurat = true

    const { data: amplopRow } = await db
      .from('essay_amplop_offline')
      .select('dikirim_at')
      .eq('sesi_id', sesiId)
      .eq('nis', user.nis!)
      .single()
    batasBawahDarurat = amplopRow?.dikirim_at ? new Date(amplopRow.dikirim_at).getTime() : null
  }

  if (!sesi.akses_mulai_essay_dibuka && !jalurDarurat) {
    return NextResponse.json(
      { error: 'Menunggu pengawas membuka akses mulai essay.' },
      { status: 403 }
    )
  }

  // FIX BUG P2 (essay bisa dimulai walau 0 soal DISETUJUI): endpoint toggle
  // (guru/mode-pengawas/toggle-akses-mulai-essay/route.ts) memang menolak
  // MENYALAKAN akses_mulai_essay_dibuka kalau soal DISETUJUI untuk mapel+
  // kelas ini masih 0 — tapi itu hanya dicek SEKALI saat toggle dinyalakan.
  // Kalau guru menghapus/membatalkan approval SEMUA soal essay SETELAH
  // toggle sudah menyala (mis. sedang direvisi ulang), sesi tetap punya
  // akses_mulai_essay_dibuka = true sementara soalnya sudah kosong — tanpa
  // pertahanan kedua di sini, siswa tetap lolos ke status MENGERJAKAN lalu
  // terjebak di halaman essay kosong (tidak ada soal untuk dikerjakan,
  // hanya bisa menekan Selesai/Kirim tanpa jawaban apa pun). Cek ulang
  // jumlah soal DISETUJUI persis sebelum mengizinkan status MENGERJAKAN,
  // sama seperti resolusi kelasId di endpoint essay lain (info/soal/
  // koreksi-essay).
  const { data: kelasRow } = sesi.paket_essay_id
    ? { data: null }
    : await db.from('kelas').select('id').eq('nama', String(sesi.kelas)).maybeSingle()
  const kelasId = kelasRow?.id ?? String(sesi.kelas)

  // FIX ARSITEKTUR KRITIS (snapshot paket essay ke sesi): kalau sesi ini
  // sudah punya paket_essay_id (siswa lain sudah pernah mulai essay
  // duluan), hitung soal HANYA dari paket itu — jangan dari mapel+kelas+
  // status DISETUJUI secara umum, supaya siswa yang mulai belakangan tetap
  // mendapat bank soal yang SAMA persis dengan siswa pertama walau paket
  // yang disetujui berubah setelahnya.
  // FIX (pemilihan paket essay tidak deterministik): sebelumnya query ini
  // TIDAK punya .order() sebelum diambil elemen [0]-nya untuk dijadikan
  // snapshot paket pertama kali — sama persis dengan celah yang sudah
  // diperbaiki di validasi/route.ts untuk paket PG (lihat komentar FIX di
  // sana). Kalau ada LEBIH DARI SATU paket_essay DISETUJUI untuk mapel+kelas
  // yang sama, paket mana yang menang tidak bisa diprediksi. Sekarang
  // diurutkan berdasarkan `paket_essay_id` — ID dibuat lewat generateId()
  // berformat PREFIX_timestamp_random (lihat src/lib/utils.ts), jadi urutan
  // ID menaik = urutan waktu paket dibuat menaik → paket yang paling DULU
  // dibuat yang menang, deterministik dan bisa diprediksi/diuji.
  const soalEssaySnapshotQuery = sesi.paket_essay_id
    ? db.from('soal_essay').select('id, paket_essay_id').eq('paket_essay_id', sesi.paket_essay_id).eq('status', 'DISETUJUI')
    : db.from('soal_essay').select('id, paket_essay_id').eq('mapel_id', sesi.mapel_id).eq('kelas_id', kelasId).eq('status', 'DISETUJUI').order('paket_essay_id', { ascending: true }).order('id', { ascending: true })

  const { data: soalEssayUntukSnapshot } = await soalEssaySnapshotQuery
  const jumlahSoalEssay = soalEssayUntukSnapshot?.length ?? 0

  if (!jumlahSoalEssay) {
    return NextResponse.json(
      { error: 'Belum ada soal essay yang disetujui untuk mapel ini. Hubungi guru/pengawas Anda.' },
      { status: 409 }
    )
  }

  // Kunci paket_essay_id ke sesi SEKALI, hanya kalau kolomnya masih NULL —
  // pola & alasan identik dengan snapshot paket_soal_id di validasi/route.ts.
  if (!sesi.paket_essay_id) {
    const paketEssayIdTerdeteksi = soalEssayUntukSnapshot?.[0]?.paket_essay_id ?? null
    if (paketEssayIdTerdeteksi) {
      await db.from('sesi_ujian')
        .update({ paket_essay_id: paketEssayIdTerdeteksi })
        .eq('id', sesiId)
        .is('paket_essay_id', null)
    }
  }

  // FIX (race condition kecil): tambahkan guard .eq('status_essay', ...) yang
  // sebelumnya tidak ada — kalau dua request /mulai nyaris bersamaan lolos
  // pengecekan idempotent di atas bersamaan (baca status_essay yang sama-sama
  // masih BELUM_MULAI SEBELUM salah satu sempat menulis), keduanya akan
  // menulis waktu_mulai_essay masing-masing dengan selisih milidetik — siapa
  // yang menulis TERAKHIR yang menang, walau keduanya "berhasil" dari sisi
  // response masing-masing. Guard ini membuat HANYA update yang baris
  // status_essay-nya BENAR-BENAR masih BELUM_MULAI (atau null, untuk data
  // lama) yang benar-benar mengubah baris; kita cek `count`/`data` hasil
  // update untuk tahu apakah update ini yang "menang". Dampaknya tetap
  // sangat kecil (beda milidetik), tapi sekarang deterministik: request yang
  // kalah akan mengambil ulang waktu_mulai_essay yang sudah tersimpan,
  // bukan menimpanya.
  // Jalur darurat: pakai waktu mulai yang dilaporkan client (waktu siswa
  // benar-benar membuka essay saat offline) supaya timer essay tidak "mundur"
  // hanya karena internet baru pulih belakangan. Klaim client TIDAK dipercaya
  // mentah-mentah: dibatasi ke rentang [waktu amplop dikirim, sekarang] —
  // tidak bisa di masa depan, dan tidak bisa lebih awal dari saat siswa
  // baru memegang amplop. Keterbatasan yang tidak bisa dihindari: server tidak
  // bisa membuktikan KAPAN persisnya siswa membuka essay saat offline; selisih
  // antara dibuka_offline_at dan rekonsiliasi_at dicatat di tabel
  // essay_amplop_offline supaya bisa diaudit pengawas/guru.
  const sekarangMs = Date.now()
  let waktuMulaiMs = sekarangMs
  if (jalurDarurat && typeof waktuMulaiClient === 'string') {
    const klaim = Date.parse(waktuMulaiClient)
    if (!Number.isNaN(klaim)) {
      waktuMulaiMs = Math.min(sekarangMs, Math.max(klaim, batasBawahDarurat ?? klaim))
    }
  }
  const waktuMulaiEssay = new Date(waktuMulaiMs).toISOString()
  const { data: updated, error } = await db
    .from('siswa_ujian')
    .update({ status_essay: 'MENGERJAKAN', waktu_mulai_essay: waktuMulaiEssay })
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)
    .or('status_essay.eq.BELUM_MULAI,status_essay.is.null')
    .select('waktu_mulai_essay')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!updated || updated.length === 0) {
    // Request ini kalah race — baris sudah diubah request lain barusan.
    // Ambil ulang waktu_mulai_essay yang sebenarnya tersimpan supaya timer
    // di client tetap konsisten dengan server.
    const { data: siswaUjianTerbaru } = await db
      .from('siswa_ujian')
      .select('waktu_mulai_essay')
      .eq('sesi_id', sesiId)
      .eq('nis', user.nis!)
      .single()
    return NextResponse.json({ waktuMulaiEssay: siswaUjianTerbaru?.waktu_mulai_essay ?? waktuMulaiEssay })
  }

  if (jalurDarurat) {
    await db.from('essay_amplop_offline')
      .update({
        dibuka_offline_at: waktuMulaiEssay,
        rekonsiliasi_at: new Date(sekarangMs).toISOString(),
        percobaan_salah_offline: Math.max(0, Math.min(1000, Number(percobaanSalah) || 0)),
      })
      .eq('sesi_id', sesiId)
      .eq('nis', user.nis!)
  }

  return NextResponse.json({ waktuMulaiEssay: updated[0].waktu_mulai_essay, viaKodeDarurat: jalurDarurat })
}
