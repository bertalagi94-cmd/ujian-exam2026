import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRoleAktif } from '@/lib/status-akun'
import { antreanSuperAdmin } from '@/lib/admin-kelas'
import { ubahStatusPaket, perkayaPaket } from '@/lib/persetujuan-paket'

export async function GET(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = tenantDb(yayasanIdDari(auth.user))
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') ?? 'MENUNGGU'

  const { data: pakets, error } = await db
    .from('paket_soal')
    .select('*')
    .eq('status', status)
    .order('tanggal', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Admin Kelas aktif → antrean MENUNGGU hanya berisi kelas tanpa Admin Kelas
  // (lihat antreanSuperAdmin). Tab Disetujui/Ditolak tetap lengkap.
  const daftar = status === 'MENUNGGU' ? await antreanSuperAdmin(db, pakets ?? []) : (pakets ?? [])
  if (!daftar.length) return NextResponse.json({ data: [] })

  const enriched = await perkayaPaket(db, daftar)

  return NextResponse.json({ data: enriched })
}

export async function POST(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = tenantDb(yayasanIdDari(auth.user))
  const { paket_id, action, catatan } = await req.json()

  let newStatus: string
  if (action === 'SETUJUI') newStatus = 'DISETUJUI'
  else if (action === 'TOLAK') newStatus = 'DITOLAK'
  else if (action === 'BATAL_SETUJUI') newStatus = 'DRAFT'
  else return NextResponse.json({ error: 'Action tidak valid' }, { status: 400 })

  // Catatan wajib diisi saat menolak agar guru tahu apa yang perlu diperbaiki.
  // Validasi di sini (server) sebagai pengaman — UI sudah memblokir lebih awal.
  if (action === 'TOLAK' && !catatan?.trim()) {
    return NextResponse.json(
      { error: 'Alasan penolakan wajib diisi agar guru bisa memperbaiki soalnya.' },
      { status: 400 }
    )
  }

  // Guard sesi-sudah-mulai + RPC atomik set_status_paket_soal + pemetaan error
  // kini ada di src/lib/persetujuan-paket.ts (dipakai bersama Admin Kelas).
  const hasil = await ubahStatusPaket(db, 'PG', { paketId: paket_id, aksi: action, catatan })
  if (!hasil.ok) return NextResponse.json({ error: hasil.error }, { status: hasil.httpStatus })

  const pesanStatus = newStatus === 'DISETUJUI' ? 'disetujui' : newStatus === 'DITOLAK' ? 'ditolak' : 'dikembalikan ke draft'
  return NextResponse.json({ message: `Paket berhasil ${pesanStatus}` })
}
