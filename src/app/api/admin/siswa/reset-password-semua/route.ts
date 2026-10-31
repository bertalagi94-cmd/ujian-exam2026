import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRoleAktif } from '@/lib/status-akun'
import { catatAktivitas } from '@/lib/aktivitas'

// POST /api/admin/siswa/reset-password-semua
//
// Reset massal: password SEMUA siswa pada satu tab akun (reguler ATAU
// tester — ditentukan oleh body.tester) dikembalikan ke NISN masing-masing,
// persis seperti reset satu-per-satu di [nis]/reset-password/route.ts.
// Sengaja TIDAK mengikuti filter kelas/pencarian yang sedang aktif di UI —
// tombol ini memang untuk mereset SELURUH siswa pada tab tersebut, bukan
// hanya yang sedang terlihat di halaman saat ini.
//
// Tiap siswa tetap dapat hash UNIK (bcrypt dari NIS masing-masing, bukan
// satu hash yang disalin ke semua baris) — sama seperti endpoint reset
// satu-siswa.
export const maxDuration = 60

// Cost lebih rendah dari reset satu-siswa (cost 10 di [nis]/reset-password)
// KHUSUS untuk operasi massal ini — alasannya sama dengan BCRYPT_COST di
// admin/siswa/import/route.ts: meng-hash ratusan/ribuan NIS satu per satu
// dengan cost 10 berisiko melebihi batas waktu function serverless.
// Endpoint login sudah dilindungi rate-limit per IP+username (lihat
// auth/login/route.ts), jadi trade-off cost lebih rendah ini sama dengan
// yang sudah diterima di alur import.
const BCRYPT_COST = 8
const BATCH = 25

export async function POST(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const body = (await req.json().catch(() => ({}))) as { tester?: boolean }
  const tester = body.tester === true

  const db = tenantDb(yayasanIdDari(auth.user))

  // Ambil NIS seluruh siswa pada scope yang diminta — sama persis dengan
  // filter tab di admin/siswa/route.ts (GET), supaya "reguler"/"tester" di
  // sini konsisten dengan apa yang admin lihat di tab terkait.
  let query = db.from('siswa').select('nis')
  query = tester ? query.eq('is_tester', 'YES') : query.neq('is_tester', 'YES')
  const { data: rows, error: selectError } = await query

  if (selectError) return NextResponse.json({ error: selectError.message }, { status: 500 })

  const nisList = (rows ?? []).map((r: { nis: string }) => r.nis)
  if (nisList.length === 0) {
    return NextResponse.json({ message: 'Tidak ada siswa untuk direset.', jumlah: 0 })
  }

  let sukses = 0
  const errors: string[] = []

  for (let i = 0; i < nisList.length; i += BATCH) {
    const group = nisList.slice(i, i + BATCH)
    const hasil = await Promise.all(
      group.map(async (nis) => {
        const password_hash = await bcrypt.hash(nis, BCRYPT_COST)
        const { error } = await db.from('siswa').update({ password_hash }).eq('nis', nis)
        return { nis, error }
      })
    )
    for (const r of hasil) {
      if (r.error) errors.push(`${r.nis}: ${r.error.message}`)
      else sukses++
    }
  }

  // Audit: aksi admin yang berdampak ke SELURUH siswa pada satu tab wajib
  // tercatat (fire-and-forget, tidak memperlambat response — lihat
  // catatAktivitas di src/lib/aktivitas.ts).
  catatAktivitas(
    db,
    auth.user.username,
    'RESET_PASSWORD_MASSAL',
    `Reset password ${sukses} siswa (${tester ? 'akun tester' : 'akun reguler'}) ke NISN masing-masing`
  )

  if (sukses === 0) {
    return NextResponse.json(
      { error: 'Reset gagal untuk semua siswa', details: errors.slice(0, 20) },
      { status: 500 }
    )
  }

  return NextResponse.json({
    message:
      errors.length > 0
        ? `Password ${sukses} siswa berhasil direset ke NISN, ${errors.length} gagal.`
        : `Password ${sukses} siswa berhasil direset ke NISN.`,
    jumlah: sukses,
    errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
  })
}
