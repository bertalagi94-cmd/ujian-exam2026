// app/api/guru/batas-soal/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRoleAktif } from '@/lib/status-akun'
import { ambilBatasMinMapel } from '@/lib/batas-soal'

/**
 * GET /api/guru/batas-soal?jenis=pg|essay&mapel_id=...
 *   -> { min: number | null }
 *
 * Dipakai form "Unduh Template" supaya jumlah soal otomatis terisi (dan
 * terkunci) sesuai batas minimal yang ditetapkan admin untuk mapel itu.
 * null = admin tidak membatasi mapel ini (atau fitur batas mati).
 */
export async function GET(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['GURU'])
  if ('error' in auth) return auth.error
  const db = tenantDb(yayasanIdDari(auth.user))

  const sp = req.nextUrl.searchParams
  const jenis = sp.get('jenis') === 'essay' ? 'essay' : 'pg'
  const mapelId = sp.get('mapel_id')
  if (!mapelId) return NextResponse.json({ min: null })

  // Hanya mapel milik guru ini (mapel.guru_id), sama seperti route guru lain
  // (lihat src/lib/guru-scope.ts). Selain itu dijawab 'tidak dibatasi' tanpa
  // membocorkan apa pun tentang mapel guru lain.
  const { data: mapel } = await db.from('mapel').select('guru_id').eq('id', mapelId).maybeSingle()
  if (!mapel || mapel.guru_id !== auth.user.username) return NextResponse.json({ min: null })

  const min = await ambilBatasMinMapel(db, { jenis, mapelId })
  return NextResponse.json({ min })
}
