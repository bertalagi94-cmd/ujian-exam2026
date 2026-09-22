// app/api/siswa/ujian/validasi/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { catatAktivitas } from '@/lib/aktivitas'
import { instrumented } from '@/lib/metrik'
import { ambilMaksReset, MAKS_RESET_ABSOLUT } from '@/lib/reset-berurutan'
import { buatSemuaAmplopReset } from '@/lib/reset-amplop-server'

// Threshold: kalau last_heartbeat device lama lebih muda dari ini,
// anggap device lama masih aktif → tolak login device baru.
// Kalau lebih tua (device lama sudah lama tidak polling), izinkan takeover.
const DEVICE_STALE_MS = 2 * 60 * 1000 // 2 menit

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  // FIX (status "Server" panel Monitoring sekarang NYATA): endpoint ini
  // adalah titik utama keluhan "siswa tidak bisa masuk/mulai ujian", jadi
  // hasil & durasinya dicatat ke metrik_sistem — lihat src/lib/metrik.ts
  // dan komentar serupa di api/auth/login/route.ts.
  return instrumented('validasi_ujian', async () => {

  const db = createAdminClient()
  const { kodeSesi, nis, deviceId } = await req.json()

  if (nis !== user.nis) return NextResponse.json({ valid: false, message: 'NIS tidak sesuai' })

  // Ambil sesi aktif
  // FIX ARSITEKTUR KRITIS: sertakan paket_soal_id — kalau sesi ini SUDAH
  // punya snapshot paket (siswa lain sudah pernah masuk duluan), kita WAJIB
  // memakai paket yang sama, bukan resolusi ulang berdasarkan status
  // DISETUJUI (lihat FIX lengkap di bagian bawah & di penilaian-ujian.ts).
  const { data: sesi } = await db
    .from('sesi_ujian')
    .select('id, mapel_id, kelas, durasi, is_darurat, siswa_diizinkan, paket_soal_id')
    .eq('kode_sesi', kodeSesi.toUpperCase())
    .eq('status', 'BERJALAN')
    .single()

  if (!sesi) return NextResponse.json({ valid: false, message: 'Kode sesi tidak ditemukan atau ujian sudah selesai.' })

  // Validasi kelas
  if (user.kelas && String(user.kelas) !== String(sesi.kelas)) {
    return NextResponse.json({
      valid: false,
      message: `Anda bukan peserta ujian ini. Kelas Anda (${user.kelas}) tidak sesuai dengan kelas sesi (${sesi.kelas}).`,
    })
  }

  // Validasi sesi susulan
  if (sesi.is_darurat && Array.isArray(sesi.siswa_diizinkan) && sesi.siswa_diizinkan.length > 0) {
    if (!sesi.siswa_diizinkan.includes(nis)) {
      return NextResponse.json({ valid: false, message: 'Anda tidak terdaftar dalam sesi ujian susulan ini. Hubungi pengawas.' })
    }
  }

  // FIX kelas_id: sesi.kelas = nama kelas, paket_soal.kelas_id = ID dari tabel kelas
  const { data: kelasRow } = await db
    .from('kelas')
    .select('id')
    .eq('nama', String(sesi.kelas))
    .maybeSingle()
  const kelasId = kelasRow?.id ?? String(sesi.kelas)

  // FIX ARSITEKTUR KRITIS (snapshot paket ke sesi): kalau sesi ini sudah
  // punya paket_soal_id tersimpan (siswa lain sudah pernah masuk duluan),
  // ambil paket ITU LANGSUNG lewat id — jangan cari ulang berdasarkan
  // status DISETUJUI, supaya siswa yang masuk belakangan (refresh halaman,
  // device baru, dst.) selalu mendapat paket yang SAMA dengan siswa
  // pertama, apa pun yang terjadi pada status approval paket setelah itu.
  // FIX (pemilihan paket tidak deterministik): sebelumnya query ini TIDAK
  // punya .order() sebelum .limit(1).single(), jadi kalau ada LEBIH DARI
  // SATU paket_soal berstatus DISETUJUI untuk mapel+kelas yang sama, paket
  // mana yang jadi snapshot PERTAMA kali tidak bisa diprediksi — bergantung
  // urutan hasil yang dikembalikan Postgres, yang tidak dijamin stabil tanpa
  // ORDER BY eksplisit (bisa beda antar restart/deploy). Sekarang diurutkan
  // berdasarkan `created_at` (paket yang paling DULU dibuat yang menang) —
  // deterministik dan bisa diprediksi/diuji. Ini HANYA memengaruhi resolusi
  // PERTAMA KALI; siswa berikutnya tetap selalu memakai paket_soal_id yang
  // sudah ter-snapshot (baris `sesi.paket_soal_id ?` di atas), tidak berubah.
  const paketQuery = sesi.paket_soal_id
    ? db.from('paket_soal').select('id, acak').eq('id', sesi.paket_soal_id).eq('status', 'DISETUJUI').maybeSingle()
    : db.from('paket_soal').select('id, acak').eq('mapel_id', sesi.mapel_id).eq('kelas_id', kelasId).eq('status', 'DISETUJUI').order('created_at', { ascending: true }).order('id', { ascending: true }).limit(1).single()

  const [
    { data: nilaiAda },
    { data: siswaUjian, error: siswaUjianError },
    { data: paketData },
    { data: mapel },
    { data: pengaturanRows },
  ] = await Promise.all([
    db.from('nilai').select('id').eq('sesi_id', sesi.id).eq('nis', nis).single(),
    db.from('siswa_ujian').select('status, waktu_mulai, waktu_mulai_awal, device_id, last_heartbeat').eq('sesi_id', sesi.id).eq('nis', nis).single(),
    paketQuery,
    db.from('mapel').select('nama').eq('id', sesi.mapel_id).single(),
    db.from('pengaturan').select('key, value').in('key', ['minSubmitAktif', 'minSubmitMenit']),
  ])

  // FIX: .single() mengembalikan error (PGRST116) kalau baris belum ada
  // sama sekali — itu wajar untuk siswa baru. Tapi error LAIN harus dianggap kegagalan nyata.
  if (siswaUjianError && siswaUjianError.code !== 'PGRST116') {
    return NextResponse.json(
      { valid: false, message: 'Gagal memeriksa status ujian Anda. Coba lagi beberapa saat.' },
      { status: 500 }
    )
  }

  if (nilaiAda) return NextResponse.json({ valid: false, message: 'Anda sudah menyelesaikan ujian ini.' })
  // FIX BUG (tidak ada tombol "Kembali ke Beranda" setelah dikunci
  // permanen): sebelumnya respons ini hanya berupa `message` teks biasa,
  // yang di client (src/app/siswa/ujian/page.tsx) cuma ditaruh di
  // `setError(...)` pada layar input kode — layar itu (phase 'KODE') dan
  // layar sebelumnya (phase 'PERSIAPAN') sama sekali tidak punya link ke
  // halaman beranda ('/siswa'), beda dengan layar "Ujian Dihentikan"
  // (dikeluarkan) yang memang sudah punya tombol tsb. Akibatnya siswa yang
  // sudah terkunci lalu mencoba masuk ulang (refresh/buka lagi) terjebak
  // bolak-balik PERSIAPAN <-> KODE tanpa jalan keluar ke beranda.
  // Sekarang: sertakan flag `terkunci_permanen` + jumlah pelanggaran asli
  // supaya client bisa langsung menampilkan layar "Ujian Dihentikan" yang
  // sudah lengkap tombolnya, alih-alih hanya menaruh pesan error di layar
  // input kode.
  if (siswaUjian?.status === 'TERKUNCI') {
    const { count: jumlahPelanggaran } = await db
      .from('pelanggaran')
      .select('*', { count: 'exact', head: true })
      .eq('sesi_id', sesi.id)
      .eq('nis', nis)
      .neq('status', 'DIABAIKAN')
    return NextResponse.json({
      valid: false,
      terkunci_permanen: true,
      jumlah_pelanggaran: jumlahPelanggaran ?? undefined,
      message: 'Akun Anda dikunci permanen oleh pengawas karena pelanggaran berulang. Nilai Anda 0.',
    })
  }
  if (siswaUjian?.status === 'RESET') {
    return NextResponse.json({ valid: false, perlu_kode_reset: true, sesiId: sesi.id, message: 'Akun Anda di-reset oleh pengawas karena pelanggaran. Masukkan kode 7 digit dari pengawas untuk melanjutkan ujian.' })
  }

  // ── DETEKSI LOGIN GANDA (multi-device) ───────────────────────────────────
  // Kalau ada device_id berbeda yang masih aktif (heartbeat segar < 2 menit),
  // tolak login ini. Kalau device lama sudah stale (> 2 menit tidak heartbeat),
  // izinkan takeover — artinya siswa pindah perangkat karena laptop rusak dll.
  //
  // FIX BUG (anti-device bisa dilewati dengan tidak mengirim deviceId): lihat
  // penjelasan lengkap di sync/route.ts — pola yang sama persis ada di sini,
  // dan di sinilah paling berbahaya karena ini titik LOGIN awal. Sebelumnya
  // `if (deviceId && ...)` membuat login TANPA deviceId sama sekali lolos
  // begitu saja tanpa pernah dicek terhadap device yang sudah aktif. Sekarang
  // begitu ada device_id terdaftar & masih aktif (heartbeat segar), login
  // tanpa deviceId yang cocok selalu ditolak — sama seperti device lain yang
  // mencoba mengambil alih.
  if (siswaUjian?.device_id && siswaUjian.device_id !== deviceId) {
    const lastHb = siswaUjian.last_heartbeat ? new Date(siswaUjian.last_heartbeat).getTime() : 0
    const deviceLamaMasihAktif = lastHb > 0 && (Date.now() - lastHb) < DEVICE_STALE_MS
    if (deviceLamaMasihAktif) {
      return NextResponse.json({
        valid: false,
        message: 'Ujian Anda sedang aktif di perangkat lain. Tutup browser di perangkat lain terlebih dahulu, lalu coba lagi.',
      })
    }
    // Device lama sudah stale — lanjut, device baru akan mengambil alih
  }
  // ─────────────────────────────────────────────────────────────────────────

  const isNewEntry = !siswaUjian

  // FASE 7 FIX (audit lanjutan): sebelumnya registrasi siswa_ujian pertama
  // kali (isNewEntry) menyimpan `deviceId ?? null` — kalau client tidak
  // mengirim deviceId sama sekali, binding pertama tersimpan NULL. Proteksi
  // device-takeover di atas (`siswaUjian?.device_id && ... !== deviceId`)
  // butuh nilai pembanding yang sudah ada; kalau binding pertama NULL,
  // seluruh siswa_ujian ini jadi permanent loophole — device APA PUN bisa
  // "melanjutkan" tanpa pernah dianggap device baru, sampai suatu saat ada
  // deviceId pertama yang tersimpan (yang sendirinya juga bisa NULL lagi
  // kalau request device_id tidak dikirim). Sekarang: START ditolak kalau
  // ini entry baru tapi deviceId tidak ada / bukan string yang valid.
  if (isNewEntry) {
    const deviceIdValid = typeof deviceId === 'string' && deviceId.trim().length >= 8
    if (!deviceIdValid) {
      return NextResponse.json({
        valid: false,
        message: 'Perangkat tidak terdeteksi dengan benar. Muat ulang halaman dan coba lagi. Jika masalah berlanjut, hubungi pengawas.',
      })
    }
  }

  // FIX (soal lintas kelas): dulu, kalau tidak ada paket_soal yang DISETUJUI
  // untuk kombinasi mapel_id+kelas_id siswa ini (paketData null — misalnya
  // karena baris `kelas` duplikat namanya sehingga lookup kelasId di atas
  // gagal, atau memang belum ada paket disetujui untuk kelas ini), query
  // soal di bawah jatuh ke fallback yang HANYA difilter mapel_id+status —
  // TANPA paket_id/kelas_id sama sekali. Siswa jadi bisa menerima campuran
  // semua soal DISETUJUI milik mapel ini dari paket KELAS LAIN, dan
  // penilaian di /api/siswa/ujian/selesai bisa salah karena soal_id yang
  // dijawab tidak akan cocok dengan kunciMap paket yang benar (paket itu
  // dihitung berdasarkan kelasId, bukan dari soal yang benar-benar
  // ditampilkan ke siswa).
  //
  // FIX: kalau tidak ada paket yang disetujui untuk kelas siswa, HENTIKAN
  // di sini dengan pesan yang jelas. Jangan pernah query tabel `soal` tanpa
  // filter paket_id ketika paketData tidak ada — siswa tidak didaftarkan
  // (siswa_ujian) dan tidak diberi soal apa pun dari kelas lain.
  if (!paketData) {
    // Pesan berbeda kalau sesi ini SUDAH punya snapshot paket tapi paket
    // itu sekarang entah kenapa tidak lagi DISETUJUI (seharusnya tidak
    // pernah terjadi selama sesi BERJALAN karena cekSesiMapelKelasSudahMulai
    // di sisi Admin memblokir perubahan status paket — kalau pesan ini
    // muncul, berarti ada jalur lain yang belum tertutup dan perlu
    // diselidiki, BUKAN sekadar disuruh coba lagi).
    return NextResponse.json({
      valid: false,
      message: sesi.paket_soal_id
        ? 'Paket soal yang digunakan sesi ini sudah tidak berstatus disetujui. Hubungi admin — JANGAN buka sesi baru untuk kombinasi mapel & kelas ini sebelum masalah ini diperbaiki, karena penilaian bisa salah.'
        : 'Belum ada paket soal yang disetujui untuk kelas Anda pada mata pelajaran ini. Hubungi guru pengampu atau admin.',
    })
  }

  // P0 FIX (fail-closed START — audit brief "resetMaterial gagal tapi valid:
  // true"): siapkan material verifier R1..R(maksReset) SEKARANG, SEBELUM
  // siswa_ujian ditandai AKTIF & SEBELUM waktu_mulai/waktu_mulai_awal
  // di-stamp di bawah. Ini SENGAJA dipindah ke sini (bukan di akhir seperti
  // sebelumnya) supaya kalau persiapan gagal dan kita menahan START, kita
  // belum terlanjur menulis waktu_mulai_awal — jadi retry berikutnya (mis.
  // setelah admin memperbaiki RESET_PELANGGARAN_SECRET) tidak kehilangan
  // waktu ujian siswa akibat percobaan yang gagal ini.
  //
  // SEBELUMNYA (bug P0): kalau buatSemuaAmplopReset() gagal (mis. secret
  // belum diset), resetMaterial jadi [] TAPI endpoint tetap mengembalikan
  // `valid: true` — siswa bisa mulai ujian tanpa kemampuan reset R1/R2/R3
  // offline sama sekali. Kalau internet lalu mati saat pelanggaran terjadi,
  // siswa terjebak: tidak ada cara verifikasi reset secara lokal. Gerbang
  // fail-closed sebelumnya HANYA ada di client (page.tsx) — cukup untuk
  // client resmi, tapi tidak cukup sebagai jaminan keamanan di titik
  // kepercayaan (trust boundary) yang benar, yaitu server. Sekarang server
  // sendiri menolak START (valid:false) kalau sesi ini butuh reset
  // (maksReset > 0) tapi materialnya tidak lengkap — apa pun klien yang
  // memanggil endpoint ini.
  //
  // Kalau maksReset menghasilkan 0 (fitur reset memang dimatikan untuk
  // sesi ini), TIDAK diblokir — reset offline memang tidak dibutuhkan.
  let resetMaterial: Awaited<ReturnType<typeof buatSemuaAmplopReset>> = []
  let maksReset = 0
  let gagalMenyiapkanReset = false
  try {
    maksReset = await ambilMaksReset(db)
  } catch (e) {
    // Tidak bisa menentukan berapa maksReset yang seharusnya — jangan
    // diam-diam anggap 0 (yang berarti "tidak butuh reset"), karena itu
    // bisa salah. Fail-closed: anggap sesi ini BUTUH reset penuh supaya
    // pemeriksaan kelengkapan di bawah menahan START, bukan meloloskannya.
    console.error('[validasi] gagal mengambil pengaturan maksReset:', e instanceof Error ? e.message : e)
    maksReset = MAKS_RESET_ABSOLUT
    gagalMenyiapkanReset = true
  }
  if (!gagalMenyiapkanReset && maksReset > 0) {
    try {
      resetMaterial = await buatSemuaAmplopReset(sesi.id, nis, maksReset)
    } catch (e) {
      console.error('[validasi] gagal menyiapkan material reset offline:', e instanceof Error ? e.message : e)
      resetMaterial = []
    }
  }
  if (maksReset > 0 && resetMaterial.length !== maksReset) {
    // START DITAHAN — sesi ini butuh reset offline tapi materialnya tidak
    // lengkap/gagal dibuat. Belum ada tulisan apa pun ke siswa_ujian untuk
    // percobaan ini, jadi aman diulang begitu server sudah siap.
    return NextResponse.json({
      valid: false,
      message: 'Sistem belum siap menyiapkan data reset pelanggaran untuk mode offline pada sesi ini. ' +
        'Ujian belum bisa dimulai. Hubungi pengawas/admin, lalu coba masukkan kode lagi.',
    })
  }

  // FIX ARSITEKTUR KRITIS (snapshot paket ke sesi): kunci paket_soal_id ini
  // ke sesi SEKALI, hanya kalau kolomnya masih NULL (siswa pertama yang
  // masuk). Guard `.is('paket_soal_id', null)` membuat ini idempotent &
  // aman dari race antar-siswa yang masuk nyaris bersamaan — siapa pun yang
  // menang update ini, PAKET YANG SAMA (paketData.id, hasil resolusi query
  // di atas) yang tersimpan, karena semua siswa pertama pada sesi yang sama
  // pasti me-resolve paket yang sama persis (query yang identik). Sesudah
  // baris ini terisi, penilaian (ambilDataSesiUntukPenilaian) dan validasi
  // siswa berikutnya SELALU memakai paket_soal_id ini — tidak peduli apa
  // yang terjadi pada status approval paket setelahnya.
  // FASE 1 FIX (audit lanjutan): sebelumnya update ini tidak pernah dicek
  // error-nya maupun dibaca ulang. Kalau UPDATE gagal (mis. gangguan DB
  // sesaat), sesi.paket_soal_id tetap NULL di database padahal siswa ini
  // sudah terlanjur dianggap "isNewEntry" dan bisa lanjut mengerjakan
  // dengan paketData yang HANYA ada di memori proses ini. Siswa berikutnya
  // yang masuk akan me-resolve ulang paket dari mapel+kelas+DISETUJUI, yang
  // bisa saja sudah berubah (paket baru disetujui) — hasilnya dua siswa di
  // sesi yang sama mengerjakan paket BERBEDA tanpa terdeteksi.
  //
  // Sekarang: fail-closed. UPDATE dicek errornya, lalu DIBACA ULANG dari
  // DB untuk memastikan snapshot yang benar-benar tersimpan sama dengan
  // paketData.id yang dipakai untuk menyusun soalList di bawah. Kalau tidak
  // cocok (update gagal, atau race dengan siswa lain yang snapshot ke paket
  // lain terlebih dahulu — seharusnya tidak mungkin karena resolusi
  // deterministik di atas, tapi diperiksa juga untuk jaga-jaga), START
  // ditolak. Belum ada baris siswa_ujian yang ditulis untuk percobaan ini,
  // jadi aman untuk diulang.
  if (!sesi.paket_soal_id) {
    const { error: snapshotError } = await db.from('sesi_ujian')
      .update({ paket_soal_id: paketData.id })
      .eq('id', sesi.id)
      .is('paket_soal_id', null)

    if (snapshotError) {
      console.error('[validasi] gagal menulis snapshot paket_soal_id:', snapshotError.message)
      return NextResponse.json({
        valid: false,
        message: 'Sistem gagal mengunci paket soal untuk sesi ini. Ujian belum bisa dimulai. Coba lagi beberapa saat.',
      })
    }

    const { data: sesiVerifikasi, error: verifikasiError } = await db
      .from('sesi_ujian')
      .select('paket_soal_id')
      .eq('id', sesi.id)
      .single()

    if (verifikasiError || sesiVerifikasi?.paket_soal_id !== paketData.id) {
      console.error(
        '[validasi] verifikasi snapshot paket_soal_id gagal setelah update:',
        verifikasiError?.message ?? `tersimpan=${sesiVerifikasi?.paket_soal_id} diharapkan=${paketData.id}`
      )
      return NextResponse.json({
        valid: false,
        message: 'Sistem gagal memastikan paket soal terkunci untuk sesi ini. Ujian belum bisa dimulai. Coba lagi beberapa saat.',
      })
    }
  }

  // Ambil soal TANPA field kunci dan pembahasan (keamanan) — selalu
  // di-scope ke paket_id yang sudah dipastikan milik kelas siswa di atas.
  const soalQuery = db
    .from('soal')
    .select('id, paket_id, mapel_id, teks, opsi_a, opsi_b, opsi_c, opsi_d, opsi_e, jumlah_opsi, gambar_pertanyaan, gambar_opsi_a, gambar_opsi_b, gambar_opsi_c, gambar_opsi_d, gambar_opsi_e, status')
    .eq('mapel_id', sesi.mapel_id)
    .eq('status', 'DISETUJUI')
    .eq('paket_id', paketData.id)

  const now = new Date().toISOString()

  const [{ data: soalList }, siswaUjianWriteResult] = await Promise.all([
    soalQuery,
    isNewEntry
      ? db.from('siswa_ujian').upsert({
          sesi_id: sesi.id, nis,
          waktu_daftar: now,
          waktu_mulai: now,
          waktu_mulai_awal: now,
          status: 'AKTIF',
          device_id: deviceId ?? null,
          last_heartbeat: now,
        }, { onConflict: 'sesi_id,nis', ignoreDuplicates: false })
      : db.from('siswa_ujian').update({
          status: 'AKTIF',
          device_id: deviceId ?? siswaUjian?.device_id ?? null,
          last_heartbeat: now,
        }).eq('sesi_id', sesi.id).eq('nis', nis),
  ])

  if (siswaUjianWriteResult.error) {
    return NextResponse.json(
      { valid: false, message: 'Gagal mendaftarkan Anda ke sesi ujian. Coba lagi beberapa saat.' },
      { status: 500 }
    )
  }

  // Catat "mulai ujian" HANYA saat benar-benar pertama kali masuk sesi ini
  // (isNewEntry) — bukan setiap kali endpoint ini dipanggil ulang (mis.
  // refresh halaman, retry jaringan), supaya log tidak banjir event yang
  // sama berulang-ulang untuk satu siswa yang sama.
  if (isNewEntry) {
    catatAktivitas(db, nis, 'MULAI_UJIAN', `Siswa ${user.nama} mulai ujian ${mapel?.nama ?? sesi.mapel_id} (${sesi.kelas})`)
  }

  // ── Tutup race condition login bersamaan ──────────────────────────────────
  // Setelah upsert, baca ulang device_id yang sebenarnya tersimpan.
  // Kalau berbeda (device lain "menang" dalam race bersamaan), tolak device ini.
  //
  // FIX BUG (anti-device bisa dilewati dengan tidak mengirim deviceId):
  // sebelumnya query verifikasi ini hanya dijalankan `if (deviceId)` — login
  // tanpa deviceId melewatkan verifikasi ulang ini sama sekali. Sekarang
  // selalu dijalankan; device_id yang tersimpan tetap dibandingkan dengan
  // `deviceId` request ini (termasuk kalau `deviceId` kosong/undefined, yang
  // otomatis dianggap tidak cocok kalau ternyata ada device_id tersimpan).
  {
    const { data: aktualRow } = await db
      .from('siswa_ujian')
      .select('device_id')
      .eq('sesi_id', sesi.id)
      .eq('nis', nis)
      .single()
    if (aktualRow?.device_id && aktualRow.device_id !== deviceId) {
      return NextResponse.json({
        valid: false,
        message: 'Ujian Anda sedang aktif di perangkat lain. Tutup browser di perangkat lain terlebih dahulu, lalu coba lagi.',
      })
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  if (!soalList?.length) return NextResponse.json({ valid: false, message: 'Tidak ada soal tersedia untuk ujian ini. Pastikan paket soal sudah disetujui.' })

  // Increment jumlah_peserta di background
  if (isNewEntry) {
    db.rpc('increment_jumlah_peserta', { sesi_id_param: sesi.id })
  }

  // Acak soal
  const shouldAcak = paketData?.acak === 'YA'
  let finalSoal
  if (shouldAcak) {
    const arr = [...soalList]
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    finalSoal = arr.map((s, i) => ({ ...s, nomor: i + 1 }))
  } else {
    finalSoal = soalList.map((s, i) => ({ ...s, nomor: i + 1 }))
  }

  // Gunakan waktu_mulai_awal sebagai referensi timer
  const waktuMulaiRef = siswaUjian?.waktu_mulai_awal ?? siswaUjian?.waktu_mulai ?? now

  // Hitung batas minimal submit dari pengaturan
  const pgMap = Object.fromEntries(
    (pengaturanRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
  )
  const minSubmitAktif = pgMap['minSubmitAktif'] === 'true'
  const minSubmitMenit = minSubmitAktif ? (parseInt(pgMap['minSubmitMenit']) || 45) : 0

  // resetMaterial/maksReset sudah disiapkan & diverifikasi lengkap di atas
  // (sebelum siswa_ujian ditandai AKTIF) — lihat blok fail-closed START.

  return NextResponse.json({
    valid: true,
    sesiId: sesi.id,
    mapelId: sesi.mapel_id,
    namaMapel: mapel?.nama ?? sesi.mapel_id,
    kelas: sesi.kelas,
    durasi: sesi.durasi,
    waktu_mulai: waktuMulaiRef,
    soalList: finalSoal,
    minSubmitMenit,
    resetMaterial,
    maksReset,
  })
  })
}
