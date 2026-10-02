// Logika MURNI (tanpa akses database, tanpa import server) untuk pengingat
// "sesi ujian belum ditutup". Aman diimpor dari komponen client maupun server.
//
// File ini hanya MENAMBAH fitur pengingat. Ia tidak mengubah aturan penutupan
// sesi, penilaian, ataupun popup lama (SesiTerlupaPopup / sesi-terlupa).
//
// Definisi yang dipakai konsisten dengan kode yang sudah ada:
//  - "Siswa masih mengerjakan" = status AKTIF atau RESET (sama dengan
//    /api/guru/sesi-terlupa). Untuk sesi yang punya essay, siswa tetap AKTIF
//    sampai essay terkirim, jadi aturan ini otomatis benar juga untuk essay.
//  - "Waktu seharusnya selesai" = waktu_mulai sesi + durasi sesi (rumus yang
//    sama dengan sesi-terlupa dan batas waktu siswa). Pengingat merah baru
//    muncul setelah ditambah toleransi 30 menit, sama dengan penanda
//    `terlambat` di panel pemantauan admin (siswa yang masuk terlambat punya
//    timer sendiri, jangan sampai pengawas diganggu terlalu cepat).

import type { ZonaWaktuInfo } from '@/lib/wilayah'

export const DURASI_DEFAULT_MENIT = 90
export const TOLERANSI_LEWAT_WAKTU_MENIT = 30
// Jeda sejak siswa terakhir selesai sebelum prompt "semua selesai" muncul.
// Kalau SEMUA siswa target sudah masuk dan selesai: cukup 1 menit. Kalau masih
// ada siswa yang belum pernah masuk (mis. sakit/izin): tunggu 10 menit supaya
// pengawas tidak diganggu di menit-menit awal ketika siswa lain belum login.
export const JEDA_SEMUA_MASUK_MENIT = 1
export const JEDA_ADA_BELUM_MASUK_MENIT = 10

export type JenisPengingat = 'KEMARIN' | 'LEWAT_WAKTU' | 'SEMUA_SELESAI'

export interface HitunganPeserta {
  aktif: number // AKTIF: masih mengerjakan (PG atau essay)
  reset: number // RESET: menunggu kode reset dari pengawas
  selesai: number
  terkunci: number
  lainnya: number
  totalMasuk: number // jumlah baris siswa_ujian di sesi ini
  waktuSelesaiTerakhir: string | null // ISO, dari siswa berstatus SELESAI
}

export interface KondisiSesi {
  kemarin: boolean
  lewatWaktu: boolean
  semuaSelesai: boolean
  jenis: JenisPengingat | null
}

// Bentuk data yang dikirim API ke tampilan (guru dan admin).
export interface SesiPengingat {
  sesiId: string
  jadwalId: string | null
  namaMapel: string
  namaKelas: string
  isSusulan: boolean
  waktuMulai: string
  labelTanggal: string
  labelJamMulai: string
  durasiMenit: number
  jenis: JenisPengingat
  kemarin: boolean
  lewatWaktu: boolean
  semuaSelesai: boolean
  bolehTutupLangsung: boolean
  peserta: {
    aktif: number
    reset: number
    selesai: number
    terkunci: number
    belumMasuk: number | null // null = tidak dihitung
  }
  pengawas: { username: string; nama: string; noHp: string | null }
}

export function hitungPeserta(
  rows: Array<{ status: string | null; waktu_selesai?: string | null }>
): HitunganPeserta {
  const h: HitunganPeserta = {
    aktif: 0, reset: 0, selesai: 0, terkunci: 0, lainnya: 0,
    totalMasuk: rows.length, waktuSelesaiTerakhir: null,
  }
  let terakhir = -Infinity
  for (const r of rows) {
    switch (r.status) {
      case 'AKTIF': h.aktif++; break
      case 'RESET': h.reset++; break
      case 'TERKUNCI': h.terkunci++; break
      case 'SELESAI': {
        h.selesai++
        const t = r.waktu_selesai ? new Date(r.waktu_selesai).getTime() : NaN
        if (!Number.isNaN(t) && t > terakhir) {
          terakhir = t
          h.waktuSelesaiTerakhir = new Date(t).toISOString()
        }
        break
      }
      default: h.lainnya++
    }
  }
  return h
}

// "YYYY-MM-DD" pada zona sekolah. Sengaja tidak memakai pengaturan-waktu.ts
// (file itu mengimpor klien database server, tidak boleh masuk bundel client).
export function tanggalDalamZona(waktu: Date | string | number, utcOffsetJam: number): string {
  const t = new Date(waktu).getTime()
  if (Number.isNaN(t)) return ''
  return new Date(t + utcOffsetJam * 3_600_000).toISOString().slice(0, 10)
}

export function labelTanggalZona(waktu: Date | string | number, utcOffsetJam: number): string {
  const t = new Date(waktu).getTime()
  if (Number.isNaN(t)) return '-'
  return new Date(t + utcOffsetJam * 3_600_000).toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  })
}

export function labelJamZona(waktu: Date | string | number, utcOffsetJam: number): string {
  const t = new Date(waktu).getTime()
  if (Number.isNaN(t)) return '-'
  const d = new Date(t + utcOffsetJam * 3_600_000)
  return `${String(d.getUTCHours()).padStart(2, '0')}.${String(d.getUTCMinutes()).padStart(2, '0')}`
}

export function tentukanKondisiSesi(a: {
  sekarang: Date
  utcOffsetJam: number
  waktuMulai: string
  durasiMenit: number | null | undefined
  peserta: HitunganPeserta
  belumMasuk: number | null
}): KondisiSesi {
  const mulai = new Date(a.waktuMulai).getTime()
  const kosong: KondisiSesi = { kemarin: false, lewatWaktu: false, semuaSelesai: false, jenis: null }
  if (Number.isNaN(mulai)) return kosong

  const sekarang = a.sekarang.getTime()
  const kemarin =
    tanggalDalamZona(mulai, a.utcOffsetJam) < tanggalDalamZona(sekarang, a.utcOffsetJam)

  const durasi = a.durasiMenit && a.durasiMenit > 0 ? a.durasiMenit : DURASI_DEFAULT_MENIT
  const lewatWaktu = sekarang >= mulai + (durasi + TOLERANSI_LEWAT_WAKTU_MENIT) * 60_000

  const p = a.peserta
  let semuaSelesai = false
  if (p.totalMasuk > 0 && p.aktif + p.reset === 0) {
    let acuan = p.waktuSelesaiTerakhir ? new Date(p.waktuSelesaiTerakhir).getTime() : mulai
    if (Number.isNaN(acuan)) acuan = mulai
    const jedaMenit = a.belumMasuk === 0 ? JEDA_SEMUA_MASUK_MENIT : JEDA_ADA_BELUM_MASUK_MENIT
    semuaSelesai = sekarang - acuan >= jedaMenit * 60_000
  }

  const jenis: JenisPengingat | null = kemarin
    ? 'KEMARIN'
    : lewatWaktu
      ? 'LEWAT_WAKTU'
      : semuaSelesai
        ? 'SEMUA_SELESAI'
        : null

  return { kemarin, lewatWaktu, semuaSelesai, jenis }
}

// Boleh ditawarkan tombol "Tutup Sesi" langsung? Sesi dari hari kemarin: ya
// (siswa yang masih berstatus AKTIF di sana pasti sudah tidak mengerjakan).
// Sesi hari ini: hanya kalau tidak ada siswa yang masih mengerjakan; kalau
// masih ada, pengawas diarahkan memeriksa dulu di Mode Pengawas.
export function bolehTutupLangsung(k: KondisiSesi, p: Pick<HitunganPeserta, 'aktif' | 'reset'>): boolean {
  return k.kemarin || p.aktif + p.reset === 0
}

// ── WhatsApp ────────────────────────────────────────────────────────────────

// Normalisasi nomor HP Indonesia ke format wa.me (62xxxxxxxxxx). null = tidak valid.
export function nomorWhatsApp(noHp: string | null | undefined): string | null {
  if (!noHp) return null
  let d = String(noHp).replace(/\D/g, '')
  if (d.startsWith('0')) d = '62' + d.slice(1)
  else if (d.startsWith('8')) d = '62' + d
  return /^62\d{8,13}$/.test(d) ? d : null
}

export function linkWhatsApp(noHp: string | null | undefined, pesan: string): string | null {
  const n = nomorWhatsApp(noHp)
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(pesan)}` : null
}

export function pesanWhatsAppPengawas(a: {
  namaPengawas: string
  namaMapel: string
  namaKelas: string
  labelTanggal: string
}): string {
  return (
    `Assalamu'alaikum ${a.namaPengawas}. Sesi ujian ${a.namaMapel} kelas ${a.namaKelas} ` +
    `(${a.labelTanggal}) di SmartExam masih berstatus berjalan dan belum ditutup. ` +
    `Mohon segera ditutup lewat menu Mode Pengawas agar nilai siswa dapat diproses. Terima kasih.`
  )
}

export type { ZonaWaktuInfo }
