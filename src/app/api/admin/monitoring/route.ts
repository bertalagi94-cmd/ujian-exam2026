import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  const db = createAdminClient()
  const now = new Date()
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0)
  const fiveMinsAgo = new Date(now.getTime() - 5 * 60 * 1000)

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
  ])

  const dbResponseMs = Date.now() - dbStart

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
  const score = Math.min(
    100,
    Math.round(
      (sesiCount / 20) * 40 +
      ((aktifitas5Menit ?? 0) / 100) * 30 +
      ((pelanggaranHariIni ?? 0) / 5) * 30
    )
  )

  const status =
    score >= 80 ? 'KRITIS' :
    score >= 60 ? 'BERAT' :
    score >= 40 ? 'WASPADA' :
    score >= 20 ? 'NORMAL' : 'AMAN'

  const maintenanceAktif =
    maintenanceRow?.value === 'true' || maintenanceRow?.value === '1'

  return NextResponse.json({
    server: {
      status,
      score,
      dbResponseMs,
      timestamp: now.toISOString(),
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
