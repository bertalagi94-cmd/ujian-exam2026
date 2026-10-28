import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireDeveloper } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

// Panel Developer: daftar pengajuan aktivasi sekolah.
// password_hash TIDAK pernah dikirim ke klien.
export async function GET(req: NextRequest) {
  const auth = requireDeveloper(req)
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const kolom = 'id, nama_sekolah, npsn, username, no_hp, status, alasan_tolak, yayasan_id, created_at, diputuskan_at'
  const [menunggu, riwayat] = await Promise.all([
    db.from('pengajuan_sekolah').select(kolom).eq('status', 'MENUNGGU').order('created_at', { ascending: true }),
    db.from('pengajuan_sekolah').select(kolom).neq('status', 'MENUNGGU').order('diputuskan_at', { ascending: false }).limit(30),
  ])
  if (menunggu.error) return NextResponse.json({ error: menunggu.error.message }, { status: 500 })
  if (riwayat.error) return NextResponse.json({ error: riwayat.error.message }, { status: 500 })

  // Kode Sekolah internal yayasan yang sudah dibuat (untuk info saja).
  const ids = (riwayat.data ?? []).map((p: any) => p.yayasan_id).filter(Boolean)
  const kodeMap: Record<string, string> = {}
  if (ids.length) {
    const { data: yys } = await db.from('yayasan').select('id, kode').in('id', ids)
    ;(yys ?? []).forEach((y: any) => { kodeMap[y.id] = y.kode })
  }

  return NextResponse.json({
    data: {
      menunggu: menunggu.data ?? [],
      riwayat: (riwayat.data ?? []).map((p: any) => ({ ...p, kode_sekolah: p.yayasan_id ? kodeMap[p.yayasan_id] ?? null : null })),
    },
  })
}
