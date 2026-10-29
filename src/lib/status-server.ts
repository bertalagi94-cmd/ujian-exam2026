// src/lib/status-server.ts
//
// Status "Server" NYATA dari tabel metrik_sistem (src/lib/metrik.ts): error
// rate & latensi endpoint kritis (login, validasi_ujian, sync_jawaban) dalam
// WINDOW_MENIT terakhir + latensi ping database. metrik_sistem GLOBAL (tidak
// per sekolah), dipakai Panel Developer (/api/developer/monitor).
//
// Dipindahkan apa adanya dari route monitoring Super Admin yang sudah dihapus.
export const WINDOW_MENIT = 5
export const JENDELA_HISTORI_MENIT = 60
export const UKURAN_BUCKET_MENIT = 5

export interface Baris { endpoint: string; status: string; durasi_ms: number; created_at: string }

function hitungP95(nilai: number[]): number {
  if (nilai.length === 0) return 0
  const sorted = [...nilai].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

// Hitung status server NYATA dari baris metrik_sistem dalam window terakhir,
// plus latensi live DB ping request admin ini sendiri.
export function hitungStatusServer(barisWindow: Baris[], dbResponseMs: number) {
  const total = barisWindow.length
  const errorCount = barisWindow.filter(b => b.status === 'error').length
  const errorRate = total > 0 ? errorCount / total : 0
  const durasiList = barisWindow.map(b => b.durasi_ms)
  const avgLatency = total > 0 ? Math.round(durasiList.reduce((a, b) => a + b, 0) / total) : 0
  const p95Latency = hitungP95(durasiList)

  // Breakdown per endpoint — supaya admin bisa lihat PERSIS mana yang
  // bermasalah (mis. cuma sync_jawaban yang error, login normal).
  const perEndpoint: Record<string, { total: number; error: number; avgMs: number; p95Ms: number }> = {}
  for (const ep of ['login', 'validasi_ujian', 'sync_jawaban']) {
    const barisEp = barisWindow.filter(b => b.endpoint === ep)
    const durasiEp = barisEp.map(b => b.durasi_ms)
    perEndpoint[ep] = {
      total: barisEp.length,
      error: barisEp.filter(b => b.status === 'error').length,
      avgMs: barisEp.length ? Math.round(durasiEp.reduce((a, b) => a + b, 0) / barisEp.length) : 0,
      p95Ms: hitungP95(durasiEp),
    }
  }

  // Thresholds disusun dari yang PALING parah dulu. `dbResponseMs` (live
  // ping saat request admin ini diproses) dicek terpisah supaya walau
  // TIDAK ADA traffic siswa sama sekali (mis. di luar jam ujian), admin
  // tetap tahu kalau koneksi ke Supabase sendiri sedang lambat/putus.
  let status: 'AMAN' | 'NORMAL' | 'WASPADA' | 'BERAT' | 'KRITIS' = 'AMAN'
  const alasan: string[] = []

  if (dbResponseMs > 3000) {
    status = 'KRITIS'; alasan.push(`Koneksi database sangat lambat (${dbResponseMs}ms)`)
  } else if (total >= 3 && errorRate >= 0.2) {
    status = 'KRITIS'; alasan.push(`${errorCount} dari ${total} request ke server gagal (${Math.round(errorRate * 100)}%) dalam ${WINDOW_MENIT} menit terakhir`)
  } else if (p95Latency > 6000) {
    status = 'KRITIS'; alasan.push(`Respons server sangat lambat (p95: ${p95Latency}ms)`)
  } else if (dbResponseMs > 1000) {
    status = 'BERAT'; alasan.push(`Koneksi database lambat (${dbResponseMs}ms)`)
  } else if (total >= 3 && errorRate >= 0.08) {
    status = 'BERAT'; alasan.push(`${errorCount} dari ${total} request gagal (${Math.round(errorRate * 100)}%)`)
  } else if (p95Latency > 2500) {
    status = 'BERAT'; alasan.push(`Respons server lambat (p95: ${p95Latency}ms)`)
  } else if (dbResponseMs > 400) {
    status = 'WASPADA'; alasan.push(`Koneksi database mulai lambat (${dbResponseMs}ms)`)
  } else if (total > 0 && errorCount > 0) {
    status = 'WASPADA'; alasan.push(`Ada ${errorCount} request gagal dalam ${WINDOW_MENIT} menit terakhir`)
  } else if (p95Latency > 1000) {
    status = 'WASPADA'; alasan.push(`Respons server mulai lambat (p95: ${p95Latency}ms)`)
  } else if (total > 0) {
    status = 'NORMAL'
  }
  // else: tidak ada traffic sama sekali & DB ping cepat → tetap AMAN

  return {
    status,
    alasan,
    totalRequest: total,
    errorCount,
    errorRatePersen: Math.round(errorRate * 1000) / 10,
    avgLatencyMs: avgLatency,
    p95LatencyMs: p95Latency,
    dbResponseMs,
    perEndpoint,
  }
}

// Kelompokkan baris metrik_sistem jadi bucket per N menit untuk grafik
// riwayat yang PERSISTEN (tersimpan di database, bukan cuma di memori
// browser admin — jadi tidak hilang saat panel di-refresh/ditutup).
export function bucketHistori(barisSemua: Baris[], now: number) {
  const jumlahBucket = Math.floor(JENDELA_HISTORI_MENIT / UKURAN_BUCKET_MENIT)
  const bucketMs = UKURAN_BUCKET_MENIT * 60 * 1000
  const awalJendela = now - JENDELA_HISTORI_MENIT * 60 * 1000

  const buckets = Array.from({ length: jumlahBucket }, (_, i) => ({
    mulai: new Date(awalJendela + i * bucketMs).toISOString(),
    total: 0,
    error: 0,
    durasiList: [] as number[],
  }))

  for (const b of barisSemua) {
    const t = new Date(b.created_at).getTime()
    if (t < awalJendela) continue
    const idx = Math.min(jumlahBucket - 1, Math.floor((t - awalJendela) / bucketMs))
    if (idx < 0) continue
    buckets[idx].total += 1
    if (b.status === 'error') buckets[idx].error += 1
    buckets[idx].durasiList.push(b.durasi_ms)
  }

  return buckets.map(bk => ({
    mulai: bk.mulai,
    total: bk.total,
    errorRatePersen: bk.total ? Math.round((bk.error / bk.total) * 1000) / 10 : 0,
    avgLatencyMs: bk.durasiList.length ? Math.round(bk.durasiList.reduce((a, b2) => a + b2, 0) / bk.durasiList.length) : 0,
  }))
}
// ─────────────────────────────────────────────────────────────────────────

