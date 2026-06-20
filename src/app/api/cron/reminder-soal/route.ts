import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { getRangkumanJadwal } from '@/lib/rangkuman'
import { kirimWaBanyak } from '@/lib/wa'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/cron/reminder-soal
// Dipanggil otomatis oleh Vercel Cron (lihat vercel.json) setiap hari.
// Mengecek mapel & kelas yang soalnya belum disetujui, lalu mengirim
// reminder WhatsApp ke guru pengampu masing-masing mapel.
export async function GET(req: NextRequest) {
  // Keamanan: Vercel otomatis mengirim header "Authorization: Bearer <CRON_SECRET>"
  // untuk request yang dipicu oleh Cron Job, selama env var CRON_SECRET di-set.
  // Saat testing manual, bisa juga lewat ?secret=xxx di URL.
  const authHeader = req.headers.get('authorization')
  const secretParam = req.nextUrl.searchParams.get('secret')
  const expected = process.env.CRON_SECRET

  if (expected && authHeader !== `Bearer ${expected}` && secretParam !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rangkuman = await getRangkumanJadwal()

  // Kelompokkan kombinasi mapel+kelas yang belum ada soal, per guru pengampu
  const perGuru: Record<string, { nama_mapel: string; kelas: string; status_soal: string }[]> = {}
  for (const item of rangkuman.belum_ada_soal) {
    if (!item.guru_id) continue // mapel tanpa guru pengampu, lewati
    if (!perGuru[item.guru_id]) perGuru[item.guru_id] = []
    perGuru[item.guru_id].push({ nama_mapel: item.nama_mapel, kelas: item.kelas, status_soal: item.status_soal })
  }

  const guruUsernames = Object.keys(perGuru)
  if (guruUsernames.length === 0) {
    return NextResponse.json({ message: 'Semua soal sudah siap, tidak ada reminder yang dikirim', terkirim: 0 })
  }

  const db = createAdminClient()
  const { data: guruRaw } = await (db as any)
    .from('users')
    .select('username, nama, no_hp, status')
    .in('username', guruUsernames)

  const guruList = (guruRaw ?? []) as { username: string; nama: string; no_hp: string | null; status: string }[]

  const labelStatus: Record<string, string> = {
    BELUM_ADA: 'belum dibuat',
    DRAFT: 'masih draft',
    MENUNGGU: 'menunggu validasi admin',
    DITOLAK: 'ditolak admin, perlu revisi',
  }

  const pesanList: { target: string; pesan: string; guru: string }[] = []
  const dilewati: { guru: string; alasan: string }[] = []

  for (const guru of guruList) {
    if (guru.status === 'NONAKTIF') continue
    const daftar = perGuru[guru.username] ?? []
    if (daftar.length === 0) continue

    if (!guru.no_hp) {
      dilewati.push({ guru: guru.nama, alasan: 'belum ada nomor WhatsApp tersimpan' })
      continue
    }

    const baris = daftar
      .map((d, i) => `${i + 1}. ${d.nama_mapel} - Kelas ${d.kelas} (${labelStatus[d.status_soal] ?? d.status_soal})`)
      .join('\n')

    const pesan =
      `Halo ${guru.nama},\n\n` +
      `Ini pengingat otomatis dari sistem ujian. Soal untuk mapel/kelas berikut *belum siap*:\n\n` +
      `${baris}\n\n` +
      `Mohon segera disiapkan sebelum jadwal ujian tiba. Terima kasih.`

    pesanList.push({ target: guru.no_hp, pesan, guru: guru.nama })
  }

  const hasilKirim = await kirimWaBanyak(pesanList.map(p => ({ target: p.target, pesan: p.pesan })))

  const hasil = hasilKirim.map((h, i) => ({
    guru: pesanList[i].guru,
    target: h.target,
    success: h.success,
    message: h.message,
  }))

  return NextResponse.json({
    message: `Reminder dikirim ke ${hasil.filter(h => h.success).length} dari ${hasil.length} guru`,
    terkirim: hasil.filter(h => h.success).length,
    gagal: hasil.filter(h => !h.success),
    dilewati,
  })
}
