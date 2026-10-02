// Pemuat data pengingat "sesi belum ditutup" (SERVER saja). Dipakai oleh:
//   - GET /api/guru/pengingat-tutup-sesi   (sesi milik guru yang sedang login)
//   - GET /api/admin/sesi-belum-ditutup    (semua sesi, lengkap dengan kontak)
//
// HANYA MEMBACA data. Tidak menutup sesi apa pun dan tidak mengubah baris
// database mana pun. Penutupan tetap lewat endpoint yang sudah ada
// (/api/guru/mode-pengawas/tutup dan /api/admin/sesi/[id]/tutup-paksa).

import { createAdminClient } from '@/lib/supabase'
import { getZonaWaktuSekolah } from '@/lib/pengaturan-waktu'
import { ambilTargetSiswaSesi } from '@/lib/target-siswa-sesi'
import {
  bolehTutupLangsung,
  hitungPeserta,
  labelJamZona,
  labelTanggalZona,
  tentukanKondisiSesi,
  type SesiPengingat,
  type ZonaWaktuInfo,
} from '@/lib/pengingat-tutup-sesi'

type DbClient = ReturnType<typeof createAdminClient>

interface BarisSiswaUjian { sesi_id: string; nis: string; status: string | null; waktu_selesai: string | null }

// PostgREST membatasi satu respons (default 1000 baris), jadi dibaca per halaman.
async function ambilBarisSiswaUjian(db: DbClient, sesiIds: string[]): Promise<BarisSiswaUjian[]> {
  const hasil: BarisSiswaUjian[] = []
  const UKURAN = 1000
  for (let dari = 0; ; dari += UKURAN) {
    const { data, error } = await db
      .from('siswa_ujian')
      .select('sesi_id, nis, status, waktu_selesai')
      .in('sesi_id', sesiIds)
      .order('id', { ascending: true })
      .range(dari, dari + UKURAN - 1)
    if (error) throw new Error(error.message)
    const baris = (data ?? []) as BarisSiswaUjian[]
    hasil.push(...baris)
    if (baris.length < UKURAN) break
  }
  return hasil
}

export async function muatPengingatSesi(
  db: DbClient,
  opsi: {
    hanyaPengawas?: string // username: hanya sesi yang menjadi tanggung jawab guru ini
    sertakanKontak?: boolean // true = sertakan no_hp pengawas (khusus admin)
    sekarang?: Date // untuk pengujian
    zona?: ZonaWaktuInfo // untuk pengujian
  } = {}
): Promise<SesiPengingat[]> {
  const sekarang = opsi.sekarang ?? new Date()
  const zona = opsi.zona ?? (await getZonaWaktuSekolah())
  const off = zona.utcOffsetJam

  // 1) Semua sesi yang masih BERJALAN.
  const { data: sesiList, error: errSesi } = await db
    .from('sesi_ujian')
    .select('id, jadwal_id, mapel_id, kelas, waktu_mulai, durasi, is_darurat, siswa_diizinkan, info_json')
    .eq('status', 'BERJALAN')
  if (errSesi) throw new Error(errSesi.message)
  if (!sesiList?.length) return []

  // 2) Pengawas yang bertanggung jawab. Aturan SAMA dengan verifySesiOwnership
  //    dan /api/guru/sesi-terlupa: sesi susulan yang dibuka admin menjadi
  //    tanggung jawab pengawas susulan; selain itu pengawas di jadwal.
  const jadwalIds = [...new Set(sesiList.map(s => s.jadwal_id).filter(Boolean))] as string[]
  const { data: jadwalList } = jadwalIds.length
    ? await db.from('jadwal').select('id, pengawas').in('id', jadwalIds)
    : { data: [] as Array<{ id: string; pengawas: string | null }> }
  const pengawasJadwal = new Map((jadwalList ?? []).map(j => [j.id, j.pengawas as string | null]))

  const tanggungJawab = new Map<string, string>() // sesiId -> username
  for (const s of sesiList) {
    const susulanAdmin = !!s.info_json?.dibuka_oleh_admin && !!s.info_json?.pengawas_susulan
    const username = susulanAdmin ? s.info_json.pengawas_susulan : pengawasJadwal.get(s.jadwal_id)
    if (username) tanggungJawab.set(s.id, String(username))
  }

  const relevan = sesiList.filter(s => {
    const u = tanggungJawab.get(s.id)
    if (opsi.hanyaPengawas) return u === opsi.hanyaPengawas
    return true
  })
  if (!relevan.length) return []

  // 3) Hitungan peserta per sesi.
  const sesiIds = relevan.map(s => s.id)
  const semuaBaris = await ambilBarisSiswaUjian(db, sesiIds)
  const barisPerSesi = new Map<string, BarisSiswaUjian[]>()
  for (const b of semuaBaris) {
    const arr = barisPerSesi.get(b.sesi_id) ?? []
    arr.push(b)
    barisPerSesi.set(b.sesi_id, arr)
  }

  // 4) Tentukan kondisi tiap sesi. "Belum masuk" hanya dihitung bila perlu
  //    (semua yang sudah masuk telah selesai), supaya hemat query.
  const kandidat: Array<{
    sesi: (typeof relevan)[number]
    peserta: ReturnType<typeof hitungPeserta>
    belumMasuk: number | null
    kondisi: ReturnType<typeof tentukanKondisiSesi>
  }> = []

  for (const s of relevan) {
    const baris = barisPerSesi.get(s.id) ?? []
    const peserta = hitungPeserta(baris)
    let belumMasuk: number | null = null
    if (peserta.totalMasuk > 0 && peserta.aktif + peserta.reset === 0) {
      const masuk = new Set(baris.map(b => b.nis))
      const target = await ambilTargetSiswaSesi(
        db,
        { kelas: s.kelas, is_darurat: s.is_darurat, siswa_diizinkan: s.siswa_diizinkan },
        [...masuk]
      )
      belumMasuk = target.filter(t => !masuk.has(t.nis)).length
    }
    const kondisi = tentukanKondisiSesi({
      sekarang, utcOffsetJam: off, waktuMulai: s.waktu_mulai,
      durasiMenit: s.durasi, peserta, belumMasuk,
    })
    if (kondisi.jenis) kandidat.push({ sesi: s, peserta, belumMasuk, kondisi })
  }
  if (!kandidat.length) return []

  // 5) Nama mapel, kelas, dan pengawas.
  const mapelIds = [...new Set(kandidat.map(k => k.sesi.mapel_id).filter(Boolean))] as string[]
  const kelasIds = [...new Set(kandidat.map(k => k.sesi.kelas).filter(Boolean))] as string[]
  const usernames = [...new Set(kandidat.map(k => tanggungJawab.get(k.sesi.id)).filter(Boolean))] as string[]
  const [mapelRes, kelasRes, userRes] = await Promise.all([
    mapelIds.length ? db.from('mapel').select('id, nama').in('id', mapelIds) : Promise.resolve({ data: [] as Array<{ id: string; nama: string }> }),
    kelasIds.length ? db.from('kelas').select('id, nama').in('id', kelasIds) : Promise.resolve({ data: [] as Array<{ id: string; nama: string }> }),
    usernames.length ? db.from('users').select('username, nama, no_hp').in('username', usernames) : Promise.resolve({ data: [] as Array<{ username: string; nama: string; no_hp: string | null }> }),
  ])
  const mapelMap = new Map((mapelRes.data ?? []).map((m: { id: string; nama: string }) => [m.id, m.nama]))
  const kelasMap = new Map((kelasRes.data ?? []).map((k: { id: string; nama: string }) => [k.id, k.nama]))
  const userMap = new Map((userRes.data ?? []).map((u: { username: string; nama: string; no_hp: string | null }) => [u.username, u]))

  const urutan = { KEMARIN: 0, LEWAT_WAKTU: 1, SEMUA_SELESAI: 2 } as const

  return kandidat
    .map(({ sesi, peserta, belumMasuk, kondisi }): SesiPengingat => {
      const username = tanggungJawab.get(sesi.id) ?? ''
      const u = userMap.get(username)
      return {
        sesiId: sesi.id,
        jadwalId: sesi.jadwal_id ?? null,
        namaMapel: mapelMap.get(sesi.mapel_id) ?? sesi.mapel_id ?? '-',
        namaKelas: kelasMap.get(sesi.kelas) ?? sesi.kelas ?? '-',
        isSusulan: !!sesi.info_json?.dibuka_oleh_admin || !!sesi.is_darurat,
        waktuMulai: sesi.waktu_mulai,
        labelTanggal: labelTanggalZona(sesi.waktu_mulai, off),
        labelJamMulai: labelJamZona(sesi.waktu_mulai, off),
        durasiMenit: sesi.durasi && sesi.durasi > 0 ? sesi.durasi : 90,
        jenis: kondisi.jenis!,
        kemarin: kondisi.kemarin,
        lewatWaktu: kondisi.lewatWaktu,
        semuaSelesai: kondisi.semuaSelesai,
        bolehTutupLangsung: bolehTutupLangsung(kondisi, peserta),
        peserta: {
          aktif: peserta.aktif, reset: peserta.reset, selesai: peserta.selesai,
          terkunci: peserta.terkunci, belumMasuk,
        },
        pengawas: {
          username,
          nama: u?.nama ?? username,
          noHp: opsi.sertakanKontak ? (u?.no_hp ?? null) : null,
        },
      }
    })
    .sort((a, b) =>
      urutan[a.jenis] - urutan[b.jenis] || a.waktuMulai.localeCompare(b.waktuMulai)
    )
}
