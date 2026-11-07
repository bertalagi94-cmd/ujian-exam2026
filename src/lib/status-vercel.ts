// src/lib/status-vercel.ts
//
// Logika MURNI (tanpa I/O) untuk kartu "Kesehatan Vercel" di Panel Developer.
// Mengubah data pemakaian Vercel menjadi status yang mudah dipahami:
// AMAN / WASPADA / BAHAYA, lengkap dengan kalimat bahasa sehari-hari.
//
// Sumber data (dibaca oleh /api/developer/vercel):
//   - GET /v1/billing/charges  → pemakaian per hari, format FOCUS v1.3 (JSONL)
//   - GET /v6/deployments      → status deploy produksi terakhir
// Batas (kuota) TIDAK bisa dibaca dari API Vercel, jadi diatur lewat env
// (default = batas paket Hobby), sama seperti kuota Supabase di
// /api/developer/penyimpanan.
//
// Hanya angka agregat sistem. Tidak ada data siswa, jawaban, atau nilai.

export type Tingkat = 'AMAN' | 'WASPADA' | 'BAHAYA'
export type KunciMeter = 'cpu' | 'deploy' | 'cdn' | 'functions' | 'memori' | 'invocation' | 'transfer' | 'origin'
export type Paket = 'hobby' | 'pro'

/** Satu baris data tagihan FOCUS. Semua field opsional agar toleran terhadap perubahan skema. */
export interface BarisCharge {
  ServiceName?: string | null
  SkuId?: string | null
  ChargeCategory?: string | null
  ChargePeriodStart?: string | null
  ConsumedQuantity?: number | string | null
  ConsumedUnit?: string | null
  BilledCost?: number | string | null
}

// Ambang status. Dua ukuran, yang terburuk menang:
//  1) persen kuota terpakai;
//  2) "sisa jatah cukup untuk berapa hari lagi sepadat HARI TERSIBUK" (pemakaian
//     harian tertinggi dalam periode). Ukuran ini cocok untuk ujian yang datang
//     bergelombang: satu hari ujian padat tidak dianggap terjadi setiap hari,
//     tetapi tetap ketahuan bila sisa jatah tidak cukup untuk hari padat berikutnya.
export const AMBANG_WASPADA_PERSEN = 70
export const AMBANG_BAHAYA_PERSEN = 90
export const AMBANG_WASPADA_HARI = 3 // sisa < 3 hari tersibuk -> WASPADA
export const AMBANG_BAHAYA_HARI = 1  // sisa < 1 hari tersibuk -> BAHAYA (satu hari padat lagi bisa menghabiskan)

// ── Konversi satuan ke satuan baku meter ─────────────────────────────────────
const MB_PER_GB = 1024

function keJam(n: number, satuan: string): number {
  const s = satuan.toLowerCase()
  if (/\bms\b|milli/.test(s)) return n / 3_600_000
  if (/^(s|sec|secs|second|seconds)$/.test(s.trim())) return n / 3600
  if (/^(m|min|mins|minute|minutes)$/.test(s.trim())) return n / 60
  return n // jam / CPU-hrs / hours
}

function keGbJam(n: number, satuan: string): number {
  const s = satuan.toLowerCase()
  if (/mb/.test(s)) return (/h/.test(s) ? n : n / 3600) / MB_PER_GB
  if (/gb/.test(s) && !/h/.test(s)) return n / 3600 // GB-detik
  return n // GB-jam
}

function keGb(n: number, satuan: string): number {
  const s = satuan.toLowerCase().trim()
  if (/\btb\b/.test(s)) return n * 1024
  if (/\bmb\b/.test(s)) return n / 1024
  if (/\bkb\b/.test(s)) return n / (1024 * 1024)
  if (/\bgb\b/.test(s)) return n
  if (/byte|^b$/.test(s)) return n / (1024 * 1024 * 1024)
  return n
}

/** Penyimpanan: Vercel menagih GB-bulan (rata-rata GB tersimpan selama sebulan). Dibaca sebagai GB. */
function keGbBulan(n: number, satuan: string): number {
  const s = satuan.toLowerCase()
  let gb = n
  if (/\btb\b/.test(s)) gb = n * 1024
  else if (/\bmb\b/.test(s)) gb = n / 1024
  else if (/\bkb\b/.test(s)) gb = n / (1024 * 1024)
  // Bila satuannya jam (GB-hrs), ubah ke GB-bulan (1 bulan ≈ 720 jam)
  if (/hour|hrs?\b|-h\b/.test(s)) gb = gb / 720
  return gb
}

interface DefMeter {
  kunci: KunciMeter
  label: string
  /** Sebutan dalam kalimat, mis. "CPU server". */
  sebutan: string
  satuan: string
  pola: RegExp
  /** Baris yang cocok dengan pola ini diabaikan (mis. Sandbox, CDN Request CPU Duration). */
  kecuali?: RegExp
  /** true = ukuran "stok" (isi penyimpanan saat ini), bukan arus harian; tidak ada hitungan "hari tersibuk". */
  stok?: boolean
  kuotaHobby: number
  env: string
  ubah: (n: number, satuan: string) => number
}

export const DEF_METER: DefMeter[] = [
  {
    kunci: 'cpu', label: 'Fluid Active CPU', sebutan: 'CPU server', satuan: 'jam',
    pola: /active[\s_-]*cpu/i, kecuali: /sandbox/i, kuotaHobby: 4, env: 'VERCEL_KUOTA_CPU_JAM', ubah: keJam,
  },
  {
    kunci: 'deploy', label: 'Deployment Storage', sebutan: 'penyimpanan deployment', satuan: 'GB', stok: true,
    pola: /deployment[\s_-]*storage/i, kuotaHobby: 10, env: 'VERCEL_KUOTA_DEPLOY_STORAGE_GB', ubah: keGbBulan,
  },
  {
    // Sejak 30 Sep 2026 bernama "CDN Requests" (dulu "Edge Requests"); angka dan batas sama.
    kunci: 'cdn', label: 'CDN Requests', sebutan: 'jumlah permintaan ke CDN', satuan: 'permintaan',
    pola: /(cdn|edge)[\s_-]*requests?/i, kecuali: /cpu|duration/i, kuotaHobby: 1_000_000, env: 'VERCEL_KUOTA_CDN_REQUESTS', ubah: n => n,
  },
  {
    kunci: 'functions', label: 'Functions Storage', sebutan: 'penyimpanan fungsi', satuan: 'GB', stok: true,
    pola: /functions?[\s_-]*storage/i, kuotaHobby: 10, env: 'VERCEL_KUOTA_FUNC_STORAGE_GB', ubah: keGbBulan,
  },
  {
    kunci: 'memori', label: 'Memori server', sebutan: 'memori server', satuan: 'GB-jam',
    pola: /provisioned[\s_-]*memory/i, kecuali: /sandbox/i, kuotaHobby: 360, env: 'VERCEL_KUOTA_MEMORI_GBJAM', ubah: keGbJam,
  },
  {
    kunci: 'invocation', label: 'Jumlah panggilan server', sebutan: 'jumlah panggilan ke server', satuan: 'kali',
    pola: /function[\s_-]*invocations?/i, kuotaHobby: 1_000_000, env: 'VERCEL_KUOTA_INVOCATION', ubah: n => n,
  },
  {
    kunci: 'transfer', label: 'Transfer data ke pengguna', sebutan: 'transfer data ke pengguna', satuan: 'GB',
    pola: /fast[\s_-]*data[\s_-]*transfer/i, kuotaHobby: 100, env: 'VERCEL_KUOTA_TRANSFER_GB', ubah: keGb,
  },
  {
    kunci: 'origin', label: 'Transfer data dari server', sebutan: 'transfer data dari server', satuan: 'GB',
    pola: /fast[\s_-]*origin[\s_-]*transfer/i, kuotaHobby: 10, env: 'VERCEL_KUOTA_ORIGIN_GB', ubah: keGb,
  },
]

// ── Utilitas kecil ───────────────────────────────────────────────────────────
function angka(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export function fmtAngka(n: number): string {
  const abs = Math.abs(n)
  const digit = abs >= 1000 ? 0 : abs >= 100 ? 1 : 2
  return n.toLocaleString('id-ID', { maximumFractionDigits: digit })
}

function awalKapital(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

const bulatSatuDesimal = (n: number) => Math.round(n * 10) / 10

// ── Membaca respons ──────────────────────────────────────────────────────────
/** Respons /v1/billing/charges berupa JSONL (satu objek per baris). Toleran terhadap baris rusak / array JSON. */
export function parseJsonl(teks: string): BarisCharge[] {
  const bersih = teks.trim()
  if (!bersih) return []
  if (bersih.startsWith('[')) {
    try {
      const arr = JSON.parse(bersih)
      return Array.isArray(arr) ? (arr.filter(x => x && typeof x === 'object') as BarisCharge[]) : []
    } catch { /* lanjut sebagai JSONL */ }
  }
  const hasil: BarisCharge[] = []
  for (const baris of bersih.split('\n')) {
    const s = baris.trim()
    if (!s) continue
    try {
      const o = JSON.parse(s)
      if (o && typeof o === 'object') hasil.push(o as BarisCharge)
    } catch { /* lewati baris rusak */ }
  }
  return hasil
}

// ── Agregasi pemakaian ───────────────────────────────────────────────────────
export interface Rincian { nama: string; jumlah: number; satuan: string; biayaUsd: number }

export interface HasilAgregasi {
  total: Record<KunciMeter, number>
  ada: Record<KunciMeter, boolean>
  perHari: Record<KunciMeter, Record<string, number>>
  rincian: Rincian[]
  biayaUsd: number
}

export function agregasi(baris: BarisCharge[]): HasilAgregasi {
  const kosong = <T,>(f: () => T) => Object.fromEntries(DEF_METER.map(d => [d.kunci, f()])) as Record<KunciMeter, T>
  const total = kosong(() => 0)
  const ada = kosong(() => false)
  const perHari = kosong<Record<string, number>>(() => ({}))
  const peta = new Map<string, Rincian>()
  let biayaUsd = 0

  for (const b of baris) {
    biayaUsd += angka(b.BilledCost) ?? 0
    const jumlah = angka(b.ConsumedQuantity)
    if (jumlah === null) continue // bukan baris pemakaian terukur

    const nama = (b.ServiceName ?? b.SkuId ?? 'Lainnya').toString()
    const satuan = (b.ConsumedUnit ?? '').toString()

    const kunciR = `${nama}|${satuan}`
    const r = peta.get(kunciR) ?? { nama, jumlah: 0, satuan, biayaUsd: 0 }
    r.jumlah += jumlah
    r.biayaUsd += angka(b.BilledCost) ?? 0
    peta.set(kunciR, r)

    const jerami = `${b.ServiceName ?? ''} ${b.SkuId ?? ''}`
    const def = DEF_METER.find(d => d.pola.test(jerami) && !(d.kecuali && d.kecuali.test(jerami)))
    if (!def) continue
    const nilai = def.ubah(jumlah, satuan)
    total[def.kunci] += nilai
    ada[def.kunci] = true
    const hari = (b.ChargePeriodStart ?? '').slice(0, 10)
    if (hari) perHari[def.kunci][hari] = (perHari[def.kunci][hari] ?? 0) + nilai
  }

  const rincian = [...peta.values()]
    .sort((a, b) => b.biayaUsd - a.biayaUsd || b.jumlah - a.jumlah)
    .slice(0, 15)
  return { total, ada, perHari, rincian, biayaUsd: Math.round(biayaUsd * 100) / 100 }
}

// ── Periode tagihan yang dibaca ──────────────────────────────────────────────
export interface Periode { from: string; to: string; mulai: string; hari: number; hariIni: string }

const awalHariUtc = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))

/**
 * Default: 30 hari terakhir (jendela bergulir — dokumentasi Vercel untuk paket
 * Hobby: batas terlampaui → tunggu 30 hari). Bila VERCEL_PERIODE_MULAI
 * (YYYY-MM-DD) diisi dan valid, dipakai sebagai awal siklus tagihan (Pro).
 */
export function periodeTagihan(sekarang: Date, mulaiEnv?: string, hari = 30): Periode {
  const hariIniD = awalHariUtc(sekarang)
  let awal = new Date(hariIniD.getTime() - (hari - 1) * 86_400_000)

  if (mulaiEnv && /^\d{4}-\d{2}-\d{2}$/.test(mulaiEnv.trim())) {
    const m = new Date(`${mulaiEnv.trim()}T00:00:00Z`)
    const selisih = (hariIniD.getTime() - m.getTime()) / 86_400_000
    if (!Number.isNaN(m.getTime()) && selisih >= 0 && selisih <= 365) awal = m
  }

  const akhir = new Date(hariIniD.getTime() + 86_400_000) // eksklusif
  return {
    from: awal.toISOString(),
    to: akhir.toISOString(),
    mulai: awal.toISOString().slice(0, 10),
    hari: Math.round((akhir.getTime() - awal.getTime()) / 86_400_000),
    hariIni: hariIniD.toISOString().slice(0, 10),
  }
}

// ── Penilaian satu meter ─────────────────────────────────────────────────────
export interface Meter {
  kunci: KunciMeter
  label: string
  satuan: string
  /** false = Vercel tidak mengirim data meter ini (belum ada pemakaian, atau nama berbeda; lihat rincian). */
  ada: boolean
  pakai: number
  kuota: number
  persen: number
  sisa: number
  /** Pemakaian harian tertinggi dalam periode (hari tersibuk), dalam satuan meter. */
  hariTersibuk: number
  /** Sisa jatah dibagi hari tersibuk: cukup untuk berapa hari lagi sepadat hari tersibuk. null bila belum ada data. */
  hariTersisa: number | null
  tingkat: Tingkat
  kalimat: string
}

export function kuotaMeter(def: DefMeter, env: Record<string, string | undefined>): number {
  const n = Number(env[def.env])
  return Number.isFinite(n) && n > 0 ? n : def.kuotaHobby
}

/** Pemakaian harian tertinggi (termasuk hari ini yang masih berjalan). */
export function hariTersibuk(perHari: Record<string, number>): number {
  let maks = 0
  for (const v of Object.values(perHari)) if (v > maks) maks = v
  return maks
}

function kalimatHari(hari: number | null, tersibuk: number, satuan: string): string {
  if (hari === null) return ''
  if (hari >= 60) return ' Jatah masih sangat cukup.'
  const sibuk = `${fmtAngka(tersibuk)} ${satuan} per hari`
  if (hari < 1) return ` Satu hari lagi sepadat hari tersibuk (${sibuk}) bisa menghabiskan sisa jatah.`
  return ` Sisa jatah cukup untuk sekitar ${Math.floor(hari)} hari lagi sepadat hari tersibuk (${sibuk}).`
}

export function nilaiMeter(
  def: DefMeter,
  agg: Pick<HasilAgregasi, 'total' | 'ada' | 'perHari'>,
  hariIni: string,
  kuota: number,
): Meter {
  const ada = agg.ada[def.kunci]
  const pakai = agg.total[def.kunci]
  const persenAsli = kuota > 0 ? (pakai / kuota) * 100 : 0
  const persen = bulatSatuDesimal(Math.min(999, persenAsli))
  const sisa = Math.max(0, kuota - pakai)
  const tersibuk = hariTersibuk(agg.perHari[def.kunci])
  const hariTersisa = ada && !def.stok && tersibuk > 0 ? sisa / tersibuk : null

  let tingkat: Tingkat = 'AMAN'
  if (ada) {
    if (persenAsli >= AMBANG_BAHAYA_PERSEN || (hariTersisa !== null && hariTersisa < AMBANG_BAHAYA_HARI)) tingkat = 'BAHAYA'
    else if (persenAsli >= AMBANG_WASPADA_PERSEN || (hariTersisa !== null && hariTersisa < AMBANG_WASPADA_HARI)) tingkat = 'WASPADA'
  }

  const angkaPakai = `${fmtAngka(pakai)} dari ${fmtAngka(kuota)} ${def.satuan}`
  let kalimat: string
  if (!ada) {
    kalimat = 'Belum ada data dari Vercel untuk bagian ini (biasanya karena belum ada pemakaian, atau data tagihan belum diperbarui).'
  } else if (tingkat === 'AMAN') {
    kalimat = `${awalKapital(def.sebutan)} baru ${fmtAngka(persen)}% terpakai (${angkaPakai}).${kalimatHari(hariTersisa, tersibuk, def.satuan)}`
  } else {
    kalimat = `${awalKapital(def.sebutan)} sudah ${fmtAngka(persen)}% terpakai (${angkaPakai}).${kalimatHari(hariTersisa, tersibuk, def.satuan)}`
  }

  return { kunci: def.kunci, label: def.label, satuan: def.satuan, ada, pakai, kuota, persen, sisa, hariTersibuk: tersibuk, hariTersisa, tingkat, kalimat }
}

// ── Deploy produksi terakhir ─────────────────────────────────────────────────
export interface PenilaianDeploy { tingkat: Tingkat; kalimat: string }

export function nilaiDeploy(state: string | null | undefined): PenilaianDeploy {
  switch ((state ?? '').toUpperCase()) {
    case 'READY':
      return { tingkat: 'AMAN', kalimat: 'Versi aplikasi terbaru berjalan normal.' }
    case 'ERROR':
      return {
        tingkat: 'WASPADA',
        kalimat: 'Pembuatan versi terbaru GAGAL. Aplikasi tetap berjalan memakai versi sebelumnya, tetapi perubahan terbaru belum aktif. Lihat Vercel → Deployments → log build.',
      }
    case 'BUILDING': case 'QUEUED': case 'INITIALIZING':
      return { tingkat: 'AMAN', kalimat: 'Versi baru sedang dibuat. Aplikasi tetap berjalan dengan versi sebelumnya sampai selesai.' }
    case 'CANCELED':
      return { tingkat: 'AMAN', kalimat: 'Pembuatan versi terakhir dibatalkan. Aplikasi memakai versi sebelumnya.' }
    default:
      return { tingkat: 'AMAN', kalimat: 'Status versi terbaru tidak dikenali.' }
  }
}

// ── Ringkasan keseluruhan ────────────────────────────────────────────────────
const URUTAN: Record<Tingkat, number> = { AMAN: 0, WASPADA: 1, BAHAYA: 2 }
export const terburuk = (a: Tingkat, b: Tingkat): Tingkat => (URUTAN[a] >= URUTAN[b] ? a : b)

function akibatHabis(paket: Paket): string {
  return paket === 'pro'
    ? 'Di paket Pro, pemakaian di atas jatah ditagih (cek batas Spend Management di Vercel agar tagihan tidak membengkak).'
    : 'Di paket Hobby, jika jatah habis Vercel menghentikan aplikasi sementara (sekitar 30 hari) sampai jatah pulih atau paket dinaikkan ke Pro.'
}

export interface RingkasanUmum { tingkat: Tingkat; ringkasan: string; saran: string[] }

export function ringkasanUmum(meter: Meter[], deploy: PenilaianDeploy | null, paket: Paket): RingkasanUmum {
  const terbaca = meter.filter(m => m.ada)
  let tingkat: Tingkat = 'AMAN'
  for (const m of terbaca) tingkat = terburuk(tingkat, m.tingkat)
  if (deploy) tingkat = terburuk(tingkat, deploy.tingkat)

  // Meter paling mendesak: tingkat tertinggi, lalu persen tertinggi.
  const utama = [...terbaca].sort((a, b) => URUTAN[b.tingkat] - URUTAN[a.tingkat] || b.persen - a.persen)[0]
  const deployBermasalah = deploy && deploy.tingkat !== 'AMAN'

  let ringkasan: string
  const saran: string[] = []

  if (tingkat === 'BAHAYA' && utama && utama.tingkat === 'BAHAYA') {
    ringkasan = `BAHAYA — hampir terkunci. ${utama.kalimat} ${akibatHabis(paket)}`
    saran.push(
      'Tunda ujian serentak berikutnya bila memungkinkan, atau bagi siswa ke beberapa sesi.',
      paket === 'pro'
        ? 'Naikkan batas Spend Management bila memang perlu, lalu kurangi beban (lihat CATATAN-HEMAT-VERCEL.md).'
        : 'Pertimbangkan upgrade ke Pro sebelum jatah habis, supaya ujian tidak terhenti di tengah jalan.',
      'Cocokkan angka ini dengan Vercel → Usage untuk memastikan.',
    )
  } else if (tingkat === 'WASPADA' && utama && utama.tingkat === 'WASPADA') {
    ringkasan = `WASPADA — masih jalan normal, tapi perlu dipantau. ${utama.kalimat}`
    saran.push(
      'Pantau kartu ini setiap hari, terutama sebelum jadwal ujian besar.',
      'Kurangi beban yang tidak perlu (lihat CATATAN-HEMAT-VERCEL.md).',
    )
  } else if (deployBermasalah) {
    ringkasan = `WASPADA — ${deploy!.kalimat}`
    saran.push('Perbaiki penyebab gagal build, lalu deploy ulang. Aplikasi yang sedang dipakai tidak terganggu.')
  } else if (terbaca.length === 0) {
    ringkasan = 'Belum ada angka pemakaian yang terbaca dari Vercel. Aplikasi tidak terdeteksi bermasalah; lihat rincian di bawah untuk memeriksa data yang diterima.'
  } else {
    const sebutan = DEF_METER.find(d => d.kunci === utama!.kunci)!.sebutan
    ringkasan = `AMAN — semua jatah Vercel masih longgar. Yang tertinggi: ${sebutan} baru ${fmtAngka(utama!.persen)}%.`
  }

  // Deploy gagal tetap diinformasikan walau ringkasan utamanya soal kuota.
  if (deployBermasalah && (tingkat === 'BAHAYA' || (tingkat === 'WASPADA' && utama?.tingkat === 'WASPADA'))) {
    saran.push(deploy!.kalimat)
  }

  return { tingkat, ringkasan, saran }
}

// ── Format angka seperti halaman Usage Vercel ────────────────────────────────
/** 0,29 jam -> "17m 27s"; 5,5 jam -> "5h 30m". */
function fmtDurasi(jam: number): string {
  const totalDetik = Math.round(jam * 3600)
  const h = Math.floor(totalDetik / 3600)
  const m = Math.floor((totalDetik % 3600) / 60)
  const d = totalDetik % 60
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  if (m > 0) return d > 0 ? `${m}m ${d}s` : `${m}m`
  return `${d}s`
}

function fmtRingkas(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })}M`
  if (n >= 1_000) return `${(n / 1_000).toLocaleString('id-ID', { maximumFractionDigits: 0 })}K`
  return n.toLocaleString('id-ID', { maximumFractionDigits: 0 })
}

/** Menampilkan nilai meter dengan gaya dashboard Vercel: "17m 27s", "490,93 MB", "39K". */
export function fmtMeterVercel(kunci: KunciMeter, n: number): string {
  switch (kunci) {
    case 'cpu': return fmtDurasi(n)
    case 'cdn': case 'invocation': return fmtRingkas(n)
    case 'memori': return `${n.toLocaleString('id-ID', { maximumFractionDigits: 1 })} GB-hrs`
    default: // GB
      return n < 1
        ? `${(n * 1024).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MB`
        : `${n.toLocaleString('id-ID', { maximumFractionDigits: 2 })} GB`
  }
}
