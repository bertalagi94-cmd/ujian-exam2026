import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// ── Status "Server" NYATA ────────────────────────────────────────────────
// FIX ARSITEKTUR (pemisahan "Status Server" vs "Beban Ujian"): sebelumnya
// SATU angka `score` dipakai untuk status AMAN/NORMAL/WASPADA/BERAT/KRITIS,
// dihitung dari jumlah sesi aktif + aktivitas 5 menit + pelanggaran hari ini
// — itu skor KESIBUKAN ujian, bukan KESEHATAN server. Server bisa saja
// benar-benar down/lambat sementara skor itu tetap rendah kalau kebetulan
// sedang sepi sesi ujian, dan sebaliknya bisa "KRITIS" padahal server
// sehat-sehat saja, cuma lagi banyak sesi.
//
// Sekarang dipisah jadi dua hal berbeda di response:
//   - `server` : status NYATA dari error rate & latensi endpoint kritis
//                (login, validasi_ujian, sync_jawaban) dalam 5 menit
//                terakhir — lihat metrik_sistem (src/lib/metrik.ts) — PLUS
//                live DB ping (dbResponseMs) dari request admin ini sendiri.
//                Inilah yang harus dicek admin saat pengawas lapor
//                "siswa tidak bisa masuk" / "jawaban lambat".
//   - `bebanUjian` : skor lama (jumlah sesi aktif dkk), sekarang dilabeli
//                eksplisit sebagai ukuran KESIBUKAN, bukan kesehatan.
const WINDOW_MENIT = 5
const JENDELA_HISTORI_MENIT = 60
const UKURAN_BUCKET_MENIT = 5

interface Baris { endpoint: string; status: string; durasi_ms: number; created_at: string }

function hitungP95(nilai: number[]): number {
  if (nilai.length === 0) return 0
  const sorted = [...nilai].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

// Hitung status server NYATA dari baris metrik_sistem dalam window terakhir,
// plus latensi live DB ping request admin ini sendiri.
function hitungStatusServer(barisWindow: Baris[], dbResponseMs: number) {
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
function bucketHistori(barisSemua: Baris[], now: number) {
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

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const now = new Date()
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0)
  const fiveMinsAgo = new Date(now.getTime() - 5 * 60 * 1000)
  const windowServerAwal = new Date(now.getTime() - WINDOW_MENIT * 60 * 1000)
  const historiAwal = new Date(now.getTime() - JENDELA_HISTORI_MENIT * 60 * 1000)

  const dbStart = Date.now()

  // FIX (siswa "Mengerjakan" tidak diverifikasi terhadap sesi yang masih
  // BERJALAN): sebelumnya siswaAktifMengerjakan dihitung murni dari
  // `siswa_ujian.status = 'AKTIF'` TANPA pernah menghubungkan ke
  // sesi_ujian.status. Dalam kondisi normal kedua penutupan sesi yang ada
  // (guru/mode-pengawas/tutup & admin/sesi/[id]/tutup-paksa) SELALU mengubah
  // siswa_ujian AKTIF/RESET → SELESAI di baris yang sama saat sesi ditutup,
  // jadi biasanya konsisten — TAPI kalau salah satu update itu gagal (lihat
  // FIX di tutup-paksa/route.ts & finalisasi-nilai.ts, yang sebelumnya
  // tidak memeriksa error sama sekali), siswa_ujian bisa tertinggal
  // berstatus AKTIF selamanya walau sesinya sudah SELESAI — dan angka ini
  // akan diam-diam ikut menghitungnya sebagai "sedang mengerjakan".
  // Sekarang sesi BERJALAN diambil LEBIH DULU (sequential, di luar
  // Promise.all di bawah), lalu id-nya dipakai sebagai filter eksplisit
  // (`in('sesi_id', ...)`) untuk siswaAktifMengerjakan, supaya angka ini
  // benar-benar berarti "siswa AKTIF pada sesi yang BENAR-BENAR masih
  // BERJALAN", bukan cuma "baris AKTIF di tabel siswa_ujian".
  const { data: sesiAktifRaw } = await db
    .from('sesi_ujian')
    // FIX: tambahkan kolom `durasi` (durasi normal ujian dalam menit) —
    // dipakai front-end untuk menandai sesi yang sudah BERJALAN jauh lebih
    // lama dari durasi seharusnya (kemungkinan lupa/tidak ditutup pengawas),
    // supaya admin tahu sesi mana yang perlu ditutup paksa.
    .select('id, kelas, mapel_id, waktu_mulai, jumlah_peserta, durasi')
    .eq('status', 'BERJALAN')
    .order('waktu_mulai', { ascending: false })

  const sesiIdsBerjalan = (sesiAktifRaw ?? []).map((s: { id: string }) => s.id)

  const siswaAktifQuery = sesiIdsBerjalan.length
    ? db.from('siswa_ujian')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'AKTIF')
        .in('sesi_id', sesiIdsBerjalan)
    : Promise.resolve({ count: 0, data: null, error: null })

  const [
    { data: logs },
    { data: pelanggaranRaw },
    { count: loginHariIni },
    { count: aktifitas5Menit },
    { count: pelanggaranHariIni },
    // Poin 1: Nama mapel
    { data: mapelList },
    // Poin 3: Nama siswa di pelanggaran
    { data: siswaList },
    // Poin 5: Jumlah siswa sedang aktif mengerjakan (sudah difilter ke sesi
    // BERJALAN — lihat komentar FIX di atas)
    { count: siswaAktifMengerjakan },
    // Poin 6: Submit hari ini
    // FIX (sumber data beda dengan daftar Submit): sebelumnya dihitung dari
    // `siswa_ujian.waktu_selesai`, sedangkan endpoint daftar
    // (/api/admin/monitoring/daftar?jenis=submit) mengambil dari tabel
    // `nilai.timestamp` — dua sumber berbeda yang bisa memberi angka
    // berbeda (mis. untuk sesi ber-essay, waktu_selesai baru terisi saat
    // essay dikirim, padahal baris `nilai` sudah ada lebih dulu sejak PG
    // selesai). Disamakan: keduanya sekarang dari `nilai.timestamp`, supaya
    // angka ringkasan dan daftar yang muncul saat diklik selalu konsisten.
    { count: submitHariIni },
    // Poin 8: Maintenance mode
    { data: maintenanceRow },
    // FIX (status Server nyata): baris metrik_sistem 60 menit terakhir —
    // dipakai untuk hitung status window 5-menit terakhir (subset dari data
    // ini, difilter di JS, bukan query terpisah) SEKALIGUS untuk bucket
    // histori grafik, jadi cukup satu query.
    { data: metrikRaw },
  ] = await Promise.all([
    db.from('log_aktivitas')
      .select('id, user_id, aksi, detail, created_at')
      .order('created_at', { ascending: false })
      .limit(30),
    db.from('pelanggaran')
      .select('id, nis, jenis, created_at')
      .gte('created_at', startOfDay.toISOString())
      .order('created_at', { ascending: false })
      .limit(10),
    db.from('log_aktivitas')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfDay.toISOString())
      .eq('aksi', 'LOGIN'),
    db.from('log_aktivitas')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', fiveMinsAgo.toISOString()),
    db.from('pelanggaran')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfDay.toISOString()),
    db.from('mapel').select('id, nama'),
    db.from('siswa').select('nis, nama'),
    siswaAktifQuery,
    db.from('nilai')
      .select('id', { count: 'exact', head: true })
      .gte('timestamp', startOfDay.toISOString()),
    db.from('pengaturan')
      .select('value')
      .eq('key', 'maintenanceAktif')
      .maybeSingle(),
    db.from('metrik_sistem')
      .select('endpoint, status, durasi_ms, created_at')
      .gte('created_at', historiAwal.toISOString())
      .order('created_at', { ascending: false })
      .limit(5000),
  ])

  const dbResponseMs = Date.now() - dbStart

  // Status server NYATA: subset metrikRaw yang jatuh di window 5 menit
  // terakhir (WINDOW_MENIT), dihitung di JS supaya tidak perlu query kedua.
  const metrikSemua: Baris[] = metrikRaw ?? []
  const metrikWindow = metrikSemua.filter(b => new Date(b.created_at).getTime() >= windowServerAwal.getTime())
  const statusServer = hitungStatusServer(metrikWindow, dbResponseMs)
  const historiServer = bucketHistori(metrikSemua, now.getTime())

  // Map mapel_id → nama mapel
  const mapelMap: Record<string, string> = {}
  if (mapelList) {
    for (const m of mapelList) mapelMap[m.id] = m.nama
  }

  // Map nis → nama siswa
  const siswaMap: Record<string, string> = {}
  if (siswaList) {
    for (const s of siswaList) siswaMap[s.nis] = s.nama
  }

  // Enriched sesiAktif: tambahkan nama mapel + durasi berjalan
  // FIX: tambahkan `terlambat` — true kalau sesi sudah berjalan lebih dari
  // (durasi seharusnya + 30 menit toleransi), indikasi kuat sesi ini
  // lupa/tidak ditutup pengawas. Dipakai front-end untuk menyorot sesi ini
  // dan menawarkan tombol "Tutup Paksa".
  const sesiAktif = (sesiAktifRaw ?? []).map((s: { id: string; kelas: string; mapel_id: string; waktu_mulai: string; jumlah_peserta: number; durasi: number | null }) => {
    const durasiMenit = Math.floor((now.getTime() - new Date(s.waktu_mulai).getTime()) / 60000)
    const durasiSeharusnya = s.durasi ?? 0
    return {
      ...s,
      nama_mapel: mapelMap[s.mapel_id] ?? s.mapel_id,
      durasi_menit: durasiMenit,
      durasi_seharusnya: durasiSeharusnya,
      terlambat: durasiSeharusnya > 0 && durasiMenit > durasiSeharusnya + 30,
    }
  })

  // Enriched pelanggaran: tambahkan nama siswa
  const pelanggaran = (pelanggaranRaw ?? []).map((p: { id: string; nis: string; jenis: string; created_at: string }) => ({
    ...p,
    nama_siswa: siswaMap[p.nis] ?? p.nis,
  }))

  // FIX: sesiUjianAktif sekarang diturunkan dari sesiAktifRaw yang sudah
  // diambil di atas (bukan query `count` terpisah lagi) — data sumbernya
  // identik (sama-sama `sesi_ujian.status = 'BERJALAN'`), jadi menghitung
  // ulang dengan query kedua hanya menambah round-trip tanpa manfaat, dan
  // berisiko sedikit tidak sinkron kalau ada sesi yang berubah status
  // PERSIS di antara kedua query (walau jendelanya sangat kecil).
  const sesiCount = sesiIdsBerjalan.length

  // FIX (dipisah dari status Server): ini skor KESIBUKAN ujian (jumlah sesi,
  // aktivitas, pelanggaran) — BUKAN kesehatan server. Dulu dipakai sebagai
  // status "Server" yang menyesatkan; sekarang eksplisit dinamai bebanUjian.
  // Label AMAN..KRITIS di sini artinya "seberapa sibuk", bukan "seberapa sehat".
  const skorBebanUjian = Math.min(
    100,
    Math.round(
      (sesiCount / 20) * 40 +
      ((aktifitas5Menit ?? 0) / 100) * 30 +
      ((pelanggaranHariIni ?? 0) / 5) * 30
    )
  )

  const labelBebanUjian =
    skorBebanUjian >= 80 ? 'SANGAT_SIBUK' :
    skorBebanUjian >= 60 ? 'SIBUK' :
    skorBebanUjian >= 40 ? 'RAMAI' :
    skorBebanUjian >= 20 ? 'NORMAL' : 'SEPI'

  const maintenanceAktif =
    maintenanceRow?.value === 'true' || maintenanceRow?.value === '1'

  return NextResponse.json({
    // FIX: status Server sekarang NYATA — dari error rate & latensi
    // endpoint kritis (login, validasi_ujian, sync_jawaban) dalam
    // WINDOW_MENIT terakhir + live DB ping. Inilah yang dicek admin saat
    // pengawas lapor "siswa tidak bisa masuk" / "jawaban lambat".
    server: {
      ...statusServer,
      windowMenit: WINDOW_MENIT,
      timestamp: now.toISOString(),
    },
    // Riwayat status server per 5 menit, 1 jam terakhir — tersimpan di
    // database (metrik_sistem), jadi TIDAK hilang saat panel di-refresh.
    historiServer,
    // Skor kesibukan ujian (dulu bernama "server"/"score") — dipisah biar
    // tidak lagi bercampur dengan kesehatan server.
    bebanUjian: {
      skor: skorBebanUjian,
      label: labelBebanUjian,
    },
    aktivitas: {
      loginHariIni: loginHariIni ?? 0,
      aktifitas5MenitTerakhir: aktifitas5Menit ?? 0,
      sesiUjianAktif: sesiCount,
      pelanggaranHariIni: pelanggaranHariIni ?? 0,
      // Poin 5 & 6
      siswaAktifMengerjakan: siswaAktifMengerjakan ?? 0,
      submitHariIni: submitHariIni ?? 0,
    },
    logs: logs ?? [],
    sesiAktif,          // enriched: + nama_mapel, durasi_menit
    pelanggaran,        // enriched: + nama_siswa
    maintenanceAktif,   // Poin 8
  })
}
