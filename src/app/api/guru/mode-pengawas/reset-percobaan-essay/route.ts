// Taruh di: src/app/api/guru/mode-pengawas/reset-percobaan-essay/route.ts
// POST { sesiId, nis } — pengawas mereset hitungan percobaan kode darurat
// essay SATU siswa (essay_amplop_offline.percobaan_server) menjadi 0.
//
// Kenapa ada: siswa yang membuka essay offline lalu melapor ke server
// (/essay/mulai) bisa kena 429 kalau jatah percobaan di server habis. Dulu
// tidak ada jalan keluar kecuali data siswa diedit manual di database.
// Endpoint ini hanya mengembalikan jatah percobaan — TIDAK membuka essay,
// TIDAK mengubah status siswa, dan TIDAK menampilkan/mengubah kode darurat.
// Setelah direset, client siswa yang masih menyimpan bukti offline-nya
// mencoba melapor lagi otomatis (tiap 10 detik).
import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRoleAktif } from '@/lib/status-akun'
import { verifySesiOwnership } from '@/lib/sesi-ownership'

export async function POST(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = tenantDb(yayasanIdDari(auth.user))
  let body: { sesiId?: unknown; nis?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body tidak valid' }, { status: 400 })
  }
  const sesiId = typeof body.sesiId === 'string' ? body.sesiId : ''
  const nis = typeof body.nis === 'string' ? body.nis : ''
  if (!sesiId || !nis) return NextResponse.json({ error: 'sesiId dan nis diperlukan' }, { status: 400 })

  // Sesi harus milik yayasan ini (essay_amplop_offline tidak punya yayasan_id)
  // dan pemanggil harus pengawas sah sesi ini (asli atau pengganti susulan).
  const { data: sesi } = await db.from('sesi_ujian').select('id, status').eq('id', sesiId).maybeSingle()
  if (!sesi) return NextResponse.json({ error: 'Sesi tidak ditemukan' }, { status: 404 })

  const sah = await verifySesiOwnership(db, sesiId, user.username)
  if (!sah) return NextResponse.json({ error: 'Anda bukan pengawas sesi ini' }, { status: 403 })

  if (sesi.status !== 'BERJALAN') {
    return NextResponse.json({ error: 'Sesi sudah tidak berjalan.' }, { status: 409 })
  }

  // Siswa harus benar-benar terdaftar di sesi ini.
  const { data: su } = await db
    .from('siswa_ujian').select('nis').eq('sesi_id', sesiId).eq('nis', nis).maybeSingle()
  if (!su) return NextResponse.json({ error: 'Siswa belum terdaftar di sesi ini' }, { status: 404 })

  const { data: diubah, error } = await db
    .from('essay_amplop_offline')
    .update({ percobaan_server: 0 })
    .eq('sesi_id', sesiId)
    .eq('nis', nis)
    .select('nis')

  if (error) {
    console.error('[reset-percobaan-essay] gagal:', error.message)
    return NextResponse.json({ error: 'Gagal mereset percobaan. Coba lagi.' }, { status: 500 })
  }
  if (!diubah || diubah.length === 0) {
    return NextResponse.json(
      { error: 'Perangkat siswa ini tidak pernah menerima soal essay terenkripsi, jadi tidak ada percobaan yang perlu direset.' },
      { status: 404 }
    )
  }

  // Jejak audit (kode TIDAK dicatat).
  await db.from('log_reset').insert({
    nis,
    sesi_id: sesiId,
    reset_oleh: user.username ?? 'pengawas',
    alasan: `sesi:${sesiId} — Percobaan kode darurat essay direset oleh pengawas`,
    password_baru: '-',
    digunakan: true,
  })

  return NextResponse.json({ success: true, message: 'Percobaan kode darurat siswa ini sudah direset.' })
}
