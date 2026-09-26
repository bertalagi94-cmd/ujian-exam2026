#!/usr/bin/env node
// scripts/generate-precache-manifest.js
//
// Dijalankan OTOMATIS setelah `next build` selesai (lihat "postbuild" di
// package.json). Tugasnya: baca manifest build Next.js
// (.next/app-build-manifest.json) untuk rute-rute yang WAJIB tetap bisa
// dimuat walau perangkat sedang offline, lalu tulis daftar URL asetnya
// (JS/CSS yang sudah di-hash) ke public/precache-manifest.json.
//
// KENAPA INI PERLU (lihat public/sw.js versi lama sebelum perbaikan ini):
// Service Worker sebelumnya HANYA menyimpan ke cache resource yang
// "kebetulan pernah diminta browser saat online" (runtime caching murni,
// tanpa precache saat install). Akibatnya kalau guru/admin belum sempat
// membuka persis URL tertentu dengan cara yang memicu fetch penuh sebelum
// jaringan mati, halaman itu gagal dimuat total saat offline — walau
// sebenarnya halaman itu 100% statis (lihat hasil `next build`: ditandai
// "○ Static"). Script ini memastikan aset-asetnya SUDAH ada di cache sejak
// Service Worker pertama kali diinstal, tidak menunggu "kebetulan".
//
// CARA KERJA:
//   1. Baca .next/BUILD_ID — dipakai sebagai bagian nama cache di sw.js,
//      supaya cache lama otomatis dibuang tiap ada deploy baru (lihat
//      logika `activate` di sw.js).
//   2. Baca .next/app-build-manifest.json — untuk tiap rute di RUTE_PRECACHE,
//      manifest ini sudah berisi DAFTAR LENGKAP file JS yang dibutuhkan
//      rute itu (termasuk chunk dari root layout & layout guru/admin di
//      atasnya, framework React, dst — tidak perlu digabung manual).
//   3. Tulis public/precache-manifest.json: dokumen HTML tiap rute (URL
//      rute itu sendiri) + semua file JS yang dibutuhkan, sebagai satu
//      daftar URL yang di-`fetch()` lalu disimpan ke Cache API saat
//      Service Worker di-install (lihat public/sw.js).
//
// CARA MENAMBAH RUTE BARU: tinggal tambahkan path-nya ke RUTE_PRECACHE di
// bawah, lalu build ulang. Tidak perlu ubah apapun di sw.js.
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const NEXT_DIR = path.join(ROOT, '.next')

// ─── Rute yang WAJIB tetap bisa dimuat walau offline ───────────────────────
// Tahap 1 (mendesak): alur darurat guru saat mengawas ujian.
// Tahap berikutnya akan menambah rute admin/kepsek/siswa lain di sini.
const RUTE_PRECACHE = [
  '/login',
  '/guru',
  '/guru/mode-pengawas',
]

function bacaJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

function main() {
  const buildIdPath = path.join(NEXT_DIR, 'BUILD_ID')
  const manifestPath = path.join(NEXT_DIR, 'app-build-manifest.json')

  if (!fs.existsSync(buildIdPath) || !fs.existsSync(manifestPath)) {
    console.warn(
      '[precache-manifest] .next/BUILD_ID atau app-build-manifest.json tidak ' +
      'ditemukan — lewati (mungkin dipanggil di luar urutan `next build`).'
    )
    return
  }

  const buildId = fs.readFileSync(buildIdPath, 'utf8').trim()
  const appManifest = bacaJson(manifestPath)

  const fileSet = new Set()
  const ruteDitemukan = []
  const ruteHilang = []

  for (const rute of RUTE_PRECACHE) {
    const key = rute === '/' ? '/page' : `${rute}/page`
    const files = appManifest.pages[key]
    if (!files) {
      ruteHilang.push(rute)
      continue
    }
    ruteDitemukan.push(rute)
    files.forEach((f) => fileSet.add(`/_next/${f}`))
  }

  if (ruteHilang.length > 0) {
    console.warn(
      `[precache-manifest] PERINGATAN: rute berikut tidak ditemukan di ` +
      `app-build-manifest.json dan TIDAK ikut di-precache: ${ruteHilang.join(', ')}. ` +
      `Cek lagi path-nya di RUTE_PRECACHE (scripts/generate-precache-manifest.js).`
    )
  }

  const urls = [...ruteDitemukan, ...fileSet]
  const out = { buildId, generatedAt: new Date().toISOString(), urls }

  const outPath = path.join(ROOT, 'public', 'precache-manifest.json')
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2))
  console.log(
    `[precache-manifest] Selesai: ${urls.length} URL dicatat untuk precache ` +
    `(build ${buildId}), rute: ${ruteDitemukan.join(', ')}.`
  )
}

main()
