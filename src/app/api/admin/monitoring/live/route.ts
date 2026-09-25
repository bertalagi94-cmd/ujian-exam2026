import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// ── Feed aktivitas LIVE (admin) ─────────────────────────────────────────
// Endpoint terpisah dari /api/admin/monitoring karena endpoint itu berat
// (banyak query paralel + metrik_sistem sampai 5000 baris) — cocok untuk
// refresh tiap 15 detik, TAPI kalau dipanggil tiap 2-3 detik akan
// membebani DB tanpa perlu.
//
// Endpoint ini sebaliknya SENGAJA dibuat murah: hanya mengambil baris
// `log_aktivitas` dan `pelanggaran` yang LEBIH BARU dari `since` (query
// range dengan index created_at, limit kecil) — jadi aman dipanggil
// setiap 2-3 detik untuk memberi kesan "langsung" tanpa scan tabel penuh.
//
// Client mengirim `since` = timestamp event terakhir yang sudah diterima,
// server balas hanya baris setelah itu + `serverTime` sebagai cursor
// berikutnya (pakai jam SERVER, bukan jam browser, supaya tidak ada celah
// akibat clock skew antara client dan DB).
const MAX_SINCE_AGE_MS = 5 * 60 * 1000 // batasi rentang query maksimal 5 menit

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const now = new Date()

  const sinceParam = req.nextUrl.searchParams.get('since')
  let since = sinceParam ? new Date(sinceParam) : new Date(now.getTime() - 15_000)
  if (isNaN(since.getTime())) {
    return NextResponse.json({ error: 'Parameter since tidak valid' }, { status: 400 })
  }
  // Jangan biarkan client minta rentang terlalu jauh ke belakang (mis. tab
  // dibiarkan tertidur lama di background) — itu tugas refresh penuh 15
  // detik, bukan endpoint delta ini.
  if (now.getTime() - since.getTime() > MAX_SINCE_AGE_MS) {
    since = new Date(now.getTime() - MAX_SINCE_AGE_MS)
  }

  const [{ data: logsBaru, error: errLogs }, { data: pelanggaranBaru, error: errPel }] = await Promise.all([
    db.from('log_aktivitas')
      .select('id, user_id, aksi, detail, created_at')
      .gt('created_at', since.toISOString())
      .order('created_at', { ascending: true })
      .limit(50),
    db.from('pelanggaran')
      .select('id, nis, jenis, created_at')
      .gt('created_at', since.toISOString())
      .order('created_at', { ascending: true })
      .limit(50),
  ])

  if (errLogs || errPel) {
    return NextResponse.json({ error: 'Gagal memuat aktivitas terbaru' }, { status: 500 })
  }

  // Nama siswa hanya dicari untuk NIS yang benar-benar muncul di batch ini
  // (bukan seluruh tabel siswa) — supaya query ini tetap ringan.
  const nisList = Array.from(new Set((pelanggaranBaru ?? []).map((p: { nis: string }) => p.nis)))
  let siswaMap: Record<string, string> = {}
  if (nisList.length) {
    const { data: siswaRows } = await db.from('siswa').select('nis, nama').in('nis', nisList)
    for (const s of siswaRows ?? []) siswaMap[s.nis] = s.nama
  }

  const pelanggaran = (pelanggaranBaru ?? []).map((p: { id: string; nis: string; jenis: string; created_at: string }) => ({
    ...p,
    nama_siswa: siswaMap[p.nis] ?? p.nis,
  }))

  return NextResponse.json({
    serverTime: now.toISOString(),
    logs: logsBaru ?? [],
    pelanggaran,
  })
}
