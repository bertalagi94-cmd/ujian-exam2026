import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRoleAktif } from '@/lib/status-akun'
import { generateId } from '@/lib/utils'
import { ambilMaksReset } from '@/lib/reset-berurutan'
import { tuntaskanSiswaTerkunci } from '@/lib/kunci-siswa'
import { cekDeviceSiswa, pesanDevice } from '@/lib/device-guard'

// POST /api/siswa/ujian/pelanggaran
// Body: { sesiId, jenis, detail, eventId?, deviceId? }
//
// PERANGKAT: deviceId dibandingkan dengan siswa_ujian.device_id (lihat
// src/lib/device-guard.ts) supaya perangkat lain yang memakai akun yang sama
// tidak bisa mengirim laporan pelanggaran palsu.
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

// Batas durasi fungsi. Tanpa ini Vercel (Hobby + Fluid Compute) memakai default
// 300 detik: saat database jenuh, satu request pelanggaran bisa menggantung
// berpuluh detik per query dan menumpuk (terlihat di log simulasi 12 Nov 2026:
// timeout 300 detik di route ini). Klien SUDAH menyimpan kejadian di antrean
// lokal dan mengulang otomatis atas 5xx, jadi gagal cepat itu aman.
export const maxDuration = 15

const PANJANG_MAKS_TEKS = 500
const POLA_EVENT_ID = /^[A-Za-z0-9_.:-]{8,80}$/

// Waktu kejadian ASLI dari perangkat (outbox menyimpannya di `dibuatIso`).
// created_at di tabel pelanggaran = waktu TIBA di server, sehingga kejadian yang
// tertahan lalu terkirim bergelombang tampak serempak. Waktu asli dititipkan di
// akhir kolom `detail` (tanpa migrasi SQL). Jam perangkat tidak tepercaya, maka
// hanya dicatat sebagai keterangan -- tidak dipakai untuk keputusan apa pun.
function sufiksWaktuKejadian(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 40) return ''
  const t = Date.parse(raw)
  if (!Number.isFinite(t)) return ''
  const sekarang = Date.now()
  if (t > sekarang + 5 * 60_000 || t < sekarang - 48 * 3600_000) return ''
  const tunda = Math.max(0, Math.round((sekarang - t) / 1000))
  return ` | kejadian=${new Date(t).toISOString()} tunda=${tunda}s`
}

export async function POST(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['SISWA'])
  if ('error' in auth) return auth.error
  const { user } = auth

  let body: { sesiId?: unknown; jenis?: unknown; detail?: unknown; eventId?: unknown; deviceId?: unknown; waktuKejadian?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body tidak valid' }, { status: 400 })
  }

  const { sesiId, jenis, detail, eventId, deviceId, waktuKejadian } = body
  if (typeof sesiId !== 'string' || !sesiId || typeof jenis !== 'string' || !jenis) {
    return NextResponse.json({ error: 'sesiId dan jenis diperlukan' }, { status: 400 })
  }
  if (eventId !== undefined && eventId !== null && (typeof eventId !== 'string' || !POLA_EVENT_ID.test(eventId))) {
    return NextResponse.json({ error: 'eventId tidak valid' }, { status: 400 })
  }

  const db = tenantDb(yayasanIdDari(auth.user))

  // Multi-yayasan: RPC di bawah TIDAK otomatis ter-scope yayasan, jadi pastikan
  // dulu sesi ini memang milik yayasan siswa. Sesi yayasan lain dijawab sama
  // seperti sesi yang tidak ada.
  const { data: sesiMilikYayasan } = await db
    .from('sesi_ujian').select('id').eq('id', sesiId).maybeSingle()
  if (!sesiMilikYayasan) {
    return NextResponse.json({ error: 'Sesi ujian tidak ditemukan untuk akun ini.' }, { status: 404 })
  }

  // Satu siswa satu perangkat. Baris siswa_ujian yang belum ada dibiarkan lewat
  // ke RPC (yang menjawab SISWA_TIDAK_TERDAFTAR). Error baca = fail-closed (503).
  const { data: siswaUjian, error: siswaErr } = await db
    .from('siswa_ujian').select('device_id').eq('sesi_id', sesiId).eq('nis', user.nis!).maybeSingle()
  if (siswaErr) {
    console.error('[pelanggaran] gagal membaca siswa_ujian:', siswaErr.message)
    return NextResponse.json({ error: 'Pelanggaran belum dapat dicatat di server. Coba lagi.' }, { status: 503 })
  }
  const cekDevice = cekDeviceSiswa(siswaUjian?.device_id, deviceId, 'pelanggaran')
  if (cekDevice !== 'OK') {
    return NextResponse.json({ error: pesanDevice(cekDevice) }, { status: 409 })
  }

  const maksReset = await ambilMaksReset(db, yayasanIdDari(auth.user))

  // detail + waktu kejadian asli, dipotong supaya tetap muat di batas kolom.
  const sufiks = sufiksWaktuKejadian(waktuKejadian)
  const detailAsli = typeof detail === 'string' ? detail : ''
  const detailFinal = detailAsli || sufiks
    ? detailAsli.slice(0, Math.max(0, PANJANG_MAKS_TEKS - sufiks.length)) + sufiks
    : null

  const { data, error } = await db.rpc('catat_pelanggaran_atomik', {
    p_sesi_id: sesiId,
    p_nis: user.nis!,
    p_id: generateId('PEL'),
    p_jenis: jenis.slice(0, 100),
    p_detail: detailFinal,
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
