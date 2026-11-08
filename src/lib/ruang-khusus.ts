// src/lib/ruang-khusus.ts
//
// ── RUANG KHUSUS (lab komputer untuk siswa tanpa HP) ────────────────────────
// Dasar rancangan (lihat supabase/65_ruang_khusus.sql):
//   - Admin membuat ruang: memilih jadwal yang belum selesai + satu guru
//     pengawas ruang.
//   - Pengawas ruang mencentang siswa -> "Proses". Siswa yang relevan
//     ditempatkan (ruang_khusus_siswa), sisanya diabaikan dengan alasan.
//   - "Mulai sesi" membuat SATU sesi_ujian per jadwal yang dipakai siswa ruang
//     (ruang_khusus_id terisi). Soal dan nilai terikat mapel+kelas, jadi sesi
//     per jadwal tidak bisa dihindari. Pengguna hanya melihat satu ruang dan
//     SATU kode (kode_ruang) untuk semua siswa lab.
//   - Siswa yang ditempatkan LEPAS dari sesi kelasnya.
//   - Kepemilikan sesi ruang memakai pola susulan yang sudah ada:
//     info_json.dibuka_oleh_admin + info_json.pengawas_susulan = pengawas ruang.
//     Jadi verifySesiOwnership, pengingat tutup sesi, sesi-terlupa, dan Mode
//     Pengawas bekerja tanpa perubahan besar.

import type { createAdminClient } from '@/lib/supabase'
import { generateId } from '@/lib/utils'
import { getZonaWaktuSekolah, tanggalHariIni } from '@/lib/pengaturan-waktu'
import { getStatusSoalDetail, isStatusSoalSiap, pesanStatusSoal } from '@/lib/soal-status'
import { resolveEssayInfoJson } from '@/lib/gabungKirim'
import { isKonflikSesiBerjalan } from '@/lib/sesi-unik'
import { cariSesiRuangBerjalan } from '@/lib/sesi-utama'

type DbClient = ReturnType<typeof createAdminClient>

export const STATUS_RUANG_AKTIF = ['MENUNGGU', 'BERJALAN'] as const

export interface JadwalRuang {
  id: string
  tanggal: string
  sesi?: number | null
  jam_mulai: string
  jam_selesai: string
  mapel_id: string
  kelas: string
  pengawas: string | null
  durasi: number | null
  status: string | null
  essay_instruksi?: string | null
  essay_durasi_menit?: number | null
}

export interface RuangKhusus {
  id: string
  nama: string | null
  pengawas: string
  kode_ruang: string
  jadwal_ids: string[]
  status: string
}

const HURUF_KODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateKode7(): string {
  let kode = ''
  for (let i = 0; i < 7; i++) kode += HURUF_KODE[Math.floor(Math.random() * HURUF_KODE.length)]
  return kode
}

/**
 * Kode ruang 7 karakter yang tidak dipakai ruang aktif lain DAN tidak sama
 * dengan kode_sesi mana pun. Input siswa dibatasi 7 karakter, jadi kode ruang
 * tidak bisa dibuat lebih panjang supaya terpisah dari kode_sesi.
 */
export async function buatKodeRuangUnik(db: DbClient): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const kode = generateKode7()
    const [{ data: r }, { data: s }] = await Promise.all([
      db.from('ruang_khusus').select('id').eq('kode_ruang', kode).in('status', [...STATUS_RUANG_AKTIF]).limit(1),
      db.from('sesi_ujian').select('id').eq('kode_sesi', kode).limit(1),
    ])
    if ((r ?? []).length === 0 && (s ?? []).length === 0) return kode
  }
  throw new Error('Gagal membuat kode ruang unik, coba lagi.')
}

const tanggal10 = (v: unknown) => String(v ?? '').slice(0, 10)
const tumpangTindih = (a: { jam_mulai: string; jam_selesai: string }, b: { jam_mulai: string; jam_selesai: string }) =>
  a.jam_mulai < b.jam_selesai && a.jam_selesai > b.jam_mulai

/**
 * Apakah guru bebas pada jam semua jadwal ini? Aturannya sama dengan Admin
 * Jadwal (tumpang tindih jam pada tanggal yang sama), bukan sekadar nomor
 * sesi. Dicek terhadap: jadwal biasa sebagai pengawas, ruang khusus aktif lain,
 * dan sesi susulan yang ditugaskan admin.
 */
export async function cekGuruBebas(
  db: DbClient,
  username: string,
  jadwalList: Array<Pick<JadwalRuang, 'id' | 'tanggal' | 'jam_mulai' | 'jam_selesai'>>,
  kecualiRuangId?: string
): Promise<{ bebas: true } | { bebas: false; alasan: string }> {
  if (jadwalList.length === 0) return { bebas: true }

  // 1) Jadwal biasa sebagai pengawas.
  const { data: jadwalSaya } = await db
    .from('jadwal').select('id, tanggal, jam_mulai, jam_selesai').eq('pengawas', username)
  for (const j of jadwalList) {
    const bentrok = (jadwalSaya ?? []).find(x =>
      tanggal10(x.tanggal) === tanggal10(j.tanggal) && tumpangTindih(x, j))
    if (bentrok) {
      return { bebas: false, alasan: `Guru ini sudah bertugas sebagai pengawas pada ${tanggal10(bentrok.tanggal)} jam ${bentrok.jam_mulai}–${bentrok.jam_selesai}.` }
    }
  }

  // 2) Ruang khusus aktif lain milik guru ini.
  const { data: ruangLain } = await db
    .from('ruang_khusus').select('id, nama, jadwal_ids')
    .eq('pengawas', username).in('status', [...STATUS_RUANG_AKTIF])
  const idJadwalRuangLain = [...new Set(
    (ruangLain ?? []).filter(r => r.id !== kecualiRuangId).flatMap(r => (r.jadwal_ids ?? []) as string[])
  )]
  if (idJadwalRuangLain.length > 0) {
    const { data: jadwalRuangLain } = await db
      .from('jadwal').select('id, tanggal, jam_mulai, jam_selesai').in('id', idJadwalRuangLain)
    for (const j of jadwalList) {
      const bentrok = (jadwalRuangLain ?? []).find(x =>
        tanggal10(x.tanggal) === tanggal10(j.tanggal) && tumpangTindih(x, j))
      if (bentrok) {
        return { bebas: false, alasan: `Guru ini sudah menjadi pengawas ruang khusus lain pada ${tanggal10(bentrok.tanggal)} jam ${bentrok.jam_mulai}–${bentrok.jam_selesai}.` }
      }
    }
  }

  // 3) Sesi susulan BERJALAN yang ditugaskan admin ke guru ini.
  const { data: sesiSusulan } = await db
    .from('sesi_ujian').select('jadwal_id')
    .eq('status', 'BERJALAN').is('ruang_khusus_id', null)
    .contains('info_json', { pengawas_susulan: username })
  const idJadwalSusulan = [...new Set((sesiSusulan ?? []).map(s => s.jadwal_id).filter(Boolean))] as string[]
  if (idJadwalSusulan.length > 0) {
    const { data: jadwalSusulan } = await db
      .from('jadwal').select('id, tanggal, jam_mulai, jam_selesai').in('id', idJadwalSusulan)
    for (const j of jadwalList) {
      const bentrok = (jadwalSusulan ?? []).find(x =>
        tanggal10(x.tanggal) === tanggal10(j.tanggal) && tumpangTindih(x, j))
      if (bentrok) {
        return { bebas: false, alasan: 'Guru ini sedang mengawas sesi susulan pada jam yang bertabrakan.' }
      }
    }
  }
  return { bebas: true }
}

/**
 * Siswa (dari `nisList`) yang SUDAH terlibat di jadwal ini lewat sesi apa pun:
 * punya baris siswa_ujian (AKTIF/RESET/SELESAI/TERKUNCI) atau sudah bernilai.
 * `kecualiSesiId` mengabaikan satu sesi (mis. sesi ruang yang sedang dibuka).
 */
export async function nisSudahTerlibat(
  db: DbClient,
  jadwalId: string,
  nisList: string[],
  kecualiSesiId?: string
): Promise<Set<string>> {
  if (nisList.length === 0) return new Set()
  const { data: sesiList } = await db.from('sesi_ujian').select('id').eq('jadwal_id', jadwalId)
  const sesiIds = (sesiList ?? []).map(s => s.id).filter(id => id !== kecualiSesiId)
  if (sesiIds.length === 0) return new Set()
  const [{ data: su }, { data: nl }] = await Promise.all([
    db.from('siswa_ujian').select('nis').in('sesi_id', sesiIds).in('nis', nisList),
    db.from('nilai').select('nis').in('sesi_id', sesiIds).in('nis', nisList),
  ])
  return new Set([...(su ?? []), ...(nl ?? [])].map(r => String(r.nis)))
}

/** Peta nis -> penempatan aktif (DIPROSES) pada sebuah jadwal. */
export async function petaPenempatanJadwal(
  db: DbClient,
  jadwalId: string
): Promise<Map<string, { ruang_id: string; sesi_id: string | null }>> {
  const { data } = await db
    .from('ruang_khusus_siswa')
    .select('nis, ruang_id, sesi_id')
    .eq('jadwal_id', jadwalId)
    .eq('status', 'DIPROSES')
  return new Map((data ?? []).map(r => [String(r.nis), { ruang_id: r.ruang_id as string, sesi_id: (r.sesi_id as string | null) ?? null }]))
}

export interface HasilBukaSesiRuang {
  ok: boolean
  sesiId?: string
  sudahAda?: boolean
  error?: string
  status?: number
  essayBelumSiap?: boolean
}

/**
 * Buka (atau ambil yang sudah ada) sesi ruang untuk satu jadwal. Syarat sama
 * dengan POST /api/guru/mode-pengawas: jadwal bertanggal hari ini, paket soal
 * siap, tidak ada paket essay yang menggantung. Anti-tabrakan LEVEL KELAS
 * sengaja tidak dipakai: siswa ruang terpisah dari kelas, dan penjagaan yang
 * relevan ada per siswa (nisSudahTerlibat + uq_ruang_khusus_siswa_aktif).
 */
export async function bukaSesiRuang(
  db: DbClient,
  opsi: { yayasanId: string; ruang: RuangKhusus; jadwal: JadwalRuang; namaPengawas: string }
): Promise<HasilBukaSesiRuang> {
  const { yayasanId, ruang, jadwal, namaPengawas } = opsi

  const ada = await cariSesiRuangBerjalan(db, jadwal.id, ruang.id)
  if (ada) return { ok: true, sesiId: ada.id, sudahAda: true }

  const zona = await getZonaWaktuSekolah(yayasanId)
  const hariIni = tanggalHariIni(zona)
  const tglJadwal = tanggal10(jadwal.tanggal)
  if (tglJadwal !== hariIni) {
    return {
      ok: false, status: 400,
      error: tglJadwal > hariIni
        ? `Jadwal ini baru dilaksanakan pada ${tglJadwal}. Sesi hanya dapat dibuka pada hari pelaksanaan.`
        : `Jadwal ini dijadwalkan pada ${tglJadwal} dan sudah lewat.`,
    }
  }

  const { status: statusSoal, namaGuru } = await getStatusSoalDetail(jadwal.mapel_id, String(jadwal.kelas), yayasanId)
  if (!isStatusSoalSiap(statusSoal)) {
    return { ok: false, status: 400, error: pesanStatusSoal(statusSoal, namaGuru) }
  }

  // Paket essay yang belum disetujui menahan pembukaan sesi (aturan sama dengan Mode Pengawas).
  const { data: kelasRow } = await db.from('kelas').select('id').eq('nama', String(jadwal.kelas)).maybeSingle()
  const kelasIdEssay = kelasRow?.id ?? String(jadwal.kelas)
  const { data: paketEssayList } = await db
    .from('paket_essay').select('status, jumlah_soal').eq('mapel_id', jadwal.mapel_id).eq('kelas_id', kelasIdEssay)
  const sudahDisetujui = (paketEssayList ?? []).some(p => p.status === 'DISETUJUI')
  const belumDiajukan = (paketEssayList ?? []).find(p => p.status !== 'DISETUJUI' && (p.jumlah_soal ?? 0) > 0)
  if (!sudahDisetujui && belumDiajukan) {
    return {
      ok: false, status: 409, essayBelumSiap: true,
      error: 'Ada soal Essay untuk mapel ini yang belum disetujui admin. Sesi tidak bisa dibuka sampai soal essay disetujui atau dihapus dari bank soal.',
    }
  }

  const infoEssay = await resolveEssayInfoJson(db, {
    mapelId: jadwal.mapel_id,
    kelasNama: String(jadwal.kelas),
    instruksi: jadwal.essay_instruksi,
    durasiEssayAdmin: jadwal.essay_durasi_menit,
  })

  // Bobot PG:Essay harus sama dengan sesi kelas untuk jadwal yang sama (ujiannya
  // sama): bila guru pengampu sudah mengubah bobot di sesi kelas, ikuti itu.
  const { data: sesiKelasLain } = await db
    .from('sesi_ujian').select('info_json')
    .eq('jadwal_id', jadwal.id).is('ruang_khusus_id', null)
    .order('waktu_mulai', { ascending: false }).limit(1)
  const bobotKelas = sesiKelasLain?.[0]?.info_json as { essay_bobot_pg_persen?: number; essay_bobot_essay_persen?: number } | null | undefined
  const infoEssaySelaras = (bobotKelas?.essay_bobot_pg_persen != null && bobotKelas?.essay_bobot_essay_persen != null)
    ? { ...infoEssay, essay_bobot_pg_persen: bobotKelas.essay_bobot_pg_persen, essay_bobot_essay_persen: bobotKelas.essay_bobot_essay_persen }
    : infoEssay

  const sesiId = generateId('SES')
  // kode_sesi tetap diisi (kolom UNIQUE); siswa memakai kode_ruang, bukan ini.
  for (let percobaan = 0; percobaan < 3; percobaan++) {
    const { error } = await db.from('sesi_ujian').insert({
      id: sesiId,
      jadwal_id: jadwal.id,
      mapel_id: jadwal.mapel_id,
      kelas: String(jadwal.kelas),
      durasi: jadwal.durasi,
      kode_sesi: generateKode7(),
      status: 'BERJALAN',
      waktu_mulai: new Date().toISOString(),
      jumlah_peserta: 0,
      ruang_khusus_id: ruang.id,
      info_json: {
        ...infoEssaySelaras,
        dibuka_oleh_admin: true,
        pengawas_susulan: ruang.pengawas,
        pengawas_susulan_nama: namaPengawas,
        pengawas_asli: jadwal.pengawas ?? null,
        ruang_khusus_id: ruang.id,
        ruang_khusus_nama: ruang.nama ?? null,
      },
    })
    if (!error) {
      await db.from('jadwal').update({ status: 'BERJALAN' }).eq('id', jadwal.id)
      return { ok: true, sesiId }
    }
    if (isKonflikSesiBerjalan(error)) {
      const pemenang = await cariSesiRuangBerjalan(db, jadwal.id, ruang.id)
      if (pemenang) return { ok: true, sesiId: pemenang.id, sudahAda: true }
    }
    // Bentrok kode_sesi acak: coba lagi dengan kode lain. Error lain: berhenti.
    if (!(error.code === '23505' && `${error.message}`.includes('kode_sesi'))) {
      return { ok: false, status: 500, error: error.message }
    }
  }
  return { ok: false, status: 500, error: 'Gagal membuat kode sesi unik, coba lagi.' }
}

/**
 * Dipanggil setelah sebuah sesi ditutup (tutup biasa maupun tutup paksa).
 * Untuk sesi RUANG: siswa yang ditempatkan untuk jadwal itu tetapi belum
 * pernah masuk dilepas (supaya bisa mengikuti susulan), dan ruang menjadi
 * SELESAI bila tidak ada lagi sesinya yang BERJALAN. Sesi kelas: tidak
 * melakukan apa pun. Tidak melempar error -- penutupan sesi tidak boleh gagal
 * karena urusan ruang.
 */
export async function setelahSesiDitutup(db: DbClient, sesiId: string): Promise<void> {
  try {
    const { data: sesi } = await db
      .from('sesi_ujian').select('id, jadwal_id, ruang_khusus_id').eq('id', sesiId).maybeSingle()
    if (!sesi?.ruang_khusus_id) return
    const ruangId = sesi.ruang_khusus_id as string

    const { data: masuk } = await db.from('siswa_ujian').select('nis').eq('sesi_id', sesiId)
    const nisMasuk = new Set((masuk ?? []).map(r => String(r.nis)))
    const { data: penempatan } = await db
      .from('ruang_khusus_siswa').select('id, nis')
      .eq('ruang_id', ruangId).eq('jadwal_id', sesi.jadwal_id).eq('status', 'DIPROSES')
    const idDilepas = (penempatan ?? []).filter(p => !nisMasuk.has(String(p.nis))).map(p => p.id)
    if (idDilepas.length > 0) {
      await db.from('ruang_khusus_siswa')
        .update({ status: 'DILEPAS', dilepas_oleh: 'sistem (sesi ruang ditutup)', dilepas_pada: new Date().toISOString() })
        .in('id', idDilepas)
    }

    const { data: masihJalan } = await db
      .from('sesi_ujian').select('id').eq('ruang_khusus_id', ruangId).eq('status', 'BERJALAN').limit(1)
    if ((masihJalan ?? []).length === 0) {
      await db.from('ruang_khusus')
        .update({ status: 'SELESAI', waktu_selesai: new Date().toISOString() })
        .eq('id', ruangId).in('status', [...STATUS_RUANG_AKTIF])
    }
  } catch (e) {
    console.error('[ruang-khusus] setelahSesiDitutup gagal:', e)
  }
}

/** NIS siswa yang ditempatkan (DIPROSES) pada pasangan ruang+jadwal tertentu. */
export async function nisPenempatanRuangJadwal(db: DbClient, ruangId: string, jadwalId: string): Promise<string[]> {
  const { data } = await db
    .from('ruang_khusus_siswa').select('nis')
    .eq('ruang_id', ruangId).eq('jadwal_id', jadwalId).eq('status', 'DIPROSES')
  return (data ?? []).map(r => String(r.nis))
}

export const KOLOM_SESI_VALIDASI =
  'id, mapel_id, kelas, durasi, is_darurat, siswa_diizinkan, paket_soal_id, jadwal_id, ruang_khusus_id'

/**
 * Dipanggil validasi token ketika kode yang diketik BUKAN kode_sesi mana pun.
 * Kalau kode itu adalah kode ruang aktif, cari sesi RUANG yang sesuai dengan
 * penempatan siswa ini (kelas+mapel-nya).
 *  - { tidakDikenal: true }  -> bukan kode ruang; validasi lanjut dengan pesan umum.
 *  - { pesan }               -> kode ruang dikenal tetapi siswa belum bisa masuk.
 *  - { sesi }                -> sesi ruang yang sah untuk siswa ini.
 */
export async function resolveSesiDariKodeRuang(
  db: DbClient,
  kode: string,
  nis: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ tidakDikenal: true } | { pesan: string } | { sesi: any }> {
  const { data: ruang } = await db
    .from('ruang_khusus')
    .select('id, status')
    .eq('kode_ruang', kode)
    .in('status', [...STATUS_RUANG_AKTIF])
    .limit(1)
    .maybeSingle()
  if (!ruang) return { tidakDikenal: true }

  const { data: penempatan } = await db
    .from('ruang_khusus_siswa')
    .select('jadwal_id')
    .eq('ruang_id', ruang.id).eq('nis', nis).eq('status', 'DIPROSES')
  if (!penempatan?.length) {
    return { pesan: 'Anda tidak terdaftar di ruang khusus ini. Hubungi pengawas ruang.' }
  }
  if (ruang.status === 'MENUNGGU') {
    return { pesan: 'Ujian di ruang khusus ini belum dimulai. Tunggu pengawas menekan Mulai sesi.' }
  }

  const idJadwalSiswa = penempatan.map(p => p.jadwal_id as string)
  const { data: sesiRuang } = await db
    .from('sesi_ujian')
    .select(`${KOLOM_SESI_VALIDASI}, waktu_mulai`)
    .eq('ruang_khusus_id', ruang.id)
    .eq('status', 'BERJALAN')
    .in('jadwal_id', idJadwalSiswa)
    .limit(50)
  if (!sesiRuang?.length) {
    return { pesan: 'Sesi ujian Anda di ruang ini belum dimulai atau sudah selesai.' }
  }

  // FIX (siswa dengan 2+ jadwal di satu ruang): sebelumnya sesi dipilih dengan
  // mengecek "apakah siswa terlibat di sesi LAIN pada jadwal yang sama", yang
  // sengaja mengecualikan sesi miliknya sendiri. Akibatnya sesi yang SUDAH
  // selesai dikerjakan siswa tetap terpilih lagi (lalu ditolak "sudah
  // menyelesaikan ujian ini"), sehingga mapel berikutnya tidak pernah bisa
  // dimulai. Urutan sesi juga hanya mengikuti urutan pembuatan, bukan jam
  // jadwal, sehingga siswa yang login ulang saat mengerjakan bisa diarahkan ke
  // sesi yang salah. Sekarang: (1) lanjutkan sesi yang sedang dikerjakan,
  // (2) kalau tidak ada, ambil sesi berikutnya yang belum disentuh menurut jam
  // jadwal, (3) sesi yang sudah selesai tidak pernah dipilih lagi.
  const idSesi = sesiRuang.map(s => s.id as string)
  const [{ data: suSaya }, { data: nilaiSaya }, { data: jadwalRows }] = await Promise.all([
    db.from('siswa_ujian').select('sesi_id, status').in('sesi_id', idSesi).eq('nis', nis),
    db.from('nilai').select('sesi_id').in('sesi_id', idSesi).eq('nis', nis),
    db.from('jadwal').select('id, jam_mulai').in('id', idJadwalSiswa),
  ])
  const statusSaya = new Map((suSaya ?? []).map(r => [String(r.sesi_id), String(r.status)]))
  const sudahBernilai = new Set((nilaiSaya ?? []).map(r => String(r.sesi_id)))
  const jamJadwal = new Map((jadwalRows ?? []).map(j => [String(j.id), String(j.jam_mulai ?? '')]))
  const selesai = (sesiId: string) => sudahBernilai.has(sesiId) || statusSaya.get(sesiId) === 'SELESAI'

  const urut = [...sesiRuang].sort((a, b) =>
    (jamJadwal.get(String(a.jadwal_id)) ?? '').localeCompare(jamJadwal.get(String(b.jadwal_id)) ?? '') ||
    String(a.waktu_mulai ?? '').localeCompare(String(b.waktu_mulai ?? '')) ||
    String(a.id).localeCompare(String(b.id)))

  // 1) Sesi yang sedang dikerjakan (punya baris siswa_ujian, belum selesai):
  // lanjutkan di situ. Status RESET/TERKUNCI ikut, supaya pesannya muncul dari
  // sesi yang benar dan siswa tidak "melompat" ke mapel berikutnya.
  const sedangDikerjakan = urut.find(s => statusSaya.has(String(s.id)) && !selesai(String(s.id)))
  if (sedangDikerjakan) return { sesi: sedangDikerjakan }

  // 2) Sesi berikutnya yang belum disentuh. Satu siswa hanya boleh punya jejak
  // di SATU sesi per jadwal (nilai hanya unik per sesi+siswa), jadi lewati sesi
  // yang jadwalnya sudah dia ikuti di sesi lain (mis. sesi kelas).
  for (const s of urut) {
    if (statusSaya.has(String(s.id)) || sudahBernilai.has(String(s.id))) continue
    const terlibat = await nisSudahTerlibat(db, s.jadwal_id as string, [nis], s.id as string)
    if (!terlibat.has(nis)) return { sesi: s }
  }

  // 3) Tidak ada sesi yang bisa dimasuki.
  if (urut.every(s => selesai(String(s.id)))) return { pesan: 'Anda sudah menyelesaikan ujian ini.' }
  return { pesan: 'Anda sudah tercatat mengikuti ujian ini di sesi lain.' }
}
