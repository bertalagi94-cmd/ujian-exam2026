'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

// Format tanggal Indonesia
function fmtTanggal(d: string) {
  if (!d) return ''
  const days = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu']
  const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']
  const dt = new Date(d)
  return `${days[dt.getDay()]}, ${dt.getDate()} ${months[dt.getMonth()]} ${dt.getFullYear()}`
}
function fmtTglPendek(d: string) {
  if (!d) return ''
  const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']
  const dt = new Date(d)
  return `${dt.getDate()} ${months[dt.getMonth()]} ${dt.getFullYear()}`
}

interface Siswa { nis: string; nama: string }
interface SekolahCetak {
  namaSekolah?: string; npsn?: string; alamat?: string
  kota?: string; tahunAjaran?: string; namaKepsek?: string; logoUrl?: string
  label?: string
}
interface JadwalCetak {
  id: string; tanggal: string; sesi: number
  jam_mulai: string; jam_selesai: string; durasi: number
  kelas: string; nama_mapel: string; nama_pengawas: string
  siswa: Siswa[]
  sekolah: SekolahCetak | null
}

function CetakContent() {
  const params = useSearchParams()
  const tanggal = params.get('tanggal') ?? ''
  const mode = params.get('mode') ?? 'daftar-hadir'
  const jadwalId = params.get('id')

  const containerRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const token = localStorage.getItem('token')
    const res = await fetch(`/api/admin/cetak?tanggal=${tanggal}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const json = await res.json()
    let jadwal: JadwalCetak[] = json.data ?? []
    if (jadwalId) jadwal = jadwal.filter((j: JadwalCetak) => j.id === jadwalId)
    renderHTML(jadwal, mode)
  }, [tanggal, jadwalId, mode])

  useEffect(() => { if (tanggal) load() }, [load, tanggal])

  function renderHTML(jadwal: JadwalCetak[], mode: string) {
    if (!containerRef.current) return

    const pages = jadwal.map(j => {
      // Sekolah diambil per-jadwal dari kelas, bukan global
      const s: SekolahCetak = j.sekolah ?? {}

      // Peringatan kalau sekolah belum diset untuk kelas ini
      if (!j.sekolah) {
        return `<div class="page" style="display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;">
          <div style="font-size:14pt;font-weight:bold;color:#b91c1c;">⚠️ Sekolah Belum Dikonfigurasi</div>
          <div style="font-size:11pt;color:#333;text-align:center;">
            Kelas <strong>${j.kelas}</strong> belum diatur sekolahnya.<br>
            Buka menu <strong>Data Kelas → Edit</strong> dan pilih sekolah untuk kelas ini,<br>
            kemudian cetak ulang dokumen ini.
          </div>
        </div>`
      }

      if (mode === 'berita-acara') {
        return `
        <div class="page">
          <div class="kop">
            ${s.logoUrl ? `<img src="${s.logoUrl}" class="logo" alt="logo">` : '<div class="logo-placeholder"></div>'}
            <div class="kop-text">
              <div class="kop-nama">${s.namaSekolah ?? 'NAMA SEKOLAH'}</div>
              <div class="kop-sub">NPSN: ${s.npsn ?? '-'}</div>
              <div class="kop-sub">${s.alamat ?? ''}</div>
            </div>
          </div>
          <div class="divider-ganda"></div>
          <div class="judul-doc">BERITA ACARA PELAKSANAAN UJIAN</div>
          <div class="intro">Pada hari ini, <strong>${fmtTanggal(j.tanggal)}</strong> telah dilaksanakan Ujian dengan ketentuan sebagai berikut:</div>
          <table class="info-table">
            <tr><td>Mata Pelajaran</td><td>:</td><td><strong>${j.nama_mapel}</strong></td></tr>
            <tr><td>Kelas</td><td>:</td><td>${j.kelas}</td></tr>
            <tr><td>Pukul</td><td>:</td><td>${j.jam_mulai} s.d. ${j.jam_selesai} (${j.durasi} menit)</td></tr>
            <tr><td>Sesi ke-</td><td>:</td><td>${j.sesi}</td></tr>
            <tr><td>Nama Pengawas</td><td>:</td><td>${j.nama_pengawas || '-'}</td></tr>
            <tr><td>Jumlah Peserta Terdaftar</td><td>:</td><td>${j.siswa.length} siswa</td></tr>
            <tr><td>Jumlah Hadir</td><td>:</td><td>______ siswa</td></tr>
            <tr><td>Jumlah Tidak Hadir</td><td>:</td><td>______ siswa (sakit: ___, izin: ___, alpha: ___)</td></tr>
            <tr><td>Kejadian Khusus</td><td>:</td><td style="border-bottom:1px solid #000; min-width:300px;">&nbsp;</td></tr>
          </table>
          <p style="margin-top:16px; font-size:11pt;">Demikian berita acara ini dibuat dengan sesungguhnya untuk dapat dipergunakan sebagaimana mestinya.</p>
          <div class="ttd-area">
            <div class="ttd-col">
              <div>Pengawas Ujian,</div>
              <div class="ttd-space"></div>
              <div class="ttd-nama">${j.nama_pengawas || '_________________'}</div>
            </div>
            <div class="ttd-col" style="text-align:right;">
              <div>${s.kota ?? ''}, ${fmtTglPendek(j.tanggal)},</div>
              <div>Kepala ${s.namaSekolah ?? 'Sekolah'},</div>
              <div class="ttd-space"></div>
              <div class="ttd-nama">${s.namaKepsek ?? '_________________'}</div>
            </div>
          </div>
        </div>`
      }

      // mode daftar hadir
      const rows = j.siswa.map((siswa, i) => `
        <tr>
          <td class="tc">${i + 1}</td>
          <td>${siswa.nis}</td>
          <td>${siswa.nama}</td>
          <td class="ttd-cell"></td>
        </tr>`).join('')

      return `
      <div class="page">
        <div class="kop">
          ${s.logoUrl ? `<img src="${s.logoUrl}" class="logo" alt="logo">` : '<div class="logo-placeholder"></div>'}
          <div class="kop-text">
            <div class="kop-nama">${s.namaSekolah ?? 'NAMA SEKOLAH'}</div>
            <div class="kop-sub">NPSN: ${s.npsn ?? '-'}</div>
            <div class="kop-sub">${s.alamat ?? ''}</div>
          </div>
        </div>
        <div class="divider-ganda"></div>
        <div class="judul-doc">DAFTAR HADIR PESERTA UJIAN</div>
        <table class="meta-table">
          <tr>
            <td>Mata Pelajaran</td><td>:</td>
            <td><strong>${j.nama_mapel}</strong></td>
            <td>Kelas</td><td>:</td><td>${j.kelas}</td>
          </tr>
          <tr>
            <td>Hari / Tanggal</td><td>:</td>
            <td>${fmtTanggal(j.tanggal)}</td>
            <td>Sesi</td><td>:</td><td>Sesi ke-${j.sesi}</td>
          </tr>
          <tr>
            <td>Pukul</td><td>:</td>
            <td>${j.jam_mulai} - ${j.jam_selesai}</td>
            <td>Pengawas</td><td>:</td><td>${j.nama_pengawas || '-'}</td>
          </tr>
          <tr>
            <td>Tahun Ajaran</td><td>:</td>
            <td>${s.tahunAjaran ?? '-'}</td>
            <td>Durasi</td><td>:</td><td>${j.durasi} menit</td>
          </tr>
        </table>
        <table class="hadir-table">
          <thead>
            <tr><th class="tc" style="width:40px">No</th><th style="width:120px">NIS</th><th>Nama Siswa</th><th style="width:140px">Tanda Tangan</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="margin-top:10px; font-size:10pt;">Jumlah peserta: <strong>${j.siswa.length} siswa</strong></p>
        <div class="ttd-area">
          <div class="ttd-col">
            <div>Pengawas Ujian,</div>
            <div class="ttd-space"></div>
            <div class="ttd-nama">${j.nama_pengawas || '_________________'}</div>
          </div>
          <div class="ttd-col" style="text-align:right;">
            <div>${s.kota ?? ''}, ${fmtTglPendek(j.tanggal)}</div>
            <div>Mengetahui,</div>
            <div>Kepala ${s.namaSekolah ?? 'Sekolah'}</div>
            <div class="ttd-space"></div>
            <div class="ttd-nama">${s.namaKepsek ?? '_________________'}</div>
          </div>
        </div>
      </div>`
    }).join('')

    containerRef.current.innerHTML = `
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Times New Roman', serif; font-size: 11pt; color: #000; }
        .page { width: 210mm; min-height: 297mm; padding: 20mm 20mm 15mm 25mm; page-break-after: always; }
        .page:last-child { page-break-after: auto; }
        .kop { display: flex; align-items: center; gap: 16px; margin-bottom: 8px; }
        .logo { width: 70px; height: 70px; object-fit: contain; }
        .logo-placeholder { width: 70px; height: 70px; border: 1px solid #000; border-radius: 50%; flex-shrink: 0; }
        .kop-text { text-align: center; flex: 1; }
        .kop-nama { font-size: 16pt; font-weight: bold; text-transform: uppercase; }
        .kop-sub { font-size: 10pt; }
        .divider-ganda { border-top: 3px double #000; margin: 8px 0 14px; }
        .judul-doc { text-align: center; font-size: 13pt; font-weight: bold; text-decoration: underline; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 1px; }
        .intro { margin-bottom: 12px; font-size: 11pt; }
        .info-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
        .info-table td { padding: 4px 8px; vertical-align: top; font-size: 11pt; }
        .info-table td:first-child { width: 200px; }
        .info-table td:nth-child(2) { width: 20px; }
        .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
        .meta-table td { padding: 3px 6px; font-size: 10.5pt; }
        .meta-table td:nth-child(1), .meta-table td:nth-child(4) { width: 130px; }
        .meta-table td:nth-child(2), .meta-table td:nth-child(5) { width: 14px; }
        .hadir-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
        .hadir-table th, .hadir-table td { border: 1px solid #000; padding: 5px 8px; font-size: 10.5pt; }
        .hadir-table th { background: #f0f0f0; font-weight: bold; text-align: left; }
        .hadir-table .tc { text-align: center; }
        .ttd-cell { height: 32px; }
        .ttd-area { display: flex; justify-content: space-between; margin-top: 28px; font-size: 11pt; }
        .ttd-col { display: flex; flex-direction: column; min-width: 200px; }
        .ttd-space { height: 60px; }
        .ttd-nama { font-weight: bold; text-decoration: underline; }
        @media print {
          body { -webkit-print-color-adjust: exact; }
          .page { page-break-after: always; }
        }
      </style>
      ${pages}
    `
    // Auto print setelah render
    setTimeout(() => window.print(), 600)
  }

  return (
    <>
      <style>{`
        body > *:not(#cetak-root) { display: none !important; }
        #cetak-root { display: block !important; }
      `}</style>
      <div id="cetak-root" ref={containerRef} style={{ background: '#fff' }}>
        <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'sans-serif', color: '#666' }}>
          Memuat dokumen...
        </div>
      </div>
    </>
  )
}

export default function CetakPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: 'center' }}>Memuat...</div>}>
      <CetakContent />
    </Suspense>
  )
}
