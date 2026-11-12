import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRoleAktif } from '@/lib/status-akun'

// POST /api/siswa/device-info
// Body: { info: string }
//
// Menyimpan ringkasan perangkat siswa (APK atau browser + model HP) ke
// siswa.device_info. Kolom ini ADA di skema tetapi tidak pernah diisi, sehingga
// pada simulasi 12 Nov 2026 tidak mungkin membandingkan APK dengan browser atau
// melihat model HP yang sering terkena pelanggaran.
//
// Sengaja ringan dan "best effort":
//  - Dipanggil klien SEKALI per sesi tab, dengan jeda acak setelah ujian
//    dimulai (supaya ratusan siswa tidak menulis serentak).
//  - Token "Lihat sebagai" (admin) dilewati: jangan menimpa data siswa asli.
//  - Kegagalan tidak memengaruhi ujian sama sekali (klien mengabaikan hasilnya).
export const maxDuration = 10

const PANJANG_MAKS = 200

export async function POST(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  if (user.viewAs) return NextResponse.json({ ok: true, dilewati: true })
  if (!user.nis) return NextResponse.json({ error: 'NIS tidak ditemukan' }, { status: 400 })

  let body: { info?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body tidak valid' }, { status: 400 })
  }

  if (typeof body.info !== 'string' || !body.info.trim()) {
    return NextResponse.json({ error: 'info diperlukan' }, { status: 400 })
  }
  // Buang karakter kontrol; hanya teks pendek yang disimpan.
  const info = body.info.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, PANJANG_MAKS)

  const db = tenantDb(yayasanIdDari(user))
  const { error } = await db.from('siswa').update({ device_info: info }).eq('nis', user.nis)
  if (error) {
    console.error('[device-info] gagal menyimpan:', error.message)
    return NextResponse.json({ error: 'Gagal menyimpan' }, { status: 503 })
  }
  return NextResponse.json({ ok: true })
}
