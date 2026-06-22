import { createAdminClient } from '@/lib/supabase'

export interface ItemBelumDijadwalkan {
  mapel_id: string
  nama_mapel: string
  kelas: string
  guru_id: string | null
}

export interface ItemBelumAdaSoal {
  mapel_id: string
  nama_mapel: string
  kelas: string
  status_soal: string
  guru_id: string | null
}

export interface ItemGuruBelumMengawas {
  username: string
  nama: string
}

export interface RangkumanJadwal {
  belum_dijadwalkan: ItemBelumDijadwalkan[]
  belum_ada_soal: ItemBelumAdaSoal[]
  guru_belum_mengawas: ItemGuruBelumMengawas[]
}

// Rangkuman kesiapan ujian:
// 1. belum_dijadwalkan   -> kombinasi mapel x kelas (dari kelas_list mapel) yang belum punya jadwal
// 2. belum_ada_soal      -> kombinasi mapel x kelas yang belum punya paket soal DISETUJUI
// 3. guru_belum_mengawas -> guru aktif yang belum pernah ditugaskan sebagai pengawas di jadwal manapun
export async function getRangkumanJadwal(): Promise<RangkumanJadwal> {
  const db = createAdminClient()

  const [{ data: mapelRaw }, { data: jadwalRaw }, { data: paketRaw }, { data: guruRaw }] = await Promise.all([
    (db as any).from('mapel').select('id, nama, kelas_list, guru_id'),
    (db as any).from('jadwal').select('mapel_id, kelas, pengawas'),
    (db as any).from('paket_soal').select('mapel_id, kelas_id, status'),
    (db as any).from('users').select('username, nama, status').eq('role', 'GURU'),
  ])

  const mapelList = (mapelRaw ?? []) as { id: string; nama: string; kelas_list: string | null; guru_id: string | null }[]
  const jadwalList = (jadwalRaw ?? []) as { mapel_id: string; kelas: string; pengawas: string | null }[]
  const paketList = (paketRaw ?? []) as { mapel_id: string; kelas_id: string; status: string }[]
  const guruList = (guruRaw ?? []) as { username: string; nama: string; status: string }[]

  // Ambil SEMUA kelas (tanpa filter) agar map id→nama lengkap
  // Ini penting karena kelas_id di paket_soal SELALU berupa id asli ("KLS_xxx")
  // sesuai dropdown guru yang menggunakan k.id sebagai value
  const { data: kelasRaw } = await (db as any).from('kelas').select('id, nama')
  const kelasList = (kelasRaw ?? []) as { id: string; nama: string }[]
  const idKeNama = Object.fromEntries(kelasList.map(k => [k.id, String(k.nama)]))
  const namaKeId = Object.fromEntries(kelasList.map(k => [String(k.nama), k.id]))

  // Set kombinasi mapel_id__kelasNama yang sudah terjadwal
  const sudahTerjadwal = new Set(jadwalList.map(j => `${j.mapel_id}__${j.kelas}`))

  // Status paket soal terbaik per mapel_id__kelasNama
  // Resolve kelas_id paket ke nama kelas via idKeNama agar key-nya konsisten dengan jadwal
  const statusPriority: Record<string, number> = { DISETUJUI: 4, MENUNGGU: 3, DITOLAK: 2, DRAFT: 1 }
  const paketStatusMap: Record<string, string> = {}
  for (const p of paketList) {
    // kelas_id di paket selalu berupa id asli; resolve ke nama kelas
    // fallback ke kelas_id langsung untuk data lama yang mungkin menyimpan nama
    const namaKelasForPaket = idKeNama[p.kelas_id] ?? p.kelas_id
    const key = `${p.mapel_id}__${namaKelasForPaket}`
    const existing = paketStatusMap[key]
    if (!existing || (statusPriority[p.status] ?? 0) > (statusPriority[existing] ?? 0)) {
      paketStatusMap[key] = p.status
    }
  }

  const belumDijadwalkan: ItemBelumDijadwalkan[] = []
  const belumAdaSoal: ItemBelumAdaSoal[] = []

  for (const m of mapelList) {
    const kelasNamaArr = m.kelas_list ? m.kelas_list.split(',').map(k => k.trim()).filter(Boolean) : []
    for (const namaKelas of kelasNamaArr) {
      if (!sudahTerjadwal.has(`${m.id}__${namaKelas}`)) {
        belumDijadwalkan.push({ mapel_id: m.id, nama_mapel: m.nama, kelas: namaKelas, guru_id: m.guru_id })
      }

      // Cek paketStatusMap dengan key berbasis nama kelas (sudah dinormalisasi di atas)
      const statusSoal = paketStatusMap[`${m.id}__${namaKelas}`] ?? 'BELUM_ADA'
      if (statusSoal !== 'DISETUJUI') {
        belumAdaSoal.push({ mapel_id: m.id, nama_mapel: m.nama, kelas: namaKelas, status_soal: statusSoal, guru_id: m.guru_id })
      }
    }
  }

  // Guru aktif yang belum pernah ditugaskan mengawas di jadwal manapun
  const guruPernahMengawas = new Set(jadwalList.map(j => j.pengawas).filter(Boolean))
  const guruBelumMengawas = guruList
    .filter(g => g.status !== 'NONAKTIF' && !guruPernahMengawas.has(g.username))
    .map(g => ({ username: g.username, nama: g.nama }))

  return {
    belum_dijadwalkan: belumDijadwalkan,
    belum_ada_soal: belumAdaSoal,
    guru_belum_mengawas: guruBelumMengawas,
  }
}
