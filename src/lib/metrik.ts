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
function catatMetrik(
  db: ReturnType<typeof createAdminClient>,
  endpoint: EndpointKritis,
  status: 'ok' | 'error',
  durasiMs: number
): void {
  // Ditulis lewat after() (waitUntil di Vercel): tetap TIDAK menambah latensi
  // respons, tetapi platform menunggu penulisan selesai sebelum instance
  // dibekukan. Sebelumnya promise dibiarkan menggantung (fire-and-forget biasa),
  // sehingga di serverless koneksinya bisa basi dan muncul error ETIMEDOUT
  // "Gagal catat metrik_sistem" di request lain pada instance yang sama.
  after(async () => {
    try {
      const { error } = await db
        .from('metrik_sistem')
        .insert({ id: generateId('MTX'), endpoint, status, durasi_ms: Math.max(0, Math.round(durasiMs)) })
      if (error) console.error('Gagal catat metrik_sistem:', error)
    } catch (e) {
      console.error('Gagal catat metrik_sistem:', e instanceof Error ? e.message : e)
    }

    if (Math.random() < PROBABILITAS_CLEANUP) {
      try {
        const batas = new Date(Date.now() - RETENSI_JAM * 60 * 60 * 1000).toISOString()
        const { error } = await db.from('metrik_sistem').delete().lt('created_at', batas)
        if (error) console.error('Gagal bersihkan metrik_sistem lama:', error)
      } catch (e) {
        console.error('Gagal bersihkan metrik_sistem lama:', e instanceof Error ? e.message : e)
      }
    }
  })
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
