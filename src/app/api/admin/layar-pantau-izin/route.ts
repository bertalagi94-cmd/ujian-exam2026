import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRole } from '@/lib/auth'
import { MASA_IZIN_JAM } from '@/lib/izin-layar-pantau'
import { catatAktivitas } from '@/lib/aktivitas'

export const dynamic = 'force-dynamic'

// GET   → daftar pengajuan izin (MENUNGGU paling atas, lalu riwayat terbaru)
// PATCH → { id, aksi: 'setujui' | 'tolak' | 'cabut' }

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error
  const db = tenantDb(yayasanIdDari(auth.user))

  const { data, error } = await db
    .from('izin_layar_pantau')
    .select('id, username, nama, status, diminta_pada, diputuskan_oleh, diputuskan_pada, berlaku_sampai')
    .order('diminta_pada', { ascending: false })
    .limit(100)
  if (error) return NextResponse.json({ error: 'Gagal memuat data izin.' }, { status: 500 })

  const now = Date.now()
  const rows = (data ?? []).map(r => ({
    ...r,
    aktif: r.status === 'DISETUJUI' && (!r.berlaku_sampai || new Date(r.berlaku_sampai).getTime() > now),
  }))
  const menunggu = rows.filter(r => r.status === 'MENUNGGU').reverse() // yang paling lama menunggu di atas
  const lainnya = rows.filter(r => r.status !== 'MENUNGGU')
  return NextResponse.json({ items: [...menunggu, ...lainnya], jumlahMenunggu: menunggu.length })
}

export async function PATCH(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error
  const { user } = auth
  if (user.viewAs) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = tenantDb(yayasanIdDari(user))

  const body = await req.json().catch(() => null)
  const id = typeof body?.id === 'string' ? body.id : ''
  const aksi = body?.aksi
  if (!id || !['setujui', 'tolak', 'cabut'].includes(aksi)) {
    return NextResponse.json({ error: 'Permintaan tidak valid.' }, { status: 400 })
  }

  const { data: row } = await db.from('izin_layar_pantau').select('id, username, nama, status').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Pengajuan tidak ditemukan.' }, { status: 404 })

  const now = new Date()
  let update: Record<string, unknown>
  if (aksi === 'setujui' || aksi === 'tolak') {
    if (row.status !== 'MENUNGGU') {
      return NextResponse.json({ error: 'Pengajuan ini sudah diproses.' }, { status: 409 })
    }
    update = aksi === 'setujui'
      ? { status: 'DISETUJUI', berlaku_sampai: new Date(now.getTime() + MASA_IZIN_JAM * 3600_000).toISOString() }
      : { status: 'DITOLAK', berlaku_sampai: null }
  } else {
    if (row.status !== 'DISETUJUI') {
      return NextResponse.json({ error: 'Hanya izin yang aktif yang bisa dicabut.' }, { status: 409 })
    }
    update = { status: 'DICABUT', berlaku_sampai: now.toISOString() }
  }

  const { error } = await db
    .from('izin_layar_pantau')
    .update({ ...update, diputuskan_oleh: user.nama, diputuskan_pada: now.toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ error: 'Gagal menyimpan keputusan.' }, { status: 500 })

  catatAktivitas(db, user.username, 'IZIN_LAYAR_PANTAU', `${aksi} izin Layar Pantau untuk ${row.nama ?? row.username}`)
  return NextResponse.json({ ok: true })
}
