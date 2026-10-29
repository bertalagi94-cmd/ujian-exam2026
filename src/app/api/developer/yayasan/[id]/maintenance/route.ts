// Mode Maintenance per sekolah (yayasan), diatur dari Panel Developer.
// Hanya menyentuh 4 kunci di tabel pengaturan (lihat src/lib/maintenance.ts);
// tidak membaca data siswa, jawaban, atau nilai.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireDeveloper } from '@/lib/developer-auth'
import { cacheDelPrefix } from '@/lib/cache'
import { KUNCI_MAINTENANCE } from '@/lib/maintenance'

export const dynamic = 'force-dynamic'

async function yayasanAda(id: string) {
  const { data, error } = await createAdminClient().from('yayasan').select('id').eq('id', id).maybeSingle()
  return { ada: !!data, error }
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const auth = requireDeveloper(req)
  if ('error' in auth) return auth.error

  const { data, error } = await createAdminClient()
    .from('pengaturan').select('key, value')
    .eq('yayasan_id', id).in('key', [...KUNCI_MAINTENANCE])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const m = Object.fromEntries((data ?? []).map((r: any) => [r.key, String(r.value ?? '')]))
  return NextResponse.json({
    aktif: m.maintenanceAktif === 'true',
    pesan: m.maintenancePesan ?? '',
    mulai: m.maintenanceMulai ?? '',
    selesai: m.maintenanceSelesai ?? '',
  })
}

export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const auth = requireDeveloper(req)
  if ('error' in auth) return auth.error

  const b = await req.json().catch(() => null)
  if (typeof b?.aktif !== 'boolean') {
    return NextResponse.json({ error: 'aktif harus true atau false' }, { status: 400 })
  }
  const pesan = String(b.pesan ?? '').trim()
  const mulai = String(b.mulai ?? '').trim()
  const selesai = String(b.selesai ?? '').trim()
  if (pesan.length > 500) return NextResponse.json({ error: 'Pesan maksimal 500 karakter' }, { status: 400 })
  for (const t of [mulai, selesai]) {
    if (t && Number.isNaN(new Date(t).getTime())) {
      return NextResponse.json({ error: 'Format waktu tidak valid' }, { status: 400 })
    }
  }
  if (mulai && selesai && new Date(selesai) <= new Date(mulai)) {
    return NextResponse.json({ error: 'Waktu selesai harus setelah waktu mulai' }, { status: 400 })
  }

  const cek = await yayasanAda(id)
  if (cek.error) return NextResponse.json({ error: cek.error.message }, { status: 500 })
  if (!cek.ada) return NextResponse.json({ error: 'Sekolah tidak ditemukan' }, { status: 404 })

  const now = new Date().toISOString()
  const baris = [
    ['maintenanceAktif', b.aktif ? 'true' : 'false'],
    ['maintenancePesan', pesan],
    ['maintenanceMulai', mulai],
    ['maintenanceSelesai', selesai],
  ].map(([key, value]) => ({ yayasan_id: id, key, value, updated_at: now }))

  const { error } = await createAdminClient().from('pengaturan').upsert(baris, { onConflict: 'yayasan_id,key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Login memakai cache pengaturan per yayasan: hapus supaya langsung berlaku.
  cacheDelPrefix('pengaturan:')
  return NextResponse.json({
    message: b.aktif ? 'Mode maintenance diaktifkan' : 'Mode maintenance dinonaktifkan',
  })
}
