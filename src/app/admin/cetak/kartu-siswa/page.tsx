'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function fmtTanggal(d: string) {
  if (!d) return '-'
  const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']
  const dt = new Date(d)
  return `${dt.getDate()} ${months[dt.getMonth()]} ${dt.getFullYear()}`
}

interface Siswa {
  nis: string; nama: string; kelas: string
  jenis_kelamin?: string; tempat_lahir?: string; tanggal_lahir?: string
}
interface Sekolah {
  namaSekolah?: string; npsn?: string; tahunAjaran?: string; logoUrl?: string; kota?: string
}

function getInitials(nama: string) {
  return nama.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()
}

// Warna avatar berdasarkan inisial
function avatarColor(initials: string) {
  const colors = [
    ['#1e40af','#3b82f6'], ['#065f46','#10b981'], ['#7c2d12','#f97316'],
    ['#4c1d95','#8b5cf6'], ['#881337','#f43f5e'], ['#164e63','#06b6d4'],
    ['#713f12','#eab308'], ['#14532d','#22c55e'],
  ]
  const idx = (initials.charCodeAt(0) + (initials.charCodeAt(1) || 0)) % colors.length
  return colors[idx]
}

function KartuSiswaContent() {
  const params = useSearchParams()
  const kelas = params.get('kelas') ?? ''
  const containerRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const token = localStorage.getItem('token')
    const res = await fetch(`/api/admin/cetak/kartu-siswa?kelas=${encodeURIComponent(kelas)}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const json = await res.json()
    renderHTML(json.siswa ?? [], json.sekolah ?? {})
  }, [kelas])

  useEffect(() => { if (kelas) load() }, [load, kelas])

  function renderHTML(siswaList: Siswa[], sekolah: Sekolah) {
    if (!containerRef.current) return
    const s = sekolah

    // 2 kartu per baris, 4 kartu per halaman (2x2 grid)
    const cards = siswaList.map((siswa, idx) => {
      const initials = getInitials(siswa.nama)
      const [bg1, bg2] = avatarColor(initials)
      // Password default = NIS siswa
      const passwordDefault = siswa.nis

      return `
      <div class="kartu">
        <!-- Header strip -->
        <div class="kartu-header">
          <div class="header-left">
            ${s.logoUrl
              ? `<img src="${s.logoUrl}" class="kartu-logo" alt="logo">`
              : `<div class="kartu-logo-ph"></div>`}
            <div class="header-title">
              <div class="kartu-judul">KARTU PESERTA UJIAN</div>
              <div class="kartu-subjudul">${s.namaSekolah ?? 'NAMA SEKOLAH'} | T.A. ${s.tahunAjaran ?? '-'}</div>
            </div>
          </div>
          <div class="kartu-nomor">${idx + 1}</div>
        </div>
        <div class="kartu-divider"></div>
        <!-- Body -->
        <div class="kartu-body">
          <!-- Avatar -->
          <div class="avatar" style="background: linear-gradient(135deg, ${bg1}, ${bg2})">
            <span class="avatar-initials">${initials}</span>
          </div>
          <!-- Info -->
          <div class="kartu-info">
            <div class="siswa-nama">${siswa.nama}</div>
            <table class="detail-table">
              <tr><td>NIS</td><td>:</td><td><strong>${siswa.nis}</strong></td></tr>
              <tr><td>Jenis Kelamin</td><td>:</td><td>${siswa.jenis_kelamin ?? '-'}</td></tr>
              <tr><td>Tempat Lahir</td><td>:</td><td>${siswa.tempat_lahir ?? '-'}</td></tr>
              <tr><td>Tanggal Lahir</td><td>:</td><td>${siswa.tanggal_lahir ? fmtTanggal(siswa.tanggal_lahir) : '-'}</td></tr>
            </table>
          </div>
        </div>
        <!-- Login Info -->
        <div class="login-box">
          <div class="login-label">🔐 Login Ujian</div>
          <div class="login-row">
            <div><span class="login-key">Username</span><span class="login-val">${siswa.nis}</span></div>
            <div><span class="login-key">Password</span><span class="login-val">${passwordDefault}</span></div>
          </div>
        </div>
      </div>`
    }).join('')

    containerRef.current.innerHTML = `
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { background: #fff; font-family: 'Arial', sans-serif; }

      .page-wrap {
        width: 210mm;
        margin: 0 auto;
        padding: 10mm;
      }

      .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8mm;
      }

      /* === KARTU === */
      .kartu {
        border-radius: 12px;
        overflow: hidden;
        background: linear-gradient(160deg, #1e3a6e 0%, #2563eb 60%, #38bdf8 100%);
        color: #fff;
        padding: 0;
        box-shadow: 0 4px 18px rgba(0,0,0,0.18);
        page-break-inside: avoid;
        position: relative;
      }

      /* noise overlay for texture */
      .kartu::before {
        content: '';
        position: absolute;
        inset: 0;
        background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");
        opacity: 0.06;
        pointer-events: none;
        border-radius: 12px;
      }

      .kartu-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px 8px;
        position: relative;
      }

      .header-left {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1;
      }

      .kartu-logo {
        width: 36px;
        height: 36px;
        object-fit: contain;
        border-radius: 4px;
        flex-shrink: 0;
      }

      .kartu-logo-ph {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: rgba(255,255,255,0.2);
        border: 1.5px solid rgba(255,255,255,0.5);
        flex-shrink: 0;
      }

      .kartu-judul {
        font-size: 9pt;
        font-weight: 800;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        line-height: 1.2;
        color: #fff;
      }

      .kartu-subjudul {
        font-size: 7pt;
        opacity: 0.8;
        color: #bfdbfe;
      }

      .kartu-nomor {
        width: 26px;
        height: 26px;
        border-radius: 8px;
        background: rgba(255,255,255,0.18);
        border: 1px solid rgba(255,255,255,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 9pt;
        font-weight: 700;
        backdrop-filter: blur(4px);
      }

      .kartu-divider {
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
        margin: 0 12px;
      }

      .kartu-body {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 10px 12px;
      }

      .avatar {
        width: 56px;
        height: 56px;
        border-radius: 10px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid rgba(255,255,255,0.4);
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      }

      .avatar-initials {
        font-size: 16pt;
        font-weight: 800;
        color: #fff;
        letter-spacing: -1px;
      }

      .kartu-info {
        flex: 1;
        min-width: 0;
      }

      .siswa-nama {
        font-size: 9.5pt;
        font-weight: 700;
        color: #fff;
        text-transform: uppercase;
        letter-spacing: 0.3px;
        margin-bottom: 5px;
        line-height: 1.2;
      }

      .detail-table {
        width: 100%;
        border-collapse: collapse;
      }

      .detail-table td {
        font-size: 7.5pt;
        color: #bfdbfe;
        padding: 1px 3px 1px 0;
        vertical-align: top;
        line-height: 1.4;
      }

      .detail-table td:first-child { width: 80px; }
      .detail-table td:nth-child(2) { width: 10px; }
      .detail-table td:last-child { color: #e0f2fe; font-weight: 500; }

      .login-box {
        margin: 0 10px 10px;
        background: rgba(0,0,0,0.25);
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 8px;
        padding: 7px 10px;
        backdrop-filter: blur(4px);
      }

      .login-label {
        font-size: 7.5pt;
        color: #93c5fd;
        margin-bottom: 5px;
        font-weight: 600;
        letter-spacing: 0.3px;
      }

      .login-row {
        display: flex;
        gap: 16px;
      }

      .login-key {
        display: block;
        font-size: 6.5pt;
        color: #93c5fd;
        margin-bottom: 1px;
      }

      .login-val {
        display: block;
        font-size: 9.5pt;
        font-weight: 800;
        color: #fff;
        font-family: 'Courier New', monospace;
        letter-spacing: 1px;
      }

      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .page-wrap { padding: 8mm; }
        .kartu { break-inside: avoid; }
      }

      @page { size: A4; margin: 0; }
    </style>
    <div class="page-wrap">
      <div class="grid">${cards}</div>
    </div>`

    setTimeout(() => window.print(), 700)
  }

  return <div ref={containerRef} style={{ background: '#fff', minHeight: '100vh' }}>
    <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'sans-serif', color: '#666' }}>
      Memuat kartu peserta...
    </div>
  </div>
}

export default function KartuSiswaPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: 'center' }}>Memuat...</div>}>
      <KartuSiswaContent />
    </Suspense>
  )
}
