import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { generateId } from '@/lib/utils'
import { ambilMaksReset } from '@/lib/reset-berurutan'
import { tuntaskanSiswaTerkunci } from '@/lib/kunci-siswa'

// POST /api/siswa/ujian/pelanggaran
// Body: { sesiId, jenis, detail, eventId? }
//
// Mencatat SATU kejadian pelanggaran. Seluruh keputusan (level, status RESET,
// atau TERKUNCI pada pelanggaran ke-(N+1)) diambil ATOMIK di dalam RPC
// catat_pelanggaran_atomik (supabase/24_reset_berurutan.sql), bukan lagi
// "hitung dulu, insert kemudian" lewat query terpisah.
//
// DEDUPLIKASI (menggantikan jendela 5 detik yang lama):
//   1. `eventId` — kunci idempoten dari client untuk SATU kejadian fisik.
//      Pengiriman ulang (retry jaringan, antrean offline) dengan eventId yang
//      sama tidak pernah menjadi pelanggaran baru.
//   2. Selama siswa masih berstatus RESET (menunggu kode), kejadian baru
//      bukan pelanggaran tambahan — sama seperti latch di client. Ini menjaga
//      pasangan pelanggaran#N <-> reset R(N) tetap sejajar.
//
// Kalau RPC gagal/tidak tersedia: 503 (BUKAN fallback ke jalur lama yang tidak
// atomik). Client menyimpan kejadian dan boleh mengulang.

const PANJANG_MAKS_TEKS = 500
const POLA_EVENT_ID = /^[A-Za-z0-9_.:-]{8,80}$/

export async function POST(req: NextRequest) {
  const auth = requireRole(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  let body: { sesiId?: unknown; jenis?: unknown; detail?: unknown; eventId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body tidak valid' }, { status: 400 })
  }

  const { sesiId, jenis, detail, eventId } = body
  if (typeof sesiId !== 'string' || !sesiId || typeof jenis !== 'string' || !jenis) {
    return NextResponse.json({ error: 'sesiId dan jenis diperlukan' }, { status: 400 })
  }
  if (eventId !== undefined && eventId !== null && (typeof eventId !== 'string' || !POLA_EVENT_ID.test(eventId))) {
    return NextResponse.json({ error: 'eventId tidak valid' }, { status: 400 })
  }

  const db = createAdminClient()
  const maksReset = await ambilMaksReset(db)

  const { data, error } = await db.rpc('catat_pelanggaran_atomik', {
    p_sesi_id: sesiId,
    p_nis: user.nis!,
    p_id: generateId('PEL'),
    p_jenis: jenis.slice(0, 100),
    p_detail: typeof detail === 'string' ? detail.slice(0, PANJANG_MAKS_TEKS) : null,
    p_event_id: typeof eventId === 'string' ? eventId : null,
    p_maks_reset: maksReset,
  })

  if (error || !data) {
    console.error('[pelanggaran] RPC catat_pelanggaran_atomik gagal:', error?.message)
    return NextResponse.json(
      { error: 'Pelanggaran belum dapat dicatat di server. Coba lagi.' },
      { status: 503 }
    )
  }

  const hasil = data as { hasil: string; level?: number; terkunci?: boolean; reset_berikutnya?: number }

  const responsTerkunci = () =>
    NextResponse.json({
      perlu_reset: false,
      terkunci: true,
      level: hasil.level,
      batasPelanggaran: maksReset,
      message: 'Batas pelanggaran terlampaui. Ujian dihentikan.',
    })

  switch (hasil.hasil) {
    case 'DICATAT':
    case 'DUPLIKAT':
    case 'MENUNGGU_RESET': {
      // DUPLIKAT bisa menjawab event yang ternyata SUDAH mengunci siswa.
      if (hasil.terkunci) {
        await tuntaskanSiswaTerkunci(db, sesiId, user.nis!)
        return responsTerkunci()
      }
      return NextResponse.json({
        perlu_reset: true,
        terkunci: false,
        level: hasil.level,
        batasPelanggaran: maksReset,
        message: `Pelanggaran ke-${hasil.level} terdeteksi. Hubungi pengawas untuk mendapatkan kode lanjut ujian.`,
      })
    }

    case 'TERKUNCI':
      // Idempoten — aman walau sudah pernah dituntaskan.
      await tuntaskanSiswaTerkunci(db, sesiId, user.nis!)
      return responsTerkunci()

    case 'SUDAH_SELESAI':
      return NextResponse.json({ perlu_reset: false, terkunci: false, level: hasil.level, batasPelanggaran: maksReset })

    case 'SESI_DITUTUP':
      return NextResponse.json({ error: 'Sesi ujian sudah ditutup.' }, { status: 409 })

    case 'SISWA_TIDAK_TERDAFTAR':
    case 'SESI_TIDAK_ADA':
      return NextResponse.json({ error: 'Sesi ujian tidak ditemukan untuk akun ini.' }, { status: 404 })

    default:
      console.error('[pelanggaran] hasil RPC tidak dikenali:', hasil)
      return NextResponse.json({ error: 'Pelanggaran belum dapat dicatat di server. Coba lagi.' }, { status: 503 })
  }
}
