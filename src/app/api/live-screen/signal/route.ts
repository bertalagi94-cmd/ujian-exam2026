import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// ── Signaling "Minta layar" (WebRTC) ────────────────────────────────────
// Satu endpoint dipakai DUA arah (admin→siswa dan siswa→admin) supaya
// logikanya tidak terduplikasi. Arah & jenis pesan yang boleh dikirim
// dibatasi ketat per role di bawah — admin tidak bisa mengirim pesan yang
// seharusnya hanya datang dari siswa (ACCEPT/REJECT/OFFER), dan sebaliknya.
//
// PENTING: endpoint ini TIDAK PERNAH menerima/menyimpan video. Yang lewat
// sini hanya teks pendek (SDP handshake / kandidat ICE) untuk membentuk
// koneksi WebRTC; videonya sendiri mengalir langsung peer-to-peer setelah
// koneksi terbentuk.

const TIPE_DARI_ADMIN = new Set(['REQUEST', 'ANSWER', 'ICE', 'STOP'])
const TIPE_DARI_SISWA = new Set(['ACCEPT', 'REJECT', 'OFFER', 'ICE', 'STOP'])
const MAX_PAYLOAD_CHARS = 20_000 // SDP wajar < 5KB; ICE candidate jauh lebih kecil — ini cuma pagar jaga-jaga
const STALE_MS = 3 * 60 * 1000

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN', 'SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  let body: { nis?: string; sesiId?: string; type?: string; payload?: unknown; adminUsername?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body tidak valid' }, { status: 400 })
  }

  const { nis, sesiId, type } = body
  if (!nis || !sesiId || !type) {
    return NextResponse.json({ error: 'nis, sesiId, dan type wajib diisi' }, { status: 400 })
  }

  const payloadStr = body.payload !== undefined ? JSON.stringify(body.payload) : null
  if (payloadStr && payloadStr.length > MAX_PAYLOAD_CHARS) {
    return NextResponse.json({ error: 'Payload terlalu besar' }, { status: 400 })
  }

  const db = createAdminClient()
  let targetRole: 'ADMIN' | 'SISWA'
  let adminUsername: string

  if (user.role === 'ADMIN') {
    if (!TIPE_DARI_ADMIN.has(type)) {
      return NextResponse.json({ error: `Admin tidak boleh mengirim pesan tipe ${type}` }, { status: 403 })
    }
    targetRole = 'SISWA'
    adminUsername = user.username

    // Hanya boleh MEMULAI (REQUEST) kalau siswa memang sedang aktif di sesi
    // BERJALAN — mencegah admin memicu banner izin ke siswa yang sudah
    // selesai/tidak sedang ujian sama sekali.
    if (type === 'REQUEST') {
      const { data: sesi } = await db.from('sesi_ujian').select('status').eq('id', sesiId).maybeSingle()
      if (!sesi || sesi.status !== 'BERJALAN') {
        return NextResponse.json({ error: 'Sesi ujian ini sudah tidak berjalan' }, { status: 409 })
      }
      const { data: su } = await db.from('siswa_ujian').select('status').eq('sesi_id', sesiId).eq('nis', nis).maybeSingle()
      if (!su || su.status !== 'AKTIF') {
        return NextResponse.json({ error: 'Siswa ini sedang tidak aktif mengerjakan ujian' }, { status: 409 })
      }
      // Log audit — bukan rekaman video, cuma catatan "siapa minta apa kapan"
      // supaya ada jejak akuntabilitas kalau nanti dipertanyakan.
      await db.from('log_aktivitas').insert({
        id: randomUUID(), user_id: user.username, aksi: 'MINTA_LAYAR_SISWA',
        detail: `Meminta berbagi layar dari siswa NIS ${nis}`,
      })
    }
  } else {
    // role === 'SISWA'
    if (nis !== user.nis) {
      return NextResponse.json({ error: 'Tidak boleh mengirim sinyal atas nama siswa lain' }, { status: 403 })
    }
    if (!TIPE_DARI_SISWA.has(type)) {
      return NextResponse.json({ error: `Siswa tidak boleh mengirim pesan tipe ${type}` }, { status: 403 })
    }
    if (!body.adminUsername) {
      return NextResponse.json({ error: 'adminUsername wajib diisi (dari permintaan yang diterima)' }, { status: 400 })
    }
    targetRole = 'ADMIN'
    adminUsername = body.adminUsername

    if (type === 'ACCEPT') {
      await db.from('log_aktivitas').insert({
        id: randomUUID(), user_id: nis, aksi: 'IZINKAN_LAYAR',
        detail: `Mengizinkan admin (${adminUsername}) melihat layar`,
      })
    } else if (type === 'REJECT') {
      await db.from('log_aktivitas').insert({
        id: randomUUID(), user_id: nis, aksi: 'TOLAK_LAYAR',
        detail: `Menolak permintaan admin (${adminUsername}) untuk melihat layar`,
      })
    }
  }

  const { error } = await db.from('live_screen_signal').insert({
    id: randomUUID(),
    nis,
    sesi_id: sesiId,
    admin_username: adminUsername,
    target_role: targetRole,
    type,
    payload: payloadStr,
  })
  if (error) {
    return NextResponse.json({ error: 'Gagal mengirim sinyal' }, { status: 500 })
  }

  // Bersih-bersih oportunistik: hapus baris basi (>3 menit) untuk
  // pasangan nis+sesi ini, jaring pengaman kalau salah satu pihak
  // menutup tab sebelum sempat poll/STOP. Tidak perlu cron terpisah.
  await db.from('live_screen_signal')
    .delete()
    .lt('created_at', new Date(Date.now() - STALE_MS).toISOString())
    .eq('nis', nis)
    .eq('sesi_id', sesiId)

  return NextResponse.json({ ok: true })
}
