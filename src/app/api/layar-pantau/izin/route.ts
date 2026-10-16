import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'
import { ambilInfoIzin, izinDiperlukan } from '@/lib/izin-layar-pantau'
import { catatAktivitas } from '@/lib/aktivitas'

export const dynamic = 'force-dynamic'

// GET  /api/layar-pantau/izin → status izin akun yang sedang login
// POST /api/layar-pantau/izin → guru mengajukan izin (menunggu persetujuan admin)

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU', 'KEPSEK', 'ADMIN'])
  if ('error' in auth) return auth.error
  const { user } = auth
  const db = tenantDb(yayasanIdDari(user))
  try {
    const info = await ambilInfoIzin(db, user)
    return NextResponse.json({ perlu: izinDiperlukan(user), ...info })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Gagal memuat status izin.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth
  if (!izinDiperlukan(user)) return NextResponse.json({ error: 'Izin tidak diperlukan.' }, { status: 400 })

  const db = tenantDb(yayasanIdDari(user))
  try {
    const info = await ambilInfoIzin(db, user)
    // Sudah menunggu / sudah disetujui → tidak membuat pengajuan ganda.
    if (info.status === 'MENUNGGU' || info.status === 'DISETUJUI') {
      return NextResponse.json({ perlu: true, ...info })
    }
    const id = generateId('IZP')
    const { error } = await db.from('izin_layar_pantau').insert({
      id, username: user.username, nama: user.nama, status: 'MENUNGGU',
    })
    if (error) throw new Error('Gagal mengajukan izin.')
    catatAktivitas(db, user.username, 'MINTA_IZIN_LAYAR_PANTAU', `${user.nama} meminta izin Layar Pantau`)
    return NextResponse.json({ perlu: true, status: 'MENUNGGU', id })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Gagal mengajukan izin.' }, { status: 500 })
  }
}
