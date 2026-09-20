// Outbox PERMANEN untuk "paket ujian belum terkirim", disimpan di localStorage
// (BUKAN React state) supaya bertahan lewat refresh/tutup-buka browser, sama
// seperti pola backup jawaban PG (lihat backupKey() di siswa/ujian/page.tsx)
// dan klaim offline PG (lihat pg-offline-client.ts).
//
// Latar belakang: sebelum modul ini ada, dua celah offline masih terbuka:
//   1) handleKirimEssay() di siswa/ujian/page.tsx memanggil endpoint
//      /essay/kirim secara LANGSUNG saat tombol "Kirim" ditekan. Kalau
//      koneksi mati TEPAT di titik itu, prosesnya berhenti dan siswa
//      terjebak di layar error — tidak ada jejak permanen bahwa essay-nya
//      "menunggu dikirim", dan tidak ada apa pun yang mencoba lagi kalau
//      siswa menutup tab.
//   2) Retry finalisasi PG (lihat useEffect [pgSelesaiOfflinePending] di
//      page.tsx) memang sudah pulih otomatis lewat klaim di localStorage,
//      TAPI itu logikanya cuma jalan selagi komponen halaman ujian sedang
//      dipasang (mounted) — begitu siswa pindah halaman, retry berhenti.
//
// Modul ini menyatukan status "satu paket ujian" (PG + essay milik satu sesi)
// jadi SATU baris outbox dengan siklus status:
//   BELUM_TERKIRIM → MENUNGGU_JARINGAN → (retry) → TERKIRIM → (dihapus)
// dan menyediakan "penjaga" global (mulaiPenjagaOutbox) yang dipasang SEKALI
// di src/app/siswa/layout.tsx, supaya retry tetap jalan di seluruh area siswa
// selama aplikasi terbuka, bukan hanya selagi berada persis di halaman ujian.
//
// PENTING: modul ini TIDAK mengubah kontrak endpoint /api/siswa/ujian/selesai
// maupun /api/siswa/ujian/essay/kirim. Keduanya SUDAH idempotent by design
// (lihat early-return "sudahDikirim"/"nilai sudah ada" di masing-masing
// route.ts) — outbox ini murni pembungkus client yang boleh memanggil
// keduanya berkali-kali dengan aman sampai mendapat ACK.

import { ambilStatusOffline, hapusStatusOffline } from '@/lib/essay-amplop-client'
import { apiRequest } from '@/lib/utils'
import { outboxPut, outboxGet, outboxDelete, outboxGetAllValues } from '@/lib/ujian-offline-storage'

// PERBAIKAN AUDIT P0 #2 (outbox bisa finalisasi PG tanpa sync jawaban dulu):
// cobaKirimPaketTertunda() DULU langsung memanggil POST /selesai begitu
// `butuhFinalisasiPg` true, tanpa jaminan seluruh jawaban lokal sudah
// tersinkron. Sekarang outbox INI SENDIRI (bukan cuma halaman ujian yang
// mounted) membaca backup jawaban lokal (format sama dengan backupKey() di
// siswa/ujian/page.tsx) dan memanggil /api/siswa/ujian/sync sampai semua
// jawaban terverifikasi ACK server, BARU memanggil /selesai. Wajib berlaku
// walau siswa sudah pindah halaman — modul ini berjalan lewat penjaga
// global (mulaiPenjagaOutbox) di siswa/layout.tsx, bukan hanya di
// siswa/ujian/page.tsx.

interface BackupJawabanOutbox {
  v: Record<string, string>
  t: Record<string, number>
  r?: Record<string, number>
}

function backupKeyOutbox(sesiId: string, nis: string): string {
  return `ujian_backup_${sesiId}_${nis}`
}

function bacaBackupJawabanLokal(sesiId: string, nis: string): BackupJawabanOutbox {
  try {
    const raw = localStorage.getItem(backupKeyOutbox(sesiId, nis))
    if (!raw) return { v: {}, t: {}, r: {} }
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && 'v' in parsed) {
      return { v: parsed.v ?? {}, t: parsed.t ?? {}, r: parsed.r ?? {} }
    }
    return { v: parsed ?? {}, t: {}, r: {} }
  } catch {
    return { v: {}, t: {}, r: {} }
  }
}

/**
 * SYNC ALL ANSWERS → SERVER ACK, dijalankan MANDIRI oleh outbox (tanpa
 * bergantung pada React state halaman ujian yang mungkin sudah unmount).
 * Mengembalikan true HANYA kalau semua jawaban lokal berhasil dikonfirmasi
 * server (`totalSynced` mencakup seluruh jawaban lokal yang ada).
 * Kalau tidak ada backup jawaban tersimpan sama sekali (mis. sudah
 * dibersihkan karena sebelumnya sudah tersinkron penuh), dianggap sinkron.
 */
async function pastikanJawabanTersinkron(
  sesiId: string,
  nis: string,
  deviceId: string
): Promise<{ sinkron: boolean; permanentReject?: boolean }> {
  const backup = bacaBackupJawabanLokal(sesiId, nis)
  const entries = Object.entries(backup.v)
  if (entries.length === 0) return { sinkron: true }

  try {
    const res = await apiRequest<{ totalSynced: number }>('/api/siswa/ujian/sync', {
      method: 'POST',
      body: JSON.stringify({
        sesiId,
        jawaban: entries.map(([soal_id, jawaban]) => ({
          soal_id,
          jawaban,
          revisi: backup.r?.[soal_id] ?? 1,
        })),
        deviceId,
      }),
    })
    return { sinkron: (res.totalSynced ?? 0) >= entries.length }
  } catch (err: unknown) {
    const status = (err as { status?: number } | undefined)?.status
    // 409 (sesi ditutup/diambil alih perangkat lain) tidak akan pernah
    // berhasil diulang — biarkan pemanggil menandai GAGAL, bukan retry
    // selamanya. Kegagalan jaringan murni (tanpa status) tetap "belum
    // sinkron" dan layak dicoba lagi nanti.
    if (status && status !== 500 && status !== 502 && status !== 503 && status !== 504) {
      return { sinkron: false, permanentReject: true }
    }
    return { sinkron: false }
  }
}

export type StatusPaketTertunda =
  | 'BELUM_TERKIRIM'    // baru dibuat, belum ada percobaan kirim sama sekali
  | 'MENYINKRONKAN'     // sedang mengirim jawaban lokal (SYNC) sebelum boleh /selesai
  | 'MENUNGGU_JARINGAN' // sudah dicoba, gagal murni karena jaringan/timeout
  | 'MENGIRIM'          // percobaan sedang berjalan (dipakai UI untuk spinner)
  | 'GAGAL'             // server MENOLAK secara sah (4xx selain race biasa) — butuh perhatian, tidak di-retry otomatis lagi
  | 'TERKIRIM'          // sukses, entri ini akan dihapus sesaat setelah ditandai (state transisi utk UI)

export interface PaketUjianTertunda {
  sesiId: string
  nis: string
  deviceId: string
  namaMapel: string
  dibuatIso: string
  percobaanTerakhirIso: string | null
  jumlahPercobaan: number
  status: StatusPaketTertunda
  pesanTerakhir: string | null
  /** Klaim waktu "selesai PG" saat offline, untuk audit di server (lihat klaimkanWaktu). */
  waktuSelesaiClaimIso: string | null
  /** false kalau nilai PG di server sudah pasti final (finalisasi tidak perlu diulang lagi). */
  butuhFinalisasiPg: boolean
  /** false kalau sesi ini tidak/tidak lagi punya essay yang perlu dikirim. */
  butuhKirimEssay: boolean
}

const PREFIX = 'outboxUjian:v1'

function storageKey(sesiId: string, nis: string): string {
  return `${PREFIX}:${sesiId}:${nis}`
}

// FIX AUDIT P0 #7 (migrasi bertahap localStorage → IndexedDB, tahap 1:
// outbox): outbox dulu SELURUHNYA disimpan sebagai string JSON di
// localStorage. Sekarang IndexedDB (STORE_OUTBOX, lihat
// ujian-offline-storage.ts) jadi penyimpanan UTAMA — lebih besar
// kuotanya dan tidak memblokir main thread untuk payload besar (paket bisa
// menumpuk kalau siswa lama offline). localStorage TETAP dipakai sebagai
// fallback DARURAT dua arah:
//   1) kalau IndexedDB gagal/tidak tersedia sama sekali (mis. browser lama,
//      mode privat sangat ketat) — supaya outbox tidak berhenti total,
//   2) migrasi SEKALI JALAN: entri lama yang sudah kadung tersimpan di
//      localStorage (dari versi sebelum patch ini) dipindah ke IndexedDB
//      begitu pertama kali modul ini dipakai, supaya tidak ada paket ujian
//      siswa yang "hilang" gara-gara pindah tempat penyimpanan.
let migrasiOutboxSelesai = false

function bacaSemuaKeyOutboxLocalStorage(): string[] {
  const hasil: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(`${PREFIX}:`)) hasil.push(k)
    }
  } catch {
    // Private mode / storage tidak tersedia — anggap tidak ada yang lama.
  }
  return hasil
}

async function migrasikanOutboxLamaJikaPerlu(): Promise<void> {
  if (migrasiOutboxSelesai) return
  // Ditandai selesai DI AWAL (bukan di akhir): kalaupun migrasi gagal
  // sebagian di tengah jalan, kita tidak mencoba mengulang di SETIAP
  // pemanggilan fungsi outbox (yang bisa sangat sering) — fallback baca
  // localStorage di ambilPaketTertunda/ambilSemuaPaketTertunda tetap
  // menjaga data lama tetap terbaca walau belum sempat pindah.
  migrasiOutboxSelesai = true
  const keysLama = bacaSemuaKeyOutboxLocalStorage()
  for (const k of keysLama) {
    try {
      const raw = localStorage.getItem(k)
      if (!raw) continue
      const paket = JSON.parse(raw) as PaketUjianTertunda
      await outboxPut(k, paket)
      localStorage.removeItem(k)
    } catch {
      // satu entri korup/gagal migrasi tidak boleh menghentikan entri lain
    }
  }
}

/** Buat entri baru atau perbarui entri yang sudah ada untuk sesi ini. */
export async function simpanPaketTertunda(
  data: Pick<PaketUjianTertunda, 'sesiId' | 'nis' | 'deviceId' | 'namaMapel'> &
    Partial<PaketUjianTertunda>
): Promise<PaketUjianTertunda> {
  await migrasikanOutboxLamaJikaPerlu()
  const existing = await ambilPaketTertunda(data.sesiId, data.nis)
  const paket: PaketUjianTertunda = {
    sesiId: data.sesiId,
    nis: data.nis,
    deviceId: data.deviceId,
    namaMapel: data.namaMapel,
    dibuatIso: existing?.dibuatIso ?? new Date().toISOString(),
    percobaanTerakhirIso: existing?.percobaanTerakhirIso ?? null,
    jumlahPercobaan: existing?.jumlahPercobaan ?? 0,
    status: data.status ?? existing?.status ?? 'BELUM_TERKIRIM',
    pesanTerakhir: data.pesanTerakhir ?? existing?.pesanTerakhir ?? null,
    waktuSelesaiClaimIso: data.waktuSelesaiClaimIso ?? existing?.waktuSelesaiClaimIso ?? null,
    butuhFinalisasiPg: data.butuhFinalisasiPg ?? existing?.butuhFinalisasiPg ?? false,
    butuhKirimEssay: data.butuhKirimEssay ?? existing?.butuhKirimEssay ?? true,
  }
  try {
    await outboxPut(storageKey(paket.sesiId, paket.nis), paket)
  } catch {
    // IndexedDB gagal/tidak tersedia — fallback darurat ke localStorage
    // supaya retry berikutnya masih berpeluang menemukan entri ini, alih-
    // alih diam-diam kehilangan status paket ini sepenuhnya.
    try {
      localStorage.setItem(storageKey(paket.sesiId, paket.nis), JSON.stringify(paket))
    } catch {
      // Kedua penyimpanan gagal — sudah di luar kendali modul ini;
      // healthCheckStorage() sebelum START seharusnya sudah menangkap ini.
    }
  }
  return paket
}

export async function ambilPaketTertunda(sesiId: string, nis: string): Promise<PaketUjianTertunda | null> {
  await migrasikanOutboxLamaJikaPerlu()
  try {
    const dariIdb = await outboxGet<PaketUjianTertunda>(storageKey(sesiId, nis))
    if (dariIdb) return dariIdb
  } catch {
    // IndexedDB tidak tersedia — lanjut ke fallback localStorage di bawah.
  }
  try {
    const raw = localStorage.getItem(storageKey(sesiId, nis))
    return raw ? (JSON.parse(raw) as PaketUjianTertunda) : null
  } catch {
    return null
  }
}

export async function hapusPaketTertunda(sesiId: string, nis: string): Promise<void> {
  try {
    await outboxDelete(storageKey(sesiId, nis))
  } catch {
    // abaikan — kalau IndexedDB tidak tersedia, tidak ada apa pun di sana
  }
  try {
    localStorage.removeItem(storageKey(sesiId, nis))
  } catch {
    // abaikan
  }
}

/** Semua paket tertunda milik satu NIS, untuk menu "Pengiriman Ujian Tertunda". */
export async function ambilSemuaPaketTertunda(nis: string): Promise<PaketUjianTertunda[]> {
  await migrasikanOutboxLamaJikaPerlu()
  const hasil: PaketUjianTertunda[] = []
  try {
    const semua = await outboxGetAllValues<PaketUjianTertunda>()
    for (const paket of semua) {
      if (paket.nis === nis) hasil.push(paket)
    }
  } catch {
    // IndexedDB tidak tersedia sama sekali (browser sangat lama) — fallback
    // baca langsung dari localStorage, sama seperti perilaku sebelum #7.
    for (const k of bacaSemuaKeyOutboxLocalStorage()) {
      try {
        const raw = localStorage.getItem(k)
        if (!raw) continue
        const paket = JSON.parse(raw) as PaketUjianTertunda
        if (paket.nis === nis) hasil.push(paket)
      } catch {
        // entri korup — abaikan, jangan sampai mematikan seluruh daftar
      }
    }
  }
  return hasil.sort((a, b) => a.dibuatIso.localeCompare(b.dibuatIso))
}

// Batas waktu sebuah percobaan kirim dianggap MACET (tab ditutup / reload /
// deploy di tengah percobaan). Satu percobaan normal jauh di bawah ini
// (tiap request punya timeout 10 detik).
export const MENGIRIM_BASI_MS = 2 * 60 * 1000

/** Status "sedang berjalan" (MENGIRIM / MENYINKRONKAN), baik masih baru maupun macet. */
export function statusSedangBerjalan(status: StatusPaketTertunda): boolean {
  return status === 'MENGIRIM' || status === 'MENYINKRONKAN'
}

/** True kalau percobaan kirim ini kemungkinan besar sudah mati di tengah jalan. */
export function paketMengirimMacet(paket: PaketUjianTertunda): boolean {
  if (!statusSedangBerjalan(paket.status)) return false
  const t = paket.percobaanTerakhirIso ? Date.parse(paket.percobaanTerakhirIso) : 0
  return !t || Date.now() - t > MENGIRIM_BASI_MS
}

/** True kalau ada percobaan yang MASIH berjalan sungguhan (jangan dobel kirim). */
function sedangDiprosesAktif(paket: PaketUjianTertunda): boolean {
  return statusSedangBerjalan(paket.status) && !paketMengirimMacet(paket)
}

// Baca backup jawaban essay lokal yang ditulis halaman ujian (mode DIGITAL) di
// localStorage. Format baru {v, t} maupun format lama (flat map) didukung.
function bacaBackupEssayLokal(sesiId: string, nis: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(`ujian_essay_backup_${sesiId}_${nis}`)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    const peta = parsed && typeof parsed === 'object' && 'v' in parsed ? parsed.v : parsed
    return peta && typeof peta === 'object' ? (peta as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/**
 * Langkah WAJIB sebelum /essay/kirim (FIX audit, jalur darurat offline):
 * saat siswa mengerjakan essay lewat KODE DARURAT tanpa internet, server belum
 * tahu apa-apa (status_essay masih BELUM_MULAI) dan jawaban essay baru ada di
 * perangkat. Efek rekonsiliasi di halaman ujian hanya berjalan selama fase
 * ESSAY_KERJAKAN -- begitu siswa menekan Kirim (offline) dan halaman pindah ke
 * SELESAI, efek itu berhenti, padahal outbox ini kemudian memanggil
 * /essay/kirim langsung -> server menolak 409 "Essay belum dimulai" dan paket
 * jadi GAGAL, sementara jawaban essay lokalnya tidak pernah terkirim.
 * Urutan yang benar sesudah PG final:
 *   1) laporkan pembukaan darurat (essay/mulai + kode) -> status MENGERJAKAN
 *   2) sinkronkan jawaban essay lokal (essay/jawab)
 *   3) baru /essay/kirim (dipanggil pemanggil fungsi ini)
 * Langkah 1 dilewati kalau tidak ada bukti pembukaan offline yang tersimpan
 * (essay dibuka online biasa), langkah 2 dilewati kalau tidak ada jawaban lokal.
 */
async function siapkanEssayUntukKirim(paket: PaketUjianTertunda): Promise<void> {
  // 409 pada langkah persiapan BUKAN alasan menggagalkan paket: artinya essay di
  // server sudah selesai (SUDAH_KIRIM/TIDAK_MENGERJAKAN -- mis. sudah terkirim
  // lewat jalur lain, jawaban sudah masuk ke guru) atau belum dimulai. Yang
  // berwenang memutuskan adalah /essay/kirim: kalau sudah terkirim ia membalas
  // sukses (idempotent) sehingga paket bersih; kalau belum dimulai ia membalas
  // 409 dengan pesan yang tepat. (Versi sebelumnya melempar 409 di sini dan
  // membuat paket yang SEBENARNYA sudah terkirim tampil "Ditolak server".)
  const abaikanJika409 = async (fn: () => Promise<unknown>): Promise<boolean> => {
    try {
      await fn()
      return true
    } catch (err) {
      if ((err as { status?: number } | undefined)?.status === 409) return false
      throw err
    }
  }

  const statusOffline = ambilStatusOffline(paket.sesiId, paket.nis)
  if (statusOffline.kode) {
    const berhasil = await abaikanJika409(() =>
      apiRequest('/api/siswa/ujian/essay/mulai', {
        method: 'POST',
        body: JSON.stringify({
          sesiId: paket.sesiId,
          deviceId: paket.deviceId,
          kodeDarurat: statusOffline.kode,
          waktuMulaiClient: statusOffline.waktuMulaiClient,
          percobaanSalah: statusOffline.salah,
        }),
      })
    )
    // Berhasil, atau ditolak 409 (essay sudah final): bukti offline ini tidak
    // berguna lagi -- hapus supaya tidak dikirim ulang terus.
    void berhasil
    hapusStatusOffline(paket.sesiId, paket.nis)
  }

  const entries = Object.entries(bacaBackupEssayLokal(paket.sesiId, paket.nis))
    .filter(([, teks]) => typeof teks === 'string')
  if (entries.length > 0) {
    await abaikanJika409(() =>
      apiRequest('/api/siswa/ujian/essay/jawab', {
        method: 'POST',
        body: JSON.stringify({
          sesiId: paket.sesiId,
          jawaban: entries.map(([soal_essay_id, jawaban_teks]) => ({ soal_essay_id, jawaban_teks })),
          deviceId: paket.deviceId,
        }),
      })
    )
  }
}

/**
 * Coba kirim SATU paket sampai tuntas: finalisasi PG dulu (kalau masih
 * perlu), baru essay/kirim (kalau sesi ini punya essay). Urutan ini WAJIB —
 * /selesai menghitung nilai PG dari baris `jawaban` di DB, dan essay/kirim
 * hanya membuka nilai itu ke siswa setelah keduanya beres.
 *
 * Mengembalikan status baru; pemanggil (penjaga latar belakang ATAU tombol
 * "Kirim Sekarang" manual) cukup memakai nilai balik ini untuk UI, state
 * sudah otomatis tersimpan/terhapus dari outbox oleh fungsi ini sendiri.
 */
export async function cobaKirimPaketTertunda(
  paket: PaketUjianTertunda
): Promise<StatusPaketTertunda> {
  let current = await simpanPaketTertunda({
    ...paket,
    status: 'MENGIRIM',
    percobaanTerakhirIso: new Date().toISOString(),
    jumlahPercobaan: paket.jumlahPercobaan + 1,
  })

  try {
    if (current.butuhFinalisasiPg) {
      // WAJIB (BUG P0 #2): LOAD LOCAL ANSWERS → SYNC ALL ANSWERS → SERVER ACK
      // dulu, baru boleh FINALIZE. Tidak boleh lagi langsung /selesai.
      current = await simpanPaketTertunda({ ...current, status: 'MENYINKRONKAN' })
      const { sinkron, permanentReject } = await pastikanJawabanTersinkron(
        current.sesiId,
        current.nis,
        current.deviceId
      )
      if (!sinkron) {
        if (permanentReject) {
          await simpanPaketTertunda({
            ...current,
            status: 'GAGAL',
            pesanTerakhir: 'Sesi ujian ditolak server saat menyinkronkan jawaban (sesi ditutup/diambil alih).',
          })
          return 'GAGAL'
        }
        await simpanPaketTertunda({
          ...current,
          status: 'MENUNGGU_JARINGAN',
          pesanTerakhir: 'Sebagian jawaban belum berhasil disinkronkan ke server.',
        })
        return 'MENUNGGU_JARINGAN'
      }

      await apiRequest('/api/siswa/ujian/selesai', {
        method: 'POST',
        body: JSON.stringify({
          sesiId: current.sesiId,
          nis: current.nis,
          deviceId: current.deviceId,
          isTimeout: false,
          ...(current.waktuSelesaiClaimIso ? { waktuSelesaiClient: current.waktuSelesaiClaimIso } : {}),
        }),
      })
      current = await simpanPaketTertunda({ ...current, butuhFinalisasiPg: false })
    }

    if (current.butuhKirimEssay) {
      await siapkanEssayUntukKirim(current)
      await apiRequest('/api/siswa/ujian/essay/kirim', {
        method: 'POST',
        body: JSON.stringify({ sesiId: current.sesiId, deviceId: current.deviceId }),
      })
      current = await simpanPaketTertunda({ ...current, butuhKirimEssay: false })
    }

    // Kedua tahap (yang relevan) sudah ACK server — paket ini selesai.
    await hapusPaketTertunda(current.sesiId, current.nis)
    return 'TERKIRIM'
  } catch (err: unknown) {
    const status = (err as { status?: number } | undefined)?.status
    // FIX (audit timeout/offline): sebelumnya HANYA error tanpa status HTTP
    // yang dianggap sementara. Error server sesaat (500/502/503/504 -- mis.
    // cold start / kelebihan beban Vercel & Supabase saat ratusan siswa
    // submit bersamaan, atau 429/408) ikut jatuh ke cabang "penolakan sah"
    // di bawah dan paket ditandai GAGAL PERMANEN tanpa retry otomatis --
    // padahal jawabannya sendiri sudah aman dan request yang sama akan
    // berhasil beberapa detik kemudian. Sekarang daftar status sementara ini
    // sama dengan yang sudah dipakai pastikanJawabanTersinkron() di atas
    // (plus 408/429), sehingga dicoba lagi oleh penjaga latar belakang.
    // 403 dengan data.sementara = siswa sedang TERKUNCI/RESET (dari essay/mulai),
    // bisa pulih sendiri setelah pengawas menanganinya -- jangan GAGAL permanen.
    const sementara403 = (err as { data?: { sementara?: boolean } } | undefined)?.data?.sementara === true
    const sementara = !status || status >= 500 || status === 408 || status === 429 || sementara403
    if (sementara) {
      await simpanPaketTertunda({
        ...current,
        status: 'MENUNGGU_JARINGAN',
        pesanTerakhir: status
          ? `Server sedang sibuk (${status}), akan dicoba lagi otomatis.`
          : 'Tidak ada koneksi ke server.',
      })
      return 'MENUNGGU_JARINGAN'
    }
    // Server SEMPAT merespons dan menolak (409/403/dst). Simpan sebagai GAGAL
    // supaya tidak diulang otomatis tanpa henti — tetap tampil di menu supaya
    // siswa/guru sadar dan bisa menekan "Kirim Sekarang" manual atau
    // menghubungi pengawas kalau memang perlu ditinjau.
    await simpanPaketTertunda({
      ...current,
      status: 'GAGAL',
      pesanTerakhir: err instanceof Error ? err.message : 'Server menolak pengiriman.',
    })
    return 'GAGAL'
  }
}

// ── Penjaga latar belakang (dipasang sekali di siswa/layout.tsx) ───────────
// Bukan React state — pakai flag modul supaya tidak terpasang dobel kalau
// layout re-render/StrictMode double-invoke efek.
let penjagaTerpasang = false

export function mulaiPenjagaOutbox(nis: string): () => void {
  if (penjagaTerpasang) return () => {}
  penjagaTerpasang = true

  const flushSemua = async () => {
    for (const paket of await ambilSemuaPaketTertunda(nis)) {
      // FIX (paket "Mengirim..." macet selamanya): sebelumnya SETIAP paket
      // berstatus MENGIRIM dilewati untuk selamanya dengan asumsi "sedang
      // diproses percobaan lain". Kalau halaman ditutup/di-reload/di-deploy
      // TEPAT saat percobaan berjalan, status MENGIRIM sudah tersimpan tapi
      // percobaannya tidak pernah selesai, sehingga paket itu tidak akan
      // pernah dicoba lagi (dan tombol manual di UI ikut mati). Sekarang
      // MENGIRIM/MENYINKRONKAN hanya dianggap "sedang berjalan" selama masih
      // baru; kalau sudah lewat MENGIRIM_BASI_MS dianggap macet dan dicoba lagi.
      if (sedangDiprosesAktif(paket)) continue
      // FIX: GAGAL = server MENOLAK secara sah (sesi sudah direset/ditutup,
      // essay belum dimulai, dst). Komentar di atas selalu menyebut paket
      // GAGAL "tidak di-retry otomatis lagi", tapi kode lama tetap
      // mengulangnya tiap 20 detik tanpa henti dan hasilnya sama terus.
      // Sekarang hanya lewat tombol "Kirim Sekarang" manual.
      if (paket.status === 'GAGAL') continue
      await cobaKirimPaketTertunda(paket)
    }
  }

  // Coba segera saat dipasang (mis. siswa baru login lagi setelah offline
  // lama), lalu ulangi tiap 20 detik selama aplikasi terbuka, dan langsung
  // begitu browser melaporkan koneksi pulih (event 'online') tanpa menunggu
  // interval berikutnya.
  void flushSemua()
  const interval = setInterval(flushSemua, 20_000)
  const onOnline = () => void flushSemua()
  window.addEventListener('online', onOnline)

  return () => {
    clearInterval(interval)
    window.removeEventListener('online', onOnline)
    penjagaTerpasang = false
  }
}
