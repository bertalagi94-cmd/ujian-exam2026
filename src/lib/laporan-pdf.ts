// ── PDF "LAPORAN LENGKAP" ADMIN: 1 FILE PER TAHAP, TABEL SEDERHANA ───────────
// Dipakai halaman /admin/laporan. Tiap tahap (Pra Ujian, Saat Ujian, Setelah
// Ujian) diunduh sebagai FILE TERPISAH — tidak lagi digabung dalam satu PDF.
//
// Di dalam satu file, data tetap dipisah per jenjang/sekolah (kop sekolah
// sendiri-sendiri) supaya data antar jenjang TIDAK PERNAH tercampur.
//
// Tiap jenjang berisi dua blok yang jelas:
//   A. BELUM LENGKAP / BELUM TUNTAS  → mapel + kelas yang masih perlu ditindaklanjuti
//   B. SUDAH LENGKAP / SUDAH TUNTAS
// Dengan opsi "hanya yang belum", blok B tidak dimuat.
//
// File ini murni logika (tanpa React/DOM) dan menerima konstruktor jsPDF dari
// pemanggil, sehingga bisa diuji di Node dengan jsPDF asli.

import type { jsPDF } from 'jspdf'

// ── Tipe data (harus selaras dengan response /api/admin/laporan-lengkap) ─────
export interface JadwalItem {
  tanggal: string
  sesi: number
  jamMulai: string
  jamSelesai: string
  namaPengawas: string
  durasi: number
  statusJadwal: string
}
export interface RowLaporan {
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
    jadwal: JadwalItem[]
    adaEssay: boolean
    modeJawabanEssay: 'DIGITAL' | 'KERTAS' | null
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
export interface JenjangGroup {
  sekolahId: string | null
  label: string
  namaSekolah: string
  npsn: string
  namaKepsek: string
  nipKepsek: string
  alamat: string
  kota: string
  tahunAjaran: string
  logoUrl: string
  rows: RowLaporan[]
}
export interface LaporanResponse {
  generatedAt: string
  data: JenjangGroup[]
}

// ── Label status ─────────────────────────────────────────────────────────────
export const STATUS_SOAL_LABEL: Record<string, string> = {
  BELUM_DIBUAT: 'Belum Dibuat', DRAFT: 'Draft', MENUNGGU: 'Menunggu Validasi',
  DISETUJUI: 'Disetujui', DITOLAK: 'Ditolak',
}
export const STATUS_KISI_LABEL: Record<string, string> = {
  BELUM_DIBUAT: 'Belum Dibuat', DRAFT: 'Draft', TERKIRIM: 'Terkirim',
}

// ── Tahap laporan ────────────────────────────────────────────────────────────
export type Tahap = 'PRA' | 'SAAT' | 'SETELAH'
export const DAFTAR_TAHAP: Tahap[] = ['PRA', 'SAAT', 'SETELAH']

export const INFO_TAHAP: Record<Tahap, {
  judul: string          // judul di PDF
  tombol: string         // label tombol di halaman
  sub: string            // keterangan singkat di tombol
  berkas: string         // potongan nama file
  istilahBelum: string   // "Belum lengkap" / "Belum tuntas"
  istilahSudah: string   // "Lengkap" / "Tuntas"
  definisiBelum: string  // penjelasan kriteria, dicetak di PDF
}> = {
  PRA: {
    judul: 'PRA UJIAN — KELENGKAPAN SOAL',
    tombol: 'Pra Ujian',
    sub: 'Kelengkapan soal',
    berkas: 'PraUjian_KelengkapanSoal',
    istilahBelum: 'Belum lengkap',
    istilahSudah: 'Lengkap',
    definisiBelum: 'Belum lengkap = soal belum berstatus Disetujui (belum dibuat, draft, menunggu validasi, atau ditolak).',
  },
  SAAT: {
    judul: 'SAAT UJIAN — PROGRES PELAKSANAAN',
    tombol: 'Saat Ujian',
    sub: 'Progres pelaksanaan',
    berkas: 'SaatUjian_Progres',
    istilahBelum: 'Belum tuntas',
    istilahSudah: 'Tuntas',
    definisiBelum: 'Belum tuntas = ujian belum selesai (belum mulai atau masih berjalan), atau masih ada pelanggaran yang belum ditindak.',
  },
  SETELAH: {
    judul: 'SETELAH UJIAN — HASIL & PENGIRIMAN NILAI',
    tombol: 'Setelah Ujian',
    sub: 'Hasil & kirim nilai',
    berkas: 'SetelahUjian_Hasil',
    istilahBelum: 'Belum tuntas',
    istilahSudah: 'Tuntas',
    definisiBelum: 'Belum tuntas = belum ada nilai, nilai belum terkirim ke wali, atau ada nilai yang dikembalikan untuk direvisi.',
  },
}

export function statusSaatUjian(r: RowLaporan): 'BERJALAN' | 'SELESAI' | 'BELUM MULAI' {
  return r.saat.adaSesiBerjalan ? 'BERJALAN' : (r.saat.siswaTerdaftar > 0 ? 'SELESAI' : 'BELUM MULAI')
}

export function keteranganSetelah(r: RowLaporan): string {
  if (r.setelah.totalNilai === 0) return 'Belum ada nilai'
  if (r.setelah.adaDikembalikan) return 'Ada nilai dikembalikan'
  if (r.setelah.sudahDikirimWali < r.setelah.totalNilai) return 'Belum terkirim ke wali'
  return 'Sudah terkirim'
}

/** Apakah kombinasi mapel + kelas ini BELUM lengkap/tuntas pada tahap tsb. */
export function isBelum(tahap: Tahap, r: RowLaporan): boolean {
  if (tahap === 'PRA') return r.pra.statusSoal !== 'DISETUJUI'
  if (tahap === 'SAAT') return statusSaatUjian(r) !== 'SELESAI' || r.saat.pelanggaranBelumDitindak > 0
  return keteranganSetelah(r) !== 'Sudah terkirim'
}

/** Jumlah total & jumlah yang belum, per tahap (untuk label tombol). */
export function hitungRingkas(rows: RowLaporan[]): Record<Tahap, { total: number; belum: number }> {
  const hasil = {} as Record<Tahap, { total: number; belum: number }>
  for (const t of DAFTAR_TAHAP) {
    hasil[t] = { total: rows.length, belum: rows.filter(r => isBelum(t, r)).length }
  }
  return hasil
}

const bandingNama = (a: string, b: string) => a.localeCompare(b, 'id', { numeric: true })
export function urutkanBaris(rows: RowLaporan[]): RowLaporan[] {
  return [...rows].sort((a, b) => bandingNama(a.namaMapel, b.namaMapel) || bandingNama(a.namaKelas, b.namaKelas))
}

export function namaBerkasPdf(p: {
  tahap: Tahap
  hanyaBelum: boolean
  jenjangLabel: string | null
  kelas: string
  mapel: string
  tanggal: string
}): string {
  const bersih = (s: string) => s.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '')
  const bagian = [
    'Laporan',
    INFO_TAHAP[p.tahap].berkas,
    p.hanyaBelum ? 'HanyaYangBelum' : '',
    p.jenjangLabel ? bersih(p.jenjangLabel) : 'SemuaJenjang',
    p.mapel ? bersih(p.mapel) : '',
    p.kelas ? bersih(p.kelas) : '',
    p.tanggal,
  ].filter(Boolean)
  return bagian.join('_') + '.pdf'
}

// ── Isi tabel per tahap ──────────────────────────────────────────────────────
type Rgb = [number, number, number]
const MERAH: Rgb = [185, 28, 28]
const HIJAU: Rgb = [21, 128, 61]
const AMBER: Rgb = [180, 83, 9]
const HITAM: Rgb = [20, 20, 20]
const ABU: Rgb = [90, 90, 90]

interface Sel { teks: string; warna?: Rgb; tebal?: boolean }
interface Kolom { label: string; width: number }

function kolomTahap(tahap: Tahap, w: number): Kolom[] {
  const sisa = (lebar: number[]) => w - lebar.reduce((a, b) => a + b, 0)
  if (tahap === 'PRA') {
    const l = [10, 38, 20, 40, 30, 17]
    return [
      { label: 'No', width: l[0] }, { label: 'Mapel', width: l[1] }, { label: 'Kelas', width: l[2] },
      { label: 'Guru', width: l[3] }, { label: 'Status Soal', width: l[4] }, { label: 'Jml Soal', width: l[5] },
      { label: 'Kisi-kisi', width: sisa(l) },
    ]
  }
  if (tahap === 'SAAT') {
    const l = [10, 40, 22, 28, 30, 22]
    return [
      { label: 'No', width: l[0] }, { label: 'Mapel', width: l[1] }, { label: 'Kelas', width: l[2] },
      { label: 'Status', width: l[3] }, { label: 'Peserta / Total', width: l[4] }, { label: 'Selesai', width: l[5] },
      { label: 'Pelanggaran Belum Ditindak', width: sisa(l) },
    ]
  }
  const l = [10, 38, 20, 20, 24, 24]
  return [
    { label: 'No', width: l[0] }, { label: 'Mapel', width: l[1] }, { label: 'Kelas', width: l[2] },
    { label: 'Rata-rata', width: l[3] }, { label: 'Lulus / Tidak', width: l[4] }, { label: 'Terkirim Wali', width: l[5] },
    { label: 'Keterangan', width: sisa(l) },
  ]
}

function selBaris(tahap: Tahap, r: RowLaporan, no: number): Sel[] {
  const dasar: Sel[] = [{ teks: String(no) }, { teks: r.namaMapel, tebal: true }, { teks: r.namaKelas }]
  if (tahap === 'PRA') {
    const belum = r.pra.statusSoal !== 'DISETUJUI'
    return [
      ...dasar,
      { teks: r.namaGuru || '-' },
      { teks: STATUS_SOAL_LABEL[r.pra.statusSoal] ?? r.pra.statusSoal, warna: belum ? MERAH : HIJAU, tebal: true },
      { teks: String(r.pra.jumlahSoal) },
      { teks: STATUS_KISI_LABEL[r.pra.statusKisiKisi] ?? r.pra.statusKisiKisi },
    ]
  }
  if (tahap === 'SAAT') {
    const st = statusSaatUjian(r)
    const pel = r.saat.pelanggaranBelumDitindak
    return [
      ...dasar,
      {
        teks: st === 'SELESAI' ? 'Selesai' : st === 'BERJALAN' ? 'Berjalan' : 'Belum mulai',
        warna: st === 'SELESAI' ? HIJAU : st === 'BERJALAN' ? AMBER : MERAH,
        tebal: true,
      },
      { teks: `${r.saat.siswaTerdaftar} / ${r.saat.totalSiswaKelas}` },
      { teks: String(r.saat.siswaSelesai) },
      { teks: String(pel), warna: pel > 0 ? MERAH : undefined, tebal: pel > 0 },
    ]
  }
  const ket = keteranganSetelah(r)
  const adaNilai = r.setelah.totalNilai > 0
  return [
    ...dasar,
    { teks: adaNilai ? String(r.setelah.rataRata) : '-' },
    { teks: adaNilai ? `${r.setelah.jumlahLulus} / ${r.setelah.jumlahTidakLulus}` : '-' },
    { teks: adaNilai ? `${r.setelah.sudahDikirimWali} / ${r.setelah.totalNilai}` : '-' },
    { teks: ket, warna: ket === 'Sudah terkirim' ? HIJAU : MERAH, tebal: true },
  ]
}

// ── Pembangun PDF ────────────────────────────────────────────────────────────
type JsPdfCtor = typeof jsPDF

export interface OpsiPdf {
  tahap: Tahap
  /** true = hanya muat yang BELUM lengkap/tuntas (blok "sudah" tidak dicetak). */
  hanyaBelum: boolean
  /** Jenjang yang sudah difilter kelas/mapel/pencarian oleh pemanggil. */
  target: JenjangGroup[]
  /** Teks cakupan, mis. "Kelas: Semua  |  Mapel: Matematika". */
  cakupan: string
  /** Teks tanggal cetak yang sudah diformat. */
  dicetak: string
  /** Pengambil logo (base64 PNG) — opsional; di Node/uji bisa dikosongkan. */
  ambilLogo?: (url: string) => Promise<string | null>
}

/** Mengembalikan dokumen jsPDF, atau null bila tidak ada baris yang perlu dicetak. */
export async function bangunPdfLaporan(JsPDF: JsPdfCtor, o: OpsiPdf): Promise<jsPDF | null> {
  const info = INFO_TAHAP[o.tahap]

  const grup = o.target
    .map(g => {
      const rows = urutkanBaris(g.rows)
      return {
        g,
        belum: rows.filter(r => isBelum(o.tahap, r)),
        sudah: rows.filter(r => !isBelum(o.tahap, r)),
      }
    })
    .filter(x => (o.hanyaBelum ? x.belum.length > 0 : x.belum.length + x.sudah.length > 0))
  if (grup.length === 0) return null

  const doc = new JsPDF({ unit: 'mm', format: 'a4' })
  const pageW = 210, pageH = 297
  const lm = 15, w = pageW - lm * 2
  const batasBawah = pageH - 18
  const kolom = kolomTahap(o.tahap, w)
  const barisH = 3.6 // tinggi satu baris teks pada font 8pt

  const pastikanRuang = (y: number, butuh: number): number => {
    if (y + butuh > batasBawah) { doc.addPage(); return 18 }
    return y
  }

  // Tulis paragraf yang otomatis dipecah ke beberapa baris sesuai lebar halaman.
  const tulis = (teks: string, y: number, opsi: { ukuran: number; warna?: Rgb; tebal?: boolean; miring?: boolean }): number => {
    doc.setFont('helvetica', opsi.tebal ? 'bold' : opsi.miring ? 'italic' : 'normal')
    doc.setFontSize(opsi.ukuran)
    const wr = opsi.warna ?? HITAM
    doc.setTextColor(wr[0], wr[1], wr[2])
    const baris = doc.splitTextToSize(teks, w) as string[]
    const tinggi = opsi.ukuran * 0.3528 * 1.25
    for (const b of baris) {
      y = pastikanRuang(y, tinggi)
      doc.text(b, lm, y)
      y += tinggi
    }
    doc.setTextColor(HITAM[0], HITAM[1], HITAM[2])
    doc.setFont('helvetica', 'normal')
    return y
  }

  const gambarTabel = (yAwal: number, rows: RowLaporan[]): number => {
    let y = yAwal

    const gambarHeader = (yy: number): number => {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      const pecah = kolom.map(c => doc.splitTextToSize(c.label, c.width - 4) as string[])
      const tinggi = Math.max(7, Math.max(...pecah.map(p => p.length)) * barisH + 3.4)
      doc.setFillColor(229, 231, 235)
      doc.rect(lm, yy, w, tinggi, 'F')
      doc.setTextColor(HITAM[0], HITAM[1], HITAM[2])
      let cx = lm
      kolom.forEach((c, i) => {
        pecah[i].forEach((ln, k) => doc.text(ln, cx + 2, yy + 4.6 + k * barisH))
        cx += c.width
      })
      garisKotak(yy, tinggi)
      doc.setFont('helvetica', 'normal')
      return yy + tinggi
    }

    const garisKotak = (yTop: number, tinggi: number) => {
      doc.setDrawColor(190, 190, 190)
      doc.setLineWidth(0.15)
      let cx = lm
      for (const c of kolom) { doc.line(cx, yTop, cx, yTop + tinggi); cx += c.width }
      doc.line(cx, yTop, cx, yTop + tinggi)
      doc.line(lm, yTop, cx, yTop)
      doc.line(lm, yTop + tinggi, cx, yTop + tinggi)
      doc.setDrawColor(0, 0, 0)
    }

    y = gambarHeader(y)
    rows.forEach((r, idx) => {
      const sel = selBaris(o.tahap, r, idx + 1)
      doc.setFontSize(8)
      // Ukur dulu (font tebal/biasa lebarnya beda) supaya tinggi baris pas.
      const pecah = sel.map((s, i) => {
        doc.setFont('helvetica', s.tebal ? 'bold' : 'normal')
        return doc.splitTextToSize(s.teks, kolom[i].width - 4) as string[]
      })
      const tinggi = Math.max(7, Math.max(...pecah.map(p => p.length)) * barisH + 3.4)
      if (y + tinggi > batasBawah) {
        doc.addPage()
        y = gambarHeader(18) // header diulang di halaman baru
      }
      let cx = lm
      sel.forEach((s, i) => {
        doc.setFont('helvetica', s.tebal ? 'bold' : 'normal')
        const wr = s.warna ?? HITAM
        doc.setTextColor(wr[0], wr[1], wr[2])
        pecah[i].forEach((ln, k) => doc.text(ln, cx + 2, y + 4.6 + k * barisH))
        cx += kolom[i].width
      })
      doc.setTextColor(HITAM[0], HITAM[1], HITAM[2])
      doc.setFont('helvetica', 'normal')
      garisKotak(y, tinggi)
      y += tinggi
    })
    return y
  }

  for (let gi = 0; gi < grup.length; gi++) {
    const { g, belum, sudah } = grup[gi]
    if (gi > 0) doc.addPage()
    let y = 18

    // ── Kop sekolah (spesifik per jenjang, supaya tidak tertukar) ──────────
    const logo = o.ambilLogo ? await o.ambilLogo(g.logoUrl) : null
    if (logo) {
      try { doc.addImage(logo, 'PNG', lm, y - 4, 18, 18) } catch { /* lewati kalau gagal decode */ }
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.text((g.namaSekolah || 'NAMA SEKOLAH').toUpperCase(), pageW / 2, y + 2, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(`NPSN: ${g.npsn || '-'}  |  ${g.alamat || '-'}${g.kota ? ', ' + g.kota : ''}`, pageW / 2, y + 7, { align: 'center' })
    doc.text(`Tahun Ajaran: ${g.tahunAjaran || '-'}`, pageW / 2, y + 11, { align: 'center' })
    y += 15
    doc.setLineWidth(0.8); doc.line(lm, y, lm + w, y)
    doc.setLineWidth(0.3); doc.line(lm, y + 1.2, lm + w, y + 1.2)
    y += 8

    // ── Judul + cakupan + ringkasan ─────────────────────────────────────────
    y = tulis(`LAPORAN ${info.judul}`, y, { ukuran: 12, tebal: true })
    y += 1
    y = tulis(`Jenjang: ${g.label}  |  ${o.cakupan}  |  Dicetak: ${o.dicetak}`, y, { ukuran: 8.5, warna: ABU })
    y += 2
    const total = belum.length + sudah.length
    y = tulis(
      `Total ${total} kombinasi mapel + kelas   |   ${info.istilahSudah}: ${sudah.length}   |   ${info.istilahBelum}: ${belum.length}`,
      y,
      { ukuran: 9.5, tebal: true, warna: belum.length > 0 ? MERAH : HIJAU },
    )
    y = tulis(
      info.definisiBelum + (o.hanyaBelum ? ' Laporan ini hanya memuat yang belum.' : ''),
      y,
      { ukuran: 7.5, warna: ABU, miring: true },
    )
    y += 4

    const blok = (judul: string, warna: Rgb, rows: RowLaporan[]) => {
      y = pastikanRuang(y, 30) // judul blok + header tabel + minimal satu baris
      y = tulis(judul, y, { ukuran: 10, tebal: true, warna })
      y += 1.5
      y = gambarTabel(y, rows)
      y += 7
    }

    if (o.hanyaBelum) {
      blok(`DAFTAR ${info.istilahBelum.toUpperCase()} (${belum.length})`, MERAH, belum)
    } else {
      if (belum.length > 0) {
        blok(`A. ${info.istilahBelum.toUpperCase()} (${belum.length})`, MERAH, belum)
      } else {
        y = tulis(`Semua kombinasi sudah ${info.istilahSudah.toLowerCase()}.`, y, { ukuran: 10, tebal: true, warna: HIJAU })
        y += 5
      }
      if (sudah.length > 0) {
        blok(`${belum.length > 0 ? 'B. ' : ''}${info.istilahSudah.toUpperCase()} (${sudah.length})`, HIJAU, sudah)
      }
    }
  }

  // Nomor halaman
  const jumlahHalaman = doc.getNumberOfPages()
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(120, 120, 120)
  for (let p = 1; p <= jumlahHalaman; p++) {
    doc.setPage(p)
    doc.text(`Halaman ${p} / ${jumlahHalaman}`, pageW / 2, pageH - 8, { align: 'center' })
  }
  doc.setTextColor(HITAM[0], HITAM[1], HITAM[2])

  return doc
}
