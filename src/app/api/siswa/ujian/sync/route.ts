import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { instrumented } from '@/lib/metrik'
import { catatAktivitas } from '@/lib/aktivitas'
import { hitungBatasWaktuPg, sudahKedaluwarsa, saringJawabanTerlambat } from '@/lib/deadline-pg'
import { normalisasiJawabanMasuk, MAKS_JAWABAN_PER_REQUEST } from '@/lib/sync-jawaban-input'

// POST /api/siswa/ujian/sync
// PENTING: setelah upsert, kita selalu hitung ulang jumlah baris jawaban yang
// BENAR-BENAR ada di database (ground truth), bukan sekadar asumsi "request sukses
// berarti semua tersimpan". Nilai totalSynced ini dipakai client untuk verifikasi
// sebelum mengizinkan siswa menyelesaikan ujian — supaya kasus "sebagian jawaban
// tidak sampai ke server karena koneksi lambat tapi tetap dianggap selesai" tidak
// terulang.
//
// FIX (status "Server" panel Monitoring sekarang NYATA): ini titik utama
// keluhan "jawaban lambat/tidak tersimpan", jadi hasil & durasinya dicatat
// ke metrik_sistem — lihat src/lib/metrik.ts.
export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  return instrumented('sync_jawaban', async () => {

  const db = createAdminClient()
  // FIX (audit /sync): body & isi `jawaban` datang dari client yang tidak
  // dipercaya. Sebelumnya JSON rusak, elemen null, soal_id kembar, atau revisi
  // pecahan membuat request jatuh 500 (atau seluruh batch ditolak Postgres).
  // Lihat src/lib/sync-jawaban-input.ts untuk daftar lengkapnya.
  const body = await req.json().catch(() => null) as { sesiId?: unknown; jawaban?: unknown; deviceId?: unknown } | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Body request tidak valid' }, { status: 400 })
  const { sesiId, deviceId } = body

  if (!sesiId || typeof sesiId !== 'string') return NextResponse.json({ error: 'sesiId diperlukan' }, { status: 400 })

  if (Array.isArray(body.jawaban) && body.jawaban.length > MAKS_JAWABAN_PER_REQUEST) {
    return NextResponse.json({ error: 'Terlalu banyak jawaban dalam satu request.' }, { status: 413 })
  }
  const { records: jawaban, dibuangFormat, digabungKembar } = normalisasiJawabanMasuk(body.jawaban)
  if (dibuangFormat > 0 || digabungKembar > 0) {
    console.warn(`[sync] payload dinormalisasi untuk sesi ${sesiId}, nis ${user.nis}: ${dibuangFormat} elemen dibuang (format tidak valid), ${digabungKembar} digabung (soal_id kembar).`)
  }

  // FIX: sebelumnya endpoint ini menerima & menyimpan jawaban TANPA pernah
  // mengecek status sesi — siswa tetap bisa sync jawaban walau sesi sudah
  // ditutup pengawas (status SELESAI). Ditemukan otomatis oleh load test
  // (skenario "sync setelah sesi ditutup seharusnya ditolak").
  const { data: sesi } = await db.from('sesi_ujian').select('status, paket_soal_id, durasi').eq('id', sesiId).single()
  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })
  if (sesi.status !== 'BERJALAN') {
    return NextResponse.json({ error: 'Sesi ujian sudah ditutup, jawaban tidak bisa disimpan lagi.' }, { status: 409 })
  }

  // FIX BUG #1b: sebelumnya endpoint ini hanya mengecek status SESI, tidak pernah
  // mengecek status SISWA itu sendiri. Akibatnya siswa yang sudah dikunci/diblokir
  // Admin (status TERKUNCI) atau sedang menunggu kode reset (status RESET) tetap
  // bisa terus mengirim & menyimpan jawaban sampai ujian selesai.
  const { data: siswaUjian, error: siswaUjianError } = await db
    .from('siswa_ujian')
    .select('status, device_id, waktu_mulai_awal, waktu_mulai')
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)
    .single()

  // FIX P1 (audit /sync, FAIL-OPEN): sebelumnya hasil null dari query di atas
  // tidak ditolak. Akibatnya user SISWA yang TIDAK terdaftar di sesi ini (tidak
  // punya baris siswa_ujian) melewati SEMUA pemeriksaan di bawah -- cek
  // TERKUNCI/RESET, cek device_id, dan cek batas waktu (batasWaktu jadi null) --
  // lalu jawabannya tetap ditulis ke tabel `jawaban` untuk sesi orang lain.
  // /selesai sudah menolak kasus ini dengan 403; /sync disamakan. Error DB
  // selain "baris tidak ada" (PGRST116) dibedakan sebagai 500 supaya gangguan
  // sesaat tidak terbaca 403.
  if (siswaUjianError && siswaUjianError.code !== 'PGRST116') {
    return NextResponse.json({ error: 'Gagal memeriksa status ujian Anda. Coba lagi beberapa saat.' }, { status: 500 })
  }
  if (!siswaUjian) {
    return NextResponse.json({ error: 'Anda belum terdaftar sebagai peserta ujian ini.' }, { status: 403 })
  }

  if (siswaUjian.status === 'TERKUNCI' || siswaUjian.status === 'RESET') {
    return NextResponse.json(
      { error: 'Akses ujian Anda sedang dikunci/menunggu reset. Jawaban tidak bisa disimpan.' },
      { status: 403 }
    )
  }

  // ── Tolak sync dari device yang sudah diambil alih ───────────────────────
  // Kalau device lain sudah login (device_id di DB berbeda), device ini tidak
  // boleh lagi menulis jawaban — hanya device aktif yang berhak sync.
  //
  // FIX BUG (anti-device bisa dilewati dengan tidak mengirim deviceId):
  // sebelumnya kondisi ini diawali `if (deviceId && ...)`, jadi pemeriksaan
  // HANYA berjalan kalau request memang menyertakan deviceId. Request yang
  // sengaja/tidak sengaja tidak mengirim deviceId sama sekali membuat kondisi
  // ini otomatis `false` dan lolos begitu saja — padahal siswa_ujian.device_id
  // di DB sudah terisi (device yang sah sudah pernah login). Sekarang: begitu
  // ada device_id terdaftar di DB, request WAJIB mengirim deviceId yang sama
  // persis; request tanpa deviceId (atau dengan deviceId lain) ditolak sama
  // seperti device lain yang mencoba mengambil alih.
  if (siswaUjian.device_id && siswaUjian.device_id !== deviceId) {
    return NextResponse.json(
      { error: 'Sesi ujian Anda sedang aktif di perangkat lain. Jawaban tidak bisa disimpan dari perangkat ini.' },
      { status: 409 }
    )
  }
  // ─────────────────────────────────────────────────────────────────────────

  if (Array.isArray(jawaban) && jawaban.length > 0) {
    // FIX (integritas data): sebelumnya soal_id yang dikirim client langsung
    // di-upsert tanpa pernah divalidasi bahwa soal itu memang bagian dari
    // paket_soal_id yang di-snapshot untuk sesi ini. Client yang dimodifikasi
    // (mis. lewat devtools) bisa mengirim soal_id dari paket/mapel lain, dan
    // baris itu tetap tersimpan di tabel `jawaban`. Ini tidak mengubah nilai
    // (hitungHasilPenilaian hanya mencocokkan ke kunciMap paket yang benar),
    // tapi mencemari data jawaban & bisa mengacaukan rekap/audit. Sekarang:
    // ambil daftar soal_id yang SAH untuk paket sesi ini, lalu buang
    // (bukan tolak seluruh request) baris jawaban yang soal_id-nya tidak ada
    // di daftar itu, supaya autosave jawaban yang sah tetap jalan mulus.
    const soalIdUnik = Array.from(new Set(jawaban.map((j: { soal_id: string }) => j.soal_id)))

    let soalIdValid = new Set<string>()
    if (sesi.paket_soal_id && soalIdUnik.length > 0) {
      const { data: soalSah, error: errSoalSah } = await db
        .from('soal')
        .select('id')
        .eq('paket_id', sesi.paket_soal_id)
        .in('id', soalIdUnik)

      if (errSoalSah) return NextResponse.json({ error: errSoalSah.message }, { status: 500 })
      soalIdValid = new Set((soalSah ?? []).map(s => s.id))
    }

    const jawabanSahPaket = sesi.paket_soal_id
      ? jawaban.filter((j: { soal_id: string }) => soalIdValid.has(j.soal_id))
      : jawaban // fallback: kalau sesi belum punya snapshot paket (seharusnya jarang), jangan blokir autosave

    const jawabanDitolak = jawaban.length - jawabanSahPaket.length

    // ── KEBIJAKAN BATAS WAKTU (server = otoritas; lihat src/lib/deadline-pg.ts) ──
    // FIX (audit "deadline /sync"): sebelumnya endpoint ini hanya mengecek sesi
    // BERJALAN, jadi jawaban bisa terus diubah lewat request langsung SETELAH
    // durasi siswa habis, lalu ikut dinilai saat sesi ditutup. Sekarang, begitu
    // waktu siswa ini KEDALUWARSA secara logis (waktu_mulai_awal + durasi + 60 dtk),
    // hanya jawaban yang terbukti DIBUAT sebelum batas yang diterima (siswa offline
    // yang mengerjakan tepat waktu tidak dirugikan). Sebelum kedaluwarsa jalur ini
    // TIDAK dijalankan sama sekali -- perilaku normal tidak berubah.
    const sekarangMs = Date.now()
    // FIX (audit /sync): baris lama bisa punya waktu_mulai_awal NULL (kolom itu
    // ditambahkan belakangan). Sebelumnya hitungBatasWaktuPg(null) = null dan
    // seluruh penegakan deadline DILEWATI. /validasi & /verifikasi-reset sudah
    // jatuh ke waktu_mulai untuk kasus ini; disamakan di sini.
    const batasWaktu = hitungBatasWaktuPg(siswaUjian.waktu_mulai_awal ?? siswaUjian.waktu_mulai, sesi.durasi)
    let jawabanValid = jawabanSahPaket
    let ackTerlambat: { soal_id: string; jawaban: string; revisi: number; accepted: boolean }[] = []
    let ditolakTerlambatTanpaBaris = 0
    let jumlahDitolakTerlambat = 0
    if (batasWaktu && sudahKedaluwarsa(batasWaktu, sekarangMs) && jawabanSahPaket.length > 0) {
      // Ambil baris yang SUDAH ada di server untuk soal-soal yang dikirim. Jawaban
      // yang revisinya tidak lebih baru dari yang tersimpan bukan "perubahan
      // baru" (klien hanya mengirim ulang isi lamanya): dibiarkan lewat apa
      // adanya (RPC tidak akan menimpanya) dan TIDAK dihitung sebagai ditolak,
      // supaya log audit hanya berisi perubahan yang benar-benar dipersoalkan.
      const idSemua = jawabanSahPaket.map((j: { soal_id: string }) => j.soal_id)
      const { data: barisAda } = await db
        .from('jawaban').select('soal_id, jawaban, revisi')
        .eq('sesi_id', sesiId).eq('nis', user.nis!).in('soal_id', idSemua)
      const adaMap = new Map(
        (barisAda ?? []).map(r => [r.soal_id as string, { jawaban: r.jawaban as string, revisi: (r.revisi as number | null) ?? 0 }])
      )
      const tidakBerubah = jawabanSahPaket.filter((j: { soal_id: string; revisi?: number }) => {
        const ada = adaMap.get(j.soal_id)
        return !!ada && (typeof j.revisi === 'number' ? j.revisi : 0) <= ada.revisi
      })
      const kandidat = jawabanSahPaket.filter(j => !tidakBerubah.includes(j))

      const { diterima, ditolak } = saringJawabanTerlambat(kandidat, batasWaktu, sekarangMs)
      jawabanValid = [...tidakBerubah, ...diterima]
      jumlahDitolakTerlambat = ditolak.length

      if (ditolak.length > 0) {
        // ACK untuk yang ditolak memakai revisi KLIEN + accepted:false: client
        // menganggap soal itu "sudah ditangani server" (tidak menunggu revisi
        // yang memang tidak akan pernah diterima) sehingga submit tidak macet;
        // nilai yang tersimpan tetap yang lama di server.
        ackTerlambat = ditolak.map(({ jawaban: j }) => ({
          soal_id: j.soal_id,
          jawaban: adaMap.get(j.soal_id)?.jawaban ?? j.jawaban,
          revisi: typeof j.revisi === 'number' ? j.revisi : 1,
          accepted: false,
        }))
        ditolakTerlambatTanpaBaris = ditolak.filter(d => !adaMap.has(d.jawaban.soal_id)).length

        const ringkasAlasan = ditolak.reduce<Record<string, number>>((acc, d) => { acc[d.alasan] = (acc[d.alasan] ?? 0) + 1; return acc }, {})
        catatAktivitas(
          db, user.nis!, 'SYNC_TERLAMBAT',
          `Sync setelah batas waktu (sesi ${sesiId}, ${Math.round((sekarangMs - batasWaktu.deadlineMs) / 1000)} dtk sesudah deadline): ${diterima.length} perubahan diterima (dibuat sebelum batas), ${ditolak.length} ditolak ${JSON.stringify(ringkasAlasan)}.`
        )
      } else if (diterima.length > 0) {
        catatAktivitas(
          db, user.nis!, 'SYNC_TERLAMBAT',
          `Sync setelah batas waktu (sesi ${sesiId}, ${Math.round((sekarangMs - batasWaktu.deadlineMs) / 1000)} dtk sesudah deadline): ${diterima.length} perubahan diterima karena dibuat sebelum batas (kerja offline).`
        )
      }
    }

    let acked: { soal_id: string; jawaban: string; revisi: number; accepted: boolean }[] | null = null

    if (jawabanValid.length > 0) {
      // FIX BUG P1 (merge timestamp client vs server tidak setara): sebelumnya
      // baris ini selalu di-upsert mentah-mentah, dan resolusi konflik saat
      // resume/reload dilakukan di CLIENT dengan membandingkan Date.now()
      // (waktu client) dengan updated_at (waktu SERVER menerima request) —
      // dua jam yang berbeda sumber. Jawaban lama yang terlambat sync bisa
      // "menang" dari jawaban baru kalau requestnya sampai belakangan.
      // Sekarang: setiap jawaban punya nomor revisi yang dibuat CLIENT saat
      // siswa mengubah pilihan (naik monoton, lihat pilihJawaban() di
      // page.tsx), dan fungsi database sync_jawaban_revisi() (lihat
      // supabase/20_pg_offline_dan_revisi_jawaban.sql) menolak revisi yang
      // lebih kecil dari yang sudah tersimpan — tidak peduli urutan
      // kedatangan request atau selisih jam client vs server.
      const records = jawabanValid.map((j: { soal_id: string; jawaban: string; revisi?: number }) => ({
        sesi_id: sesiId,
        nis: user.nis!,
        soal_id: j.soal_id,
        jawaban: j.jawaban,
        revisi: typeof j.revisi === 'number' ? j.revisi : 0,
      }))

      const { data: rpcData, error: rpcError } = await db.rpc('sync_jawaban_revisi', { p_records: records })

      if (!rpcError) {
        acked = (rpcData ?? []).map((r: { out_soal_id: string; out_jawaban: string; out_revisi: number; out_accepted: boolean }) => ({
          soal_id: r.out_soal_id,
          jawaban: r.out_jawaban,
          revisi: r.out_revisi,
          accepted: r.out_accepted,
        }))
      } else {
        // FALLBACK: migrasi 20_pg_offline_dan_revisi_jawaban.sql belum
        // dijalankan di database ini (fungsi belum ada — kode Postgres
        // 42883 "undefined function"). Jatuh ke upsert lama tanpa revisi,
        // supaya deploy kode baru sebelum migrasi jalan tidak mematikan
        // autosave siswa. Bug P1 di atas TIDAK diperbaiki selama fallback
        // ini dipakai — jalankan migrasinya secepatnya.
        if (rpcError.code !== '42883' && !/function .*sync_jawaban_revisi/i.test(rpcError.message ?? '')) {
          return NextResponse.json({ error: rpcError.message }, { status: 500 })
        }
        console.warn('[sync] sync_jawaban_revisi belum tersedia di database, memakai upsert lama (tanpa proteksi revisi). Jalankan migrasi 20_pg_offline_dan_revisi_jawaban.sql.')
        const legacyRecords = jawabanValid.map((j: { soal_id: string; jawaban: string }) => ({
          sesi_id: sesiId,
          nis: user.nis!,
          soal_id: j.soal_id,
          jawaban: j.jawaban,
          updated_at: new Date().toISOString(),
          sync_status: 'SYNCED',
          local_timestamp: Date.now(),
        }))
        const { error } = await db.from('jawaban').upsert(legacyRecords, { onConflict: 'sesi_id,nis,soal_id' })
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      }
    }

    if (jawabanDitolak > 0) {
      console.warn(`[sync] ${jawabanDitolak} jawaban ditolak untuk sesi ${sesiId}, nis ${user.nis}: soal_id tidak termasuk paket sesi ini.`)
    }

    // Gabungkan ACK jawaban yang ditolak karena terlambat. Hanya kalau server
    // memang memakai mode ACK (migrasi 20) ATAU tidak ada satu pun jawaban valid
    // yang diproses; kalau tidak (mode lama berbasis hitungan), client tidak
    // memakai `acked` dan `ditolakTerlambatTanpaBaris` di bawah yang menutupi.
    if (ackTerlambat.length > 0 && (acked !== null || jawabanValid.length === 0)) {
      acked = [...(acked ?? []), ...ackTerlambat]
    }

    if (acked) {
      // Ground truth + ACK per jawaban dikembalikan sekaligus supaya client
      // tidak perlu round-trip GET terpisah untuk tahu mana yang benar2
      // tersimpan dengan revisi yang benar (lihat catatan totalSynced di
      // bawah — verifikasi handleSelesai() sekarang bisa memakai `acked`
      // per-soal, bukan cuma count agregat).
      const { count, error: countError } = await db
        .from('jawaban').select('*', { count: 'exact', head: true })
        .eq('sesi_id', sesiId).eq('nis', user.nis!)
      if (countError) return NextResponse.json({ error: countError.message }, { status: 500 })
      return NextResponse.json({
        message: `${Array.isArray(jawaban) ? jawaban.length : 0} jawaban diproses`,
        // Jawaban yang ditolak karena terlambat TIDAK punya baris di DB, tapi
        // client membandingkan totalSynced dengan jumlah jawaban lokalnya --
        // hitung sebagai "sudah ditangani" agar submit tidak menunggu selamanya.
        totalSynced: (count ?? 0) + ditolakTerlambatTanpaBaris,
        acked,
        ...(jumlahDitolakTerlambat > 0 ? { ditolakTerlambat: jumlahDitolakTerlambat } : {}),
      })
    }
    if (jumlahDitolakTerlambat > 0) {
      // Mode hitungan (tanpa ACK per soal): tetap sertakan penyesuaian.
      const { count: cnt } = await db.from('jawaban').select('*', { count: 'exact', head: true }).eq('sesi_id', sesiId).eq('nis', user.nis!)
      return NextResponse.json({
        message: `${jawaban.length} jawaban diproses`,
        totalSynced: (cnt ?? 0) + ditolakTerlambatTanpaBaris,
        ditolakTerlambat: jumlahDitolakTerlambat,
      })
    }
  }

  // Hitung ground-truth: berapa baris jawaban yang benar-benar tersimpan di DB
  // untuk sesi+siswa ini saat ini (bukan jumlah yang dikirim di request ini saja).
  const { count, error: countError } = await db
    .from('jawaban')
    .select('*', { count: 'exact', head: true })
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)

  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 })

  return NextResponse.json({
    message: `${Array.isArray(jawaban) ? jawaban.length : 0} jawaban diproses`,
    totalSynced: count ?? 0,
  })
  })
}

// GET /api/siswa/ujian/sync?sesiId=xxx
// Mengambil jawaban yang sudah tersimpan di server untuk sesi ini.
// Dipakai untuk: (1) memulihkan progres siswa jika halaman ter-reload/koneksi putus,
// (2) referensi totalSynced awal saat masuk ulang ke ujian.
export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const sesiId = searchParams.get('sesiId')
  const deviceId = searchParams.get('deviceId')
  if (!sesiId) return NextResponse.json({ error: 'sesiId diperlukan' }, { status: 400 })

  // FIX BUG #9 (GET jawaban PG tidak validasi status sesi/device): sebelumnya
  // endpoint ini mengambil jawaban langsung dari sesi_id+nis tanpa mengecek
  // apakah sesi masih BERJALAN atau apakah device yang meminta masih device
  // yang sah — padahal POST di atas (sync jawaban) sudah menegakkan keduanya.
  // Dampaknya memang rendah (read-only, data selalu milik NIS sendiri lewat
  // requireRole), tapi tetap ada celah kecil: device yang SUDAH diambil alih
  // (mis. HP lama yang ditinggal siswa) masih bisa terus membaca progres
  // jawaban dari sesi yang sudah ditutup. Disamakan dengan pola guard di POST
  // supaya konsisten.
  const { data: sesi } = await db.from('sesi_ujian').select('status').eq('id', sesiId).single()
  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })
  if (sesi.status !== 'BERJALAN') {
    return NextResponse.json({ error: 'Sesi ujian sudah ditutup.' }, { status: 409 })
  }

  const { data: siswaUjian } = await db
    .from('siswa_ujian')
    .select('status, device_id')
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!)
    .single()

  if (siswaUjian && (siswaUjian.status === 'TERKUNCI' || siswaUjian.status === 'RESET')) {
    return NextResponse.json(
      { error: 'Akses ujian Anda sedang dikunci/menunggu reset.' },
      { status: 403 }
    )
  }
  if (siswaUjian?.device_id && siswaUjian.device_id !== deviceId) {
    return NextResponse.json(
      { error: 'Sesi ujian Anda sedang aktif di perangkat lain.' },
      { status: 409 }
    )
  }

  // FIX BUG P1 (merge timestamp client vs server tidak setara — lihat FIX
  // di POST di atas): dulu hanya `updated_at` yang dikirim, dan client
  // membandingkannya dengan Date.now() lokal untuk resolusi konflik saat
  // resume — dua jam yang tidak setara. Sekarang sertakan `revisi`; client
  // memakai src/lib/jawaban-merge.ts (bandingkan revisi, bukan jam) dan
  // hanya jatuh ke jam sebagai pemutus kalau kedua revisi sama persis.
  // `updated_at` tetap disertakan untuk kompatibilitas & sebagai fallback itu.
  let { data, error } = await db
    .from('jawaban')
    .select('soal_id, jawaban, updated_at, revisi')
    .eq('sesi_id', sesiId)
    .eq('nis', user.nis!) as { data: { soal_id: string; jawaban: string; updated_at: string; revisi?: number }[] | null, error: { message: string } | null }

  if (error && /column .*revisi.* does not exist/i.test(error.message ?? '')) {
    // FALLBACK: migrasi 20_pg_offline_dan_revisi_jawaban.sql belum jalan di
    // database ini. Client tetap dapat data, hanya tanpa `revisi` (jatuh ke
    // perbandingan jam di jawaban-merge.ts, sama seperti perilaku lama).
    ;({ data, error } = await db
      .from('jawaban')
      .select('soal_id, jawaban, updated_at')
      .eq('sesi_id', sesiId)
      .eq('nis', user.nis!))
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ jawaban: data ?? [], totalSynced: data?.length ?? 0 })
}
