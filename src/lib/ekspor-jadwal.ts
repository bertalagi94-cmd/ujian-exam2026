// Unduh JADWAL UJIAN (PDF) per jenjang/sekolah: kop surat, tabel jadwal
// (Hari/Tanggal, Sesi, Jam, Mapel, Kelas, Pengawas) dan tanda tangan
// Kepala Madrasah + Ketua Panitia Ujian.
//
// Dibuat 100% di BROWSER (jsPDF), sama seperti Cetak Massal: tidak ada request
// baru ke server selain mengambil gambar logo sekolah (opsional).
import type { Jadwal } from '@/types'

/** Data kop & penanda tangan. Nama field mengikuti tabel `sekolah` (snake_case). */
export interface DataSekolahJadwal {
  nama_sekolah?: string
  npsn?: string
  alamat?: string
  kota?: string
  tempat_surat?: string
  tahun_ajaran?: string
  logo_url?: string
  nama_kepsek?: string
  nip_kepsek?: string
  nama_ketua_panitia?: string
  nip_ketua_panitia?: string
}

const NAMA_BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]
const NAMA_HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']

// "2026-11-16..." -> "Senin, 16 November 2026". Dihitung dari komponen Y-M-D
// (bukan new Date(string) lokal) supaya tanggal tidak bergeser karena zona waktu.
function hariTanggal(tgl: string): string {
  const [y, m, d] = String(tgl ?? '').slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return String(tgl ?? '')
  const hari = NAMA_HARI[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${hari}, ${d} ${NAMA_BULAN[m - 1]} ${y}`
}

function tanggalHariIni(): string {
  const n = new Date()
  return `${n.getDate()} ${NAMA_BULAN[n.getMonth()]} ${n.getFullYear()}`
}

const jam = (s?: string | null) => String(s ?? '').slice(0, 5)

const banding = (a: string, b: string) =>
  a.localeCompare(b, 'id', { numeric: true, sensitivity: 'base' })

function urutkan(data: Jadwal[]): Jadwal[] {
  return [...data].sort((a, b) =>
    banding(String(a.tanggal).slice(0, 10), String(b.tanggal).slice(0, 10)) ||
    (a.sesi ?? 0) - (b.sesi ?? 0) ||
    banding(jam(a.jam_mulai), jam(b.jam_mulai)) ||
    banding(String(a.kelas ?? ''), String(b.kelas ?? '')) ||
    banding(a.nama_mapel ?? '', b.nama_mapel ?? '')
  )
}

async function logoDataUrl(url: string): Promise<{ data: string; format: 'PNG' | 'JPEG' } | null> {
  try {
    const resp = await fetch(url)
    if (!resp.ok) return null
    const blob = await resp.blob()
    const format = /jpe?g/i.test(blob.type) ? 'JPEG' : 'PNG'
    const data = await new Promise<string>((res, rej) => {
      const r = new FileReader()
      r.onload = () => res(r.result as string)
      r.onerror = () => rej(new Error('baca logo gagal'))
      r.readAsDataURL(blob)
    })
    return { data, format }
  } catch {
    return null // logo gagal dimuat (mis. CORS): PDF tetap dibuat tanpa logo
  }
}

export function namaBerkasJadwal(sekolah: DataSekolahJadwal): string {
  const dasar = String(sekolah.nama_sekolah ?? 'Sekolah').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')
  const n = new Date()
  const dua = (v: number) => String(v).padStart(2, '0')
  return `Jadwal_Ujian_${dasar}_${n.getFullYear()}-${dua(n.getMonth() + 1)}-${dua(n.getDate())}.pdf`
}

interface Baris {
  kunciTgl: string
  kunciSesi: string
  labelTgl: string
  labelSesi: string
  labelJam: string
  mapel: string[]
  kelas: string[]
  pengawas: string[]
  h: number
}

export async function eksporJadwalPdf(data: Jadwal[], sekolah: DataSekolahJadwal): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const logo = sekolah.logo_url ? await logoDataUrl(sekolah.logo_url) : null

  const pageW = 210
  const pageH = 297
  const lm = 15
  const rm = 15
  const w = pageW - lm - rm // 180
  const batasBawah = pageH - 15

  // Lebar kolom (jumlah = 180)
  const kol = { tgl: 34, sesi: 14, jam: 24, mapel: 50, kelas: 20, peng: 38 }
  const x0 = lm
  const x1 = x0 + kol.tgl
  const x2 = x1 + kol.sesi
  const x3 = x2 + kol.jam
  const x4 = x3 + kol.mapel
  const x5 = x4 + kol.kelas
  const x6 = x5 + kol.peng

  const lineH = 4.2
  const pad = 2

  // ── Siapkan baris (teks dibungkus dulu untuk menghitung tinggi) ───────────
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  const wrap = (t: string, lebar: number): string[] => {
    const s = String(t ?? '').trim()
    return s ? (doc.splitTextToSize(s, lebar - 2 * pad) as string[]) : ['']
  }

  const baris: Baris[] = urutkan(data).map(j => {
    const tgl = String(j.tanggal).slice(0, 10)
    const jamTeks = `${jam(j.jam_mulai)} - ${jam(j.jam_selesai)}`
    const b: Baris = {
      kunciTgl: tgl,
      kunciSesi: `${tgl}|${j.sesi}|${jam(j.jam_mulai)}|${jam(j.jam_selesai)}`,
      labelTgl: hariTanggal(tgl),
      labelSesi: String(j.sesi ?? ''),
      labelJam: jamTeks,
      mapel: wrap(j.nama_mapel ?? '', kol.mapel),
      kelas: wrap(j.kelas ?? '', kol.kelas),
      pengawas: wrap(j.nama_pengawas ?? j.pengawas ?? '', kol.peng),
      h: 0,
    }
    const baris = Math.max(b.mapel.length, b.kelas.length, b.pengawas.length)
    b.h = Math.max(8, baris * lineH + 2 * pad - 1)
    return b
  })

  // ── Kop surat ─────────────────────────────────────────────────────────────
  const top = 14
  if (logo) {
    try { doc.addImage(logo.data, logo.format, lm, top, 20, 20) } catch { /* lewati logo */ }
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(String(sekolah.nama_sekolah ?? 'NAMA SEKOLAH').toUpperCase(), pageW / 2, top + 6, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(`NPSN: ${sekolah.npsn || '-'}`, pageW / 2, top + 11.5, { align: 'center' })
  if (sekolah.alamat) {
    const al = doc.splitTextToSize(sekolah.alamat, w - 50) as string[]
    doc.text(al.slice(0, 2), pageW / 2, top + 16, { align: 'center' })
  }
  const garisY = top + 23
  doc.setLineWidth(0.8); doc.line(lm, garisY, lm + w, garisY)
  doc.setLineWidth(0.3); doc.line(lm, garisY + 1.4, lm + w, garisY + 1.4)

  // Judul
  let y = garisY + 10
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text('JADWAL PELAKSANAAN UJIAN', pageW / 2, y, { align: 'center' })
  if (sekolah.tahun_ajaran) {
    y += 5.5
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.text(`Tahun Pelajaran ${sekolah.tahun_ajaran}`, pageW / 2, y, { align: 'center' })
  }
  y += 7
  const yMulaiTabel = y

  // ── Header tabel (diulang di tiap halaman) ────────────────────────────────
  const headerTabel = () => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setLineWidth(0.25)
    doc.setFillColor(232, 235, 242)
    doc.rect(x0, y, w, 8, 'FD')
    const judul: [string, number, number][] = [
      ['Hari / Tanggal', x0, kol.tgl], ['Sesi', x1, kol.sesi], ['Jam', x2, kol.jam],
      ['Mata Pelajaran', x3, kol.mapel], ['Kelas', x4, kol.kelas], ['Pengawas', x5, kol.peng],
    ]
    for (const [t, x, lebar] of judul) {
      doc.text(t, x + lebar / 2, y + 5.3, { align: 'center' })
    }
    for (const x of [x1, x2, x3, x4, x5]) doc.line(x, y, x, y + 8)
    y += 8
    doc.setFont('helvetica', 'normal')
  }

  // Sel gabungan: kotak + teks di tengah (vertikal & horizontal).
  const selGabungan = (x: number, lebar: number, yAwal: number, yAkhir: number, teks: string, tebal: boolean) => {
    if (yAkhir <= yAwal) return
    doc.rect(x, yAwal, lebar, yAkhir - yAwal)
    doc.setFont('helvetica', tebal ? 'bold' : 'normal')
    doc.setFontSize(9)
    const baris = doc.splitTextToSize(teks, lebar - 2 * pad) as string[]
    const tinggiTeks = baris.length * lineH
    const mulai = yAwal + (yAkhir - yAwal - tinggiTeks) / 2 + lineH - 1.1
    doc.text(baris, x + lebar / 2, mulai, { align: 'center' })
    doc.setFont('helvetica', 'normal')
  }

  // Tinggi seluruh baris satu tanggal (untuk menjaga satu hari tetap utuh bila muat).
  const tinggiTanggal: Record<string, number> = {}
  for (const b of baris) tinggiTanggal[b.kunciTgl] = (tinggiTanggal[b.kunciTgl] ?? 0) + b.h
  const tinggiHalamanPenuh = batasBawah - (yMulaiTabel + 8)

  headerTabel()
  doc.setLineWidth(0.25)

  let kunciTglAktif = ''
  let kunciSesiAktif = ''
  let awalTgl = y
  let awalSesi = y
  let labelTglAktif = ''
  let labelSesiAktif = ''
  let labelJamAktif = ''

  const tutupSesi = (yAkhir: number) => {
    if (!kunciSesiAktif) return
    selGabungan(x1, kol.sesi, awalSesi, yAkhir, labelSesiAktif, true)
    selGabungan(x2, kol.jam, awalSesi, yAkhir, labelJamAktif, false)
  }
  const tutupTgl = (yAkhir: number) => {
    if (!kunciTglAktif) return
    selGabungan(x0, kol.tgl, awalTgl, yAkhir, labelTglAktif, true)
  }
  const halamanBaru = () => {
    tutupSesi(y); tutupTgl(y)
    doc.addPage()
    y = 15
    headerTabel()
    awalTgl = y
    awalSesi = y
  }

  for (const b of baris) {
    // Hari baru: kalau seluruh hari itu muat di satu halaman tapi sisa tempat tidak cukup,
    // pindah halaman dulu agar sel tanggal tidak terpotong.
    if (b.kunciTgl !== kunciTglAktif) {
      const perlu = Math.min(tinggiTanggal[b.kunciTgl], tinggiHalamanPenuh)
      if (y + perlu > batasBawah && kunciTglAktif) halamanBaru()
    }
    if (y + b.h > batasBawah) halamanBaru()

    if (b.kunciTgl !== kunciTglAktif) {
      tutupSesi(y); tutupTgl(y)
      kunciTglAktif = b.kunciTgl; kunciSesiAktif = ''
      awalTgl = y; labelTglAktif = b.labelTgl
    }
    if (b.kunciSesi !== kunciSesiAktif) {
      tutupSesi(y)
      kunciSesiAktif = b.kunciSesi
      awalSesi = y; labelSesiAktif = b.labelSesi; labelJamAktif = b.labelJam
    }

    // Sel isi: mapel, kelas, pengawas (rata kiri, rata atas dengan padding).
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.rect(x3, y, kol.mapel, b.h)
    doc.rect(x4, y, kol.kelas, b.h)
    doc.rect(x5, y, kol.peng, b.h)
    const ty = y + pad + lineH - 1.3
    doc.text(b.mapel, x3 + pad, ty)
    doc.text(b.kelas, x4 + pad, ty)
    doc.text(b.pengawas, x5 + pad, ty)
    y += b.h
  }
  tutupSesi(y)
  tutupTgl(y)

  // ── Tanda tangan ──────────────────────────────────────────────────────────
  // Satu blok utuh: kalau sisa halaman kurang, pindah ke halaman baru.
  const tinggiTtd = 50
  if (y + 8 + tinggiTtd > pageH - 12) { doc.addPage(); y = 20 } else { y += 8 }

  const kota = (sekolah.tempat_surat ?? '').trim() || (sekolah.kota ?? '').trim() || '...................'
  const kiriX = lm + 5
  const kananX = lm + w - 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`${kota}, ${tanggalHariIni()}`, kananX, y, { align: 'right' })
  y += 5
  doc.text('Mengetahui,', kiriX, y)
  doc.text('Ketua Panitia Ujian,', kananX, y, { align: 'right' })
  y += 5
  doc.text('Kepala Madrasah,', kiriX, y)

  const yNama = y + 24
  const blokNama = (nama: string, nip: string | undefined, x: number, kanan: boolean) => {
    const teks = nama?.trim() || '_________________'
    doc.setFont('helvetica', 'bold')
    doc.text(teks, x, yNama, kanan ? { align: 'right' } : undefined)
    const lebarNama = doc.getTextWidth(teks)
    doc.setLineWidth(0.3)
    if (kanan) doc.line(x - lebarNama, yNama + 1, x, yNama + 1)
    else doc.line(x, yNama + 1, x + lebarNama, yNama + 1)
    doc.setFont('helvetica', 'normal')
    if (nip?.trim()) doc.text(`NIP. ${nip.trim()}`, x, yNama + 6, kanan ? { align: 'right' } : undefined)
  }
  blokNama(sekolah.nama_kepsek ?? '', sekolah.nip_kepsek, kiriX, false)
  blokNama(sekolah.nama_ketua_panitia ?? '', sekolah.nip_ketua_panitia, kananX, true)

  // Nomor halaman
  const total = doc.getNumberOfPages()
  if (total > 1) {
    for (let p = 1; p <= total; p++) {
      doc.setPage(p)
      doc.setFontSize(8)
      doc.setTextColor(120)
      doc.text(`Halaman ${p} dari ${total}`, pageW - rm, pageH - 7, { align: 'right' })
      doc.setTextColor(0)
    }
  }

  // Unduh
  const url = URL.createObjectURL(doc.output('blob'))
  const a = document.createElement('a')
  a.href = url
  a.download = namaBerkasJadwal(sekolah)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
