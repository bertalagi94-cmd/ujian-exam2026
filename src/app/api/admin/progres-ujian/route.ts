import { NextRequest, NextResponse } from 'next/server'
import { tenantDb, yayasanIdDari } from '@/lib/tenant'
import { requireRoleAktif } from '@/lib/status-akun'
import { cachedFetch } from '@/lib/cache'
import { ambilSemuaBaris } from '@/lib/ambil-semua'
import { getZonaWaktuSekolah, tanggalHariIni } from '@/lib/pengaturan-waktu'
import { bangunPenyaringPeserta } from '@/lib/agama'

// =============================================================================
// GET /api/admin/progres-ujian
//
// Data untuk tab "Progres Ujian" di beranda admin (donat + kartu ringkas).
// HANYA MEMBACA. Tidak mengubah baris database mana pun.
//
// SATUAN HITUNG = "ujian siswa": satu siswa pada satu jadwal ujian.
//   penyebut  = untuk setiap jadwal (status AKTIF / BERJALAN / SELESAI), semua
//               siswa AKTIF non-tester di kelas jadwal itu, disaring agama untuk
//               mapel khusus agama (aturan sama dgn src/lib/agama.ts) — jadwal
//               yang belum tiba ikut dihitung, jadi 100% = seluruh masa ujian
//               tuntas.
//   status tiap ujian siswa (digabung dari SEMUA sesi milik jadwal itu —
//   reguler, susulan, ruang khusus — dengan prioritas di bawah):
//     SELESAI      siswa_ujian.status = SELESAI di sesi mana pun
//     MENGERJAKAN  siswa_ujian.status = AKTIF/RESET pada sesi yang BERJALAN
//     TERKUNCI     siswa_ujian.status = TERKUNCI (pelanggaran, belum dibuka)
//     TIDAK_HADIR  tidak punya hasil apa pun & jadwal sudah SELESAI -> perlu susulan
//     BELUM_MULAI  tidak punya hasil apa pun & jadwal belum selesai
//
// Catatan skema: `siswa_ujian` tidak punya kolom yayasan_id, jadi dibaca lewat
// sesi_id dari `sesi_ujian` yang sudah ber-scope yayasan (tenantDb).
// =============================================================================

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
interface SesiRow { id: string; jadwal_id: string | null; status: string }
interface SiswaUjianRow { sesi_id: string; nis: string; status: string | null }

async function fetchProgresUjian(yayasanId: string) {
  const db = tenantDb(yayasanId)
  const zona = await getZonaWaktuSekolah(yayasanId)
  const hariIni = tanggalHariIni(zona)

  // ── 1. Jadwal + siswa aktif + pelanggaran belum ditindak (paralel) ─────────
  const [jadwalRes, siswaRes, pelanggaranRes] = await Promise.all([
    ambilSemuaBaris<JadwalRow>((dari, sampai) =>
      db.from('jadwal')
        .select('id, tanggal, sesi, mapel_id, kelas, status')
        .in('status', ['AKTIF', 'BERJALAN', 'SELESAI'])
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

  const jadwalList = jadwalRes.data
  const pelanggaranBelumDitindak = pelanggaranRes.count ?? 0

  const ringkasanKosong = {
    generatedAt: new Date().toISOString(),
    ringkasan: { ...kosong(), persen: 0 },
    sedangUjian: { siswa: 0, sesi: 0 },
    perluSusulan: { siswa: 0, jadwal: 0, total: 0 },
    pelanggaranBelumDitindak,
    hariIni: { tanggal: hariIni, total: 0, selesai: 0, berjalan: 0, akanDatang: 0 },
    kelasTertinggal: [] as KelasTertinggal[],
    jadwal: [] as JadwalProgres[],
  }
  if (jadwalList.length === 0) return ringkasanKosong

  const siswaPerKelas = new Map<string, string[]>()
  for (const s of siswaRes.data) {
    if (!siswaPerKelas.has(s.kelas)) siswaPerKelas.set(s.kelas, [])
    siswaPerKelas.get(s.kelas)!.push(String(s.nis))
  }

  const jadwalIds = jadwalList.map(j => j.id)
  const mapelIds = [...new Set(jadwalList.map(j => j.mapel_id))]

  // ── 2. Sesi milik jadwal-jadwal itu, lalu siswa_ujian-nya ──────────────────
  // .in() dipotong per 100 id supaya URL permintaan tidak kepanjangan.
  const sesiPotongan = await Promise.all(potong(jadwalIds, 100).map(async potongan => {
    const { data, error } = await ambilSemuaBaris<SesiRow>((dari, sampai) =>
      db.from('sesi_ujian')
        .select('id, jadwal_id, status')
        .in('jadwal_id', potongan)
        .order('id', { ascending: true })
        .range(dari, sampai)
    )
    if (error) throw new Error(`Gagal membaca data sesi: ${error.message}`)
    return data
  }))
  const sesiList = sesiPotongan.flat()
  const sesiMeta = new Map(sesiList.map(s => [s.id, s]))

  const suPotongan = await Promise.all(potong(sesiList.map(s => s.id), 100).map(async potongan => {
    const { data, error } = await ambilSemuaBaris<SiswaUjianRow>((dari, sampai) =>
      db.from('siswa_ujian')
        .select('sesi_id, nis, status')
        .in('sesi_id', potongan)
        .order('id', { ascending: true })
        .range(dari, sampai)
    )
    if (error) throw new Error(`Gagal membaca data ujian siswa: ${error.message}`)
    return data
  }))

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

  // ── 3. Penyaring peserta (mapel khusus agama) + nama mapel ─────────────────
  const semuaNis = [...new Set(siswaRes.data.map(s => String(s.nis)))]
  const [adalahPeserta, mapelRes] = await Promise.all([
    bangunPenyaringPeserta(db, mapelIds, semuaNis),
    db.from('mapel').select('id, nama').in('id', mapelIds),
  ])
  const namaMapel = new Map(((mapelRes.data ?? []) as { id: string; nama: string }[]).map(m => [m.id, m.nama]))

  // ── 4. Hitung ──────────────────────────────────────────────────────────────
  const total = kosong()
  const perKelasLewat = new Map<string, Hitungan>()  // hanya jadwal yang "seharusnya sudah selesai"
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
        mapel: namaMapel.get(j.mapel_id) ?? j.mapel_id,
        kelas: j.kelas,
        tanggal,
        sesi: j.sesi ?? null,
        status: j.status,
        ...h,
      })
    }
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

  const sesiBerjalan = sesiList.filter(s => s.status === 'BERJALAN').length

  jadwalProgres.sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.mapel.localeCompare(b.mapel) || a.kelas.localeCompare(b.kelas))

  return {
    generatedAt: new Date().toISOString(),
    ringkasan: { ...total, persen: total.total ? Math.round((total.selesai / total.total) * 100) : 0 },
    sedangUjian: { siswa: total.mengerjakan, sesi: sesiBerjalan },
    perluSusulan: { siswa: nisPerluSusulan.size, jadwal: jadwalPerluSusulan.size, total: total.tidakHadir },
    pelanggaranBelumDitindak,
    hariIni: hariIniInfo,
    kelasTertinggal,
    jadwal: jadwalProgres,
  }
}

export type ProgresUjianResponse = Awaited<ReturnType<typeof fetchProgresUjian>>

export interface JadwalProgres extends Hitungan {
  id: string
  mapel: string
  kelas: string
  tanggal: string
  sesi: number | null
  status: string
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
