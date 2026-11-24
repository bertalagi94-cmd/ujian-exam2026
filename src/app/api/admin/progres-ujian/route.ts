import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRoleAktif } from '@/lib/status-akun'
import { cachedFetch, cacheDelPrefix } from '@/lib/cache'
import { ambilSemuaBaris } from '@/lib/ambil-semua'
import { getZonaWaktuSekolah, tanggalHariIni, parseJadwalKeInstant } from '@/lib/pengaturan-waktu'
import { bangunPenyaringPeserta } from '@/lib/agama'

// =============================================================================
// GET /api/admin/progres-ujian   — data tab "Progres Ujian" di beranda admin
// PUT /api/admin/progres-ujian   — simpan "tanggal mulai periode ujian"
//
// GET hanya membaca. PUT hanya menulis satu kunci pengaturan (ujian_mulai_periode).
//
// SATUAN HITUNG diagram donat = satu kombinasi MAPEL + KELAS (sama seperti donat
// Progres Soal). Status satu mapel+kelas dirangkum dari ujian siswanya:
//   SELESAI      semua peserta sudah selesai
//   MENGERJAKAN  ada peserta yang sedang mengerjakan
//   TERKUNCI     ada peserta terkunci (dan tidak ada yang mengerjakan)
//   TIDAK_HADIR  ada peserta tidak hadir (perlu susulan)
//   BELUM_MULAI  selebihnya
// Angka per siswa (sedang ujian, perlu susulan, kelas tertinggal) tetap dihitung
// per "ujian siswa" = satu siswa pada satu jadwal, seperti di bawah ini.
//
// A) JADWAL YANG MASIH ADA (status AKTIF / BERJALAN / SELESAI)
//   penyebut  = untuk setiap jadwal, semua siswa AKTIF non-tester di kelas jadwal
//               itu, disaring agama untuk mapel khusus agama (aturan sama dgn
//               src/lib/agama.ts). Jadwal yang belum tiba ikut dihitung, jadi
//               100% = seluruh masa ujian tuntas.
//   status tiap ujian siswa (digabung dari SEMUA sesi milik jadwal itu —
//   reguler, susulan, ruang khusus — dengan prioritas):
//     SELESAI      siswa_ujian.status = SELESAI di sesi mana pun
//     MENGERJAKAN  siswa_ujian.status = AKTIF/RESET pada sesi yang BERJALAN
//     TERKUNCI     siswa_ujian.status = TERKUNCI (pelanggaran, belum dibuka)
//     TIDAK_HADIR  tidak punya hasil apa pun & jadwal sudah SELESAI -> perlu susulan
//     BELUM_MULAI  tidak punya hasil apa pun & jadwal belum selesai
//
// B) RIWAYAT: JADWAL YANG SUDAH DIHAPUS
//   Menu Jadwal punya tombol hapus jadwal SELESAI (hanya bila tidak ada siswa
//   yang belum ujian). Yang terhapus HANYA baris `jadwal`; `sesi_ujian` & `nilai`
//   tetap ada (lihat catatan cekSudahPernahDinilai di api/admin/jadwal). Tanpa
//   bagian ini ujian yang sudah selesai lalu dihapus akan hilang dari hitungan.
//   Sesi "yatim" (jadwal_id tidak lagi ada di tabel jadwal) dikelompokkan per
//   mapel+kelas; siswa yang punya nilai pada sesi itu dihitung SELESAI (dan
//   masuk penyebut). Kombinasi mapel+kelas yang masih punya jadwal hidup tidak
//   dihitung lagi di sini supaya tidak ganda.
//
// C) TANGGAL MULAI PERIODE (opsional, pengaturan `ujian_mulai_periode`)
//   Bila diisi, jadwal bertanggal sebelum itu dan sesi yang dimulai sebelum itu
//   tidak dihitung — supaya data simulasi/periode lama tidak ikut.
//
// Catatan skema: `siswa_ujian` & `nilai` dibaca lewat sesi_id dari `sesi_ujian`
// yang sudah ber-scope yayasan (tenantDb).
// =============================================================================

const KUNCI_MULAI = 'ujian_mulai_periode'
const FORMAT_TANGGAL = /^\d{4}-\d{2}-\d{2}$/

type StatusUjianSiswa = 'SELESAI' | 'MENGERJAKAN' | 'BELUM_MULAI' | 'TERKUNCI' | 'TIDAK_HADIR'

interface Hitungan {
  total: number
  selesai: number
  mengerjakan: number
  belumMulai: number
  terkunci: number
  tidakHadir: number
}

const kosong = (): Hitungan => ({ total: 0, selesai: 0, mengerjakan: 0, belumMulai: 0, terkunci: 0, tidakHadir: 0 })

function tambah(h: Hitungan, s: StatusUjianSiswa) {
  h.total++
  if (s === 'SELESAI') h.selesai++
  else if (s === 'MENGERJAKAN') h.mengerjakan++
  else if (s === 'TERKUNCI') h.terkunci++
  else if (s === 'TIDAK_HADIR') h.tidakHadir++
  else h.belumMulai++
}

function potong<T>(arr: T[], ukuran: number): T[][] {
  const hasil: T[][] = []
  for (let i = 0; i < arr.length; i += ukuran) hasil.push(arr.slice(i, i + ukuran))
  return hasil
}

// Prioritas status siswa_ujian bila satu siswa punya beberapa baris pada jadwal yang sama
// (mis. terkunci di sesi reguler lalu selesai di sesi susulan): yang terbesar menang.
const PRIORITAS: Record<string, number> = { SELESAI: 4, MENGERJAKAN: 3, TERKUNCI: 2 }

interface JadwalRow { id: string; tanggal: string | null; sesi: number | null; mapel_id: string; kelas: string; status: string }
interface SesiRow { id: string; jadwal_id: string | null; mapel_id: string | null; kelas: string | null; status: string; waktu_mulai: string | null }
interface SiswaUjianRow { sesi_id: string; nis: string; status: string | null }
interface NilaiRow { sesi_id: string; nis: string }

async function fetchProgresUjian(yayasanId: string) {
  const db = tenantDb(yayasanId)
  const zona = await getZonaWaktuSekolah(yayasanId)
  const hariIni = tanggalHariIni(zona)
  const offsetMs = zona.utcOffsetJam * 3_600_000
  const tanggalLokal = (iso: string) => new Date(new Date(iso).getTime() + offsetMs).toISOString().slice(0, 10)

  // ── 1. Pengaturan periode, jadwal, siswa aktif, pelanggaran (paralel) ───────
  const [mulaiRes, jadwalRes, siswaRes, pelanggaranRes] = await Promise.all([
    db.from('pengaturan').select('value').eq('key', KUNCI_MULAI).maybeSingle(),
    ambilSemuaBaris<JadwalRow>((dari, sampai) =>
      db.from('jadwal')
        .select('id, tanggal, sesi, mapel_id, kelas, status')
        .order('id', { ascending: true })
        .range(dari, sampai)
    ),
    ambilSemuaBaris<{ nis: string; kelas: string }>((dari, sampai) =>
      db.from('siswa')
        .select('nis, kelas')
        .eq('status', 'AKTIF')
        .neq('is_tester', 'YES')
        .order('nis', { ascending: true })
        .range(dari, sampai)
    ),
    db.from('pelanggaran').select('*', { count: 'exact', head: true }).eq('status', 'BELUM_DITINDAKLANJUTI'),
  ])
  if (jadwalRes.error) throw new Error(`Gagal membaca jadwal: ${jadwalRes.error.message}`)
  if (siswaRes.error) throw new Error(`Gagal membaca data siswa: ${siswaRes.error.message}`)

  const mulaiRaw = String((mulaiRes.data as { value?: string | null } | null)?.value ?? '')
  const periodeMulai = FORMAT_TANGGAL.test(mulaiRaw) ? mulaiRaw : null
  const pelanggaranBelumDitindak = pelanggaranRes.count ?? 0

  // Semua id jadwal yang MASIH ADA (semua status/tanggal) — dipakai mengenali sesi yatim.
  const semuaJadwalIds = new Set(jadwalRes.data.map(j => j.id))
  const jadwalList = jadwalRes.data.filter(j =>
    ['AKTIF', 'BERJALAN', 'SELESAI'].includes(j.status) &&
    (!periodeMulai || String(j.tanggal ?? '').slice(0, 10) >= periodeMulai)
  )
  const jadwalIdsHidup = new Set(jadwalList.map(j => j.id))

  const siswaPerKelas = new Map<string, string[]>()
  const pesertaKelasSet = new Map<string, Set<string>>()
  for (const s of siswaRes.data) {
    const nis = String(s.nis)
    if (!siswaPerKelas.has(s.kelas)) { siswaPerKelas.set(s.kelas, []); pesertaKelasSet.set(s.kelas, new Set()) }
    siswaPerKelas.get(s.kelas)!.push(nis)
    pesertaKelasSet.get(s.kelas)!.add(nis)
  }

  // ── 2. Sesi (dibatasi tanggal mulai periode bila ada) ──────────────────────
  const batasAwal = periodeMulai ? parseJadwalKeInstant(periodeMulai, '00:00', zona).toISOString() : null
  const sesiRes = await ambilSemuaBaris<SesiRow>((dari, sampai) => {
    const dasar = db.from('sesi_ujian').select('id, jadwal_id, mapel_id, kelas, status, waktu_mulai')
    return (batasAwal ? dasar.gte('waktu_mulai', batasAwal) : dasar)
      .order('id', { ascending: true })
      .range(dari, sampai)
  })
  if (sesiRes.error) throw new Error(`Gagal membaca data sesi: ${sesiRes.error.message}`)

  const sesiHidup = sesiRes.data.filter(s => s.jadwal_id && jadwalIdsHidup.has(s.jadwal_id))
  const sesiYatim = sesiRes.data.filter(s => s.jadwal_id && !semuaJadwalIds.has(s.jadwal_id) && s.mapel_id && s.kelas)
  const sesiMeta = new Map(sesiHidup.map(s => [s.id, s]))
  const sesiYatimMeta = new Map(sesiYatim.map(s => [s.id, s]))

  // ── 3. siswa_ujian (sesi hidup) dan nilai (sesi yatim), dipotong per 100 id ──
  const [suPotongan, nilaiPotongan] = await Promise.all([
    Promise.all(potong(sesiHidup.map(s => s.id), 100).map(async potongan => {
      const { data, error } = await ambilSemuaBaris<SiswaUjianRow>((dari, sampai) =>
        db.from('siswa_ujian')
          .select('sesi_id, nis, status')
          .in('sesi_id', potongan)
          .order('id', { ascending: true })
          .range(dari, sampai)
      )
      if (error) throw new Error(`Gagal membaca data ujian siswa: ${error.message}`)
      return data
    })),
    Promise.all(potong(sesiYatim.map(s => s.id), 100).map(async potongan => {
      const { data, error } = await ambilSemuaBaris<NilaiRow>((dari, sampai) =>
        db.from('nilai')
          .select('sesi_id, nis')
          .in('sesi_id', potongan)
          .order('id', { ascending: true })
          .range(dari, sampai)
      )
      if (error) throw new Error(`Gagal membaca riwayat nilai: ${error.message}`)
      return data
    })),
  ])

  // Status terbaik per (jadwal, siswa)
  const terbaik = new Map<string, StatusUjianSiswa>()
  for (const su of suPotongan.flat()) {
    const sesi = sesiMeta.get(su.sesi_id)
    if (!sesi?.jadwal_id) continue
    let st: StatusUjianSiswa | null = null
    if (su.status === 'SELESAI') st = 'SELESAI'
    else if ((su.status === 'AKTIF' || su.status === 'RESET') && sesi.status === 'BERJALAN') st = 'MENGERJAKAN'
    else if (su.status === 'TERKUNCI') st = 'TERKUNCI'
    if (!st) continue
    const kunci = `${sesi.jadwal_id}|${su.nis}`
    const lama = terbaik.get(kunci)
    if (!lama || PRIORITAS[st] > PRIORITAS[lama]) terbaik.set(kunci, st)
  }

  // ── 4. Penyaring peserta (mapel khusus agama) + nama mapel ─────────────────
  const mapelIds = [...new Set([
    ...jadwalList.map(j => j.mapel_id),
    ...sesiYatim.map(s => s.mapel_id as string),
  ])]
  const semuaNis = [...new Set(siswaRes.data.map(s => String(s.nis)))]
  const [adalahPeserta, mapelRes] = await Promise.all([
    bangunPenyaringPeserta(db, mapelIds, semuaNis),
    mapelIds.length
      ? db.from('mapel').select('id, nama').in('id', mapelIds)
      : Promise.resolve({ data: [] as { id: string; nama: string }[] }),
  ])
  const namaMapel = new Map(((mapelRes.data ?? []) as { id: string; nama: string }[]).map(m => [m.id, m.nama]))

  // ── 5. Hitung jadwal yang masih ada ────────────────────────────────────────
  const total = kosong()
  const perKelasLewat = new Map<string, Hitungan>()  // hanya ujian yang "seharusnya sudah selesai"
  const nisPerluSusulan = new Set<string>()
  const jadwalPerluSusulan = new Set<string>()
  const jadwalProgres: JadwalProgres[] = []
  const hariIniInfo = { tanggal: hariIni, total: 0, selesai: 0, berjalan: 0, akanDatang: 0 }

  for (const j of jadwalList) {
    const tanggal = j.tanggal ? String(j.tanggal).slice(0, 10) : ''
    const h = kosong()
    const peserta = (siswaPerKelas.get(j.kelas) ?? []).filter(nis => adalahPeserta(j.mapel_id, nis))
    // Jadwal "sudah seharusnya selesai": ditutup, atau tanggalnya sudah lewat.
    const sudahLewat = j.status === 'SELESAI' || (tanggal !== '' && tanggal < hariIni)

    for (const nis of peserta) {
      let st: StatusUjianSiswa | undefined = terbaik.get(`${j.id}|${nis}`)
      if (!st) st = j.status === 'SELESAI' ? 'TIDAK_HADIR' : 'BELUM_MULAI'
      tambah(h, st)
      tambah(total, st)
      if (st === 'TIDAK_HADIR') { nisPerluSusulan.add(nis); jadwalPerluSusulan.add(j.id) }
      if (sudahLewat) {
        if (!perKelasLewat.has(j.kelas)) perKelasLewat.set(j.kelas, kosong())
        tambah(perKelasLewat.get(j.kelas)!, st)
      }
    }

    if (tanggal === hariIni) {
      hariIniInfo.total++
      if (j.status === 'SELESAI') hariIniInfo.selesai++
      else if (j.status === 'BERJALAN') hariIniInfo.berjalan++
      else hariIniInfo.akanDatang++
    }

    if (h.total > 0) {
      jadwalProgres.push({
        id: j.id,
        mapelId: j.mapel_id,
        mapel: namaMapel.get(j.mapel_id) ?? j.mapel_id,
        kelas: j.kelas,
        tanggal,
        sesi: j.sesi ?? null,
        status: j.status,
        riwayat: false,
        ...h,
      })
    }
  }

  // ── 6. Riwayat: jadwal yang sudah dihapus (sesi yatim + nilai) ─────────────
  const komboHidup = new Set(jadwalList.map(j => `${j.mapel_id}|${j.kelas}`))
  const riwayat = new Map<string, { mapelId: string; kelas: string; nis: Set<string>; tanggal: string }>()
  for (const s of sesiYatim) {
    const kombo = `${s.mapel_id}|${s.kelas}`
    if (komboHidup.has(kombo)) continue
    const tgl = s.waktu_mulai ? tanggalLokal(s.waktu_mulai) : ''
    const ada = riwayat.get(kombo)
    if (!ada) riwayat.set(kombo, { mapelId: s.mapel_id as string, kelas: s.kelas as string, nis: new Set(), tanggal: tgl })
    else if (tgl && (!ada.tanggal || tgl < ada.tanggal)) ada.tanggal = tgl
  }
  for (const n of nilaiPotongan.flat()) {
    const s = sesiYatimMeta.get(n.sesi_id)
    if (!s) continue
    const r = riwayat.get(`${s.mapel_id}|${s.kelas}`)
    if (!r) continue
    const nis = String(n.nis)
    // Hanya siswa yang sekarang memang peserta (aktif, kelas sama, seagama untuk mapel agama).
    if (!pesertaKelasSet.get(r.kelas)?.has(nis) || !adalahPeserta(r.mapelId, nis)) continue
    r.nis.add(nis)
  }

  for (const [kombo, r] of riwayat) {
    const jumlah = r.nis.size
    if (jumlah === 0) continue
    total.total += jumlah
    total.selesai += jumlah
    if (!perKelasLewat.has(r.kelas)) perKelasLewat.set(r.kelas, kosong())
    const k = perKelasLewat.get(r.kelas)!
    k.total += jumlah
    k.selesai += jumlah
    if (r.tanggal === hariIni) { hariIniInfo.total++; hariIniInfo.selesai++ }
    jadwalProgres.push({
      id: `riwayat:${kombo}`,
      mapelId: r.mapelId,
      mapel: namaMapel.get(r.mapelId) ?? r.mapelId,
      kelas: r.kelas,
      tanggal: r.tanggal,
      sesi: null,
      status: 'SELESAI',
      riwayat: true,
      ...kosong(),
      total: jumlah,
      selesai: jumlah,
    })
  }

  // Kelas tertinggal: persentase selesai terendah pada ujian yang seharusnya sudah tuntas.
  const kelasTertinggal: KelasTertinggal[] = [...perKelasLewat.entries()]
    .map(([kelas, h]) => ({
      kelas,
      selesai: h.selesai,
      total: h.total,
      belumTuntas: h.total - h.selesai,
      persen: h.total ? Math.round((h.selesai / h.total) * 100) : 100,
    }))
    .filter(k => k.belumTuntas > 0)
    .sort((a, b) => a.persen - b.persen || b.belumTuntas - a.belumTuntas)
    .slice(0, 3)

  // Hari ujian tersisa: tanggal berbeda (hari ini dan sesudahnya) yang masih punya jadwal belum selesai.
  const NAMA_HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
  const tanggalSisa = [...new Set(
    jadwalList
      .filter(j => j.status !== 'SELESAI')
      .map(j => (j.tanggal ? String(j.tanggal).slice(0, 10) : ''))
      .filter(t => FORMAT_TANGGAL.test(t) && t >= hariIni)
  )].sort()
  const hariTersisa = {
    jumlah: tanggalSisa.length,
    hariIniTermasuk: tanggalSisa[0] === hariIni,
    hari: tanggalSisa.map(t => NAMA_HARI[new Date(`${t}T00:00:00Z`).getUTCDay()]),
    tanggal: tanggalSisa,
    adaJadwal: jadwalList.length > 0,
  }

  const sesiBerjalan = sesiHidup.filter(s => s.status === 'BERJALAN').length

  jadwalProgres.sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.mapel.localeCompare(b.mapel) || a.kelas.localeCompare(b.kelas))

  // ── 7. Rangkum per MAPEL + KELAS (satuan donat) ────────────────────────────
  const unitMap = new Map<string, UnitMapel>()
  for (const j of jadwalProgres) {
    const kunci = `${j.mapelId}|${j.kelas}`
    let u = unitMap.get(kunci)
    if (!u) {
      u = { id: kunci, mapel: j.mapel, kelas: j.kelas, tanggal: j.tanggal, jumlahJadwal: 0, status: 'BELUM_MULAI', ...kosong() }
      unitMap.set(kunci, u)
    }
    u.jumlahJadwal++
    if (j.tanggal && (!u.tanggal || j.tanggal < u.tanggal)) u.tanggal = j.tanggal
    u.total += j.total
    u.selesai += j.selesai
    u.mengerjakan += j.mengerjakan
    u.belumMulai += j.belumMulai
    u.terkunci += j.terkunci
    u.tidakHadir += j.tidakHadir
  }
  const unit = [...unitMap.values()]
  const ringkasanMapel = kosong()
  for (const u of unit) {
    u.status =
      u.total > 0 && u.selesai === u.total ? 'SELESAI'
      : u.mengerjakan > 0 ? 'MENGERJAKAN'
      : u.terkunci > 0 ? 'TERKUNCI'
      : u.tidakHadir > 0 ? 'TIDAK_HADIR'
      : 'BELUM_MULAI'
    tambah(ringkasanMapel, u.status)
  }
  unit.sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.mapel.localeCompare(b.mapel) || a.kelas.localeCompare(b.kelas))

  return {
    generatedAt: new Date().toISOString(),
    periodeMulai,
    // Donat + legenda: dihitung per mapel+kelas.
    ringkasan: { ...ringkasanMapel, persen: ringkasanMapel.total ? Math.round((ringkasanMapel.selesai / ringkasanMapel.total) * 100) : 0 },
    unit,
    sedangUjian: { siswa: total.mengerjakan, sesi: sesiBerjalan },
    perluSusulan: { siswa: nisPerluSusulan.size, jadwal: jadwalPerluSusulan.size, total: total.tidakHadir },
    pelanggaranBelumDitindak,
    hariIni: hariIniInfo,
    hariTersisa,
    kelasTertinggal,
  }
}

export type ProgresUjianResponse = Awaited<ReturnType<typeof fetchProgresUjian>>

export interface JadwalProgres extends Hitungan {
  id: string
  mapelId: string
  mapel: string
  kelas: string
  tanggal: string
  sesi: number | null
  status: string
  /** true = ujian ini jadwalnya sudah dihapus; dihitung dari riwayat sesi + nilai. */
  riwayat: boolean
}

export interface UnitMapel extends Hitungan {
  id: string
  mapel: string
  kelas: string
  /** Tanggal jadwal paling awal untuk mapel+kelas ini. */
  tanggal: string
  jumlahJadwal: number
  status: StatusUjianSiswa
}

export interface KelasTertinggal {
  kelas: string
  selesai: number
  total: number
  belumTuntas: number
  persen: number
}

export async function GET(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  try {
    // Cache pendek (10 dtk) hanya sebagai pengaman bila tab diklik berulang cepat.
    // Setiap klik tab tetap mendapat data segar dalam praktik.
    const data = await cachedFetch(
      `admin:progres-ujian:${yayasanIdDari(auth.user)}`,
      10,
      () => fetchProgresUjian(yayasanIdDari(auth.user)),
    )
    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal memuat progres ujian'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Simpan tanggal mulai periode ujian. Body: { mulai: 'YYYY-MM-DD' } atau { mulai: null } untuk menghapus batas.
export async function PUT(req: NextRequest) {
  const auth = await requireRoleAktif(req, ['ADMIN'])
  if ('error' in auth) return auth.error

  let body: { mulai?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Format tidak valid' }, { status: 400 })
  }

  let nilai = ''
  if (body.mulai !== null && body.mulai !== undefined && body.mulai !== '') {
    if (
      typeof body.mulai !== 'string' ||
      !FORMAT_TANGGAL.test(body.mulai) ||
      Number.isNaN(Date.parse(`${body.mulai}T00:00:00Z`))
    ) {
      return NextResponse.json({ error: 'Tanggal tidak valid. Gunakan format tahun-bulan-tanggal.' }, { status: 400 })
    }
    nilai = body.mulai
  }

  const db = tenantDb(yayasanIdDari(auth.user))
  const { error } = await db
    .from('pengaturan')
    .upsert([{ key: KUNCI_MULAI, value: nilai, updated_at: new Date().toISOString() }], { onConflict: 'yayasan_id,key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  cacheDelPrefix('admin:progres-ujian:')
  return NextResponse.json({ message: 'Tanggal mulai periode ujian disimpan.', mulai: nilai || null })
}
