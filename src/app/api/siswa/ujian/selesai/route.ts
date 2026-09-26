import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'
import { ambilDataSesiUntukPenilaian, hitungHasilPenilaian } from '@/lib/penilaian-ujian'
import { catatAktivitas } from '@/lib/aktivitas'
import { klaimkanWaktu } from '@/lib/klaim-offline'
import { hitungBatasWaktuPg, sudahKedaluwarsa } from '@/lib/deadline-pg'

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  // `waktuSelesaiClient` HANYA diisi ketika client menyelesaikan PG secara
  // offline (lihat src/lib/ujian-lokal.ts) dan baru berhasil memanggil
  // endpoint ini setelah koneksi pulih. Nilai PG TIDAK PERNAH dihitung dari
  // klaim ini -- selalu dari baris `jawaban` yang sebenarnya ada di server
  // (lihat hitungHasilPenilaian di bawah) -- klaim ini murni untuk jejak
  // audit ("kapan siswa MENGAKU selesai") dan tidak bisa dipakai untuk
  // memalsukan nilai.
  const { sesiId, nis, waktuSelesaiClient, deviceId } = await req.json()

  if (nis !== user.nis) return NextResponse.json({ error: 'NIS tidak sesuai' }, { status: 403 })

  // FIX BUG #1b: cek status siswa SEBELUM cek nilai. Sebelumnya endpoint ini
  // hanya peduli "apakah nilai sudah ada?" sehingga siswa yang sudah dikunci
  // Admin (TERKUNCI) atau sedang menunggu kode reset (RESET) tetap bisa submit
  // dan jawabannya tetap dihitung. Sekarang ditolak — kecuali nilai SUDAH ada
  // (misal hasil kunci_permanen) sehingga early-return di bawah tetap berfungsi
  // untuk menampilkan hasil yang sudah final.
  //
  // FIX PERFORMA (load test 25 Jun 2026, 05.37): query ini sebelumnya dipecah
  // jadi 2 round-trip terpisah ke tabel siswa_ujian (satu untuk `status`, satu
  // lagi belakangan untuk `waktu_mulai_awal`). Sekarang digabung jadi SATU
  // query — keduanya dari baris yang sama, tidak ada alasan dipisah.
  // FIX (fitur essay): tambah status_essay ke select supaya kita tahu, di
  // SEMUA jalur (early-return maupun jalur submit baru), apakah siswa ini
  // masih perlu diarahkan ke fase essay sebelum nilai PG-nya boleh dibuka.
  const { data: siswaUjianCheck, error: siswaUjianError } = await db
    .from('siswa_ujian')
    .select('status, waktu_mulai_awal, status_essay, device_id')
    .eq('sesi_id', sesiId)
    .eq('nis', nis)
    .single()

  // FIX BUG P0 (audit): sebelumnya hasil null dari query di atas tidak
  // ditolak, jadi user yang tidak pernah membuka/terdaftar di sesi ini
  // (tidak punya baris siswa_ujian) tetap bisa lanjut ke penghitungan nilai
  // dan menulis baris `nilai`. Error DB selain "baris tidak ada" (PGRST116)
  // dibedakan sebagai 500 supaya gangguan sesaat tidak terbaca 403.
  if (siswaUjianError && siswaUjianError.code !== 'PGRST116') {
    return NextResponse.json(
      { error: 'Gagal memeriksa status ujian Anda. Coba lagi beberapa saat.' },
      { status: 500 }
    )
  }
  if (!siswaUjianCheck) {
    return NextResponse.json(
      { error: 'Anda belum terdaftar sebagai peserta ujian ini.' },
      { status: 403 }
    )
  }

  // FIX BUG P0 (audit): validasi device_id, sama seperti /sync, /essay/mulai,
  // /essay/jawab dan /essay/kirim. Begitu ada device_id terdaftar di DB,
  // request WAJIB mengirim deviceId yang sama persis -- request tanpa
  // deviceId atau dengan deviceId lain ditolak.
  if (siswaUjianCheck.device_id && siswaUjianCheck.device_id !== deviceId) {
    return NextResponse.json(
      { error: 'Sesi ujian Anda sedang aktif di perangkat lain. Ujian tidak bisa diselesaikan dari perangkat ini.' },
      { status: 409 }
    )
  }

  // FIX (kkm hilang di response duplikat/early-return — ditemukan dari 2 load
  // test terpisah, 56+7 kejadian): sesiCache di bawah sebelumnya baru diambil
  // SETELAH kedua early-return ini, jadi kalau siswa memanggil endpoint ini
  // lagi untuk sesi yang SAMA (submit ganda, retry jaringan, refresh halaman
  // hasil), response-nya kehilangan field `kkm` walau field lain (nilai,
  // grade, lulus, dst) tetap ada — client yang menampilkan KKM di halaman
  // hasil jadi menampilkan undefined. Diambil di sini (SEBELUM early-return)
  // supaya kkm selalu konsisten ada di response, di jalur manapun. Aman untuk
  // performa: ini query yang sama yang sudah di-cache 5 menit per sesi_id
  // (lihat komentar "FIX PERFORMA" di bawah), jadi memindahkannya ke sini
  // tidak menambah beban — cache-nya tetap dipakai bersama oleh semua siswa.
  const sesiCache = await ambilDataSesiUntukPenilaian(db, sesiId)
  const kkmUntukEarlyReturn = sesiCache?.kkm ?? 75

  // FIX (fitur essay): sesi punya essay kalau info_json.essay_aktif = true
  // (disalin dari jadwal saat sesi dibuka — lihat 07_essay.sql &
  // HANDOFF.md poin 1). Dipakai di SEMUA jalur di bawah untuk memutuskan
  // apakah nilai PG boleh langsung dibuka atau harus menunggu essay dikirim.
  const essayAktif = !!sesiCache?.sesi?.info_json?.essay_aktif

  // Helper: apakah fase essay siswa ini sudah "selesai" (sudah kirim, atau
  // ditandai tidak mengerjakan oleh guru)? Kalau ya, nilai PG boleh dibuka
  // di jalur early-return (mis. refresh halaman hasil setelah essay dikirim).
  const essaySudahSelesai = (statusEssay: string | null | undefined) =>
    statusEssay === 'SUDAH_KIRIM' || statusEssay === 'TIDAK_MENGERJAKAN'

  if (siswaUjianCheck.status === 'TERKUNCI' || siswaUjianCheck.status === 'RESET') {
    const { data: nilaiSudahAda } = await db
      .from('nilai')
      .select('id, nilai, grade, benar, total, lulus')
      .eq('sesi_id', sesiId)
      .eq('nis', nis)
      .single()

    if (nilaiSudahAda) {
      // FIX (fitur essay): kalau sesi ini punya essay dan siswa belum
      // menyelesaikan fase essay, JANGAN buka nilai PG — arahkan ke fase
      // essay dulu (sesuai desain: nilai baru tampil setelah essay dikirim).
      if (essayAktif && !essaySudahSelesai(siswaUjianCheck.status_essay)) {
        return NextResponse.json({ id: nilaiSudahAda.id, lanjutEssay: true, kkm: kkmUntukEarlyReturn })
      }
      return NextResponse.json({
        id: nilaiSudahAda.id,
        nilai: nilaiSudahAda.nilai,
        grade: nilaiSudahAda.grade,
        benar: nilaiSudahAda.benar,
        total: nilaiSudahAda.total,
        lulus: nilaiSudahAda.lulus,
        kkm: kkmUntukEarlyReturn,
      })
    }

    // BUG P0 (ditemukan via audit "apiRequest -> anggap berhasil/gagal
    // permanen -> outbox berhenti retry" di semua endpoint offline): endpoint
    // ini dulu membalas 403 TANPA `sementara: true` untuk KEDUA status
    // (TERKUNCI maupun RESET) sekaligus, tidak seperti /sync dan
    // /essay/mulai yang sudah membedakannya. Akibatnya cobaKirimPaketTertunda
    // di ujian-outbox.ts (lihat sementara403 di sana) menandai SELURUH paket
    // ujian (PG + essay) sebagai GAGAL PERMANEN begitu /selesai dipanggil
    // SAAT status siswa masih 'RESET' (mis. karena rekonsiliasi R1 offline
    // belum sempat sinkron duluan -- lihat reset-offline-client.ts). Paket
    // yang sudah GAGAL tidak dicoba lagi otomatis oleh penjaga latar
    // belakang (mulaiPenjagaOutbox men-skip status GAGAL) -- jadi walau R1
    // dan pelanggaran akhirnya tersinkron dan status siswa kembali AKTIF,
    // ujian TETAP tidak pernah terfinalisasi sampai ada yang menekan tombol
    // "Kirim Sekarang" manual. Ini penyebab utama gejala "status di pengawas
    // tetap belum SELESAI" walau semuanya akhirnya tersinkron.
    //
    // RESET bersifat SEMENTARA (bisa pulih sendiri begitu R1 tersinkron) ->
    // sementara: true supaya outbox tetap retry otomatis. TERKUNCI bersifat
    // PERMANEN (siswa memang dihentikan, butuh intervensi pengawas) -> TIDAK
    // diberi sementara: true, supaya outbox berhenti retry seperti semula.
    if (siswaUjianCheck.status === 'RESET') {
      return NextResponse.json(
        {
          error: 'Akses ujian Anda sedang menunggu kode reset. Ujian akan otomatis diselesaikan setelah kode reset tersinkron.',
          sementara: true,
        },
        { status: 403 }
      )
    }

    return NextResponse.json(
      { error: 'Akses ujian Anda dikunci. Ujian tidak bisa diselesaikan sekarang.' },
      { status: 403 }
    )
  }

  // Cek dulu apakah sudah pernah submit — early return
  const { data: nilaiExist } = await db
    .from('nilai')
    .select('id, nilai, grade, benar, total, lulus')
    .eq('sesi_id', sesiId)
    .eq('nis', nis)
    .single()

  if (nilaiExist) {
    // FIX (fitur essay): sama seperti early-return TERKUNCI/RESET di atas —
    // kalau essay masih menggantung, jangan bocorkan nilai PG di sini.
    if (essayAktif && !essaySudahSelesai(siswaUjianCheck.status_essay)) {
      return NextResponse.json({ id: nilaiExist.id, lanjutEssay: true, kkm: kkmUntukEarlyReturn })
    }
    return NextResponse.json({
      id: nilaiExist.id,
      nilai: nilaiExist.nilai,
      grade: nilaiExist.grade,
      benar: nilaiExist.benar,
      total: nilaiExist.total,
      lulus: nilaiExist.lulus,
      kkm: kkmUntukEarlyReturn,
    })
  }

  // (sesiCache sudah diambil di atas, sebelum kedua early-return, supaya
  // field `kkm` tersedia konsisten di semua jalur response — lihat komentar
  // FIX di atas. Query & cache-nya sama seperti sebelumnya, cuma dipindah.)
  if (!sesiCache) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })
  const { sesi, kkm, totalSoal, kunciMap } = sesiCache

  // FIX BUG #7 (submit PG tidak eksplisit cek sesi.status, hanya mengandalkan
  // jendela waktu): sebelumnya endpoint ini HANYA menolak submit lewat
  // pengecekan `waktu_mulai_awal + durasi` di bawah — tidak pernah mengecek
  // sesi_ujian.status secara langsung, padahal endpoint lain yang menulis
  // data siswa selama ujian (sync/route.ts, essay/jawab/route.ts, dst) semua
  // menolak begitu sesi.status !== 'BERJALAN'. Akibatnya kalau pengawas
  // menutup sesi (status → SELESAI) SEBELUM jendela waktu ujian siswa habis
  // (mis. menutup sesi lebih awal secara sengaja), siswa yang device-nya
  // masih dalam jendela waktu tetap bisa lolos memanggil endpoint ini dan
  // membuat baris `nilai` sendiri — bersaing dengan finalisasiNilaiPaksa
  // yang justru sudah/akan menghitungkan nilai mereka dari sisi server.
  // Sesuai catatan di ambilDataSesiUntukPenilaian: status sesi TIDAK di-cache
  // (data di sesiCache murni statis), jadi di-query langsung di sini, tanpa
  // cache, supaya tidak ada risiko status basi lintas-instance Vercel.
  // Pengaturan batas minimal submit diambil PARALEL dengan cek status sesi
  // supaya tidak menambah round-trip serial di jalur submit.
  const [{ data: sesiStatusCheck }, { data: pengaturanMinSubmit }] = await Promise.all([
    db.from('sesi_ujian').select('status').eq('id', sesiId).single(),
    db.from('pengaturan').select('key, value').in('key', ['minSubmitAktif', 'minSubmitMenit']),
  ])
  if (sesiStatusCheck && sesiStatusCheck.status !== 'BERJALAN') {
    return NextResponse.json(
      { error: 'Sesi ujian sudah ditutup, ujian tidak bisa diselesaikan dari sini. Jawaban yang sudah tersimpan akan dinilai secara otomatis oleh sistem.' },
      { status: 409 }
    )
  }

  // ── VALIDASI WAKTU SERVER ─────────────────────────────────────────────────
  // Cek apakah submit masih dalam jendela waktu yang sah.
  // waktu_mulai_awal adalah referensi tunggal yang tidak pernah berubah
  // (bahkan setelah reset pelanggaran). Toleransi 60 detik untuk mengakomodasi
  // jeda jaringan wajar saat auto-submit timeout.
  //
  // FIX (audit: kedaluwarsa sesi secara logis): dulu submit setelah batas waktu
  // ditolak 409 dengan pesan "akan dinilai otomatis oleh sistem" -- padahal
  // TIDAK ADA proses otomatis: satu-satunya yang menilai siswa itu adalah
  // pengawas yang menutup sesi. Pengawas lupa menutup = siswa tanpa nilai.
  // Sekarang server sendiri yang memutuskan (waktu_mulai_awal + durasi + 60 dtk,
  // lihat src/lib/deadline-pg.ts): submit terlambat TETAP diproses, tapi nilainya
  // dihitung HANYA dari jawaban yang sudah tersimpan di server -- dan jawaban
  // yang masuk setelah batas sudah disaring di /sync -- persis sama dengan yang
  // akan dilakukan finalisasiNilaiPaksa saat pengawas menutup sesi. Tidak
  // bergantung pada pengawas maupun cron. Status sesi tetap wajib BERJALAN
  // (dicek di atas); kalau sudah ditutup, finalisasiNilaiPaksa yang berwenang.
  const batasWaktuPg = hitungBatasWaktuPg(siswaUjianCheck.waktu_mulai_awal, sesi.durasi)
  const terlambat = sudahKedaluwarsa(batasWaktuPg, Date.now())
  const terlambatDetik = terlambat && batasWaktuPg ? Math.round((Date.now() - batasWaktuPg.deadlineMs) / 1000) : 0

  // ── VALIDASI BATAS MINIMAL SUBMIT (server-side) ───────────────────────────
  // FIX (audit): /validasi hanya MENGIRIM minSubmitMenit ke frontend; tombol
  // di UI di-disable, tapi request langsung ke endpoint ini tidak dicek.
  // Logika parsing sama persis dengan /validasi (default 45 menit).
  // Batas efektif dibatasi durasi ujian, sehingga auto-submit saat waktu habis
  // tidak pernah terblokir walau pengaturan minimal > durasi. Sengaja TIDAK
  // memakai `isTimeout` dari client (bisa dipalsukan).
  const pengMap = Object.fromEntries(
    (pengaturanMinSubmit ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
  )
  if (pengMap['minSubmitAktif'] === 'true' && siswaUjianCheck.waktu_mulai_awal) {
    const minMenit = parseInt(pengMap['minSubmitMenit']) || 45
    const minEfektifMenit = sesi.durasi ? Math.min(minMenit, sesi.durasi) : minMenit
    const toleransiMs = 5 * 1000 // selisih pembulatan/jam antara client & server
    const elapsedMs = Date.now() - new Date(siswaUjianCheck.waktu_mulai_awal).getTime()
    if (elapsedMs + toleransiMs < minEfektifMenit * 60 * 1000) {
      const sisaMenit = Math.ceil((minEfektifMenit * 60 * 1000 - elapsedMs) / 60000)
      // Sengaja 403 (BUKAN 409): di client, 409 dari endpoint ini berarti
      // penolakan PERMANEN (sesi ditutup / jendela waktu lewat) dan memicu
      // alur "menunggu penilaian otomatis". Penolakan ini sifatnya SEMENTARA
      // -- akan lolos begitu batas minimal terlewati -- jadi 403 (yang di
      // retry background diulang lagi di tick berikutnya) lebih tepat.
      //
      // FIX BUG P0 (audit outbox): respons ini dulu TIDAK menyertakan
      // `sementara: true`. cobaKirimPaketTertunda() di ujian-outbox.ts hanya
      // meng-otomatis-retry 403 yang punya flag itu (lihat sementara403 di
      // sana) -- tanpanya, siswa yang menekan "Selesai" sebelum waktu minimal
      // lalu OFFLINE (jawaban masuk outbox) akan menemukan paketnya ditandai
      // GAGAL PERMANEN begitu koneksi pulih, walau batas minimal sudah lama
      // terlewati -- outbox tidak pernah mencoba lagi otomatis, harus
      // "Kirim Sekarang" manual. Sekarang ditandai sementara, sama seperti
      // RESET/TERKUNCI-sementara di jalur lain endpoint ini.
      return NextResponse.json(
        {
          error: `Ujian belum bisa diselesaikan. Minimal waktu pengerjaan ${minEfektifMenit} menit (sisa sekitar ${sisaMenit} menit).`,
          kode: 'BELUM_MINIMAL_WAKTU',
          sementara: true,
        },
        { status: 403 }
      )
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Jawaban siswa ini TETAP harus di-query per-siswa (berbeda untuk tiap
  // siswa, tidak bisa di-cache bersama).
  const { data: jawabanSiswa } = await db
    .from('jawaban').select('soal_id, jawaban').eq('sesi_id', sesiId).eq('nis', nis)

  // Hitung nilai — kunciMap sudah didapat dari cache di atas, tidak perlu
  // query soal lagi di sini.
  const { benar, total, nilai: nilaiAngka, grade, lulus } = hitungHasilPenilaian(jawabanSiswa, kunciMap, totalSoal, kkm)

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
    // Tanda untuk guru: nilai ini dari submit yang datang SETELAH batas waktu
    // (mis. siswa offline lalu online lagi) dan dihitung dari jawaban tersimpan.
    ...(terlambat
      ? { catatan_guru: `Dikirim ${terlambatDetik} detik setelah batas waktu ujian; dinilai otomatis dari jawaban yang sudah tersimpan di server.` }
      : {}),
  }

  // FIX (fitur essay): kalau sesi ini punya essay, JANGAN tandai siswa_ujian
  // SELESAI di sini — siswa harus melalui fase essay dulu. Fase essay yang
  // akan menandai status = SELESAI (lihat src/app/api/siswa/ujian/essay/kirim/route.ts).
  // Di sini kita hanya menandai status_essay = BELUM_MULAI supaya endpoint
  // .../essay/info tahu siswa sudah boleh melihat halaman info essay.
  //
  // FIX BUG P0 (offline PG -> Essay bisa merusak status_essay yang sudah
  // maju): endpoint ini bisa terlambat sampai ke server -- misalnya siswa
  // menyelesaikan PG sambil offline, lalu essay/mulai (jalur darurat, lihat
  // essay/mulai/route.ts) SUDAH sempat dipanggil & berhasil duluan begitu
  // koneksi baru sebagian pulih (status_essay sudah MENGERJAKAN, bahkan bisa
  // SUDAH_KIRIM kalau reconnect terjadi belakangan), dan request submit PG
  // ini baru menyusul setelah itu. Sebelumnya update ini SELALU menimpa
  // status_essay jadi 'BELUM_MULAI' tanpa syarat -- kalau itu terjadi
  // setelah essay sudah maju, statusnya mundur lagi padahal siswa sudah
  // mengerjakan/mengirim essay. Sekarang guard-nya sama seperti pola
  // idempotent .or(status_essay.eq.BELUM_MULAI,status_essay.is.null) yang
  // sudah dipakai di essay/mulai/route.ts: hanya tulis status_essay kalau
  // baris itu MEMANG masih di keadaan awal (belum pernah maju ke fase essay
  // sama sekali).
  // Jejak audit klaim "PG selesai offline" (kolom dari migrasi 20). Tidak
  // memengaruhi nilai atau status apa pun -- murni untuk ditinjau guru/pengawas
  // kalau ada keraguan. Waktu yang dikirim client TIDAK dipercaya mentah-mentah
  // (lihat klaimkanWaktu di src/lib/klaim-offline.ts).
  let klaimOffline: { waktu_klaim: string; audit: Record<string, unknown> } | null = null
  if (typeof waktuSelesaiClient === 'string') {
    const batasBawahMs = siswaUjianCheck.waktu_mulai_awal
      ? new Date(siswaUjianCheck.waktu_mulai_awal).getTime()
      : null
    const klaim = klaimkanWaktu(waktuSelesaiClient, batasBawahMs)
    klaimOffline = {
      waktu_klaim: new Date(klaim.waktuMs).toISOString(),
      audit: {
        klaimMentah: waktuSelesaiClient,
        anomali: klaim.anomali,
        alasanAnomali: klaim.alasanAnomali ?? null,
        direkonsiliasiPada: new Date().toISOString(),
      },
    }
  }

  // ── FINALISASI ATOMIK ─────────────────────────────────────────────────────
  // FIX (audit: race condition finalisasi PG): sebelumnya cek status sesi,
  // upsert nilai, dan update status siswa adalah query TERPISAH. Sekarang
  // ketiganya dijalankan di dalam SATU transaksi Postgres lewat fungsi
  // finalisasi_pg_atomik() (lihat supabase/21_finalisasi_pg_atomik.sql):
  // status sesi dikunci (FOR SHARE) selama transaksi, jadi penutupan sesi oleh
  // pengawas tidak bisa menyelip di antara "cek BERJALAN" dan "tulis nilai",
  // dan nilai + status siswa commit bersama atau batal bersama.
  //
  // FIX BUG P0 (audit: race condition device takeover): sebelumnya device_id
  // HANYA dicek di query terpisah SEBELUM RPC ini (lihat cek di atas), bukan
  // di dalam transaksi. Device B bisa mengambil alih (device_id di DB
  // berubah) TEPAT setelah cek awal lolos tapi SEBELUM RPC ini commit --
  // device A yang sudah tidak sah tetap bisa memfinalisasi nilai. Sekarang
  // p_device_id dikirim ke RPC dan dicek ULANG di dalam transaksi (setelah
  // baris siswa_ujian dikunci FOR UPDATE, lihat supabase/33_...sql) --
  // menutup celah yang sama seperti migrasi 28 menutup celah RESET/TERKUNCI.
  let nilaiIdFinal: string = nilaiData.id

  const { data: rpcHasil, error: rpcError } = await db.rpc('finalisasi_pg_atomik', {
    p_sesi_id: sesiId,
    p_nis: nis,
    p_nilai: nilaiData,
    p_essay_aktif: essayAktif,
    p_klaim_offline: klaimOffline,
    p_device_id: deviceId ?? null,
  })

  // FAIL CLOSED (audit P0 #2): tidak ada lagi jalur fallback non-atomik kalau
  // fungsi belum ada. Migrasi 21 & 23 wajib terpasang; kalau RPC gagal karena
  // alasan apa pun, siswa mendapat error dan mencoba lagi — jawaban tetap aman
  // di database dan di perangkat.
  if (!rpcError) {
    const hasilRpc = rpcHasil as { hasil?: string; nilai_id?: string } | null
    switch (hasilRpc?.hasil) {
      case 'OK':
        nilaiIdFinal = hasilRpc.nilai_id ?? nilaiData.id
        break
      case 'SESI_DITUTUP':
        return NextResponse.json(
          { error: 'Sesi ujian sudah ditutup, ujian tidak bisa diselesaikan dari sini. Jawaban yang sudah tersimpan akan dinilai secara otomatis oleh sistem.' },
          { status: 409 }
        )
      case 'SESI_TIDAK_ADA':
        return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })
      case 'SISWA_TIDAK_TERDAFTAR':
        return NextResponse.json(
          { error: 'Anda belum terdaftar sebagai peserta ujian ini.' },
          { status: 403 }
        )
      // FIX BUG P0 (migrasi 28): hasil ini dulu bernama 'SISWA_TERKUNCI' untuk
      // KEDUA status (TERKUNCI maupun RESET), dan dibalas 403 di sini TANPA
      // `sementara: true` apa pun penyebabnya. Cek ulang status di dalam
      // finalisasi_pg_atomik ini sengaja dibuat SEMPIT untuk menutup race
      // antara pengecekan awal (di atas, sebelum RPC) dan commit nilai --
      // jadi race yang sama (pelanggaran/reset tersinkron TEPAT sebelum
      // commit) justru PALING SERING kena di sini, bukan di pengecekan awal.
      // Akibatnya cobaKirimPaketTertunda() di ujian-outbox.ts menandai paket
      // GAGAL PERMANEN dan berhenti retry walau status siswa akan pulih
      // sendiri begitu reset tersinkron -- gejala "jawaban tertunda tidak
      // terkirim lagi" yang persis sama dengan bug yang sudah diperbaiki di
      // pengecekan awal, hanya lolos karena berada di cabang yang berbeda.
      // Sekarang dibedakan sama seperti pengecekan awal: RESET = sementara.
      case 'SISWA_RESET':
        return NextResponse.json(
          {
            error: 'Akses ujian Anda sedang menunggu kode reset. Ujian akan otomatis diselesaikan setelah kode reset tersinkron.',
            sementara: true,
          },
          { status: 403 }
        )
      case 'SISWA_TERKUNCI':
        return NextResponse.json(
          { error: 'Akses ujian Anda dikunci. Ujian tidak bisa diselesaikan sekarang.' },
          { status: 403 }
        )
      // FIX BUG P0 (migrasi 33): hasil baru dari cek ulang device_id DI DALAM
      // transaksi -- device yang sudah diambil alih device lain TEPAT sebelum
      // commit ditolak di sini, bukan lolos memfinalisasi nilai. Ini
      // penolakan PERMANEN dari sudut pandang device ini (bukan sesuatu yang
      // "pulih sendiri" seperti RESET), jadi TIDAK diberi `sementara: true` --
      // sama seperti pesan cek device_id di awal endpoint ini.
      case 'DEVICE_LAIN':
        return NextResponse.json(
          { error: 'Sesi ujian Anda sedang aktif di perangkat lain. Ujian tidak bisa diselesaikan dari perangkat ini.' },
          { status: 409 }
        )
      default:
        return NextResponse.json(
          { error: 'Gagal menyimpan hasil ujian (respons tidak dikenali). Coba lagi.' },
          { status: 500 }
        )
    }
  } else {
    console.error('[selesai] finalisasi_pg_atomik gagal:', rpcError.message)
    return NextResponse.json(
      { error: 'Gagal menyimpan hasil ujian ke server. Jawaban Anda aman, silakan coba lagi.' },
      { status: 500 }
    )
  }

  // Catat "submit ujian" -- kode di atas hanya sampai sini kalau ini benar-benar
  // submit BARU (kedua early-return "sudah pernah submit" di atas sudah
  // menangani panggilan ulang), jadi aman dicatat sekali.
  catatAktivitas(db, nis, 'SUBMIT_UJIAN', `Siswa ${user.nama} submit ujian ${sesi.mapel_id} (${sesi.kelas}), nilai ${nilaiAngka}`)
  if (terlambat) {
    catatAktivitas(db, nis, 'SUBMIT_TERLAMBAT', `Siswa ${user.nama} submit ${terlambatDetik} detik setelah batas waktu (sesi ${sesiId}); dinilai otomatis dari jawaban tersimpan.`)
  }

  // FIX (fitur essay): kalau sesi punya essay, JANGAN kirim nilai/grade/lulus
  // ke client sekarang — sesuai desain, nilai PG baru boleh tampil setelah
  // essay dikirim (lihat .../essay/kirim/route.ts). Cukup beri sinyal
  // `lanjutEssay` supaya frontend redirect ke halaman info essay.
  if (essayAktif) {
    return NextResponse.json({ id: nilaiIdFinal, lanjutEssay: true, kkm })
  }

  // FIX: sertakan `kkm` di response — sebelumnya tidak dikirim ke client,
  // jadi halaman hasil ujian siswa tidak bisa menampilkan KKM atau menjelaskan
  // dengan jelas kenapa siswa dinyatakan lulus/tidak lulus.
  return NextResponse.json({ id: nilaiIdFinal, nilai: nilaiAngka, grade, benar, total, lulus, kkm })
}
