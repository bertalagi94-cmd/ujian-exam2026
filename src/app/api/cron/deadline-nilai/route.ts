import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { kirimWa } from '@/lib/wa'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/cron/deadline-nilai
// Dipanggil setiap jam oleh Vercel Cron (tambahkan di vercel.json).
// Tugas:
//   1. Kirim reminder WA ke guru jika mendekati deadline
//   2. Auto-kirim semua nilai yang belum dikirim ketika deadline sudah lewat
export async function GET(req: NextRequest) {
  // Verifikasi secret
  const authHeader = req.headers.get('authorization')
  const secretParam = req.nextUrl.searchParams.get('secret')
  const expected = process.env.CRON_SECRET

  if (expected && authHeader !== `Bearer ${expected}` && secretParam !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  // Ambil pengaturan deadline
  const { data: pengaturanData } = await db
    .from('pengaturan')
    .select('key, value')
    .in('key', ['deadline_kirim_nilai', 'reminder_nilai_jam'])

  const pengaturanMap = Object.fromEntries((pengaturanData ?? []).map((p: { key: string; value: string }) => [p.key, p.value]))
  const deadlineStr = pengaturanMap['deadline_kirim_nilai']
  const reminderJam = parseInt(pengaturanMap['reminder_nilai_jam'] ?? '24', 10)

  if (!deadlineStr) {
    return NextResponse.json({ message: 'Deadline belum dikonfigurasi, tidak ada yang dikerjakan' })
  }

  const deadline = new Date(deadlineStr)
  const sekarang = new Date()

  if (isNaN(deadline.getTime())) {
    return NextResponse.json({ message: 'Format deadline tidak valid' })
  }

  const selisihMs = deadline.getTime() - sekarang.getTime()
  const selisihJam = selisihMs / (1000 * 60 * 60)

  const log: string[] = []

  // ── 1. Auto-kirim jika deadline sudah lewat ──
  if (selisihJam <= 0) {
    const { data: belumDikirim } = await db
      .from('nilai')
      .select('id, mapel_id')
      .eq('dikirim_ke_wali', false)

    if ((belumDikirim ?? []).length > 0) {
      const now = sekarang.toISOString()
      const { error, count } = await db
        .from('nilai')
        .update({ dikirim_ke_wali: true, dikirim_at: now })
        .eq('dikirim_ke_wali', false)

      if (error) {
        log.push(`Error auto-kirim: ${error.message}`)
      } else {
        log.push(`Auto-kirim ${count ?? 0} nilai ke wali kelas karena deadline sudah lewat`)
      }
    } else {
      log.push('Deadline sudah lewat tapi semua nilai sudah dikirim')
    }

    return NextResponse.json({ message: log.join(' | '), log })
  }

  // ── 2. Kirim reminder jika mendekati deadline ──
  if (selisihJam <= reminderJam) {
    // Ambil semua nilai yang belum dikirim, kelompokkan per guru
    const { data: nilaiBlm } = await db
      .from('nilai')
      .select('mapel_id, kelas')
      .eq('dikirim_ke_wali', false)

    if ((nilaiBlm ?? []).length === 0) {
      log.push('Mendekati deadline tapi semua nilai sudah dikirim, tidak perlu reminder')
      return NextResponse.json({ message: log.join(' | '), log })
    }

    // Kelompokkan per mapel
    const perMapel: Record<string, { kelas: Set<string>; jumlah: number }> = {}
    for (const n of (nilaiBlm ?? [])) {
      if (!perMapel[n.mapel_id]) perMapel[n.mapel_id] = { kelas: new Set(), jumlah: 0 }
      perMapel[n.mapel_id].kelas.add(n.kelas)
      perMapel[n.mapel_id].jumlah++
    }

    // Ambil info mapel & guru
    const mapelIds = Object.keys(perMapel)
    const { data: mapelList } = await db
      .from('mapel')
      .select('id, nama, guru_id')
      .in('id', mapelIds)

    const guruIds = [...new Set((mapelList ?? []).map((m: { guru_id: string }) => m.guru_id).filter(Boolean))]
    const { data: guruList } = await db
      .from('users')
      .select('username, nama, no_hp')
      .in('username', guruIds)
      .eq('status', 'AKTIF')

    // Kelompokkan per guru
    const perGuru: Record<string, { nama: string; no_hp: string | null; mapelBelum: string[] }> = {}
    for (const mapel of (mapelList ?? [])) {
      const info = perMapel[mapel.id]
      if (!info) continue

      if (!perGuru[mapel.guru_id]) {
        const guru = (guruList ?? []).find((g: { username: string }) => g.username === mapel.guru_id)
        if (!guru) continue
        perGuru[mapel.guru_id] = { nama: guru.nama, no_hp: guru.no_hp ?? null, mapelBelum: [] }
      }
      perGuru[mapel.guru_id].mapelBelum.push(
        `${mapel.nama} (${[...info.kelas].join(', ')}) — ${info.jumlah} siswa belum dikirim`
      )
    }

    const deadlineLabel = deadline.toLocaleString('id-ID', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
    const sisaLabel = `${Math.round(selisihJam)} jam lagi`

    let terkirim = 0
    const adminWa = process.env.ADMIN_WA_NUMBER

    for (const guru of Object.values(perGuru)) {
      const daftar = guru.mapelBelum.map((m, i) => `  ${i + 1}. ${m}`).join('\n')
      const pesan =
        `⏰ *Reminder Pengiriman Nilai*\n\n` +
        `Yth. Bapak/Ibu *${guru.nama}*,\n\n` +
        `Batas waktu pengiriman nilai ke wali kelas adalah:\n` +
        `📅 *${deadlineLabel}* (${sisaLabel})\n\n` +
        `Berikut mapel yang nilainya *belum dikirim*:\n${daftar}\n\n` +
        `Silakan buka menu *Kirim Nilai* di akun Anda sebelum deadline.\n` +
        `_Pesan otomatis dari sistem ujian._`

      // Kirim ke nomor guru jika ada, jika tidak kirim ke admin sebagai proxy
      const target = guru.no_hp || adminWa
      if (target) {
        const hasil = await kirimWa(target, pesan)
        if (hasil.success) terkirim++
        log.push(`Reminder ke ${guru.nama} (${target}): ${hasil.success ? 'OK' : hasil.message}`)
      } else {
        log.push(`Lewati ${guru.nama}: no_hp kosong & ADMIN_WA_NUMBER tidak dikonfigurasi`)
      }
    }

    log.push(`Total reminder terkirim: ${terkirim}`)
    return NextResponse.json({ message: log.join(' | '), log, terkirim })
  }

  // Belum mendekati deadline, tidak ada yang dikerjakan
  log.push(`Deadline masih ${Math.round(selisihJam)} jam lagi, belum perlu reminder`)
  return NextResponse.json({ message: log.join(' | '), log })
}
