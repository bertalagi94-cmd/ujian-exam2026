import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// GET /api/admin/monitoring-nilai
// Menampilkan rekap status pengiriman nilai per guru per kelas
export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()

  // Ambil semua nilai beserta info pengiriman
  const { data: nilaiList, error } = await db
    .from('nilai')
    .select('mapel_id, kelas, dikirim_ke_wali, dikirim_at, dikembalikan')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Ambil semua mapel beserta guru pengampunya
  const { data: mapelList } = await db.from('mapel').select('id, nama, guru_id')
  const mapelMap = Object.fromEntries((mapelList ?? []).map((m: { id: string; nama: string; guru_id: string }) => [m.id, m]))

  // Ambil nama guru
  const guruIds = [...new Set((mapelList ?? []).map((m: { guru_id: string }) => m.guru_id).filter(Boolean))]
  const { data: guruList } = await db.from('users').select('username, nama').in('username', guruIds)
  const guruMap = Object.fromEntries((guruList ?? []).map((g: { username: string; nama: string }) => [g.username, g.nama]))

  // Ambil deadline dari pengaturan
  const { data: pengaturanData } = await db
    .from('pengaturan')
    .select('key, value')
    .in('key', ['deadline_kirim_nilai', 'reminder_nilai_jam'])

  const pengaturanMap = Object.fromEntries((pengaturanData ?? []).map((p: { key: string; value: string }) => [p.key, p.value]))
  const deadline = pengaturanMap['deadline_kirim_nilai'] || null

  // Kelompokkan per guru+mapel+kelas
  const kelompok: Record<string, {
    guru_id: string
    nama_guru: string
    mapel_id: string
    nama_mapel: string
    kelas: string
    total: number
    sudah_dikirim: number
    ada_dikembalikan: boolean
    semua_dikirim: boolean
  }> = {}

  for (const n of (nilaiList ?? [])) {
    const mapel = mapelMap[n.mapel_id as string]
    if (!mapel) continue

    const key = `${mapel.guru_id}__${n.mapel_id}__${n.kelas}`
    if (!kelompok[key]) {
      kelompok[key] = {
        guru_id: mapel.guru_id,
        nama_guru: guruMap[mapel.guru_id] ?? mapel.guru_id,
        mapel_id: n.mapel_id,
        nama_mapel: mapel.nama,
        kelas: n.kelas,
        total: 0,
        sudah_dikirim: 0,
        ada_dikembalikan: false,
        semua_dikirim: false,
      }
    }

    kelompok[key].total++
    if (n.dikirim_ke_wali) kelompok[key].sudah_dikirim++
    if (n.dikembalikan) kelompok[key].ada_dikembalikan = true
  }

  // Tandai mana yang sudah semua terkirim
  for (const k of Object.values(kelompok)) {
    k.semua_dikirim = k.total > 0 && k.sudah_dikirim === k.total
  }

  const hasil = Object.values(kelompok).sort((a, b) =>
    a.nama_guru.localeCompare(b.nama_guru) || a.nama_mapel.localeCompare(b.nama_mapel)
  )

  return NextResponse.json({ data: hasil, deadline })
}
