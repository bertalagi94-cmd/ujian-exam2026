import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// Tabel yang BENAR-BENAR ada di schema database
// kisi_kisi DIHAPUS karena tidak ada di schema (01_schema.sql)
//
// BUG FIX: tabel `sekolah` (fitur jenjang/Kepsek — lihat src/lib/kepsek-scope.ts)
// sebelumnya tidak ada di sini sama sekali, padahal `kelas.sekolah_id` dan
// `users.sekolah_id` adalah FK ke tabel ini. Akibatnya: backup tidak pernah
// menyimpan data sekolah, dan restore ke environment lain bisa gagal (FK
// violation) saat insert kelas/users yang sekolah_id-nya menunjuk ke baris
// sekolah yang tidak ada. `sekolah` harus DIHAPUS SETELAH kelas & users
// (dia induk dari keduanya), dan DI-INSERT SEBELUM kelas & users.
const DELETE_ORDER = [
  'log_aktivitas',
  'log_reset',
  'pelanggaran',
  'nilai',
  'jawaban',
  'siswa_ujian',
  'sesi_ujian',
  'soal',
  'paket_soal',
  'jadwal',
  'users',
  'siswa',
  'kelas_mapel',
  'mapel',
  'kelas',
  'sekolah',
  'pengaturan',
]

const INSERT_ORDER = [
  'pengaturan',
  'sekolah',
  'kelas',
  'mapel',
  'kelas_mapel',
  'siswa',
  'users',
  'jadwal',
  'paket_soal',
  'soal',
  'sesi_ujian',
  'siswa_ujian',
  'jawaban',
  'nilai',
  'pelanggaran',
  'log_reset',
  'log_aktivitas',
]

// Tabel yang diketahui ada di schema (untuk validasi backup)
const SCHEMA_TABLES = new Set(DELETE_ORDER)

async function clearTable(
  db: ReturnType<typeof import('@/lib/supabase').createAdminClient>,
  table: string
): Promise<string | null> {
  // Skip tabel yang tidak ada di schema agar tidak error
  if (!SCHEMA_TABLES.has(table)) return null

  try {
    let error: { message: string } | null = null

    if (table === 'users') {
      // users: hapus semua kecuali ADMIN
      ;({ error } = await (db as any).from('users').delete().neq('role', 'ADMIN'))
    } else if (table === 'pengaturan') {
      // pengaturan: PK = key (TEXT)
      ;({ error } = await (db as any).from('pengaturan').delete().not('key', 'is', null))
    } else if (table === 'siswa') {
      // siswa: PK = nis (TEXT)
      ;({ error } = await (db as any).from('siswa').delete().not('nis', 'is', null))
    } else if (table === 'siswa_ujian' || table === 'jawaban' || table === 'log_reset') {
      // BIGSERIAL PK — pakai gt 0
      ;({ error } = await (db as any).from(table).delete().gt('id', 0))
    } else {
      // Tabel lain punya id TEXT
      ;({ error } = await (db as any).from(table).delete().not('id', 'is', null))
    }

    if (error) {
      // Jika tabel tidak exist di DB (42P01), skip saja — jangan gagalkan restore
      if (
        error.message.includes('does not exist') ||
        error.message.includes('42P01')
      ) {
        return null
      }
      return `${table}: ${error.message}`
    }
    return null
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error'
    // Skip jika tabel tidak exist
    if (msg.includes('does not exist') || msg.includes('42P01')) return null
    return `${table}: ${msg}`
  }
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  let payload: {
    version?: string
    app?: string
    tables: Record<string, unknown[]>
  }

  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'File backup tidak valid (bukan JSON)' }, { status: 400 })
  }

  if (!payload?.tables || typeof payload.tables !== 'object') {
    return NextResponse.json(
      { error: 'Format backup tidak dikenali. Pastikan file adalah backup SmartExam.' },
      { status: 400 }
    )
  }

  if (payload.app && payload.app !== 'SmartExam') {
    return NextResponse.json(
      { error: 'File backup bukan dari aplikasi SmartExam.' },
      { status: 400 }
    )
  }

  // Validasi: minimal ada satu tabel schema yang dikenal
  const tableKeys = Object.keys(payload.tables)
  const hasKnownTable = tableKeys.some(k => SCHEMA_TABLES.has(k))
  if (!hasKnownTable) {
    return NextResponse.json(
      { error: 'File backup tidak mengandung data yang dikenali. Pastikan file adalah backup SmartExam yang valid.' },
      { status: 400 }
    )
  }

  const db = createAdminClient()

  // ── CEK AKTIVITAS SEBELUM RESTORE ───────────────────────────────────────
  // Restore saat ujian berjalan akan menghapus semua jawaban dan nilai siswa
  // yang sedang mengerjakan. Tolak jika ada sesi aktif atau siswa aktif.
  const [{ data: sesiAktif }, { data: siswaAktif }] = await Promise.all([
    db.from('sesi_ujian').select('id').eq('status', 'BERJALAN').limit(1),
    db.from('siswa_ujian').select('id').eq('status', 'AKTIF').limit(1),
  ])

  const adaSesi = (sesiAktif?.length ?? 0) > 0
  const adaSiswa = (siswaAktif?.length ?? 0) > 0

  if (adaSesi || adaSiswa) {
    const pesan: string[] = []
    if (adaSesi) pesan.push('ada sesi ujian yang sedang berjalan')
    if (adaSiswa) pesan.push('ada siswa yang sedang mengerjakan ujian')
    return NextResponse.json({
      error: `Restore tidak bisa dilakukan karena ${pesan.join(' dan ')}. Tutup semua sesi terlebih dahulu. Restore akan menghapus seluruh data yang ada termasuk jawaban siswa yang sedang mengerjakan.`,
      ada_aktivitas: true,
      ada_sesi: adaSesi,
      ada_siswa: adaSiswa,
    }, { status: 409 })
  }
  // ─────────────────────────────────────────────────────────────────────────

  const deleteErrors: string[] = []

  // 1. Hapus data lama — hanya tabel yang ada di schema DAN ada di backup
  for (const table of DELETE_ORDER) {
    if (!(table in payload.tables)) continue
    const err = await clearTable(db, table)
    if (err) deleteErrors.push(err)
  }

  if (deleteErrors.length > 0) {
    return NextResponse.json(
      { error: 'Gagal membersihkan data lama', details: deleteErrors },
      { status: 500 }
    )
  }

  // 2. Insert data dari backup
  const errors: string[] = []
  const stats: Record<string, number> = {}

  for (const table of INSERT_ORDER) {
    // Skip tabel yang tidak ada di schema (misal: kisi_kisi dari backup lama)
    if (!SCHEMA_TABLES.has(table)) {
      stats[table] = 0
      continue
    }

    let rows = payload.tables[table]
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      stats[table] = 0
      continue
    }

    // users: skip row ADMIN (tidak dihapus saat clear, hindari duplicate key)
    if (table === 'users') {
      rows = rows.filter((r: any) => r.role !== 'ADMIN')
      if (rows.length === 0) {
        stats[table] = 0
        continue
      }
    }

    const BATCH = 500
    let inserted = 0
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH)
      try {
        const { error } = await (db as any).from(table).insert(batch)
        if (error) {
          errors.push(`Gagal insert ${table} (batch ${Math.floor(i / BATCH) + 1}): ${error.message}`)
          break
        }
        inserted += batch.length
      } catch (e) {
        errors.push(`Gagal insert ${table}: ${e instanceof Error ? e.message : 'error'}`)
        break
      }
    }
    stats[table] = inserted
  }

  if (errors.length > 0) {
    return NextResponse.json(
      { error: 'Restore selesai dengan beberapa error', details: errors, stats },
      { status: 207 }
    )
  }

  return NextResponse.json({ message: 'Restore berhasil', stats })
}
