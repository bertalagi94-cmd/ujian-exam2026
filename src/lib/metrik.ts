import { NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { generateId } from '@/lib/utils'

// Endpoint yang diinstrumentasi — sengaja dibatasi ke 3 titik yang PALING
// sering jadi sumber keluhan pengawas saat ujian berlangsung:
//   - login            → "Min, kok tidak bisa masuk?"
//   - validasi_ujian    → "Min, siswa saya tidak bisa mulai ujian"
//   - sync_jawaban      → "Min, kok jawaban lambat/tidak tersimpan?"
// Sengaja TIDAK menginstrumentasi semua endpoint sekaligus, supaya tabel
// metrik_sistem tetap kecil & query admin/monitoring tetap cepat.
export type EndpointKritis = 'login' | 'validasi_ujian' | 'sync_jawaban'

const RETENSI_JAM = 6

// Probabilitas pembersihan baris lama dijalankan setiap kali ada insert baru.
// Dibuat probabilistik (bukan cron terjadwal) supaya tidak perlu setup Vercel
// Cron Job terpisah — cukup "menumpang" pada traffic yang sudah ada.
const PROBABILITAS_CLEANUP = 0.02 // ~1 dari 50 request

/**
 * Catat satu hasil request ke tabel metrik_sistem. Fire-and-forget (tidak
 * di-`await` oleh pemanggil) — supaya pencatatan metrik TIDAK PERNAH menambah
 * latensi ke response yang dirasakan siswa/guru, dan kegagalan insert metrik
 * tidak pernah menggagalkan request aslinya.
 */
// ── Penulisan metrik digabung (batch) ─────────────────────────────────────
// LATAR BELAKANG: sebelumnya SETIAP request kritis menulis satu baris sendiri =
// satu panggilan HTTP ke API Supabase + satu INSERT. Saat ujian serentak itu
// ratusan ribu penulisan kecil yang ikut membebani database. Sekarang baris
// ditampung di memori instance dan ditulis sekaligus dalam SATU INSERT
// multi-baris. Isi datanya SAMA (satu baris per request, dengan created_at
// yang dicatat saat request selesai), jadi hitungan error rate / latensi di
// panel monitoring tidak berubah.
//
// Kapan ditulis (flush): saat tampungan >= BUFFER_MAKS baris, atau saat sudah
// >= JEDA_FLUSH_MS sejak penulisan terakhir (termasuk request yang sedang
// dicatat). Jadi saat trafik sepi, baris langsung ditulis seperti dulu; saat
// ramai, digabung. Catatan: bila trafik berhenti tepat setelah satu flush,
// sisa baris di tampungan baru ditulis pada request berikutnya di instance
// yang sama. Ini hanya telemetri, bukan data ujian.
type BarisMetrik = {
  id: string
  endpoint: EndpointKritis
  status: 'ok' | 'error'
  durasi_ms: number
  created_at: string
}

const BUFFER_MAKS = 25
const JEDA_FLUSH_MS = 3000

let tampungan: BarisMetrik[] = []
let flushTerakhirMs = 0

// Pesan error PostgREST bisa berupa halaman HTML Cloudflare utuh (puluhan KB)
// saat database tidak terjangkau. Dipotong supaya log Vercel tetap terbaca.
function ringkasError(e: unknown): string {
  const msg =
    e instanceof Error ? e.message
    : e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message)
    : String(e)
  const rapi = msg.replace(/\s+/g, ' ').trim()
  return rapi.length > 300 ? `${rapi.slice(0, 300)}… (dipotong)` : rapi
}

async function tulisBatch(db: ReturnType<typeof createAdminClient>, baris: BarisMetrik[]): Promise<void> {
  try {
    const { error } = await db.from('metrik_sistem').insert(baris)
    if (error) console.error('Gagal catat metrik_sistem:', ringkasError(error))
  } catch (e) {
    console.error('Gagal catat metrik_sistem:', ringkasError(e))
  }

  // Pembersihan baris lama: peluang per baris tetap 2% seperti sebelumnya,
  // dihitung untuk seluruh batch (maks 100%).
  if (Math.random() < Math.min(1, PROBABILITAS_CLEANUP * baris.length)) {
    try {
      const batas = new Date(Date.now() - RETENSI_JAM * 60 * 60 * 1000).toISOString()
      const { error } = await db.from('metrik_sistem').delete().lt('created_at', batas)
      if (error) console.error('Gagal bersihkan metrik_sistem lama:', ringkasError(error))
    } catch (e) {
      console.error('Gagal bersihkan metrik_sistem lama:', ringkasError(e))
    }
  }
}

function catatMetrik(
  db: ReturnType<typeof createAdminClient>,
  endpoint: EndpointKritis,
  status: 'ok' | 'error',
  durasiMs: number
): void {
  tampungan.push({
    id: generateId('MTX'),
    endpoint,
    status,
    durasi_ms: Math.max(0, Math.round(durasiMs)),
    created_at: new Date().toISOString(),
  })

  const sekarang = Date.now()
  if (tampungan.length < BUFFER_MAKS && sekarang - flushTerakhirMs < JEDA_FLUSH_MS) return

  // Ambil seluruh tampungan SEKARANG (sinkron) supaya request lain yang datang
  // saat penulisan berlangsung tidak ikut tertulis dua kali.
  const batch = tampungan
  tampungan = []
  flushTerakhirMs = sekarang

  // Ditulis lewat after() (waitUntil di Vercel): tetap TIDAK menambah latensi
  // respons, tetapi platform menunggu penulisan selesai sebelum instance
  // dibekukan. Sebelumnya promise dibiarkan menggantung (fire-and-forget biasa),
  // sehingga di serverless koneksinya bisa basi dan muncul error ETIMEDOUT
  // "Gagal catat metrik_sistem" di request lain pada instance yang sama.
  after(() => tulisBatch(db, batch))
}

/**
 * Bungkus sebuah handler endpoint kritis supaya hasilnya (sukses/gagal +
 * durasi) otomatis tercatat ke metrik_sistem, TANPA perlu mengubah logika
 * internal handler (return statement di tengah fungsi tetap apa adanya).
 *
 * Aturan penentuan ok/error:
 *   - status HTTP < 500, ATAU handler mengembalikan NextResponse biasa
 *     (termasuk 400/401/403/404/409 — itu kesalahan PENGGUNA, bukan server)
 *     → dicatat 'ok' (server merespons dengan benar, walau menolak request).
 *   - status HTTP >= 500, atau handler throw exception (mis. Supabase down,
 *     timeout, error tak terduga) → dicatat 'error'. Ini yang benar-benar
 *     mencerminkan "server sedang bermasalah".
 */
export async function instrumented(
  endpoint: EndpointKritis,
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  const db = createAdminClient()
  const mulai = Date.now()
  try {
    const res = await handler()
    catatMetrik(db, endpoint, res.status >= 500 ? 'error' : 'ok', Date.now() - mulai)
    return res
  } catch (err) {
    catatMetrik(db, endpoint, 'error', Date.now() - mulai)
    throw err
  }
}
