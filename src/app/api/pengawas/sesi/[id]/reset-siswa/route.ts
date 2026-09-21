import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { verifySesiOwnership } from '@/lib/sesi-ownership'
import { ambilMaksReset, hitungKodeReset } from '@/lib/reset-berurutan'
import { tuntaskanSiswaTerkunci } from '@/lib/kunci-siswa'

// POST /api/pengawas/sesi/[id]/reset-siswa
// Body: { nis: string }
//
// Menampilkan kode reset R(reset_terpakai + 1) untuk siswa yang sedang
// menunggu (status RESET) atau baru saja dikunci, agar pengawas bisa
// membacakannya. Jawaban TIDAK dihapus.
//
// BUG P0 YANG DIPERBAIKI: endpoint ini SEBELUMNYA memakai generator kode
// sendiri (`Math.random()`, disimpan mentah di `log_reset`), TERPISAH dari
// mekanisme HMAC di src/lib/reset-berurutan.ts yang sudah dipakai oleh
// verifier siswa (/api/siswa/ujian/verifikasi-reset), endpoint admin
// (bypass_reset di /api/admin/pelanggaran), dan endpoint pra-cache pengawas
// (/api/pengawas/sesi/[id]/kode-reset). Akibatnya kode yang diberikan
// pengawas lewat endpoint ini bisa berbeda dari kode yang diharapkan
// verifier -> R1 ditolak.
//
// Sekarang endpoint ini HANYA membaca giliran reset (reset_terpakai + 1) dan
// MENURUNKAN kodenya lewat hitungKodeReset (sama persis dengan yang dipakai
// kode-reset/route.ts dan bypass_reset). Tidak ada generator kedua, tidak ada
// kode tersimpan mentah di database — satu-satunya sumber kebenaran adalah
// reset-berurutan.ts + penghitung siswa_ujian.reset_terpakai.
//
// Endpoint ini TIDAK memutuskan sendiri kapan siswa dikunci permanen —
// itu sudah terjadi atomik di RPC catat_pelanggaran_atomik saat pelanggaran
// ke-(N+1) dilaporkan (lihat /api/siswa/ujian/pelanggaran). Di sini kita
// hanya membaca status siswa_ujian yang sudah menjadi sumber kebenaran itu.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireRole(req, ['GURU', 'ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const sesiId = params.id
  const { nis } = await req.json()

  if (!nis) return NextResponse.json({ error: 'NIS diperlukan' }, { status: 400 })

  if (auth.user.role === 'GURU') {
    const sah = await verifySesiOwnership(db, sesiId, auth.user.username)
    if (!sah) {
      return NextResponse.json({ error: 'Anda bukan pengawas sesi ini' }, { status: 403 })
    }
  }

  const { data: siswa } = await db.from('siswa').select('nama').eq('nis', nis).single()
  if (!siswa) return NextResponse.json({ error: 'Siswa tidak ditemukan' }, { status: 404 })

  const { data: siswaUjian, error: suErr } = await db
    .from('siswa_ujian')
    .select('status, reset_terpakai')
    .eq('sesi_id', sesiId)
    .eq('nis', nis)
    .maybeSingle()

  // Fail-closed: error database BUKAN berarti "siswa tidak terdaftar".
  if (suErr) {
    console.error('[reset-siswa] gagal membaca siswa_ujian:', suErr.message)
    return NextResponse.json({ error: 'Data siswa belum dapat dibaca. Coba lagi sebentar lagi.' }, { status: 503 })
  }
  if (!siswaUjian) {
    return NextResponse.json({ error: 'Siswa belum terdaftar di sesi ini' }, { status: 404 })
  }

  const maks = await ambilMaksReset(db)

  // Sudah terkunci permanen (diputuskan atomik oleh catat_pelanggaran_atomik
  // pada pelanggaran ke-(N+1)) -> tidak ada kode untuk ditampilkan.
  if (siswaUjian.status === 'TERKUNCI') {
    // Idempoten: pastikan nilai 0 + waktu selesai sudah tercatat walau
    // request ini datang lewat jalur lama / retry.
    await tuntaskanSiswaTerkunci(db, sesiId, nis)

    const { count } = await db
      .from('pelanggaran')
      .select('*', { count: 'exact', head: true })
      .eq('sesi_id', sesiId)
      .eq('nis', nis)
      .neq('status', 'DIABAIKAN')

    return NextResponse.json({
      dikunci_permanen: true,
      jumlah_pelanggaran: count ?? undefined,
      message: `${siswa.nama} telah melanggar melebihi batas (${maks}x reset). Siswa di-logout permanen dan nilai menjadi 0.`,
    })
  }

  if (siswaUjian.status === 'SELESAI') {
    return NextResponse.json({ error: `${siswa.nama} sudah menyelesaikan ujian.` }, { status: 409 })
  }

  const nomor = (siswaUjian.reset_terpakai ?? 0) + 1
  if (nomor > maks) {
    // Hanya mungkin bila batasPelanggaran diturunkan saat ujian berjalan.
    return NextResponse.json(
      { error: `Semua kode reset (R1–R${maks}) sudah terpakai. Pelanggaran berikutnya menutup ujian siswa ini.` },
      { status: 409 }
    )
  }

  let kodeReset: string
  try {
    kodeReset = hitungKodeReset(sesiId, nis, nomor)
  } catch (e) {
    console.error('[reset-siswa] gagal menghitung kode reset:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Kode reset belum dapat disiapkan. Periksa konfigurasi rahasia server.' }, { status: 500 })
  }

  // Hanya AKTIF/RESET yang boleh diubah ke RESET (jangan menimpa status lain).
  // Menampilkan kode ini TIDAK "memakainya" — pemakaian (dan kenaikan
  // reset_terpakai) baru terjadi atomik saat siswa memasukkan kodenya lewat
  // konsumsi_reset_berurutan di /api/siswa/ujian/verifikasi-reset.
  await Promise.all([
    db.from('siswa_ujian')
      .update({ status: 'RESET' })
      .eq('sesi_id', sesiId)
      .eq('nis', nis)
      .in('status', ['AKTIF', 'RESET']),
    db.from('pelanggaran')
      .update({ status: 'SUDAH_DITINDAKLANJUTI' })
      .eq('sesi_id', sesiId)
      .eq('nis', nis)
      .eq('status', 'BELUM_DITINDAKLANJUTI'),
  ])

  // Jejak audit SAJA — kode TIDAK disimpan mentah ('-'), sama seperti
  // bypass_reset ADMIN dan konsumsi_reset_berurutan. reset_no sengaja kosong
  // karena ini bukan pemakaian, hanya menampilkan giliran R(nomor).
  await db.from('log_reset').insert({
    nis,
    sesi_id: sesiId,
    reset_oleh: auth.user?.username ?? 'pengawas',
    alasan: `sesi:${sesiId} — Reset R${nomor} ditampilkan oleh pengawas karena pelanggaran`,
    password_baru: '-',
    digunakan: false,
  })

  return NextResponse.json({
    dikunci_permanen: false,
    kode_reset: kodeReset,
    nama_siswa: siswa.nama,
    reset_ke: nomor,
    batasPelanggaran: maks,
    message: `Siswa ${siswa.nama} perlu kode reset R${nomor}/${maks}. Berikan kode ${kodeReset} kepada siswa untuk melanjutkan ujian.`,
  })
}
