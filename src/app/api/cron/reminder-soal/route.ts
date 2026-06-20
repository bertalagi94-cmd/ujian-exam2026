import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { getRangkumanJadwal } from '@/lib/rangkuman'
import { kirimWa } from '@/lib/wa'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/cron/reminder-soal
// Dipanggil otomatis oleh Vercel Cron (lihat vercel.json) setiap hari.
// Mengecek mapel & kelas yang soalnya belum disetujui, lalu mengirim
// SATU pesan rangkuman ke nomor admin (nomor yang dipakai scan di Fonnte).
// Admin lalu meneruskan pesan ini secara manual ke grup WA sekolah.
// Pendekatan ini sengaja dipakai (bukan kirim langsung ke tiap guru) karena
// paket Fonnte Free hanya bisa mengirim ke nomor yang sudah jadi kontak
// dari device tersebut — nomor admin sendiri selalu lolos tanpa syarat itu.
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

  const adminWa = process.env.ADMIN_WA_NUMBER
  if (!adminWa) {
    return NextResponse.json(
      { error: 'ADMIN_WA_NUMBER belum di-set di environment variables' },
      { status: 500 }
    )
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
    .select('username, nama, status')
    .in('username', guruUsernames)

  const guruList = (guruRaw ?? []) as { username: string; nama: string; status: string }[]

  const labelStatus: Record<string, string> = {
    BELUM_ADA: 'belum dibuat',
    DRAFT: 'masih draft',
    MENUNGGU: 'menunggu validasi admin',
    DITOLAK: 'ditolak admin, perlu revisi',
  }

  // Susun rangkuman per guru jadi satu blok teks, lalu gabungkan semua jadi 1 pesan
  const blokPerGuru: string[] = []
  const dilewati: { guru: string; alasan: string }[] = []

  for (const guru of guruList) {
    if (guru.status === 'NONAKTIF') {
      dilewati.push({ guru: guru.nama, alasan: 'status guru NONAKTIF' })
      continue
    }
    const daftar = perGuru[guru.username] ?? []
    if (daftar.length === 0) continue

    const baris = daftar
      .map((d, i) => `   ${i + 1}. ${d.nama_mapel} - Kelas ${d.kelas} (${labelStatus[d.status_soal] ?? d.status_soal})`)
      .join('\n')

    blokPerGuru.push(`*${guru.nama}*\n${baris}`)
  }

  if (blokPerGuru.length === 0) {
    return NextResponse.json({
      message: 'Tidak ada guru aktif dengan soal belum siap, tidak ada reminder yang dikirim',
      terkirim: 0,
      dilewati,
    })
  }

  const tanggal = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  const pesan =
    `*Rangkuman Soal Belum Siap - ${tanggal}*\n\n` +
    `Berikut daftar mapel/kelas yang soalnya belum siap, dikelompokkan per guru pengampu:\n\n` +
    `${blokPerGuru.join('\n\n')}\n\n` +
    `_Pesan ini otomatis dari sistem ujian. Mohon diteruskan ke grup sekolah._`

  const hasilKirim = await kirimWa(adminWa, pesan)

  return NextResponse.json({
    message: hasilKirim.success
      ? `Rangkuman berhasil dikirim ke nomor admin (${blokPerGuru.length} guru disebutkan)`
      : 'Gagal mengirim rangkuman ke nomor admin',
    terkirim: hasilKirim.success ? 1 : 0,
    detail: hasilKirim,
    jumlah_guru_disebutkan: blokPerGuru.length,
    dilewati,
  })
}
