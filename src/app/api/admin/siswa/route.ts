import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

interface ImportRow {
  nis: string
  nama: string
  kelas: string
  jenis_kelamin?: string
  tempat_lahir?: string
  tanggal_lahir?: string
  status?: string
}

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const body = await req.json()
  const rows: ImportRow[] = body.data

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'Data kosong' }, { status: 400 })
  }

  let inserted = 0
  let skipped = 0

  for (const row of rows) {
    if (!row.nis || !row.nama) { skipped++; continue }

    const password_hash = await bcrypt.hash(String(row.nis), 10)

    const { error } = await db.from('siswa').insert({
      nis: String(row.nis).trim(),
      nama: String(row.nama).trim().toUpperCase(),
      kelas: String(row.kelas ?? '').trim(),
      password_hash,
      jenis_kelamin: row.jenis_kelamin || null,
      tempat_lahir: row.tempat_lahir || null,
      tanggal_lahir: row.tanggal_lahir || null,
      status: row.status ?? 'AKTIF',
    })

    if (error) {
      // Skip duplicate NIS (code 23505) silently
      skipped++
    } else {
      inserted++
    }
  }

  return NextResponse.json({ inserted, skipped })
}
