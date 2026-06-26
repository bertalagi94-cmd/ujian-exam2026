// app/api/admin/pengaturan/batas-submit/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { cacheDelPrefix } from '@/lib/cache'
import { revalidatePath } from 'next/cache'

/**
 * POST /api/admin/pengaturan/batas-submit
 *
 * Mengaktifkan atau menonaktifkan fitur batas minimal waktu submit ujian.
 * Sebelum mengubah status, endpoint ini mengecek apakah ada sesi ujian
 * yang sedang BERJALAN. Jika ada, perubahan ditolak dengan HTTP 409.
 *
 * Body: { aktif: boolean, menit: number }
 */
export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const body = await req.json()
  const { aktif, menit } = body

  if (typeof aktif !== 'boolean') {
    return NextResponse.json({ error: 'Parameter "aktif" harus boolean' }, { status: 400 })
  }

  const menitNum = parseInt(menit) || 45
  if (menitNum < 1 || menitNum > 300) {
    return NextResponse.json({ error: 'Durasi minimal harus antara 1 sampai 300 menit' }, { status: 400 })
  }

  // ── Cek apakah ada sesi ujian yang sedang BERJALAN ──────────────────────
  const { data: sesiAktif, error: sesiError } = await db
    .from('sesi_ujian')
    .select('id')
    .eq('status', 'BERJALAN')
    .limit(1)

  if (sesiError) {
    return NextResponse.json({ error: 'Gagal memeriksa sesi ujian aktif' }, { status: 500 })
  }

  if (sesiAktif && sesiAktif.length > 0) {
    const action = aktif ? 'mengaktifkan' : 'menonaktifkan'
    return NextResponse.json({
      error: `Tidak dapat ${action} pengaturan ini karena ada sesi ujian yang sedang berjalan. Tunggu sampai semua sesi selesai, lalu coba lagi.`,
    }, { status: 409 })
  }
  // ─────────────────────────────────────────────────────────────────────────

  const now = new Date().toISOString()
  const records = [
    { key: 'minSubmitAktif', value: String(aktif), updated_at: now },
    { key: 'minSubmitMenit', value: String(menitNum), updated_at: now },
  ]

  const { error: upsertError } = await db
    .from('pengaturan')
    .upsert(records, { onConflict: 'key' })

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 })
  }

  cacheDelPrefix('pengaturan:')
  revalidatePath('/', 'layout')

  const status = aktif ? `diaktifkan (${menitNum} menit)` : 'dinonaktifkan'
  return NextResponse.json({ message: `Batas minimal waktu submit berhasil ${status}` })
}
