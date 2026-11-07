// GET /api/developer/vercel — kesehatan hosting Vercel, khusus developer.
//
// Menjawab: "apakah aplikasi masih aman, atau sudah mau terkunci karena kuota
// Vercel penuh?" dalam bahasa yang mudah (AMAN / WASPADA / BAHAYA).
//
// Sumber data (semua agregat sistem, tanpa data siswa/jawaban/nilai):
//   1. GET /v1/billing/charges — pemakaian per hari: Active CPU, memori,
//      invocation, transfer data (format FOCUS v1.3, JSONL)
//   2. GET /v6/deployments     — status deploy produksi terakhir
//   3. Env runtime Vercel       — region fungsi yang sedang melayani request ini
//
// Env yang dibutuhkan (lihat CATATAN-MONITOR-VERCEL.md):
//   VERCEL_API_TOKEN            WAJIB. Token dari Vercel → Account Settings → Tokens.
//                               Hanya dibaca di server, TIDAK pernah dikirim ke browser.
//   VERCEL_TEAM_ID              (opsional) id tim "team_xxx"; kosongkan untuk akun pribadi.
//   VERCEL_PROJECT_ID           (otomatis bila "System Environment Variables" aktif;
//                               kalau tidak, isi manual) — untuk status deploy.
//   VERCEL_PAKET                'hobby' (default) atau 'pro'.
//   VERCEL_KUOTA_*              (opsional) batas paket; default = batas Hobby.
//   VERCEL_PERIODE_MULAI        (opsional) YYYY-MM-DD, awal siklus tagihan (Pro).
//   VERCEL_REGION_DIHARAPKAN    (opsional) default 'sin1' (sama dengan vercel.json).
import { NextRequest, NextResponse } from 'next/server'
import { requireDeveloper } from '@/lib/developer-auth'
import {
  DEF_METER, agregasi, kuotaMeter, nilaiMeter, nilaiDeploy, parseJsonl, periodeTagihan, ringkasanUmum,
  type Meter, type Paket, type PenilaianDeploy,
} from '@/lib/status-vercel'

export const dynamic = 'force-dynamic'

const API = 'https://api.vercel.com'
const CACHE_MS = 90_000        // data tagihan berubah per hari; cukup 1 panggilan / 90 dtk
const JEDA_PAKSA_MS = 15_000   // tombol "Segarkan" tidak boleh menembak Vercel lebih rapat dari ini
const TIMEOUT_MS = 10_000

let cache: { at: number; data: Record<string, unknown> } | null = null

const NAMA_REGION: Record<string, string> = {
  sin1: 'Singapura', hnd1: 'Tokyo', kix1: 'Osaka', icn1: 'Seoul', hkg1: 'Hong Kong', bom1: 'Mumbai',
  syd1: 'Sydney', iad1: 'Washington D.C.', cle1: 'Cleveland', sfo1: 'San Francisco', pdx1: 'Portland',
  cdg1: 'Paris', fra1: 'Frankfurt', lhr1: 'London', dub1: 'Dublin', arn1: 'Stockholm',
  gru1: 'São Paulo', cpt1: 'Cape Town',
}

type HasilPanggil = { ok: true; teks: string } | { ok: false; error: string }

/** Pesan galat ramah. SENGAJA tidak menyertakan isi respons/URL/token. */
function pesanGagal(status: number): string {
  if (status === 401) return 'Token Vercel ditolak (salah atau kedaluwarsa). Buat token baru di Vercel → Account Settings → Tokens, lalu perbarui VERCEL_API_TOKEN.'
  if (status === 403) return 'Token Vercel tidak punya izin membaca data ini. Pastikan token dibuat oleh akun/tim pemilik project, dan peran akunnya boleh melihat tagihan (Owner/Billing).'
  if (status === 404) return 'Data tidak ditemukan di Vercel. Periksa VERCEL_TEAM_ID dan VERCEL_PROJECT_ID.'
  if (status === 429) return 'Vercel sedang membatasi permintaan. Coba lagi sekitar 1 menit.'
  return `Vercel menjawab galat ${status}. Coba lagi nanti.`
}

async function panggilVercel(path: string, params: Record<string, string>, token: string): Promise<HasilPanggil> {
  const url = new URL(path, API)
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v)
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, application/jsonl' },
      signal: ctrl.signal,
      cache: 'no-store',
    })
    if (!res.ok) return { ok: false, error: pesanGagal(res.status) }
    return { ok: true, teks: await res.text() }
  } catch (e) {
    const habisWaktu = e instanceof Error && e.name === 'AbortError'
    return { ok: false, error: habisWaktu ? 'Vercel tidak menjawab dalam 10 detik. Coba lagi nanti.' : 'Tidak bisa menghubungi Vercel dari server.' }
  } finally {
    clearTimeout(t)
  }
}

function infoRuntime() {
  const region = process.env.VERCEL_REGION?.toLowerCase() || null
  const diharapkan = (process.env.VERCEL_REGION_DIHARAPKAN || 'sin1').toLowerCase()
  const nama = (r: string) => NAMA_REGION[r] ? `${NAMA_REGION[r]} (${r})` : r
  let kalimat: string | null = null
  if (region) {
    kalimat = region === diharapkan
      ? `Fungsi berjalan di ${nama(region)}, dekat dengan database. Ini sudah tepat.`
      : `Fungsi berjalan di ${nama(region)}, bukan ${nama(diharapkan)}. Jarak ke database jadi jauh sehingga lebih lambat dan lebih boros CPU. Periksa Vercel → Settings → Functions → Function Region.`
  }
  return {
    region,
    regionBenar: region ? region === diharapkan : null,
    kalimat,
    env: process.env.VERCEL_ENV ?? null,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    commit: process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : null,
  }
}

const LANGKAH_SETUP = [
  'Buka vercel.com → klik foto profil → Account Settings → Tokens → Create Token. Beri nama "monitor-ujian", pilih akun/tim yang memiliki project ini, masa berlaku sesuai kebutuhan.',
  'Salin token-nya (hanya tampil sekali).',
  'Buka Project → Settings → Environment Variables, tambahkan VERCEL_API_TOKEN (isi token tadi). Kalau project berada di dalam Team, tambahkan juga VERCEL_TEAM_ID (id tim berawalan "team_", ada di Team Settings → General).',
  'Aktifkan "Automatically expose System Environment Variables" di halaman yang sama agar VERCEL_PROJECT_ID terisi otomatis (atau isi VERCEL_PROJECT_ID manual).',
  'Redeploy project, lalu buka kembali halaman ini.',
]

export async function GET(req: NextRequest) {
  const auth = requireDeveloper(req)
  if ('error' in auth) return auth.error

  const sekarang = Date.now()
  const paksa = req.nextUrl.searchParams.get('paksa') === '1'
  // Normal: pakai cache bila umurnya < 90 dtk. "Segarkan" (paksa): hanya bila < 15 dtk.
  const umur = cache ? sekarang - cache.at : Infinity
  if (cache && umur < (paksa ? JEDA_PAKSA_MS : CACHE_MS)) {
    return NextResponse.json(cache.data)
  }

  const paket: Paket = process.env.VERCEL_PAKET?.toLowerCase() === 'pro' ? 'pro' : 'hobby'
  const runtime = infoRuntime()
  const token = process.env.VERCEL_API_TOKEN

  if (!token) {
    const data = {
      terhubung: false,
      paket,
      alasan: 'Belum terhubung ke Vercel. Kartu ini butuh VERCEL_API_TOKEN supaya bisa membaca pemakaian CPU, memori, dan kuota.',
      langkah: LANGKAH_SETUP,
      runtime,
      timestamp: new Date(sekarang).toISOString(),
    }
    return NextResponse.json(data) // tidak di-cache: begitu env diisi, langsung terbaca
  }

  const teamId = process.env.VERCEL_TEAM_ID ?? ''
  const projectId = process.env.VERCEL_PROJECT_ID ?? ''
  const periode = periodeTagihan(new Date(sekarang), process.env.VERCEL_PERIODE_MULAI)

  const [tagihan, deployRes] = await Promise.all([
    panggilVercel('/v1/billing/charges', { teamId, from: periode.from, to: periode.to }, token),
    projectId
      ? panggilVercel('/v6/deployments', { projectId, teamId, target: 'production', limit: '3' }, token)
      : Promise.resolve<HasilPanggil>({ ok: false, error: 'VERCEL_PROJECT_ID belum tersedia. Aktifkan "System Environment Variables" di pengaturan project, atau isi VERCEL_PROJECT_ID manual.' }),
  ])

  // ── Pemakaian ──
  let meter: Meter[] = []
  let rincian: ReturnType<typeof agregasi>['rincian'] = []
  let biayaUsd = 0
  let tagihanError: string | null = null
  let jumlahBaris = 0
  if (tagihan.ok) {
    const baris = parseJsonl(tagihan.teks)
    jumlahBaris = baris.length
    const agg = agregasi(baris)
    rincian = agg.rincian
    biayaUsd = agg.biayaUsd
    meter = DEF_METER.map(d => nilaiMeter(d, agg, periode.hariIni, kuotaMeter(d, process.env)))
  } else {
    tagihanError = tagihan.error
  }

  // ── Deploy produksi terakhir ──
  let deploy: ({ ok: true; state: string; dibuatMs: number | null } & PenilaianDeploy) | { ok: false; error: string }
  if (deployRes.ok) {
    try {
      const j = JSON.parse(deployRes.teks) as { deployments?: Array<{ state?: string; readyState?: string; created?: number; createdAt?: number }> }
      const d = j.deployments?.[0]
      if (d) {
        const state = (d.state ?? d.readyState ?? '').toString()
        deploy = { ok: true, state, dibuatMs: d.created ?? d.createdAt ?? null, ...nilaiDeploy(state) }
      } else {
        deploy = { ok: false, error: 'Belum ada deployment produksi yang ditemukan untuk project ini.' }
      }
    } catch {
      deploy = { ok: false, error: 'Jawaban status deploy dari Vercel tidak bisa dibaca.' }
    }
  } else {
    deploy = { ok: false, error: deployRes.error }
  }

  const umum = meter.length && jumlahBaris > 0
    ? ringkasanUmum(meter, deploy.ok ? { tingkat: deploy.tingkat, kalimat: deploy.kalimat } : null, paket)
    : null

  const data = {
    terhubung: true,
    paket,
    tingkat: umum?.tingkat ?? (deploy.ok ? deploy.tingkat : null),
    ringkasan: umum?.ringkasan
      ?? (deploy.ok && deploy.tingkat !== 'AMAN' ? deploy.kalimat
        : tagihan.ok && jumlahBaris === 0
          ? 'Vercel menjawab, tetapi tidak mengirim data pemakaian sama sekali. Angka kuota belum bisa ditampilkan (lihat penjelasan di bawah).'
          : 'Pemakaian Vercel belum bisa dibaca. Lihat pesan di bawah.'),
    saran: umum?.saran ?? [],
    meter,
    // Berapa baris pemakaian yang dikirim Vercel. 0 = Vercel menjawab sukses tetapi kosong
    // (umum pada akun Hobby, karena API tagihan hanya memuat pemakaian yang ditagih).
    jumlahBaris,
    periode: { mulai: periode.mulai, hari: periode.hari },
    biayaUsd,
    rincian,
    tagihanError,
    deploy,
    runtime,
    timestamp: new Date(sekarang).toISOString(),
  }

  // Hanya cache jawaban yang sukses (jangan "mengunci" galat sementara selama 90 detik).
  if (tagihan.ok) cache = { at: sekarang, data }
  return NextResponse.json(data)
}
