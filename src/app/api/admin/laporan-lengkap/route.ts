import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { cachedFetch } from '@/lib/cache'

// =============================================================================
// GET /api/admin/laporan-lengkap
//
// Laporan lengkap admin: satu baris per kombinasi Mapel + Kelas, dipecah jadi
// 3 seksi mengikuti siklus ujian — Pra Ujian, Saat Ujian, Setelah Ujian — lalu
// dikelompokkan per SEKOLAH/JENJANG (tabel `sekolah`, direlasikan lewat
// `kelas.sekolah_id`) supaya data antar jenjang tidak pernah tercampur.
//
// CATATAN PENTING soal kunci relasi (supaya tidak salah tempel data):
// - `paket_soal.kelas_id` dan `kisi_kisi.kelas_id` merujuk ke `kelas.id`.
// - `jadwal.kelas`, `sesi_ujian.kelas`, `nilai.kelas`, `siswa.kelas` menyimpan
//   NAMA kelas (teks), bukan id.
// - `mapel.kelas_list` juga menyimpan nama kelas (koma-dipisah), sama seperti
//   yang dipakai di api/admin/mapel/route.ts.
// Karena itu setiap kombinasi mapel+kelas di bawah punya DUA kunci gabungan:
//   keyId   = `${mapelId}::${kelasId}`   -> untuk paket_soal & kisi_kisi
//   keyNama = `${mapelId}::${namaKelas}` -> untuk jadwal, sesi_ujian, nilai
//
// `kelas_mapel.status` SENGAJA tidak dipakai sebagai indikator "siklus
// selesai" — baris ini tidak lagi dibuat untuk jadwal yang dibuat lewat alur
// normal (lihat catatan di api/guru/wali-kelas/route.ts), jadi datanya bisa
// basi/kosong. Status selesai/belum di laporan ini diturunkan langsung dari
// `jadwal.status`.
// =============================================================================

interface SekolahRow {
  id: string
  label: string
  nama_sekolah: string
  npsn: string | null
  nama_kepsek: string | null
  nip_kepsek: string | null
  alamat: string | null
  kota: string | null
  tahun_ajaran: string | null
  logo_url: string | null
  urutan: number | null
}

interface KelasRow {
  id: string
  nama: string
  sekolah_id: string | null
}

interface MapelRow {
  id: string
  nama: string
  guru_id: string | null
  kelas_list: string | null
  kkm: number | null
}

function parseKelasList(kelasList: string | null | undefined): string[] {
  return (kelasList ?? '').split(',').map(s => s.trim()).filter(Boolean)
}

function safeIn<T>(arr: T[]): T[] {
  // Supabase .in() dengan array kosong bisa berperilaku aneh di beberapa versi —
  // ganti dengan nilai dummy yang pasti tidak match (pola yang sama dipakai
  // di beberapa route lain di app ini, mis. api/admin/cetak/route.ts).
  return arr.length ? arr : (['__none__'] as unknown as T[])
}

async function fetchLaporanLengkap() {
  const db = createAdminClient()

  // ── 1. Data master (sekolah, kelas, mapel, guru) ──────────────────────────
  const [
    { data: sekolahList },
    { data: kelasList },
    { data: mapelList },
  ] = await Promise.all([
    db.from('sekolah').select('*').order('urutan').order('created_at'),
    db.from('kelas').select('id, nama, sekolah_id'),
    db.from('mapel').select('id, nama, guru_id, kelas_list, kkm').order('nama'),
  ])

  const sekolahRows = (sekolahList ?? []) as SekolahRow[]
  const kelasRows = (kelasList ?? []) as KelasRow[]
  const mapelRows = (mapelList ?? []) as MapelRow[]

  // Peta kelas: by id (untuk paket_soal/kisi_kisi) & by nama (untuk sisanya).
  // Kalau ada nama kelas yang kebetulan sama di jenjang berbeda, baris kelas
  // yang paling akhir di-index yang dipakai — ini keterbatasan bawaan skema
  // (kelas_list/jadwal/nilai memang menyimpan nama kelas, bukan id), bukan
  // sesuatu yang bisa diperbaiki dari sisi laporan ini saja.
  const kelasById = new Map<string, KelasRow>()
  const kelasByNama = new Map<string, KelasRow>()
  for (const k of kelasRows) {
    kelasById.set(k.id, k)
    kelasByNama.set(k.nama, k)
  }

  const guruIdsFromMapel = [...new Set(mapelRows.map(m => m.guru_id).filter(Boolean))] as string[]

  // ── 2. Bangun daftar kombinasi Mapel + Kelas ──────────────────────────────
  interface Combo {
    mapelId: string
    namaMapel: string
    guruId: string | null
    kelasId: string
    namaKelas: string
    sekolahId: string | null
    keyId: string
    keyNama: string
  }
  const combos: Combo[] = []
  for (const m of mapelRows) {
    const namaKelasList = parseKelasList(m.kelas_list)
    for (const namaKelas of namaKelasList) {
      const kelasRow = kelasByNama.get(namaKelas)
      if (!kelasRow) continue // kelas sudah dihapus tapi masih tercatat di kelas_list mapel — lewati
      combos.push({
        mapelId: m.id,
        namaMapel: m.nama,
        guruId: m.guru_id,
        kelasId: kelasRow.id,
        namaKelas,
        sekolahId: kelasRow.sekolah_id,
        keyId: `${m.id}::${kelasRow.id}`,
        keyNama: `${m.id}::${namaKelas}`,
      })
    }
  }

  if (combos.length === 0) {
    return { generatedAt: new Date().toISOString(), sekolahTanpaData: sekolahRows.map(s => ({
      id: s.id, label: s.label, namaSekolah: s.nama_sekolah,
    })), data: [] }
  }

  const mapelIdsAll = [...new Set(combos.map(c => c.mapelId))]
  const kelasIdsAll = [...new Set(combos.map(c => c.kelasId))]
  const namaKelasAll = [...new Set(combos.map(c => c.namaKelas))]

  // ── 3. PRA UJIAN: paket_soal + soal (distribusi tingkat) + kisi_kisi + jadwal ──
  const [
    { data: paketRows },
    { data: kisiRows },
    { data: jadwalRows },
  ] = await Promise.all([
    db.from('paket_soal')
      .select('id, mapel_id, kelas_id, guru_id, status, catatan, jumlah_soal, tanggal, created_at')
      .in('mapel_id', safeIn(mapelIdsAll))
      .in('kelas_id', safeIn(kelasIdsAll)),
    db.from('kisi_kisi')
      .select('mapel_id, kelas_id, status, updated_at')
      .in('mapel_id', safeIn(mapelIdsAll))
      .in('kelas_id', safeIn(kelasIdsAll)),
    db.from('jadwal')
      .select('id, tanggal, sesi, jam_mulai, jam_selesai, mapel_id, kelas, pengawas, durasi, status')
      .in('mapel_id', safeIn(mapelIdsAll))
      .in('kelas', safeIn(namaKelasAll))
      .order('tanggal'),
  ])

  type PaketRow = { id: string; mapel_id: string; kelas_id: string; guru_id: string | null; status: string; catatan: string | null; jumlah_soal: number; tanggal: string; created_at: string }
  const paketList = (paketRows ?? []) as PaketRow[]

  // Distribusi tingkat soal — query soal HANYA untuk paket_id yang relevan di atas,
  // pakai index idx_soal_paket. Safety limit sama seperti route lain di app ini.
  const paketIds = paketList.map(p => p.id)
  const { data: soalTingkatRows } = paketIds.length
    ? await db.from('soal').select('paket_id, tingkat').in('paket_id', safeIn(paketIds)).limit(20000)
    : { data: [] as { paket_id: string; tingkat: string }[] }

  const tingkatByPaket = new Map<string, { mudah: number; sedang: number; sukar: number }>()
  for (const s of (soalTingkatRows ?? []) as { paket_id: string; tingkat: string }[]) {
    if (!s.paket_id) continue
    if (!tingkatByPaket.has(s.paket_id)) tingkatByPaket.set(s.paket_id, { mudah: 0, sedang: 0, sukar: 0 })
    const bucket = tingkatByPaket.get(s.paket_id)!
    const t = (s.tingkat ?? 'Sedang').toLowerCase()
    if (t === 'mudah') bucket.mudah++
    else if (t === 'sukar') bucket.sukar++
    else bucket.sedang++
  }

  // Gabungkan (bisa lebih dari 1 baris paket_soal per kombinasi mapel+kelas,
  // mis. karena revisi/duplikasi) — pakai yang PALING BARU untuk status &
  // catatan, tapi JUMLAH soal & distribusi tingkat dijumlahkan dari semua paket.
  interface PraPaket {
    statusSoal: string
    jumlahSoal: number
    distribusi: { mudah: number; sedang: number; sukar: number }
    catatanPenolakan: string | null
    tanggalTerbaru: string
  }
  const praPaketMap = new Map<string, PraPaket>()
  for (const p of paketList) {
    const key = `${p.mapel_id}::${p.kelas_id}`
    const dist = tingkatByPaket.get(p.id) ?? { mudah: 0, sedang: 0, sukar: 0 }
    const existing = praPaketMap.get(key)
    if (!existing) {
      praPaketMap.set(key, {
        statusSoal: p.status,
        jumlahSoal: p.jumlah_soal ?? 0,
        distribusi: { ...dist },
        catatanPenolakan: p.status === 'DITOLAK' ? (p.catatan ?? null) : null,
        tanggalTerbaru: p.tanggal ?? p.created_at,
      })
      continue
    }
    existing.jumlahSoal += p.jumlah_soal ?? 0
    existing.distribusi.mudah += dist.mudah
    existing.distribusi.sedang += dist.sedang
    existing.distribusi.sukar += dist.sukar
    const tanggalP = p.tanggal ?? p.created_at
    if (tanggalP > (existing.tanggalTerbaru ?? '')) {
      existing.statusSoal = p.status
      existing.catatanPenolakan = p.status === 'DITOLAK' ? (p.catatan ?? null) : null
      existing.tanggalTerbaru = tanggalP
    }
  }

  type KisiRow = { mapel_id: string; kelas_id: string; status: string; updated_at: string }
  const kisiMap = new Map<string, KisiRow>()
  for (const k of (kisiRows ?? []) as KisiRow[]) {
    const key = `${k.mapel_id}::${k.kelas_id}`
    const existing = kisiMap.get(key)
    if (!existing || k.updated_at > existing.updated_at) kisiMap.set(key, k)
  }

  type JadwalRow = { id: string; tanggal: string; sesi: number; jam_mulai: string; jam_selesai: string; mapel_id: string; kelas: string; pengawas: string | null; durasi: number; status: string }
  const jadwalList = (jadwalRows ?? []) as JadwalRow[]
  const jadwalMap = new Map<string, JadwalRow[]>()
  for (const j of jadwalList) {
    const key = `${j.mapel_id}::${j.kelas}`
    if (!jadwalMap.has(key)) jadwalMap.set(key, [])
    jadwalMap.get(key)!.push(j)
  }

  // ── 4. SAAT UJIAN: sesi_ujian + siswa_ujian + pelanggaran + siswa aktif ───
  const { data: sesiRows } = await db
    .from('sesi_ujian')
    .select('id, mapel_id, kelas, status, jumlah_peserta')
    .in('mapel_id', safeIn(mapelIdsAll))
    .in('kelas', safeIn(namaKelasAll))

  type SesiRow = { id: string; mapel_id: string; kelas: string; status: string; jumlah_peserta: number }
  const sesiList = (sesiRows ?? []) as SesiRow[]
  const sesiMap = new Map<string, SesiRow[]>()
  for (const s of sesiList) {
    const key = `${s.mapel_id}::${s.kelas}`
    if (!sesiMap.has(key)) sesiMap.set(key, [])
    sesiMap.get(key)!.push(s)
  }

  const sesiIds = sesiList.map(s => s.id)

  const [{ data: siswaUjianRows }, { data: pelanggaranRows }] = await Promise.all([
    sesiIds.length
      ? db.from('siswa_ujian').select('sesi_id, status').in('sesi_id', safeIn(sesiIds)).limit(50000)
      : Promise.resolve({ data: [] as { sesi_id: string; status: string }[] }),
    sesiIds.length
      ? db.from('pelanggaran').select('sesi_id, status').in('sesi_id', safeIn(sesiIds)).limit(50000)
      : Promise.resolve({ data: [] as { sesi_id: string; status: string }[] }),
  ])

  const siswaUjianBySesi = new Map<string, { total: number; selesai: number }>()
  for (const su of (siswaUjianRows ?? []) as { sesi_id: string; status: string }[]) {
    if (!siswaUjianBySesi.has(su.sesi_id)) siswaUjianBySesi.set(su.sesi_id, { total: 0, selesai: 0 })
    const b = siswaUjianBySesi.get(su.sesi_id)!
    b.total++
    if (su.status === 'SELESAI') b.selesai++
  }

  const pelanggaranBySesi = new Map<string, { total: number; belum: number }>()
  for (const p of (pelanggaranRows ?? []) as { sesi_id: string; status: string }[]) {
    if (!pelanggaranBySesi.has(p.sesi_id)) pelanggaranBySesi.set(p.sesi_id, { total: 0, belum: 0 })
    const b = pelanggaranBySesi.get(p.sesi_id)!
    b.total++
    if (p.status === 'BELUM_DITINDAKLANJUTI') b.belum++
  }

  // Total siswa aktif per NAMA kelas (siswa non-tester, status AKTIF) — untuk persentase progres
  const { data: siswaAktifRows } = await db
    .from('siswa')
    .select('kelas')
    .in('kelas', safeIn(namaKelasAll))
    .eq('status', 'AKTIF')
    .neq('is_tester', 'YES')
  const totalSiswaByKelas = new Map<string, number>()
  for (const s of (siswaAktifRows ?? []) as { kelas: string }[]) {
    totalSiswaByKelas.set(s.kelas, (totalSiswaByKelas.get(s.kelas) ?? 0) + 1)
  }

  // ── 5. SETELAH UJIAN: nilai ────────────────────────────────────────────────
  const { data: nilaiRows } = await db
    .from('nilai')
    .select('mapel_id, kelas, nilai, lulus, dikirim_ke_wali, dikembalikan')
    .in('mapel_id', safeIn(mapelIdsAll))
    .in('kelas', safeIn(namaKelasAll))

  type NilaiRow = { mapel_id: string; kelas: string; nilai: number; lulus: boolean; dikirim_ke_wali: boolean; dikembalikan: boolean }
  const nilaiAggMap = new Map<string, { total: number; sumNilai: number; lulus: number; tidakLulus: number; dikirimWali: number; dikembalikan: boolean }>()
  for (const n of (nilaiRows ?? []) as NilaiRow[]) {
    const key = `${n.mapel_id}::${n.kelas}`
    if (!nilaiAggMap.has(key)) {
      nilaiAggMap.set(key, { total: 0, sumNilai: 0, lulus: 0, tidakLulus: 0, dikirimWali: 0, dikembalikan: false })
    }
    const b = nilaiAggMap.get(key)!
    b.total++
    b.sumNilai += Number(n.nilai ?? 0)
    if (n.lulus) b.lulus++
    else b.tidakLulus++
    if (n.dikirim_ke_wali) b.dikirimWali++
    if (n.dikembalikan) b.dikembalikan = true
  }

  // ── 6. Nama guru & pengawas (satu batch query untuk semua username terkait) ──
  const pengawasIds = [...new Set(jadwalList.map(j => j.pengawas).filter(Boolean))] as string[]
  const semuaUsername = [...new Set([...guruIdsFromMapel, ...pengawasIds])]
  const { data: userRows } = semuaUsername.length
    ? await db.from('users').select('username, nama').in('username', safeIn(semuaUsername))
    : { data: [] as { username: string; nama: string }[] }
  const namaUserMap = Object.fromEntries(
    ((userRows ?? []) as { username: string; nama: string }[]).map(u => [u.username, u.nama])
  )

  // ── 7. Rakit hasil akhir, dikelompokkan per sekolah/jenjang ───────────────
  interface RowLaporan {
    mapelId: string
    namaMapel: string
    namaGuru: string
    kelasId: string
    namaKelas: string
    pra: {
      statusSoal: string
      jumlahSoal: number
      distribusi: { mudah: number; sedang: number; sukar: number }
      catatanPenolakan: string | null
      statusKisiKisi: string
      jadwal: { tanggal: string; sesi: number; jamMulai: string; jamSelesai: string; namaPengawas: string; durasi: number; statusJadwal: string }[]
    }
    saat: {
      adaSesiBerjalan: boolean
      totalSiswaKelas: number
      siswaTerdaftar: number
      siswaSelesai: number
      pelanggaranBelumDitindak: number
    }
    setelah: {
      adaJadwalSelesai: boolean
      totalNilai: number
      rataRata: number
      jumlahLulus: number
      jumlahTidakLulus: number
      sudahDikirimWali: number
      adaDikembalikan: boolean
      pelanggaranFinal: number
    }
  }

  const bySekolah = new Map<string, { sekolah: SekolahRow | null; rows: RowLaporan[] }>()

  for (const c of combos) {
    const skKey = c.sekolahId ?? '__tanpa_jenjang__'
    if (!bySekolah.has(skKey)) {
      const sekolahRow = c.sekolahId ? (sekolahRows.find(s => s.id === c.sekolahId) ?? null) : null
      bySekolah.set(skKey, { sekolah: sekolahRow, rows: [] })
    }

    const pra = praPaketMap.get(c.keyId)
    const kisi = kisiMap.get(c.keyId)
    const jadwalCombo = jadwalMap.get(c.keyNama) ?? []
    const sesiCombo = sesiMap.get(c.keyNama) ?? []
    const nilaiAgg = nilaiAggMap.get(c.keyNama)

    let siswaTerdaftar = 0, siswaSelesai = 0, pelanggaranBelum = 0, pelanggaranFinal = 0
    let adaSesiBerjalan = false
    for (const s of sesiCombo) {
      const su = siswaUjianBySesi.get(s.id)
      if (su) { siswaTerdaftar += su.total; siswaSelesai += su.selesai }
      const pl = pelanggaranBySesi.get(s.id)
      if (pl) { pelanggaranBelum += pl.belum; pelanggaranFinal += pl.total }
      if (s.status === 'BERJALAN') adaSesiBerjalan = true
    }

    const row: RowLaporan = {
      mapelId: c.mapelId,
      namaMapel: c.namaMapel,
      namaGuru: c.guruId ? (namaUserMap[c.guruId] ?? c.guruId) : '-',
      kelasId: c.kelasId,
      namaKelas: c.namaKelas,
      pra: {
        statusSoal: pra?.statusSoal ?? 'BELUM_DIBUAT',
        jumlahSoal: pra?.jumlahSoal ?? 0,
        distribusi: pra?.distribusi ?? { mudah: 0, sedang: 0, sukar: 0 },
        catatanPenolakan: pra?.catatanPenolakan ?? null,
        statusKisiKisi: kisi?.status ?? 'BELUM_DIBUAT',
        jadwal: jadwalCombo
          .sort((a, b) => a.tanggal.localeCompare(b.tanggal))
          .map(j => ({
            tanggal: j.tanggal,
            sesi: j.sesi,
            jamMulai: j.jam_mulai,
            jamSelesai: j.jam_selesai,
            namaPengawas: j.pengawas ? (namaUserMap[j.pengawas] ?? j.pengawas) : '-',
            durasi: j.durasi,
            statusJadwal: j.status,
          })),
      },
      saat: {
        adaSesiBerjalan,
        totalSiswaKelas: totalSiswaByKelas.get(c.namaKelas) ?? 0,
        siswaTerdaftar,
        siswaSelesai,
        pelanggaranBelumDitindak: pelanggaranBelum,
      },
      setelah: {
        adaJadwalSelesai: jadwalCombo.some(j => j.status === 'SELESAI'),
        totalNilai: nilaiAgg?.total ?? 0,
        rataRata: nilaiAgg && nilaiAgg.total > 0 ? Math.round((nilaiAgg.sumNilai / nilaiAgg.total) * 100) / 100 : 0,
        jumlahLulus: nilaiAgg?.lulus ?? 0,
        jumlahTidakLulus: nilaiAgg?.tidakLulus ?? 0,
        sudahDikirimWali: nilaiAgg?.dikirimWali ?? 0,
        adaDikembalikan: nilaiAgg?.dikembalikan ?? false,
        pelanggaranFinal,
      },
    }

    bySekolah.get(skKey)!.rows.push(row)
  }

  const data = [...bySekolah.values()]
    .map(({ sekolah, rows }) => ({
      sekolahId: sekolah?.id ?? null,
      label: sekolah?.label ?? 'Belum Diatur',
      namaSekolah: sekolah?.nama_sekolah ?? 'Kelas Belum Diatur Jenjangnya',
      npsn: sekolah?.npsn ?? '',
      namaKepsek: sekolah?.nama_kepsek ?? '',
      nipKepsek: sekolah?.nip_kepsek ?? '',
      alamat: sekolah?.alamat ?? '',
      kota: sekolah?.kota ?? '',
      tahunAjaran: sekolah?.tahun_ajaran ?? '',
      logoUrl: sekolah?.logo_url ?? '',
      urutan: sekolah?.urutan ?? 999999,
      rows: rows.sort((a, b) => a.namaMapel.localeCompare(b.namaMapel) || a.namaKelas.localeCompare(b.namaKelas)),
    }))
    .sort((a, b) => a.urutan - b.urutan)

  return { generatedAt: new Date().toISOString(), data }
}

export async function GET(req: NextRequest) {
  const auth = requireRole(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  try {
    // Cache singkat (20 dtk) — laporan ini berat (banyak query join), tapi
    // admin sering buka-tutup halaman/preview sebelum akhirnya klik download.
    const data = await cachedFetch('admin:laporan-lengkap', 20, fetchLaporanLengkap)
    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal memuat laporan'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
