import { tenantDb } from '@/lib/tenant'
import { buildStatusSoalKey, computeStatusSoalDetailMap } from '@/lib/soal-status'
import type { StatusSoal } from '@/lib/soal-status'

export interface ItemBelumDijadwalkan {
  mapel_id: string
  nama_mapel: string
  kelas: string
  guru_id: string | null
  nama_guru: string | null
  status_soal: StatusSoal
}

export interface ItemBelumAdaSoal {
  mapel_id: string
  nama_mapel: string
  kelas: string
  status_soal: string
  guru_id: string | null
  nama_guru: string | null
}

export interface ItemGuruBelumMengawas {
  username: string
  nama: string
}

// Satu baris = satu kombinasi mapel x kelas, lengkap dengan status soal DAN
// status jadwalnya. Dipakai tab "Siap Dijadwalkan" dan "Status Soal" di
// modal Rangkuman.
export interface ItemKesiapan {
  mapel_id: string
  nama_mapel: string
  kelas: string
  guru_id: string | null
  nama_guru: string | null
  status_soal: StatusSoal
  sudah_dijadwalkan: boolean
  // Tanggal jadwal paling awal untuk kombinasi ini (YYYY-MM-DD), null kalau belum terjadwal.
  tanggal_jadwal: string | null
}

export interface RingkasanKesiapan {
  total: number
  // Soal DISETUJUI tapi belum punya jadwal -> prioritas kerja admin.
  siap_dijadwalkan: number
  sudah_terjadwal: number
  per_status: Record<StatusSoal, number>
}

export interface RangkumanJadwal {
  belum_dijadwalkan: ItemBelumDijadwalkan[]
  belum_ada_soal: ItemBelumAdaSoal[]
  guru_belum_mengawas: ItemGuruBelumMengawas[]
  kesiapan: ItemKesiapan[]
  ringkasan: RingkasanKesiapan
}

// Urutan tampil: yang paling siap dikerjakan admin di atas.
const URUTAN_STATUS: Record<StatusSoal, number> = { DISETUJUI: 0, MENUNGGU: 1, DRAFT: 2, DITOLAK: 3, BELUM_ADA: 4 }

// Rangkuman kesiapan ujian:
// 1. kesiapan            -> SEMUA kombinasi mapel x kelas (dari kelas_list mapel) beserta status soal & jadwal
// 2. ringkasan           -> hitungan per status soal + berapa yang siap dijadwalkan
// 3. belum_dijadwalkan   -> kombinasi mapel x kelas yang belum punya jadwal (kini + status soal)
// 4. belum_ada_soal      -> kombinasi mapel x kelas yang belum punya paket soal DISETUJUI
// 5. guru_belum_mengawas -> guru aktif yang belum pernah ditugaskan sebagai pengawas di jadwal manapun
// Multi-yayasan: yayasanId WAJIB (semua tabel yang dibaca di bawah ter-scope yayasan).
//
// Status soal dihitung lewat computeStatusSoalDetailMap (src/lib/soal-status.ts),
// helper yang sama dengan yang dipakai daftar jadwal, supaya angka di
// rangkuman SELALU sama dengan badge di tabel jadwal.
export async function getRangkumanJadwal(yayasanId: string): Promise<RangkumanJadwal> {
  const db = tenantDb(yayasanId)

  const [{ data: mapelRaw }, { data: jadwalRaw }, { data: guruRaw }] = await Promise.all([
    (db as any).from('mapel').select('id, nama, kelas_list, guru_id'),
    (db as any).from('jadwal').select('mapel_id, kelas, pengawas, tanggal'),
    (db as any).from('users').select('username, nama, status').eq('role', 'GURU'),
  ])

  const mapelList = (mapelRaw ?? []) as { id: string; nama: string; kelas_list: string | null; guru_id: string | null }[]
  const jadwalList = (jadwalRaw ?? []) as { mapel_id: string; kelas: string; pengawas: string | null; tanggal: string | null }[]
  const guruList = (guruRaw ?? []) as { username: string; nama: string; status: string }[]

  // Semua kombinasi mapel x kelas yang diampu.
  const kombinasi: { mapel: (typeof mapelList)[number]; kelas: string }[] = []
  for (const m of mapelList) {
    const kelasNamaArr = m.kelas_list ? m.kelas_list.split(',').map(k => k.trim()).filter(Boolean) : []
    for (const namaKelas of kelasNamaArr) kombinasi.push({ mapel: m, kelas: namaKelas })
  }

  // Status soal + nama guru, konsisten dengan daftar jadwal.
  const statusMap = await computeStatusSoalDetailMap(
    kombinasi.map(k => ({ mapel_id: k.mapel.id, kelas: k.kelas })),
    yayasanId
  )

  // Jadwal per kombinasi (kunci dinormalisasi: spasi & kapitalisasi tidak ngaruh).
  // Simpan tanggal paling awal untuk ditampilkan di rangkuman.
  const jadwalMap = new Map<string, string | null>()
  for (const j of jadwalList) {
    const key = buildStatusSoalKey(j.mapel_id, j.kelas)
    const tgl = j.tanggal ? String(j.tanggal).slice(0, 10) : null
    const existing = jadwalMap.get(key)
    if (!jadwalMap.has(key) || (tgl && (!existing || tgl < existing))) jadwalMap.set(key, tgl)
  }

  const kesiapan: ItemKesiapan[] = kombinasi.map(({ mapel: m, kelas }) => {
    const key = buildStatusSoalKey(m.id, kelas)
    const detail = statusMap[key]
    return {
      mapel_id: m.id,
      nama_mapel: m.nama,
      kelas,
      guru_id: m.guru_id,
      nama_guru: detail?.namaGuru ?? null,
      status_soal: detail?.status ?? 'BELUM_ADA',
      sudah_dijadwalkan: jadwalMap.has(key),
      tanggal_jadwal: jadwalMap.get(key) ?? null,
    }
  })

  kesiapan.sort((a, b) =>
    (URUTAN_STATUS[a.status_soal] ?? 9) - (URUTAN_STATUS[b.status_soal] ?? 9) ||
    a.nama_mapel.localeCompare(b.nama_mapel, 'id') ||
    a.kelas.localeCompare(b.kelas, 'id', { numeric: true })
  )

  const perStatus: Record<StatusSoal, number> = { DISETUJUI: 0, MENUNGGU: 0, DRAFT: 0, DITOLAK: 0, BELUM_ADA: 0 }
  let siapDijadwalkan = 0
  let sudahTerjadwal = 0
  for (const k of kesiapan) {
    perStatus[k.status_soal] = (perStatus[k.status_soal] ?? 0) + 1
    if (k.sudah_dijadwalkan) sudahTerjadwal++
    else if (k.status_soal === 'DISETUJUI') siapDijadwalkan++
  }

  const belumDijadwalkan: ItemBelumDijadwalkan[] = kesiapan
    .filter(k => !k.sudah_dijadwalkan)
    .map(k => ({
      mapel_id: k.mapel_id, nama_mapel: k.nama_mapel, kelas: k.kelas,
      guru_id: k.guru_id, nama_guru: k.nama_guru, status_soal: k.status_soal,
    }))

  const belumAdaSoal: ItemBelumAdaSoal[] = kesiapan
    .filter(k => k.status_soal !== 'DISETUJUI')
    .map(k => ({
      mapel_id: k.mapel_id, nama_mapel: k.nama_mapel, kelas: k.kelas,
      status_soal: k.status_soal, guru_id: k.guru_id, nama_guru: k.nama_guru,
    }))

  // Guru aktif yang belum pernah ditugaskan mengawas di jadwal manapun
  const guruPernahMengawas = new Set(jadwalList.map(j => j.pengawas).filter(Boolean))
  const guruBelumMengawas = guruList
    .filter(g => g.status !== 'NONAKTIF' && !guruPernahMengawas.has(g.username))
    .map(g => ({ username: g.username, nama: g.nama }))

  return {
    belum_dijadwalkan: belumDijadwalkan,
    belum_ada_soal: belumAdaSoal,
    guru_belum_mengawas: guruBelumMengawas,
    kesiapan,
    ringkasan: {
      total: kesiapan.length,
      siap_dijadwalkan: siapDijadwalkan,
      sudah_terjadwal: sudahTerjadwal,
      per_status: perStatus,
    },
  }
}
