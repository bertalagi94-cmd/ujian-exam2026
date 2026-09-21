// src/lib/reset-offline-client.ts
//
// SISI CLIENT untuk jalur reset pelanggaran (R1/R2/R3) OFFLINE. Tugasnya:
//   1. Menyimpan amplop terenkripsi (dari /api/siswa/ujian/validasi, field
//      `resetMaterial`) di perangkat SEJAK siswa masuk ujian.
//   2. Mencoba MEMBUKA amplop nomor yang diminta dengan kode dari pengawas —
//      murni lokal, tanpa server, tanpa pernah memegang kode benar sebelumnya.
//   3. Mengantrekan kejadian reset yang berhasil diverifikasi offline supaya
//      SERVER TETAP TAHU (rekonsiliasi) begitu koneksi kembali — memakai
//      endpoint /api/siswa/ujian/verifikasi-reset yang SUDAH idempoten &
//      atomik (reset-berurutan.ts), TIDAK ada endpoint baru yang dibutuhkan.
//
// KETERBATASAN JUJUR (baca juga reset-amplop-shared.ts): melindungi dari
// siswa biasa, bukan dari brute force sungguhan terhadap amplop yang sudah
// ada di perangkat. Ruang kode 32^7 + PBKDF2 600rb iterasi menjadikan itu
// tidak praktis dalam durasi satu sesi ujian.
//
// PENTING SOAL URUTAN: server (konsumsi_reset_berurutan) hanya menerima R(N)
// tepat saat reset_terpakai server = N-1. Karena laporan pelanggaran itu
// sendiri juga bisa tertunda offline (lihat pelanggaran-outbox.ts), antrean
// di modul ini SELALU dikirim satu-per-satu secara berurutan dan menunggu ACK
// sebelum mengirim entri berikutnya — tidak pernah paralel, tidak pernah
// melompati entri yang gagal.

import { apiRequest } from '@/lib/utils'
import {
  resetMaterialPut,
  resetMaterialGet,
  resetPendingPut,
  resetPendingDelete,
  resetPendingGetAllValues,
} from '@/lib/ujian-offline-storage'
import {
  RESET_PBKDF2_ITERASI_MAKS_CLIENT,
  aadAmplopReset,
  type ResetAmplop,
  type IsiAmplopReset,
} from '@/lib/reset-amplop-shared'

// ── base64 ↔ bytes ─────────────────────────────────────────────────────────
function dariBase64(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer as ArrayBuffer
}

export class EnkripsiTidakDidukungError extends Error {
  constructor() {
    super('Perangkat/browser ini tidak mendukung fitur keamanan yang dibutuhkan (WebCrypto).')
    this.name = 'EnkripsiTidakDidukungError'
  }
}

// ── Penyimpanan material (amplop) ───────────────────────────────────────────
const materialKey = (sesiId: string, nis: string) => `reset_material_${sesiId}_${nis}`
const materialKeyLS = (sesiId: string, nis: string) => `reset_material_ls_${sesiId}_${nis}`

/**
 * Simpan seluruh amplop R1..R(maks) untuk sesi ini. WAJIB dipanggil (dan
 * di-`await`) SEBELUM mengizinkan siswa menekan "Mulai Ujian" — sama seperti
 * precacheGambarSoal() dan healthCheckStorage(). Fallback ke localStorage
 * kalau IndexedDB gagal total (mis. mode privat sangat ketat).
 */
export async function simpanMaterialReset(sesiId: string, nis: string, material: ResetAmplop[]): Promise<boolean> {
  try {
    await resetMaterialPut(materialKey(sesiId, nis), material)
    return true
  } catch { /* lanjut ke fallback */ }
  try {
    localStorage.setItem(materialKeyLS(sesiId, nis), JSON.stringify(material))
    return true
  } catch {
    return false
  }
}

export async function ambilMaterialReset(sesiId: string, nis: string): Promise<ResetAmplop[] | null> {
  try {
    const rec = await resetMaterialGet<ResetAmplop[]>(materialKey(sesiId, nis))
    if (rec) return rec
  } catch { /* lanjut ke fallback */ }
  try {
    const raw = localStorage.getItem(materialKeyLS(sesiId, nis))
    return raw ? (JSON.parse(raw) as ResetAmplop[]) : null
  } catch {
    return null
  }
}

/**
 * Gerbang fail-closed sebelum START: material dianggap siap kalau amplop
 * nomor 1..`maks` semuanya ada. Kalau server gagal membuat material (lihat
 * catatan di validasi/route.ts, mis. env var belum diset), array yang
 * dikirim akan kosong/kurang — jangan sampai siswa mengira reset offline
 * tersedia padahal tidak.
 */
export function materialResetSiap(material: ResetAmplop[] | null | undefined, maks: number): boolean {
  if (!material || maks <= 0) return maks <= 0
  const nomorAda = new Set(material.map(a => a.nomor))
  for (let n = 1; n <= maks; n++) if (!nomorAda.has(n)) return false
  return true
}

// ── Progress reset lokal (bertahan lewat reload/browser restart selama
// internet tetap mati) ──────────────────────────────────────────────────────
const progressKey = (sesiId: string, nis: string) => `reset_offline_progress_${sesiId}_${nis}`

/** Berapa nomor reset yang SUDAH berhasil diverifikasi offline di perangkat ini (0 kalau belum ada). */
export function ambilTerpakaiLokal(sesiId: string, nis: string): number {
  try {
    const raw = localStorage.getItem(progressKey(sesiId, nis))
    const n = raw ? parseInt(raw, 10) : 0
    return Number.isFinite(n) && n >= 0 ? n : 0
  } catch { return 0 }
}

function simpanTerpakaiLokal(sesiId: string, nis: string, terpakai: number): void {
  try { localStorage.setItem(progressKey(sesiId, nis), String(terpakai)) } catch { /* abaikan */ }
}

/**
 * Nomor reset yang harus dicoba SELANJUTNYA di perangkat ini: yang lebih
 * besar antara progres lokal tersimpan (bertahan lewat reload) dan perkiraan
 * dari UI (mis. hitungan pelanggRef/jumlahPelanggaran di halaman ujian, yang
 * bisa lebih mutakhir kalau progres lokal belum sempat tersimpan/dibaca).
 */
export function nomorResetBerikutnya(sesiId: string, nis: string, perkiraanDariUI: number): number {
  return Math.max(ambilTerpakaiLokal(sesiId, nis) + 1, perkiraanDariUI, 1)
}

// ── Dekripsi & verifikasi ────────────────────────────────────────────────────

/**
 * Coba verifikasi `kode` sebagai R(nomor) yang sah untuk (sesiId, nis),
 * MURNI LOKAL. Tidak pernah menghubungi server.
 * @returns true kalau kode benar (amplop berhasil dibuka & isinya cocok).
 * @throws EnkripsiTidakDidukungError kalau WebCrypto tidak tersedia.
 */
export async function verifikasiKodeResetOffline(
  material: ResetAmplop[],
  sesiId: string,
  nis: string,
  nomor: number,
  kode: string
): Promise<boolean> {
  const amplop = material.find(a => a.nomor === nomor)
  if (!amplop) return false

  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined
  if (!subtle) throw new EnkripsiTidakDidukungError()

  const iter = Number(amplop.iter)
  if (!Number.isInteger(iter) || iter < 1 || iter > RESET_PBKDF2_ITERASI_MAKS_CLIENT) return false

  try {
    const bahanKunci = await subtle.importKey('raw', new TextEncoder().encode(kode), 'PBKDF2', false, ['deriveKey'])
    const kunci = await subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: dariBase64(amplop.salt), iterations: iter },
      bahanKunci,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    )
    const plain = await subtle.decrypt(
      { name: 'AES-GCM', iv: dariBase64(amplop.iv), additionalData: new TextEncoder().encode(aadAmplopReset(sesiId, nis, nomor)) },
      kunci,
      dariBase64(amplop.ct)
    )
    const isi = JSON.parse(new TextDecoder().decode(plain)) as IsiAmplopReset
    // Lapisan kedua di atas AAD: pastikan payload benar-benar cocok, bukan
    // sekadar berhasil didekripsi (jaga-jaga format amplop berubah di masa depan).
    return isi.sesiId === sesiId && isi.nis === nis && isi.nomor === nomor
  } catch {
    // Tag GCM tidak cocok (kode salah) ATAU amplop rusak — diperlakukan sama.
    return false
  }
}

// ── Antrean rekonsiliasi (dikirim ke server begitu online) ─────────────────
export type StatusResetTertunda = 'BELUM_TERKIRIM' | 'MENGIRIM' | 'MENUNGGU_JARINGAN'

export interface ResetTertunda {
  sesiId: string
  nis: string
  nomor: number
  /** Kode yang terbukti benar secara offline — dikirim ke server sebagai bukti saat rekonsiliasi, lalu dihapus dari antrean begitu server ACK. */
  kode: string
  eventId: string
  dibuatIso: string
  percobaanTerakhirIso: string | null
  jumlahPercobaan: number
  status: StatusResetTertunda
  pesanTerakhir: string | null
}

const PREFIX_PENDING = 'resetOutbox:v1'
function pendingKey(sesiId: string, nis: string, nomor: number): string {
  return `${PREFIX_PENDING}:${sesiId}:${nis}:${nomor}`
}

function buatEventId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `rst-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Catat kode yang BARU SAJA terbukti benar secara offline. Dipanggil SEGERA
 * setelah verifikasiKodeResetOffline() mengembalikan true, SEBELUM UI
 * melanjutkan ujian — supaya kejadian ini tidak pernah hilang walau tab
 * ditutup tepat setelahnya. Juga menaikkan progres lokal (nomorResetBerikutnya).
 */
export async function antrekanResetOffline(sesiId: string, nis: string, nomor: number, kode: string): Promise<void> {
  const entri: ResetTertunda = {
    sesiId, nis, nomor, kode,
    eventId: buatEventId(),
    dibuatIso: new Date().toISOString(),
    percobaanTerakhirIso: null,
    jumlahPercobaan: 0,
    status: 'BELUM_TERKIRIM',
    pesanTerakhir: null,
  }
  try { await resetPendingPut(pendingKey(sesiId, nis, nomor), entri) } catch { /* fallback di bawah */ }
  try {
    // Jaga-jaga IndexedDB gagal total: tetap simpan progres nomor supaya
    // gerbang nomorResetBerikutnya() tidak minta R(nomor) yang sama lagi.
  } finally {
    simpanTerpakaiLokal(sesiId, nis, Math.max(ambilTerpakaiLokal(sesiId, nis), nomor))
  }
}

async function ambilSemuaResetTertunda(): Promise<ResetTertunda[]> {
  try {
    const semua = await resetPendingGetAllValues<ResetTertunda>()
    // Urutan nomor NAIK — server hanya menerima R(N) tepat saat gilirannya.
    return semua.sort((a, b) => a.nomor - b.nomor || a.dibuatIso.localeCompare(b.dibuatIso))
  } catch {
    return []
  }
}

function statusSementara(status: number | undefined): boolean {
  return !status || status >= 500 || status === 408 || status === 429
}

/**
 * Kirim SATU entri ke /verifikasi-reset (endpoint yang sama dengan jalur
 * online — sudah idempoten & atomik). Mengembalikan true kalau boleh
 * dihapus dari antrean (berhasil ACK ATAU server menolak permanen sehingga
 * mengulang tidak ada gunanya), false kalau harus dicoba lagi nanti.
 *
 * BERHENTI pada entri pertama yang belum berhasil — TIDAK melompat ke nomor
 * berikutnya, supaya urutan R1→R2→R3 yang disyaratkan server tetap terjaga.
 */
async function kirimSatuReset(entri: ResetTertunda): Promise<boolean> {
  const current: ResetTertunda = {
    ...entri,
    status: 'MENGIRIM',
    percobaanTerakhirIso: new Date().toISOString(),
    jumlahPercobaan: entri.jumlahPercobaan + 1,
  }
  try { await resetPendingPut(pendingKey(current.sesiId, current.nis, current.nomor), current) } catch { /* abaikan */ }

  try {
    await apiRequest<{ valid: boolean; message?: string }>('/api/siswa/ujian/verifikasi-reset', {
      method: 'POST',
      body: JSON.stringify({ sesiId: current.sesiId, kodeReset: current.kode }),
    })
    // valid:true ATAU valid:false-tapi-sudah-terpakai (server memperlakukan
    // resend kode yang sama sebagai idempoten, lihat verifikasi-reset/route.ts)
    // — dua-duanya berarti server sudah/akan konsisten dengan progres lokal.
    // Kegagalan bisnis yang genuinely tidak akan pernah berhasil (kode ditolak
    // permanen) sangat tidak mungkin terjadi di sini karena kode ini SUDAH
    // terbukti benar lewat amplop; tetap dihapus supaya antrean tidak macet.
    await resetPendingDelete(pendingKey(current.sesiId, current.nis, current.nomor))
    return true
  } catch (err: unknown) {
    const status = (err as { status?: number } | undefined)?.status
    if (statusSementara(status)) {
      try {
        await resetPendingPut(pendingKey(current.sesiId, current.nis, current.nomor), {
          ...current,
          status: 'MENUNGGU_JARINGAN',
          pesanTerakhir: status ? `Server sedang sibuk (${status}).` : 'Tidak ada koneksi ke server.',
        })
      } catch { /* abaikan */ }
      return false
    }
    // Status non-sementara (4xx lain) — simpan untuk jejak audit, tapi
    // JANGAN hapus: nomor berikutnya (kalau ada) tetap menunggu di belakang
    // sampai ada intervensi (mis. pengawas mengecek manual).
    try {
      await resetPendingPut(pendingKey(current.sesiId, current.nis, current.nomor), {
        ...current,
        pesanTerakhir: err instanceof Error ? err.message : 'Server menolak pengiriman.',
      })
    } catch { /* abaikan */ }
    return false
  }
}

let penjagaTerpasang = false

/**
 * Penjaga latar belakang: coba rekonsiliasi antrean reset offline begitu
 * dipasang, lalu berkala, dan segera saat koneksi pulih. Pasang SEKALI di
 * siswa/layout.tsx, sejajar dengan mulaiPenjagaOutbox/mulaiPenjagaPelanggaran.
 */
export function mulaiPenjagaResetOffline(): () => void {
  if (penjagaTerpasang) return () => {}
  penjagaTerpasang = true

  const flushSemua = async () => {
    for (const entri of await ambilSemuaResetTertunda()) {
      const lanjut = await kirimSatuReset(entri)
      if (!lanjut) break // jaga urutan: jangan coba nomor berikutnya dulu
    }
  }

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
