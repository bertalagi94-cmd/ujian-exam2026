// Pembuat PDF "Kesiapan Ujian" untuk tab Kesiapan Ujian di menu Admin Kelas.
//
// Dibuat 100% di BROWSER (jsPDF, sama seperti Ekspor Akun & Cetak Massal),
// jadi tidak ada yang diunggah ke server. Isi PDF sengaja TIDAK memuat nomor HP
// guru, supaya aman dibagikan ke grup WhatsApp guru.
import { LABEL_KESIAPAN, type BarisKesiapanKelas, type RingkasanKesiapanKelas } from '@/lib/admin-kelas-shared'
import type { StatusSoal } from '@/lib/soal-status-shared'

export interface OpsiPdfKesiapan {
  /** Baris yang akan dicetak (sudah disaring/diurutkan oleh pemanggil). */
  data: BarisKesiapanKelas[]
  /** Ringkasan untuk SELURUH kelas wilayah (bukan hanya baris yang dicetak). */
  ringkasan: RingkasanKesiapanKelas
  /** Nama kelas wilayah admin kelas, mis. ['7A', '7B']. */
  kelasWilayah: string[]
  /** Judul tambahan di bawah judul utama, mis. "Hanya yang belum lengkap". */
  subjudul?: string
  namaSekolah?: string
  logoUrl?: string
  /** Nama guru admin kelas yang mencetak. */
  dicetakOleh?: string
}

// Warna latar & teks sel status (RGB).
const WARNA_STATUS: Record<StatusSoal, { bg: [number, number, number]; fg: [number, number, number] }> = {
  DISETUJUI: { bg: [209, 250, 229], fg: [6, 95, 70] },
  MENUNGGU: { bg: [254, 243, 199], fg: [146, 64, 14] },
  DITOLAK: { bg: [254, 226, 226], fg: [153, 27, 27] },
  DRAFT: { bg: [219, 234, 254], fg: [30, 64, 175] },
  BELUM_ADA: { bg: [255, 237, 213], fg: [154, 52, 18] },
}

/** YYYY-MM-DD menurut jam perangkat (bukan UTC), untuk nama file. */
function tanggalFile(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// 'YYYY-MM-DD' -> 'DD/MM/YYYY' tanpa lewat objek Date (hindari geser zona waktu).
function tglJadwal(t: string | null): string {
  if (!t) return '-'
  const [y, m, d] = t.split('-')
  return y && m && d ? `${d}/${m}/${y}` : t
}

function tglCetak(d: Date): string {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar',
    }).format(d).replace(/\./g, ':') + ' WITA'
  } catch {
    return d.toLocaleString('id-ID')
  }
}

function namaFileAman(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

async function logoKeDataUrl(url: string): Promise<{ data: string; format: 'PNG' | 'JPEG' } | null> {
  try {
    const resp = await fetch(url)
    if (!resp.ok) return null
    const blob = await resp.blob()
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader()
      r.onload = () => res(String(r.result))
      r.onerror = () => rej(new Error('baca logo gagal'))
      r.readAsDataURL(blob)
    })
    const jenis = /^data:image\/(png|jpe?g)/i.exec(dataUrl)?.[1]?.toLowerCase()
    if (!jenis) return null // webp/svg tidak didukung jsPDF: lewati logo saja
    return { data: dataUrl, format: jenis === 'png' ? 'PNG' : 'JPEG' }
  } catch {
    return null
  }
}

/**
 * Membuat PDF kesiapan ujian lalu mengunduhnya. Mengembalikan nama file.
 * Melempar Error kalau tidak ada baris untuk dicetak.
 */
export async function unduhPdfKesiapan(opsi: OpsiPdfKesiapan): Promise<string> {
  const { data, ringkasan, kelasWilayah, subjudul, namaSekolah, logoUrl, dicetakOleh } = opsi
  if (data.length === 0) throw new Error('Tidak ada data untuk dicetak')

  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageW = 210
  const pageH = 297
  const lm = 15
  const rm = 15
  const w = pageW - lm - rm
  const bawahAman = pageH - 18 // sisakan ruang untuk nomor halaman
  const sekarang = new Date()

  // ── Kop ──────────────────────────────────────────────────────────────────
  let y = 15
  const logo = logoUrl ? await logoKeDataUrl(logoUrl) : null
  if (logo) {
    try { doc.addImage(logo.data, logo.format, lm, y - 2, 16, 16) } catch { /* lewati logo */ }
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(15, 23, 42)
  doc.text((namaSekolah || 'SMARTEXAM').toUpperCase(), pageW / 2, y + 4, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(71, 85, 105)
  doc.text('Laporan Kesiapan Soal Ujian', pageW / 2, y + 9.5, { align: 'center' })
  y += 17
  doc.setDrawColor(15, 23, 42)
  doc.setLineWidth(0.7); doc.line(lm, y, lm + w, y)
  doc.setLineWidth(0.2); doc.line(lm, y + 1.2, lm + w, y + 1.2)
  y += 8

  // ── Judul & info ─────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(15, 23, 42)
  doc.text('KESIAPAN UJIAN PER MATA PELAJARAN', pageW / 2, y, { align: 'center' })
  y += 5.5
  if (subjudul) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(71, 85, 105)
    doc.text(subjudul, pageW / 2, y, { align: 'center' })
    y += 5
  }
  y += 2

  doc.setFontSize(9.5)
  const infoBaris: [string, string][] = [
    ['Kelas', kelasWilayah.length > 0 ? kelasWilayah.join(', ') : '-'],
    ['Per tanggal', tglCetak(sekarang)],
  ]
  if (dicetakOleh) infoBaris.push(['Admin Kelas', dicetakOleh])
  for (const [label, nilai] of infoBaris) {
    doc.setFont('helvetica', 'normal'); doc.setTextColor(71, 85, 105)
    doc.text(label, lm, y)
    doc.text(':', lm + 26, y)
    doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 23, 42)
    const baris = doc.splitTextToSize(nilai, w - 30) as string[]
    doc.text(baris, lm + 29, y)
    y += 4.8 * baris.length
  }
  y += 2

  // ── Kotak ringkasan ──────────────────────────────────────────────────────
  const kotak: { label: string; nilai: string; warna: [number, number, number] }[] = [
    { label: 'Disetujui', nilai: `${ringkasan.per_status.DISETUJUI}/${ringkasan.total}`, warna: [5, 150, 105] },
    { label: 'Menunggu validasi', nilai: String(ringkasan.per_status.MENUNGGU), warna: [217, 119, 6] },
    { label: 'Belum lengkap', nilai: String(ringkasan.perlu_ditagih), warna: [220, 38, 38] },
    { label: 'Sudah terjadwal', nilai: `${ringkasan.sudah_terjadwal}/${ringkasan.total}`, warna: [2, 132, 199] },
  ]
  const gap = 3
  const kw = (w - gap * (kotak.length - 1)) / kotak.length
  kotak.forEach((k, i) => {
    const x = lm + i * (kw + gap)
    doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.2)
    doc.setFillColor(248, 250, 252)
    doc.roundedRect(x, y, kw, 15, 1.5, 1.5, 'FD')
    doc.setFillColor(...k.warna)
    doc.rect(x, y + 2, 1.2, 11, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...k.warna)
    doc.text(k.nilai, x + 5, y + 7.5)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(71, 85, 105)
    doc.text(k.label, x + 5, y + 12)
  })
  y += 15 + 3
  doc.setFontSize(7.5); doc.setTextColor(100, 116, 139)
  doc.text('Ringkasan di atas mencakup seluruh mata pelajaran di kelas Anda, bukan hanya baris yang tercetak di bawah.', lm, y + 1)
  y += 6

  // ── Tabel ────────────────────────────────────────────────────────────────
  const kolom = [
    { judul: 'No', lebar: 9, rata: 'center' as const },
    { judul: 'Mata Pelajaran', lebar: 56, rata: 'left' as const },
    { judul: 'Kelas', lebar: 16, rata: 'center' as const },
    { judul: 'Guru Pengampu', lebar: 51, rata: 'left' as const },
    { judul: 'Status Soal', lebar: 28, rata: 'center' as const },
    { judul: 'Jadwal', lebar: 20, rata: 'center' as const },
  ]
  const totalLebar = kolom.reduce((a, k) => a + k.lebar, 0) // = 180 = w
  const pad = 1.8
  const tinggiBaris1 = 6.4 // tinggi minimum satu baris
  const lh = 4.2 // tinggi per baris teks

  function gambarHeader() {
    doc.setFillColor(30, 41, 59)
    doc.rect(lm, y, totalLebar, 7, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(255, 255, 255)
    let cx = lm
    for (const k of kolom) {
      const tx = k.rata === 'center' ? cx + k.lebar / 2 : cx + pad
      doc.text(k.judul, tx, y + 4.7, { align: k.rata === 'center' ? 'center' : 'left' })
      cx += k.lebar
    }
    y += 7
  }

  gambarHeader()
  doc.setFontSize(8.5)

  data.forEach((d, i) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
    const mapelLines = doc.splitTextToSize(d.nama_mapel, kolom[1].lebar - pad * 2) as string[]
    const guruLines = doc.splitTextToSize(d.nama_guru ?? '-', kolom[3].lebar - pad * 2) as string[]
    const nBaris = Math.max(mapelLines.length, guruLines.length, 1)
    const tinggi = Math.max(tinggiBaris1, nBaris * lh + 2.4)

    if (y + tinggi > bawahAman) {
      doc.addPage()
      y = 15
      gambarHeader()
    }

    // Latar belang-belang
    if (i % 2 === 1) {
      doc.setFillColor(248, 250, 252)
      doc.rect(lm, y, totalLebar, tinggi, 'F')
    }

    // Sel status berwarna
    const warna = WARNA_STATUS[d.status_soal]
    let cx = lm
    for (let c = 0; c < 4; c++) cx += kolom[c].lebar
    doc.setFillColor(...warna.bg)
    doc.rect(cx, y, kolom[4].lebar, tinggi, 'F')

    const ty = y + 4.4
    doc.setTextColor(15, 23, 42)
    cx = lm
    doc.text(String(i + 1), cx + kolom[0].lebar / 2, ty, { align: 'center' }); cx += kolom[0].lebar

    doc.setFont('helvetica', 'bold')
    doc.text(mapelLines, cx + pad, ty); cx += kolom[1].lebar
    doc.setFont('helvetica', 'normal')

    doc.text(d.kelas, cx + kolom[2].lebar / 2, ty, { align: 'center' }); cx += kolom[2].lebar

    if (!d.nama_guru) doc.setTextColor(148, 163, 184)
    doc.text(guruLines, cx + pad, ty); cx += kolom[3].lebar

    doc.setFont('helvetica', 'bold'); doc.setTextColor(...warna.fg)
    doc.text(LABEL_KESIAPAN[d.status_soal], cx + kolom[4].lebar / 2, ty, { align: 'center' }); cx += kolom[4].lebar

    doc.setFont('helvetica', 'normal')
    if (d.sudah_dijadwalkan) {
      doc.setTextColor(15, 23, 42)
      doc.text(tglJadwal(d.tanggal_jadwal), cx + kolom[5].lebar / 2, ty, { align: 'center' })
    } else {
      // "Belum" dijadwalkan: tebal & oranye kalau soalnya sudah siap (perlu dijadwalkan)
      if (d.status_soal === 'DISETUJUI') { doc.setFont('helvetica', 'bold'); doc.setTextColor(180, 83, 9) }
      else doc.setTextColor(148, 163, 184)
      doc.text('Belum', cx + kolom[5].lebar / 2, ty, { align: 'center' })
    }

    // Garis bawah baris
    doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.15)
    doc.line(lm, y + tinggi, lm + totalLebar, y + tinggi)
    y += tinggi
  })

  // Bingkai tabel di halaman terakhir tidak dipakai (garis antar-baris sudah cukup).
  y += 5
  if (y + 22 > bawahAman) { doc.addPage(); y = 15 }

  // ── Catatan kaki ─────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(15, 23, 42)
  doc.text('Keterangan status', lm, y)
  y += 4.5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(71, 85, 105)
  const ket = [
    'Belum dibuat / Sedang dibuat / Ditolak: menunggu tindakan guru pengampu (buat, kirim, atau revisi paket soal).',
    'Menunggu validasi: paket soal sudah dikirim guru dan menunggu persetujuan Admin Kelas.',
    'Disetujui: soal siap. Jadwal "Belum" berarti soal siap tetapi belum dijadwalkan.',
  ]
  for (const k of ket) {
    const baris = doc.splitTextToSize(`- ${k}`, w) as string[]
    doc.text(baris, lm, y)
    y += 4 * baris.length
  }

  // ── Nomor halaman di setiap halaman ──────────────────────────────────────
  const total = doc.getNumberOfPages()
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(148, 163, 184)
    doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.2)
    doc.line(lm, pageH - 12, lm + w, pageH - 12)
    doc.text(`Kesiapan Ujian - dicetak ${tglCetak(sekarang)}`, lm, pageH - 8)
    doc.text(`Halaman ${p} dari ${total}`, lm + w, pageH - 8, { align: 'right' })
  }

  const bagianKelas = kelasWilayah.length > 0 ? namaFileAman(kelasWilayah.join('-')) : ''
  const namaFile = `kesiapan-ujian${bagianKelas ? `-${bagianKelas}` : ''}-${tanggalFile(sekarang)}.pdf`
  doc.save(namaFile)
  return namaFile
}
