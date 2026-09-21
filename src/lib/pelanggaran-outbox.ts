// Antrean OFFLINE untuk event pelanggaran anti-cheat.
//
// CELAH SEBELUM MODUL INI ADA (README "Belum ada — Antrean event pelanggaran
// offline"): laporPelanggaran() di siswa/ujian/page.tsx memanggil
// POST /api/siswa/ujian/pelanggaran LANGSUNG. Kalau request gagal (offline,
// timeout, error jaringan sesaat), kegagalan hanya di-`console.warn` dan
// event pelanggaran HILANG SELAMANYA — padahal `eventId` (kunci idempoten
// untuk kejadian fisik itu) sudah sempat dibuat dan seharusnya bisa dicoba
// lagi. Ini melanggar prinsip utama: "Offline bukan berarti anti-cheat mati."
//
// DESAIN (mengikuti pola ujian-outbox.ts / STORE_OUTBOX persis):
//   1) SETIAP kejadian pelanggaran disimpan ke IndexedDB (STORE_PELANGGARAN,
//      lihat ujian-offline-storage.ts) SEBELUM percobaan kirim apa pun.
//      Kalau tab ditutup/crash tepat setelah baris simpan ini, event tetap
//      ada saat aplikasi dibuka lagi.
//   2) Siklus status per event:
//        BELUM_TERKIRIM → MENGIRIM → (gagal jaringan) MENUNGGU_JARINGAN → ...
//                                   ↘ (server menolak sah) GAGAL
//      Sukses → entri dihapus dari antrean.
//   3) Penjaga latar belakang (mulaiPenjagaPelanggaran), dipasang SEKALI di
//      siswa/layout.tsx sama seperti mulaiPenjagaOutbox, mencoba ulang semua
//      event MENUNGGU_JARINGAN tiap beberapa detik dan segera saat browser
//      melaporkan koneksi pulih ('online') — supaya retry tetap berjalan
//      walau siswa sempat pindah halaman.
//   4) Server SUDAH idempotent lewat `eventId` (lihat catat_pelanggaran_atomik
//      di supabase/24_reset_berurutan.sql: eventId yang sama tidak pernah
//      menjadi pelanggaran baru, sekadar mengembalikan hasil yang sama). Jadi
//      modul ini AMAN memanggil endpoint berkali-kali dengan eventId yang
//      sama sampai dapat ACK — tidak ada risiko pelanggaran ganda dari satu
//      kejadian fisik.
//
// CATATAN UX: overlay peringatan pelanggaran di halaman ujian sudah tampil
// SEKETIKA saat deteksi client-side (lihat pelanggaranActiveRef di page.tsx),
// tidak menunggu ACK server. Modul ini murni memastikan SERVER akhirnya juga
// tahu tentang kejadian itu. Kalau server sempat merespons "terkunci: true"
// (batas reset habis) SAAT ITU JUGA (kondisi online normal), pemanggil boleh
// memakainya untuk transisi UI seketika; kalau tertunda (offline) dan baru
// terkirim belakangan lewat penjaga latar belakang, polling status sesi yang
// sudah ada (cekStatusSesi, tiap 10 detik) yang akan mengambil alih transisi
// UI begitu status TERKUNCI benar-benar tercatat di server — modul ini tidak
// perlu (dan tidak bisa, karena berjalan di luar komponen halaman) memaksa
// transisi itu sendiri.

import { apiRequest } from '@/lib/utils'
import {
  pelanggaranQueuePut,
  pelanggaranQueueDelete,
  pelanggaranQueueGetAllValues,
} from '@/lib/ujian-offline-storage'

export type StatusPelanggaranTertunda =
  | 'BELUM_TERKIRIM'    // baru dibuat, belum ada percobaan kirim sama sekali
  | 'MENGIRIM'          // percobaan sedang berjalan
  | 'MENUNGGU_JARINGAN' // sudah dicoba, gagal murni karena jaringan/server sibuk
  | 'GAGAL'             // server MENOLAK secara sah — tidak diulang otomatis lagi, tapi tetap tersimpan untuk jejak audit

export interface PelanggaranTertunda {
  sesiId: string
  nis: string
  /** Kunci idempoten untuk SATU kejadian fisik (dibuat sekali, tidak berubah walau di-retry). */
  eventId: string
  jenis: string
  detail: string | null
  dibuatIso: string
  percobaanTerakhirIso: string | null
  jumlahPercobaan: number
  status: StatusPelanggaranTertunda
  pesanTerakhir: string | null
}

export interface HasilKirimPelanggaran {
  perlu_reset?: boolean
  terkunci?: boolean
  level?: number
  batasPelanggaran?: number
  message?: string
}

const PREFIX = 'pelanggaranOutbox:v1'

function storageKey(sesiId: string, nis: string, eventId: string): string {
  return `${PREFIX}:${sesiId}:${nis}:${eventId}`
}

function buatEventId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `ev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

// Fallback DARURAT ke localStorage kalau IndexedDB gagal/tidak tersedia sama
// sekali (mis. mode privat sangat ketat) — supaya event tetap punya peluang
// tersimpan, sama seperti pola simpanPaketTertunda() di ujian-outbox.ts.
async function simpan(entri: PelanggaranTertunda): Promise<void> {
  try {
    await pelanggaranQueuePut(storageKey(entri.sesiId, entri.nis, entri.eventId), entri)
    return
  } catch {
    // lanjut ke fallback di bawah
  }
  try {
    localStorage.setItem(storageKey(entri.sesiId, entri.nis, entri.eventId), JSON.stringify(entri))
  } catch {
    // Kedua penyimpanan gagal (storage device penuh/diblokir total) — di luar
    // kendali modul ini; healthCheckStorage() sebelum START seharusnya sudah
    // menangkap storage yang benar-benar mati sebelum ujian dimulai.
  }
}

async function hapus(sesiId: string, nis: string, eventId: string): Promise<void> {
  try { await pelanggaranQueueDelete(storageKey(sesiId, nis, eventId)) } catch { /* abaikan */ }
  try { localStorage.removeItem(storageKey(sesiId, nis, eventId)) } catch { /* abaikan */ }
}

function bacaSemuaKeyLocalStorageLama(): string[] {
  const hasil: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(`${PREFIX}:`)) hasil.push(k)
    }
  } catch {
    // Private mode / storage tidak tersedia.
  }
  return hasil
}

/**
 * Semua event pelanggaran tertunda milik satu NIS (gabungan IndexedDB +
 * fallback localStorage), diurutkan sesuai waktu kejadian ASLI supaya
 * dikirim ke server dalam urutan yang sama seperti terjadinya (server sendiri
 * sudah menyerialkan lewat row lock di catat_pelanggaran_atomik, tapi
 * mengirim di luar urutan tetap bisa membuat level pelanggaran tercatat
 * dengan urutan waktu yang membingungkan untuk audit).
 */
export async function ambilSemuaPelanggaranTertunda(nis: string): Promise<PelanggaranTertunda[]> {
  const hasil: PelanggaranTertunda[] = []
  let idbOk = true
  try {
    const semua = await pelanggaranQueueGetAllValues<PelanggaranTertunda>()
    for (const e of semua) if (e.nis === nis) hasil.push(e)
  } catch {
    idbOk = false
  }
  if (!idbOk) {
    for (const k of bacaSemuaKeyLocalStorageLama()) {
      try {
        const raw = localStorage.getItem(k)
        if (!raw) continue
        const e = JSON.parse(raw) as PelanggaranTertunda
        if (e.nis === nis) hasil.push(e)
      } catch {
        // entri korup — abaikan, jangan sampai menggagalkan entri lain
      }
    }
  }
  return hasil.sort((a, b) => a.dibuatIso.localeCompare(b.dibuatIso))
}

/** True kalau status HTTP ini kemungkinan besar sementara (jaringan/server sibuk) — layak diulang otomatis. */
function statusSementara(status: number | undefined): boolean {
  return !status || status >= 500 || status === 408 || status === 429
}

async function kirimSatuPelanggaran(entri: PelanggaranTertunda): Promise<HasilKirimPelanggaran | null> {
  const current: PelanggaranTertunda = {
    ...entri,
    status: 'MENGIRIM',
    percobaanTerakhirIso: new Date().toISOString(),
    jumlahPercobaan: entri.jumlahPercobaan + 1,
  }
  await simpan(current)
  try {
    const res = await apiRequest<HasilKirimPelanggaran>('/api/siswa/ujian/pelanggaran', {
      method: 'POST',
      body: JSON.stringify({
        sesiId: current.sesiId,
        jenis: current.jenis,
        detail: current.detail,
        eventId: current.eventId,
      }),
    })
    await hapus(current.sesiId, current.nis, current.eventId)
    return res
  } catch (err: unknown) {
    const status = (err as { status?: number } | undefined)?.status
    if (statusSementara(status)) {
      await simpan({
        ...current,
        status: 'MENUNGGU_JARINGAN',
        pesanTerakhir: status
          ? `Server sedang sibuk (${status}), akan dicoba lagi otomatis.`
          : 'Tidak ada koneksi ke server.',
      })
    } else {
      // 400 (bentuk payload salah — seharusnya tak pernah terjadi dari client
      // ini), 404 (siswa/sesi tak terdaftar), 409 (sesi sudah ditutup) tidak
      // akan pernah berhasil kalau diulang. TETAP DISIMPAN (bukan dihapus)
      // sebagai GAGAL untuk jejak audit — supaya pelanggaran yang sempat
      // terdeteksi client tapi tak sempat masuk sebelum sesi ditutup tidak
      // hilang tanpa jejak sama sekali — hanya tidak dicoba lagi otomatis.
      await simpan({
        ...current,
        status: 'GAGAL',
        pesanTerakhir: err instanceof Error ? err.message : 'Server menolak pengiriman.',
      })
    }
    return null
  }
}

/**
 * Catat SATU kejadian pelanggaran: simpan ke antrean lokal TERLEBIH DAHULU
 * (WAJIB — supaya tidak hilang walau proses kirim di bawah gagal atau tab
 * ditutup tepat di tengah jalan), baru coba kirim ke server sekarang juga.
 *
 * Mengembalikan respons server kalau berhasil terkirim SEKARANG (dipakai
 * pemanggil untuk transisi UI seketika saat kondisi online normal — lihat
 * catatan UX di atas modul ini); `null` kalau tertunda (offline/gagal
 * sementara) atau ditolak permanen — pemanggil TIDAK PERLU menunggu di sini,
 * penjaga latar belakang (mulaiPenjagaPelanggaran) dan polling status sesi
 * yang sudah ada akan mengambil alih.
 */
export async function antrekanPelanggaran(
  sesiId: string,
  nis: string,
  jenis: string,
  detail: string
): Promise<HasilKirimPelanggaran | null> {
  const entri: PelanggaranTertunda = {
    sesiId,
    nis,
    eventId: buatEventId(),
    jenis,
    detail: detail || null,
    dibuatIso: new Date().toISOString(),
    percobaanTerakhirIso: null,
    jumlahPercobaan: 0,
    status: 'BELUM_TERKIRIM',
    pesanTerakhir: null,
  }
  await simpan(entri)
  return kirimSatuPelanggaran(entri)
}

// ── Penjaga latar belakang (dipasang sekali di siswa/layout.tsx) ───────────
// Bukan React state — pakai flag modul supaya tidak terpasang dobel kalau
// layout re-render/StrictMode double-invoke efek (sama seperti mulaiPenjagaOutbox).
let penjagaTerpasang = false

// Batas waktu satu percobaan kirim dianggap MACET (tab ditutup/reload/deploy
// tepat di tengah percobaan) — sama seperti MENGIRIM_BASI_MS di ujian-outbox.ts.
const MENGIRIM_BASI_MS = 2 * 60 * 1000

export function mulaiPenjagaPelanggaran(nis: string): () => void {
  if (penjagaTerpasang) return () => {}
  penjagaTerpasang = true

  const flushSemua = async () => {
    for (const entri of await ambilSemuaPelanggaranTertunda(nis)) {
      if (entri.status === 'GAGAL') continue // ditolak sah — hanya lewat jalur manual/audit
      if (entri.status === 'MENGIRIM') {
        const t = entri.percobaanTerakhirIso ? Date.parse(entri.percobaanTerakhirIso) : 0
        if (t && Date.now() - t <= MENGIRIM_BASI_MS) continue // sedang berjalan sungguhan, jangan dobel kirim
      }
      await kirimSatuPelanggaran(entri)
    }
  }

  // Coba segera saat dipasang (mis. siswa buka lagi setelah offline lama /
  // browser crash dengan event yang belum sempat terkirim), lalu ulangi tiap
  // 15 detik (lebih rapat dari outbox PG/Essay karena ini menyangkut
  // anti-cheat — reset R1/R2/R3 di pengawas idealnya tidak menunggu lama),
  // dan segera lagi begitu browser melaporkan koneksi pulih.
  void flushSemua()
  const interval = setInterval(flushSemua, 15_000)
  const onOnline = () => void flushSemua()
  window.addEventListener('online', onOnline)

  return () => {
    clearInterval(interval)
    window.removeEventListener('online', onOnline)
    penjagaTerpasang = false
  }
}
