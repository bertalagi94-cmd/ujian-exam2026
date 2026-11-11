/**
 * Daftar "Siswa Tidak Mengikuti Ujian" untuk akun Guru BK.
 *
 * ── APA YANG DIHITUNG ───────────────────────────────────────────────────────
 * Satu baris = satu siswa pada satu jadwal ujian yang SESINYA SUDAH DIBUKA
 * (sedang berjalan atau sudah selesai) tetapi siswa itu belum punya jejak
 * mengerjakan. Jadwal yang sesinya belum pernah dibuka (masih akan datang)
 * sengaja tidak dihitung, supaya tidak ada siswa "tidak ikut" untuk ujian
 * yang memang belum dimulai.
 *
 * ── "TIDAK PUNYA NILAI" TIDAK SAMA DENGAN "TIDAK IKUT" ──────────────────────
 * Siswa dianggap SUDAH terlibat (jadi tidak masuk daftar) bila di SALAH SATU
 * sesi milik jadwal itu ia punya baris nilai ATAU baris siswa_ujian (apa pun
 * statusnya: AKTIF/RESET/SELESAI/TERKUNCI). "Salah satu sesi" mencakup sesi
 * kelas, sesi susulan, dan sesi ruang khusus, karena nilai siswa ruang khusus
 * tercatat di sesi ruang, bukan di sesi kelasnya.
 *
 * Siswa yang belum terlibat dibagi menjadi tiga status:
 *   - RUANG_KHUSUS : sedang ditempatkan di ruang khusus (status DIPROSES) dan
 *                    belum mengerjakan. Diawasi pengawas ruang, bukan absen.
 *   - BELUM_MASUK  : masih ada sesi kelas/susulan yang BERJALAN untuk jadwal
 *                    itu, jadi siswa masih bisa masuk. Belum bisa disebut absen.
 *   - TIDAK_IKUT   : semua sesi kelas/susulan sudah selesai dan siswa tidak
 *                    punya jejak sama sekali. Inilah daftar yang perlu
 *                    ditindaklanjuti BK.
 *
 * Siswa yang TERKUNCI karena pelanggaran punya baris siswa_ujian, jadi tidak
 * masuk daftar ini (mereka sudah mengikuti ujian dan ditangani lewat menu
 * Pelanggaran Siswa).
 *
 * Mapel khusus agama (mis. PAI/PAK) hanya dihitung untuk siswa seagama, sama
 * seperti aturan di sesi susulan dan layar pengawas (lihat src/lib/agama.ts).
 *
 * Fail-closed seperti bk-scope.ts: query yang gagal MELEMPAR error, tidak
 * diam-diam mengembalikan daftar kosong (daftar kosong yang salah lebih
 * menyesatkan daripada pesan galat).
 */
import { tenantDb } from '@/lib/tenant'
import { ambilSemuaBaris } from '@/lib/ambil-semua'
import { ambilSiswaBinaan, type SiswaBinaan } from '@/lib/bk-scope'
import { ambilAgamaMapelBanyak, ambilAgamaSiswa, cocokAgama, type Agama } from '@/lib/agama'

export type StatusTidakUjian = 'TIDAK_IKUT' | 'BELUM_MASUK' | 'RUANG_KHUSUS'

export interface BarisTidakUjian {
  kunci: string            // `${jadwal_id}__${nis}`, unik per baris
  nis: string
  nama: string
  kelas: string
  jadwal_id: string
  mapel_id: string | null
  nama_mapel: string
  tanggal: string          // YYYY-MM-DD
  jam_mulai: string
  jam_selesai: string
  status: StatusTidakUjian
  keterangan: string       // kalimat biasa, untuk dibaca guru
  susulan_dibuka: boolean  // sudah pernah ada sesi susulan untuk jadwal ini
}

export interface RingkasanTidakUjian {
  tidakIkut: number        // baris berstatus TIDAK_IKUT
  siswaTidakIkut: number   // siswa unik yang punya baris TIDAK_IKUT
  belumMasuk: number
  ruangKhusus: number
  jumlahJadwal: number     // jadwal (sesi sudah dibuka) yang ikut dihitung
}

export interface JadwalInput {
  id: string
  tanggal: string
  jam_mulai: string
  jam_selesai: string
  mapel_id: string | null
  kelas: string
}

export interface SesiInput {
  id: string
  jadwal_id: string | null
  status: string | null
  ruang_khusus_id: string | null
  is_darurat: boolean | null
}

export interface MasukanKlasifikasi {
  jadwal: JadwalInput[]
  sesi: SesiInput[]
  siswa: SiswaBinaan[]
  /** sesi_id -> NIS yang punya baris nilai ATAU siswa_ujian di sesi itu. */
  terlibatPerSesi: Map<string, Set<string>>
  /** jadwal_id -> NIS yang sedang DIPROSES ke ruang khusus untuk jadwal itu. */
  penempatanRuang: Map<string, Set<string>>
  namaMapel: Map<string, string>
  agamaMapel: Map<string, Agama[]>
  agamaSiswa: Map<string, Agama>
}

const PRIORITAS_STATUS: Record<StatusTidakUjian, number> = {
  TIDAK_IKUT: 0,
  BELUM_MASUK: 1,
  RUANG_KHUSUS: 2,
}

const tanggal10 = (v: unknown) => String(v ?? '').slice(0, 10)

/**
 * Inti perhitungan, murni (tanpa database) supaya mudah diuji. Lihat penjelasan
 * aturan di kepala berkas.
 */
export function klasifikasiTidakUjian(masukan: MasukanKlasifikasi): {
  baris: BarisTidakUjian[]
  jumlahJadwal: number
} {
  const { jadwal, sesi, siswa, terlibatPerSesi, penempatanRuang, namaMapel, agamaMapel, agamaSiswa } = masukan

  const sesiPerJadwal = new Map<string, SesiInput[]>()
  for (const s of sesi) {
    if (!s.jadwal_id) continue
    const daftar = sesiPerJadwal.get(s.jadwal_id) ?? []
    daftar.push(s)
    sesiPerJadwal.set(s.jadwal_id, daftar)
  }

  const siswaPerKelas = new Map<string, SiswaBinaan[]>()
  for (const s of siswa) {
    const daftar = siswaPerKelas.get(s.kelas) ?? []
    daftar.push(s)
    siswaPerKelas.set(s.kelas, daftar)
  }

  const baris: BarisTidakUjian[] = []
  let jumlahJadwal = 0

  for (const j of jadwal) {
    const semuaSesi = sesiPerJadwal.get(j.id) ?? []
    // Hanya sesi KELAS (termasuk susulan) yang menandai ujian kelas sudah dibuka.
    // Jadwal yang baru punya sesi ruang khusus belum berarti ujian kelasnya mulai.
    const sesiKelas = semuaSesi.filter(s => !s.ruang_khusus_id)
    if (sesiKelas.length === 0) continue
    jumlahJadwal++

    const masihBerjalan = sesiKelas.some(s => s.status === 'BERJALAN')
    const susulanBerjalan = sesiKelas.some(s => s.status === 'BERJALAN' && s.is_darurat === true)
    const susulanDibuka = sesiKelas.some(s => s.is_darurat === true)

    const terlibat = new Set<string>()
    for (const s of semuaSesi) {
      for (const nis of terlibatPerSesi.get(s.id) ?? []) terlibat.add(nis)
    }

    const diRuang = penempatanRuang.get(j.id) ?? new Set<string>()
    const agamaJadwal = j.mapel_id ? (agamaMapel.get(j.mapel_id) ?? null) : null
    const namaJadwal = (j.mapel_id && namaMapel.get(j.mapel_id)) || j.mapel_id || '-'

    for (const s of siswaPerKelas.get(String(j.kelas)) ?? []) {
      if (!cocokAgama(agamaJadwal, agamaSiswa.get(s.nis) ?? null)) continue
      if (terlibat.has(s.nis)) continue

      let status: StatusTidakUjian
      let keterangan: string
      if (diRuang.has(s.nis)) {
        status = 'RUANG_KHUSUS'
        keterangan = 'Ditempatkan di ruang khusus dan belum mengerjakan. Diawasi pengawas ruang, belum dihitung tidak ikut.'
      } else if (masihBerjalan) {
        status = 'BELUM_MASUK'
        keterangan = susulanBerjalan
          ? 'Sesi susulan sedang dibuka. Siswa belum masuk, masih bisa mengikuti.'
          : 'Ujian sedang berlangsung. Siswa belum masuk, masih bisa mengikuti.'
      } else {
        status = 'TIDAK_IKUT'
        keterangan = susulanDibuka
          ? 'Tidak mengikuti ujian, termasuk sesi susulan yang sudah dibuka.'
          : 'Tidak mengikuti ujian. Belum ada sesi susulan untuk jadwal ini.'
      }

      baris.push({
        kunci: `${j.id}__${s.nis}`,
        nis: s.nis,
        nama: s.nama,
        kelas: s.kelas,
        jadwal_id: j.id,
        mapel_id: j.mapel_id,
        nama_mapel: namaJadwal,
        tanggal: tanggal10(j.tanggal),
        jam_mulai: j.jam_mulai,
        jam_selesai: j.jam_selesai,
        status,
        keterangan,
        susulan_dibuka: susulanDibuka,
      })
    }
  }

  baris.sort((a, b) =>
    PRIORITAS_STATUS[a.status] - PRIORITAS_STATUS[b.status] ||
    b.tanggal.localeCompare(a.tanggal) ||
    a.jam_mulai.localeCompare(b.jam_mulai) ||
    a.kelas.localeCompare(b.kelas, 'id', { numeric: true }) ||
    a.nama.localeCompare(b.nama, 'id') ||
    a.nama_mapel.localeCompare(b.nama_mapel, 'id'))

  return { baris, jumlahJadwal }
}

export function ringkasTidakUjian(baris: BarisTidakUjian[], jumlahJadwal: number): RingkasanTidakUjian {
  const tidakIkut = baris.filter(b => b.status === 'TIDAK_IKUT')
  return {
    tidakIkut: tidakIkut.length,
    siswaTidakIkut: new Set(tidakIkut.map(b => b.nis)).size,
    belumMasuk: baris.filter(b => b.status === 'BELUM_MASUK').length,
    ruangKhusus: baris.filter(b => b.status === 'RUANG_KHUSUS').length,
    jumlahJadwal,
  }
}

// ── Akses database ──────────────────────────────────────────────────────────

// Daftar id dalam klausa .in() dipotong supaya URL permintaan tidak kepanjangan.
const UKURAN_POTONGAN = 100

function potong<T>(daftar: T[], ukuran = UKURAN_POTONGAN): T[][] {
  const hasil: T[][] = []
  for (let i = 0; i < daftar.length; i += ukuran) hasil.push(daftar.slice(i, i + ukuran))
  return hasil
}

/** Ambil semua baris untuk tiap potongan id, gagal keras bila ada error. */
async function ambilPerPotongan<T>(
  ids: string[],
  pesan: string,
  buat: (potongan: string[], dari: number, sampai: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const semua: T[] = []
  for (const bagian of potong(ids)) {
    const { data, error } = await ambilSemuaBaris<T>((dari, sampai) => buat(bagian, dari, sampai))
    if (error) throw new Error(`${pesan}: ${error.message}`)
    semua.push(...data)
  }
  return semua
}

/**
 * Hitung daftar siswa tidak mengikuti ujian untuk kelas binaan satu guru BK.
 * `kelasList` berisi NAMA kelas (lihat catatan di bk-scope.ts).
 */
export async function hitungSiswaTidakUjian(
  yayasanId: string,
  kelasList: string[]
): Promise<{ baris: BarisTidakUjian[]; ringkasan: RingkasanTidakUjian }> {
  const kosong = { baris: [], ringkasan: ringkasTidakUjian([], 0) }
  if (kelasList.length === 0) return kosong

  const db = tenantDb(yayasanId)

  const siswa = await ambilSiswaBinaan(yayasanId, kelasList)
  if (siswa.length === 0) return kosong

  const { data: jadwalRows, error: jadwalError } = await ambilSemuaBaris<{
    id: string; tanggal: string; jam_mulai: string; jam_selesai: string; mapel_id: string | null; kelas: string
  }>((dari, sampai) =>
    db.from('jadwal')
      .select('id, tanggal, jam_mulai, jam_selesai, mapel_id, kelas')
      .in('kelas', kelasList)
      .order('id', { ascending: true })
      .range(dari, sampai)
  )
  if (jadwalError) throw new Error(`Gagal memuat jadwal ujian: ${jadwalError.message}`)
  if (jadwalRows.length === 0) return kosong

  const jadwalIds = jadwalRows.map(j => String(j.id))

  const sesiRows = await ambilPerPotongan<SesiInput>(jadwalIds, 'Gagal memuat sesi ujian', (bagian, dari, sampai) =>
    db.from('sesi_ujian')
      .select('id, jadwal_id, status, ruang_khusus_id, is_darurat')
      .in('jadwal_id', bagian)
      .order('id', { ascending: true })
      .range(dari, sampai)
  )
  if (sesiRows.length === 0) return kosong

  const sesiIds = sesiRows.map(s => String(s.id))

  const [nilaiRows, siswaUjianRows, penempatanRows] = await Promise.all([
    ambilPerPotongan<{ sesi_id: string; nis: string }>(sesiIds, 'Gagal memuat nilai', (bagian, dari, sampai) =>
      db.from('nilai')
        .select('id, sesi_id, nis')
        .in('sesi_id', bagian)
        .order('id', { ascending: true })
        .range(dari, sampai)
    ),
    ambilPerPotongan<{ sesi_id: string; nis: string }>(sesiIds, 'Gagal memuat data peserta ujian', (bagian, dari, sampai) =>
      db.from('siswa_ujian')
        .select('id, sesi_id, nis')
        .in('sesi_id', bagian)
        .order('id', { ascending: true })
        .range(dari, sampai)
    ),
    ambilPerPotongan<{ jadwal_id: string; nis: string }>(jadwalIds, 'Gagal memuat penempatan ruang khusus', (bagian, dari, sampai) =>
      db.from('ruang_khusus_siswa')
        .select('id, jadwal_id, nis')
        .in('jadwal_id', bagian)
        .eq('status', 'DIPROSES')
        .order('id', { ascending: true })
        .range(dari, sampai)
    ),
  ])

  const terlibatPerSesi = new Map<string, Set<string>>()
  for (const r of [...nilaiRows, ...siswaUjianRows]) {
    const kunci = String(r.sesi_id)
    const himpunan = terlibatPerSesi.get(kunci) ?? new Set<string>()
    himpunan.add(String(r.nis))
    terlibatPerSesi.set(kunci, himpunan)
  }

  const penempatanRuang = new Map<string, Set<string>>()
  for (const r of penempatanRows) {
    const kunci = String(r.jadwal_id)
    const himpunan = penempatanRuang.get(kunci) ?? new Set<string>()
    himpunan.add(String(r.nis))
    penempatanRuang.set(kunci, himpunan)
  }

  const mapelIds = [...new Set(jadwalRows.map(j => j.mapel_id).filter((x): x is string => !!x))]
  const { data: mapelRows, error: mapelError } = mapelIds.length
    ? await db.from('mapel').select('id, nama').in('id', mapelIds)
    : { data: [] as { id: string; nama: string }[], error: null }
  if (mapelError) throw new Error(`Gagal memuat daftar mapel: ${mapelError.message}`)
  const namaMapel = new Map((mapelRows ?? []).map((m: { id: string; nama: string }) => [String(m.id), String(m.nama)]))

  // Dua pembacaan agama di bawah tahan-gagal (lihat agama.ts): bila kolom agama
  // belum ada, semua mapel dianggap umum.
  const agamaMapel = await ambilAgamaMapelBanyak(db, mapelIds)
  const agamaSiswa = agamaMapel.size > 0
    ? await ambilAgamaSiswa(db, siswa.map(s => s.nis))
    : new Map<string, Agama>()

  const { baris, jumlahJadwal } = klasifikasiTidakUjian({
    jadwal: jadwalRows.map(j => ({
      id: String(j.id),
      tanggal: String(j.tanggal),
      jam_mulai: String(j.jam_mulai ?? ''),
      jam_selesai: String(j.jam_selesai ?? ''),
      mapel_id: j.mapel_id ? String(j.mapel_id) : null,
      kelas: String(j.kelas),
    })),
    sesi: sesiRows.map(s => ({
      id: String(s.id),
      jadwal_id: s.jadwal_id ? String(s.jadwal_id) : null,
      status: s.status ?? null,
      ruang_khusus_id: s.ruang_khusus_id ? String(s.ruang_khusus_id) : null,
      is_darurat: s.is_darurat ?? null,
    })),
    siswa,
    terlibatPerSesi,
    penempatanRuang,
    namaMapel,
    agamaMapel,
    agamaSiswa,
  })

  return { baris, ringkasan: ringkasTidakUjian(baris, jumlahJadwal) }
}
