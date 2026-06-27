import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// GET /api/guru/kirim-nilai
// Mengembalikan semua nilai (per mapel yang diajar guru ini) lengkap dengan
// status pengiriman, nilai edit, dan info deadline dari pengaturan admin.
export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()

  // Ambil mapel yang diajar guru ini
  const { data: guruMapel } = await db
    .from('mapel')
    .select('id, nama, kkm')
    .eq('guru_id', user.username)

  const mapelIds = (guruMapel ?? []).map((m: { id: string }) => m.id)
  if (!mapelIds.length) {
    return NextResponse.json({ data: [], mapelList: [], deadline: null, reminderJam: 24 })
  }

  // Ambil nilai
  const { data: nilaiData, error } = await db
    .from('nilai')
    .select('id, nis, mapel_id, kelas, nilai, grade, lulus, kkm, timestamp, nilai_edit, grade_edit, lulus_edit, dikirim_ke_wali, dikirim_at, dikembalikan, catatan_guru')
    .in('mapel_id', mapelIds)
    .order('kelas', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Enrich dengan nama siswa
  const nisSet = [...new Set((nilaiData ?? []).map((r: { nis: string }) => r.nis))]
  const { data: siswaList } = await db.from('siswa').select('nis, nama').in('nis', nisSet)
  const siswaMap = Object.fromEntries((siswaList ?? []).map((s: { nis: string; nama: string }) => [s.nis, s.nama]))
  const mapelMap = Object.fromEntries((guruMapel ?? []).map((m: { id: string; nama: string }) => [m.id, m.nama]))

  const enriched = (nilaiData ?? []).map((r: Record<string, unknown>) => ({
    ...r,
    nama_siswa: siswaMap[r.nis as string] ?? r.nis,
    nama_mapel: mapelMap[r.mapel_id as string] ?? r.mapel_id,
  }))

  // Ambil deadline & reminder dari pengaturan
  const { data: pengaturanData } = await db
    .from('pengaturan')
    .select('key, value')
    .in('key', ['deadline_kirim_nilai', 'reminder_nilai_jam'])

  const pengaturanMap = Object.fromEntries((pengaturanData ?? []).map((p: { key: string; value: string }) => [p.key, p.value]))
  const deadline = pengaturanMap['deadline_kirim_nilai'] || null
  const reminderJam = parseInt(pengaturanMap['reminder_nilai_jam'] ?? '24', 10)

  return NextResponse.json({
    data: enriched,
    mapelList: guruMapel ?? [],
    deadline,
    reminderJam,
  })
}

// PATCH /api/guru/kirim-nilai
// Body dapat berisi salah satu dari:
//   { aksi: 'simpan_edit', id: string, nilai_edit: number|null, catatan_guru?: string }
//   { aksi: 'kirim_ke_wali', mapel_id: string, kelas: string }   ← kirim semua siswa di mapel+kelas itu
//   { aksi: 'kirim_semua' }                                        ← kirim semua yang belum dikirim
export async function PATCH(req: NextRequest) {
  const auth = requireRole(req, ['GURU'])
  if ('error' in auth) return auth.error
  const { user } = auth

  const db = createAdminClient()
  const body = await req.json()
  const { aksi } = body

  // Verifikasi guru memiliki mapel ini
  const { data: guruMapel } = await db
    .from('mapel')
    .select('id, nama, kkm')
    .eq('guru_id', user.username)

  const mapelIds = (guruMapel ?? []).map((m: { id: string }) => m.id)

  // ── Simpan nilai edit per siswa ──
  if (aksi === 'simpan_edit') {
    const { id, nilai_edit, catatan_guru } = body as {
      id: string
      nilai_edit: number | null
      catatan_guru?: string
    }

    // Verifikasi nilai ini milik mapel guru
    const { data: nilaiRow } = await db
      .from('nilai')
      .select('id, mapel_id, total, kkm')
      .eq('id', id)
      .single()

    if (!nilaiRow || !mapelIds.includes(nilaiRow.mapel_id)) {
      return NextResponse.json({ error: 'Tidak diizinkan' }, { status: 403 })
    }

    const updateData: Record<string, unknown> = { catatan_guru: catatan_guru ?? null }

    if (nilai_edit === null || nilai_edit === undefined) {
      // Hapus nilai edit — kembali ke nilai asli
      updateData.nilai_edit = null
      updateData.grade_edit = null
      updateData.lulus_edit = null
    } else {
      const kkm = nilaiRow.kkm ?? 75
      updateData.nilai_edit = nilai_edit
      updateData.grade_edit = hitungGrade(nilai_edit)
      updateData.lulus_edit = nilai_edit >= kkm
    }

    const { error } = await db.from('nilai').update(updateData).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ message: 'Nilai edit berhasil disimpan' })
  }

  // ── Kirim nilai ke wali kelas (per mapel+kelas) ──
  if (aksi === 'kirim_ke_wali') {
    const { mapel_id, kelas } = body as { mapel_id: string; kelas: string }

    if (!mapelIds.includes(mapel_id)) {
      return NextResponse.json({ error: 'Tidak diizinkan' }, { status: 403 })
    }

    const now = new Date().toISOString()
    const { error, count } = await db
      .from('nilai')
      .update({ dikirim_ke_wali: true, dikirim_at: now, dikembalikan: false })
      .eq('mapel_id', mapel_id)
      .eq('kelas', kelas)
      .eq('dikirim_ke_wali', false)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ message: `Nilai berhasil dikirim ke wali kelas`, jumlah: count ?? 0 })
  }

  // ── Kirim semua nilai yang belum dikirim (dari semua mapel guru ini) ──
  if (aksi === 'kirim_semua') {
    if (!mapelIds.length) return NextResponse.json({ message: 'Tidak ada mapel', jumlah: 0 })

    const now = new Date().toISOString()
    const { error, count } = await db
      .from('nilai')
      .update({ dikirim_ke_wali: true, dikirim_at: now, dikembalikan: false })
      .in('mapel_id', mapelIds)
      .eq('dikirim_ke_wali', false)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ message: 'Semua nilai berhasil dikirim ke wali kelas', jumlah: count ?? 0 })
  }

  return NextResponse.json({ error: 'Aksi tidak dikenali' }, { status: 400 })
}

function hitungGrade(nilai: number): string {
  if (nilai >= 90) return 'A'
  if (nilai >= 80) return 'B'
  if (nilai >= 70) return 'C'
  if (nilai >= 60) return 'D'
  return 'E'
}
