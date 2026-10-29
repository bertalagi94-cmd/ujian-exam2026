// Pembuat file "Ekspor Akun" (Excel + kartu PDF) untuk halaman Data Pengguna.
// Data berasal dari POST /api/admin/users/kredensial. Semua pembuatan file
// terjadi di BROWSER admin; tidak ada yang diunggah ke mana pun.

export interface AkunKredensial {
  username: string
  nama: string
  role: string
  /** Password awal (= username) kalau masih belum diganti; null kalau sudah diganti. */
  password: string | null
}

export interface HasilKredensial {
  data: AkunKredensial[]
  total: number
  passwordTerbaca: number
  namaSekolah: string
}

export const KETERANGAN_SUDAH_DIGANTI =
  'Password sudah diganti/diatur sendiri. Reset dulu lewat menu Data Pengguna jika perlu dibagikan.'

export function labelPeran(role: string): string {
  if (role === 'GURU') return 'Guru'
  if (role === 'KEPSEK') return 'Kepala Sekolah'
  return role
}

/** YYYY-MM-DD menurut jam perangkat (bukan UTC), untuk nama file. */
export function tanggalFile(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Baris lembar Excel (array-of-arrays), sudah termasuk baris judul kolom. */
export function barisExcel(data: AkunKredensial[]): string[][] {
  const judul = ['No', 'Nama', 'Peran', 'Username', 'Password', 'Keterangan']
  const isi = data.map((a, i) => [
    String(i + 1),
    a.nama,
    labelPeran(a.role),
    a.username,
    a.password ?? '',
    a.password ? 'Password awal' : KETERANGAN_SUDAH_DIGANTI,
  ])
  return [judul, ...isi]
}

export async function unduhExcel(hasil: HasilKredensial): Promise<void> {
  const XLSX = await import('xlsx')
  const aoa = barisExcel(hasil.data)
  // "No" ditulis sebagai angka; selainnya teks supaya username/password
  // berangka tidak diubah Excel (mis. nol di depan hilang).
  const ws = XLSX.utils.aoa_to_sheet(aoa.map((r, i) => (i === 0 ? r : [Number(r[0]), ...r.slice(1)])))
  ws['!cols'] = [{ wch: 5 }, { wch: 34 }, { wch: 16 }, { wch: 24 }, { wch: 24 }, { wch: 60 }]

  const catatan = XLSX.utils.aoa_to_sheet([
    ['CATATAN KEAMANAN'],
    ['- File ini berisi password awal akun. Simpan di tempat aman dan hapus setelah dibagikan.'],
    ['- Bagikan ke tiap orang hanya akunnya sendiri; jangan kirim daftar lengkap ke grup.'],
    ['- Akun ber-role Admin, akun tester, dan akun nonaktif tidak disertakan.'],
    ['- Baris tanpa password: password sudah diganti pemiliknya. Gunakan "Reset Password" di Data Pengguna.'],
  ])
  catatan['!cols'] = [{ wch: 100 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Akun')
  XLSX.utils.book_append_sheet(wb, catatan, 'Catatan')
  XLSX.writeFile(wb, `akun-pengguna-${tanggalFile()}.xlsx`)
}

/**
 * Kartu akun untuk digunting, 2 kolom x 6 baris per halaman A4. Hanya akun yang
 * passwordnya terbaca yang dibuatkan kartu (yang sudah diganti dilewati).
 */
export async function unduhPdfKartu(
  hasil: HasilKredensial,
  urlLogin: string
): Promise<{ jumlahKartu: number; dilewati: number }> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })

  const halamanW = 210
  const halamanH = 297
  const mx = 10
  const my = 12
  const kolom = 2
  const baris = 6
  const jarakX = 5
  const jarakY = 4
  const kw = (halamanW - 2 * mx - jarakX * (kolom - 1)) / kolom
  const kh = (halamanH - 2 * my - jarakY * (baris - 1)) / baris
  const perHalaman = kolom * baris
  const pad = 4
  const labelW = 18
  const lebarKredensial = kw - 2 * pad - labelW

  // Username/password TIDAK BOLEH dipotong ("...") — kartu dengan kredensial
  // terpotong tidak bisa dipakai login. Huruf dikecilkan sampai muat; kalau
  // tetap tidak muat pada ukuran terkecil, kartunya dilewati (akunnya tetap ada
  // di file Excel).
  const UKURAN_AWAL = 9
  const UKURAN_MIN = 5
  const ukuranMuat = (teks: string): number | null => {
    doc.setFont('courier', 'bold')
    for (let u = UKURAN_AWAL; u >= UKURAN_MIN; u -= 0.5) {
      doc.setFontSize(u)
      if (doc.getTextWidth(teks) <= lebarKredensial) return u
    }
    return null
  }

  const kartu = hasil.data.filter(
    a => a.password && ukuranMuat(a.username) !== null && ukuranMuat(a.password) !== null
  )
  const dilewati = hasil.data.length - kartu.length
  if (kartu.length === 0) return { jumlahKartu: 0, dilewati }

  const potong = (teks: string, lebar: number): string => {
    const t = (doc.splitTextToSize(String(teks), lebar) as string[])[0] ?? ''
    return t.length < String(teks).length ? t.replace(/.$/, '...') : t
  }

  kartu.forEach((a, i) => {
    if (i > 0 && i % perHalaman === 0) doc.addPage()
    const slot = i % perHalaman
    const x = mx + (slot % kolom) * (kw + jarakX)
    const y = my + Math.floor(slot / kolom) * (kh + jarakY)
    const lebarIsi = kw - 2 * pad

    // Bingkai putus-putus (garis gunting).
    doc.setDrawColor(150)
    doc.setLineWidth(0.25)
    doc.setLineDashPattern([1.5, 1.5], 0)
    doc.roundedRect(x, y, kw, kh, 2, 2)
    doc.setLineDashPattern([], 0)

    // Kop: nama sekolah + peran.
    doc.setTextColor(30)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text(potong((hasil.namaSekolah || 'AKUN APLIKASI UJIAN').toUpperCase(), lebarIsi), x + pad, y + 6)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(90)
    doc.text(`Akun ${labelPeran(a.role)}`, x + pad, y + 10)
    doc.setDrawColor(200)
    doc.setLineWidth(0.2)
    doc.line(x + pad, y + 12, x + kw - pad, y + 12)

    // Isi: nama, username, password.
    doc.setTextColor(30)
    const baris1 = y + 17.5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text('Nama', x + pad, baris1)
    doc.text('Username', x + pad, baris1 + 6)
    doc.text('Password', x + pad, baris1 + 12)
    doc.setFont('helvetica', 'bold')
    doc.text(potong(a.nama, lebarIsi - labelW), x + pad + labelW, baris1)
    // Username & password ditulis UTUH (ukuran huruf menyesuaikan, tanpa dipotong).
    const passwordKartu = a.password ?? ''
    doc.setFont('courier', 'bold')
    doc.setFontSize(ukuranMuat(a.username) ?? UKURAN_MIN)
    doc.text(a.username, x + pad + labelW, baris1 + 6)
    doc.setFontSize(ukuranMuat(passwordKartu) ?? UKURAN_MIN)
    doc.text(passwordKartu, x + pad + labelW, baris1 + 12)

    // Kaki.
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(110)
    doc.text(potong(`Masuk di: ${urlLogin}`, lebarIsi), x + pad, y + kh - 7)
    doc.text('Rahasiakan akun ini. Jangan dibagikan ke orang lain.', x + pad, y + kh - 3.5)
  })

  doc.save(`kartu-akun-${tanggalFile()}.pdf`)
  return { jumlahKartu: kartu.length, dilewati }
}
