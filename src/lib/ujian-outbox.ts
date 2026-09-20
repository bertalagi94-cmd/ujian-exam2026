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

import { apiRequest } from '@/lib/utils'

export type StatusPaketTertunda =
  | 'BELUM_TERKIRIM'   // baru dibuat, belum ada percobaan kirim sama sekali
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

function bacaSemuaKeyOutbox(): string[] {
  const hasil: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(`${PREFIX}:`)) hasil.push(k)
    }
  } catch {
    // Private mode / storage tidak tersedia — anggap outbox kosong.
  }
  return hasil
}

/** Buat entri baru atau perbarui entri yang sudah ada untuk sesi ini. */
export function simpanPaketTertunda(
  data: Pick<PaketUjianTertunda, 'sesiId' | 'nis' | 'deviceId' | 'namaMapel'> &
    Partial<PaketUjianTertunda>
): PaketUjianTertunda {
  const existing = ambilPaketTertunda(data.sesiId, data.nis)
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
    localStorage.setItem(storageKey(paket.sesiId, paket.nis), JSON.stringify(paket))
  } catch {
    // abaikan — retry berikutnya masih akan mencoba menyimpan ulang
  }
  return paket
}

export function ambilPaketTertunda(sesiId: string, nis: string): PaketUjianTertunda | null {
  try {
    const raw = localStorage.getItem(storageKey(sesiId, nis))
    return raw ? (JSON.parse(raw) as PaketUjianTertunda) : null
  } catch {
    return null
  }
}

export function hapusPaketTertunda(sesiId: string, nis: string): void {
  try {
    localStorage.removeItem(storageKey(sesiId, nis))
  } catch {
    // abaikan
  }
}

/** Semua paket tertunda milik satu NIS, untuk menu "Pengiriman Ujian Tertunda". */
export function ambilSemuaPaketTertunda(nis: string): PaketUjianTertunda[] {
  const hasil: PaketUjianTertunda[] = []
  for (const k of bacaSemuaKeyOutbox()) {
    try {
      const raw = localStorage.getItem(k)
      if (!raw) continue
      const paket = JSON.parse(raw) as PaketUjianTertunda
      if (paket.nis === nis) hasil.push(paket)
    } catch {
      // entri korup — abaikan, jangan sampai mematikan seluruh daftar
    }
  }
  return hasil.sort((a, b) => a.dibuatIso.localeCompare(b.dibuatIso))
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
  let current = simpanPaketTertunda({
    ...paket,
    status: 'MENGIRIM',
    percobaanTerakhirIso: new Date().toISOString(),
    jumlahPercobaan: paket.jumlahPercobaan + 1,
  })

  try {
    if (current.butuhFinalisasiPg) {
      await apiRequest('/api/siswa/ujian/selesai', {
        method: 'POST',
        body: JSON.stringify({
          sesiId: current.sesiId,
          nis: current.nis,
          isTimeout: false,
          ...(current.waktuSelesaiClaimIso ? { waktuSelesaiClient: current.waktuSelesaiClaimIso } : {}),
        }),
      })
      current = simpanPaketTertunda({ ...current, butuhFinalisasiPg: false })
    }

    if (current.butuhKirimEssay) {
      await apiRequest('/api/siswa/ujian/essay/kirim', {
        method: 'POST',
        body: JSON.stringify({ sesiId: current.sesiId, deviceId: current.deviceId }),
      })
      current = simpanPaketTertunda({ ...current, butuhKirimEssay: false })
    }

    // Kedua tahap (yang relevan) sudah ACK server — paket ini selesai.
    hapusPaketTertunda(current.sesiId, current.nis)
    return 'TERKIRIM'
  } catch (err: unknown) {
    const status = (err as { status?: number } | undefined)?.status
    if (!status) {
      // Tidak ada status HTTP = request tidak pernah sampai server (jaringan
      // mati/timeout) — bukan penolakan sah, tetap layak dicoba lagi nanti.
      simpanPaketTertunda({
        ...current,
        status: 'MENUNGGU_JARINGAN',
        pesanTerakhir: 'Tidak ada koneksi ke server.',
      })
      return 'MENUNGGU_JARINGAN'
    }
    // Server SEMPAT merespons dan menolak (409/403/dst). Simpan sebagai GAGAL
    // supaya tidak diulang otomatis tanpa henti — tetap tampil di menu supaya
    // siswa/guru sadar dan bisa menekan "Kirim Sekarang" manual atau
    // menghubungi pengawas kalau memang perlu ditinjau.
    simpanPaketTertunda({
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
    for (const paket of ambilSemuaPaketTertunda(nis)) {
      if (paket.status === 'MENGIRIM') continue // sedang diproses percobaan lain
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
