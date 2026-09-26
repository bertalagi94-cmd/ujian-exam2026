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
import { sudahLewatBatasWaktuEssay } from '@/lib/essay-waktu'

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const nis = user.nis!

  const db = createAdminClient()
  // FIX BUG (essay/kirim tidak memeriksa deviceId): sebelumnya endpoint ini
  // hanya menerima `sesiId`, padahal autosave essay (essay/jawab) dan endpoint
  // sync PG sudah sama-sama menegakkan kebijakan "satu siswa satu perangkat"
  // lewat siswa_ujian.device_id. Akibatnya begitu Device A sedang mengerjakan,
  // Device B dengan NIS yang sama tetap bisa memanggil endpoint ini secara
  // langsung dan mengubah status jadi SUDAH_KIRIM/SELESAI, memotong sesi
  // Device A tanpa sepengetahuannya. Sekarang deviceId wajib dikirim & wajib
  // cocok dengan device_id yang terdaftar, persis pola guard di essay/jawab.
  const { sesiId, deviceId } = await req.json()
  if (!sesiId) return NextResponse.json({ error: 'sesiId diperlukan' }, { status: 400 })

  const { data: sesi } = await db.from('sesi_ujian').select('status, info_json').eq('id', sesiId).single()
  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })

  const { data: siswaUjian } = await db
    .from('siswa_ujian')
    .select('status, status_essay, waktu_mulai_essay, device_id')
    .eq('sesi_id', sesiId)
    .eq('nis', nis)
    .single()

  if (!siswaUjian) return NextResponse.json({ error: 'Data ujian Anda tidak ditemukan' }, { status: 404 })

  // Idempotent: kalau sudah pernah kirim, kembalikan nilai yang sudah ada
  // (pola sama seperti early-return di selesai/route.ts untuk PG) — supaya
  // klik ganda / retry jaringan tidak error, cukup tampilkan hasil yang sama.
  // Diletakkan SEBELUM guard deviceId di bawah supaya siswa yang sudah
  // berhasil kirim dari device yang sah tetap bisa mengambil ulang hasilnya
  // (mis. refresh halaman) meskipun deviceId di localStorage-nya kebetulan
  // berubah setelahnya — status sudah final, tidak ada aksi tulis baru di sini.
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

  // FIX BUG (essay/kirim tidak memeriksa status TERKUNCI/RESET): sebelumnya
  // endpoint ini sama sekali tidak mengecek siswaUjian.status, padahal
  // essay/jawab dan essay/mulai sudah sama-sama menolak begitu status siswa
  // TERKUNCI/RESET. Ini bukan cuma soal konsistensi — tanpa guard ini, siswa
  // yang baru saja DIKUNCI PERMANEN oleh admin (aksi 'kunci_permanen' di
  // admin/pelanggaran/route.ts, yang SENGAJA hanya mengubah `status` menjadi
  // TERKUNCI dan TIDAK menyentuh `status_essay`) tetap bisa menekan "Kirim"
  // selama status_essay-nya masih MENGERJAKAN — dan UPDATE di bawah akan
  // MENIMPA status TERKUNCI itu kembali menjadi SELESAI, membatalkan efek
  // penguncian yang sudah sengaja ditegakkan admin karena pelanggaran. Hal
  // yang sama berlaku untuk siswa yang sedang RESET (menunggu kode dari
  // pengawas) — reset-siswa/route.ts juga hanya mengubah `status`, bukan
  // `status_essay`. Sekarang keduanya diblokir di sini, sama seperti endpoint
  // essay lainnya.
  // BUG P0 (audit outbox "anggap berhasil/gagal permanen tanpa cek status
  // bisnis" — sama seperti temuan di /selesai dan reset-offline-client.ts):
  // dulu 403 di sini TIDAK menyertakan `sementara: true`, tidak seperti
  // /sync dan /essay/mulai. Akibatnya cobaKirimPaketTertunda() di
  // ujian-outbox.ts menandai paket essay GAGAL PERMANEN kalau endpoint ini
  // dipanggil saat status siswa masih 'RESET' sementara (mis. rekonsiliasi
  // R1 offline belum sempat sinkron duluan) — essay tidak pernah terkirim
  // otomatis lagi walau R1-nya sendiri akhirnya berhasil tersinkron.
  // RESET = sementara (bisa pulih sendiri) -> sementara: true.
  // TERKUNCI = permanen (butuh intervensi pengawas) -> tidak.
  if (siswaUjian.status === 'RESET') {
    return NextResponse.json(
      { error: 'Akses ujian Anda sedang menunggu kode reset. Essay akan otomatis dikirim setelah kode reset tersinkron.', sementara: true },
      { status: 403 }
    )
  }
  if (siswaUjian.status === 'TERKUNCI') {
    return NextResponse.json(
      { error: 'Akses ujian Anda dikunci. Essay tidak bisa dikirim sekarang.' },
      { status: 403 }
    )
  }

  if (siswaUjian.status_essay !== 'MENGERJAKAN') {
    return NextResponse.json({ error: 'Essay belum dimulai, tidak bisa dikirim.' }, { status: 409 })
  }

  // FIX BUG (essay/kirim tidak memeriksa deviceId): tolak pengiriman baru
  // kalau request tidak berasal dari perangkat yang terdaftar di
  // siswa_ujian.device_id. Kalau device_id belum pernah tercatat (null —
  // mis. data lama sebelum fitur device-lock ada), lewati pengecekan ini
  // supaya tidak memblokir siswa yang sah tanpa sebab.
  if (siswaUjian.device_id && siswaUjian.device_id !== deviceId) {
    return NextResponse.json(
      { error: 'Sesi ujian Anda sedang aktif di perangkat lain. Essay tidak bisa dikirim dari perangkat ini.' },
      { status: 409 }
    )
  }

  // FIX BUG (essay bisa dikirim setelah sesi ujian ditutup): sebelumnya
  // endpoint ini hanya mengambil `info_json` dari sesi_ujian dan tidak pernah
  // memeriksa `status`-nya. Akibatnya kalau pengawas menutup sesi (status
  // jadi SELESAI) sementara siswa masih berada di halaman essay, siswa itu
  // tetap bisa menekan "Kirim" dan server tetap memprosesnya (status_essay
  // = SUDAH_KIRIM, siswa_ujian.status = SELESAI) — padahal endpoint autosave
  // (essay/jawab) dan mulai (essay/mulai) sudah sama-sama menolak begitu
  // sesi.status !== 'BERJALAN'. Ditaruh SETELAH early-return idempotent di
  // atas (bukan sebelumnya) supaya siswa yang KEBETULAN sudah berhasil
  // mengirim sebelum sesi ditutup tetap bisa mengambil ulang hasilnya
  // (mis. refresh halaman) walau sesi sudah ditutup — cek ini hanya
  // memblokir PENGIRIMAN BARU, bukan pengambilan hasil yang sudah ada.
  if (sesi.status !== 'BERJALAN') {
    return NextResponse.json(
      { error: 'Sesi ujian sudah ditutup, essay tidak bisa dikirim lagi.' },
      { status: 409 }
    )
  }

  // FIX BUG (tidak ada validasi waktu server-side untuk essay): pola & pesan
  // sengaja disamakan dengan pengecekan PG di selesai/route.ts. Tanpa ini,
  // siswa yang mem-bypass countdown client bisa menekan "Kirim" kapan saja
  // jauh melewati durasi essay yang ditentukan guru, tanpa ditolak sistem.
  // Jawaban yang sudah ter-autosave sebelum batas waktu tetap tersimpan dan
  // bisa dinilai guru lewat halaman koreksi essay.
  //
  // FIX BUG (mode KERTAS bisa terjebak tidak bisa "Selesai"): pengecekan ini
  // sebelumnya berlaku untuk SEMUA mode, padahal mode KERTAS sengaja didesain
  // TANPA gerbang waktu di endpoint ini — lihat komentar di bawah ("siswa
  // cukup menekan 'Selesai' KAPAN PUN") dan popup waktu-habis di frontend
  // (siswa/ujian/page.tsx) yang justru menyuruh siswa TERUS menulis dulu di
  // kertas sebelum menekan "Selesai". Kalau guard ini tetap dipaksakan untuk
  // KERTAS, siswa yang mengikuti instruksi popup itu (menulis dulu, baru
  // klik Selesai) hampir pasti sudah lewat toleransi 60 detik dan ditolak
  // sistem — padahal UI sendiri yang menyuruhnya menunggu. Mode DIGITAL tetap
  // divalidasi karena auto-submit di client bergantung pada batas ini persis
  // saat sisaWaktuEssay mencapai 0.
  if (
    sesi.info_json?.essay_mode_jawaban === 'DIGITAL' &&
    sudahLewatBatasWaktuEssay(siswaUjian.waktu_mulai_essay, sesi.info_json?.essay_durasi_menit)
  ) {
    return NextResponse.json(
      { error: 'Waktu pengerjaan essay Anda sudah habis. Jawaban yang sudah tersimpan akan dinilai oleh guru.' },
      { status: 409 }
    )
  }

  // MODE KERTAS: siswa menulis jawaban di kertas fisik (dinilai guru
  // langsung dari kertas, bukan dari foto/unggahan) — tidak ada lagi syarat
  // "akses kirim dibuka" atau "foto sudah diupload" di sini. Siswa cukup
  // menekan tombol "Selesai" kapan pun mereka sudah selesai menulis; endpoint
  // ini hanya menandai status ujian selesai, tidak menyimpan jawaban apapun
  // untuk mode ini.

  // ── FINALISASI ATOMIK ─────────────────────────────────────────────────────
  // FIX BUG (race: sesi ditutup / device berganti / status siswa berubah
  // TEPAT di antara semua pengecekan di atas dan penulisan status): versi
  // sebelumnya HANYA mempersempit celah dengan membaca ulang status SESI
  // sesaat sebelum UPDATE (tanpa lock — tetap TOCTOU), dan sama sekali tidak
  // membaca ulang device_id maupun status TERKUNCI/RESET siswa di titik itu.
  // Sekarang SELURUH pengecekan kritis (status sesi, device_id, status
  // TERKUNCI/RESET, status_essay MENGERJAKAN) dan penulisan
  // status_essay=SUDAH_KIRIM/status=SELESAI dilakukan dalam SATU transaksi
  // Postgres lewat finalisasi_essay_atomik() (lihat
  // supabase/32_finalisasi_essay_atomik.sql) — pola yang sama persis dengan
  // finalisasi_pg_atomik yang sudah dipakai selesai/route.ts: FOR SHARE pada
  // baris sesi_ujian (penutupan sesi oleh pengawas menunggu commit yang
  // sedang berjalan) + FOR UPDATE pada baris siswa_ujian (menyerialkan klik
  // ganda / retry jaringan outbox offline dari siswa yang sama).
  const { data: rpcHasil, error: rpcError } = await db.rpc('finalisasi_essay_atomik', {
    p_sesi_id: sesiId,
    p_nis: nis,
    p_device_id: deviceId ?? null,
  })

  // FAIL CLOSED (sama seperti finalisasi_pg_atomik di selesai/route.ts): kalau
  // migrasi 32 belum terpasang atau RPC gagal karena alasan apa pun, siswa
  // mendapat error dan mencoba lagi — jawaban essay yang sudah ter-autosave
  // tetap aman di server, tidak ada yang ditulis diam-diam lewat jalur lain.
  if (rpcError) {
    console.error('[essay/kirim] finalisasi_essay_atomik gagal:', rpcError.message)
    return NextResponse.json(
      { error: 'Gagal mengirim jawaban essay ke server. Jawaban Anda aman, silakan coba lagi.' },
      { status: 500 }
    )
  }

  const hasil = (rpcHasil as { hasil?: string } | null)?.hasil

  switch (hasil) {
    case 'OK':
    case 'SUDAH_KIRIM':
      // Lanjut ke pengambilan nilai di bawah — sama untuk submit baru
      // (OK) maupun panggilan yang kalah race / retry (SUDAH_KIRIM).
      break
    case 'SESI_TIDAK_ADA':
      return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })
    case 'SESI_DITUTUP':
      return NextResponse.json(
        { error: 'Sesi ujian baru saja ditutup, essay tidak bisa dikirim lagi.' },
        { status: 409 }
      )
    case 'SISWA_TIDAK_TERDAFTAR':
      return NextResponse.json({ error: 'Data ujian Anda tidak ditemukan' }, { status: 404 })
    case 'DEVICE_LAIN':
      return NextResponse.json(
        { error: 'Sesi ujian Anda sedang aktif di perangkat lain. Essay tidak bisa dikirim dari perangkat ini.' },
        { status: 409 }
      )
    // RESET = sementara (bisa pulih sendiri begitu kode reset tersinkron) ->
    // sementara: true, supaya cobaKirimPaketTertunda() di ujian-outbox.ts
    // tetap retry otomatis alih-alih menandai paket essay GAGAL PERMANEN
    // (persis bug yang sama yang sudah diperbaiki di selesai/route.ts,
    // migrasi 28).
    case 'SISWA_RESET':
      return NextResponse.json(
        {
          error: 'Akses ujian Anda sedang menunggu kode reset. Essay akan otomatis dikirim setelah kode reset tersinkron.',
          sementara: true,
        },
        { status: 403 }
      )
    case 'SISWA_TERKUNCI':
      return NextResponse.json(
        { error: 'Akses ujian Anda dikunci. Essay tidak bisa dikirim sekarang.' },
        { status: 403 }
      )
    case 'ESSAY_BELUM_MULAI':
      return NextResponse.json({ error: 'Essay belum dimulai, tidak bisa dikirim.' }, { status: 409 })
    default:
      return NextResponse.json(
        { error: 'Gagal mengirim jawaban essay (respons tidak dikenali). Coba lagi.' },
        { status: 500 }
      )
  }

  // Nilai PG SUDAH dihitung & disimpan sebelumnya oleh selesai/route.ts —
  // di sinilah nilai itu baru "dibuka" ke siswa (nilai_total tetap kosong
  // sampai guru koreksi essay & merilis). Query baca murni ini aman di luar
  // transaksi RPC di atas — nilai tidak ditulis di sini maupun oleh RPC ini.
  const { data: nilai } = await db
    .from('nilai')
    .select('id, benar, total, kkm')
    .eq('sesi_id', sesiId)
    .eq('nis', nis)
    .single()

  return NextResponse.json({
    sudahDikirim: true,
    nilaiPg: nilai ? { id: nilai.id, benar: nilai.benar, total: nilai.total, kkm: nilai.kkm } : null,
    ...(hasil === 'OK'
      ? { pesan: 'Jawaban essay terkirim. Nilai akhir akan dirilis guru setelah dikoreksi.' }
      : {}),
  })
}
