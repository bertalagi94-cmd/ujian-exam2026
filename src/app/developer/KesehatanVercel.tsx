'use client'

// Kartu "Ringkasan aplikasi" dan "Kesehatan Vercel" untuk tab Monitor Server
// di Panel Developer. Hanya menampilkan angka agregat sistem.
import {
  AlertTriangle, CheckCircle2, Cloud, Database, Globe, HardDrive, Info, RefreshCw, Rocket, ShieldCheck, XCircle,
} from 'lucide-react'
import { fmtAngka, fmtMeterVercel, type KunciMeter } from '@/lib/status-vercel'

export type TingkatUi = 'AMAN' | 'WASPADA' | 'BAHAYA'

export interface MeterVercel {
  kunci: string; label: string; satuan: string; ada: boolean
  pakai: number; kuota: number; persen: number; sisa: number
  hariTersibuk: number; hariTersisa: number | null; tingkat: TingkatUi; kalimat: string
}

export interface DataVercel {
  terhubung: boolean
  paket: 'hobby' | 'pro'
  alasan?: string
  langkah?: string[]
  tingkat?: TingkatUi | null
  ringkasan?: string
  saran?: string[]
  meter?: MeterVercel[]
  periode?: { mulai: string; hari: number }
  biayaUsd?: number
  jumlahBaris?: number
  rincian?: Array<{ nama: string; jumlah: number; satuan: string; biayaUsd: number }>
  tagihanError?: string | null
  deploy?:
    | { ok: true; state: string; dibuatMs: number | null; tingkat: TingkatUi; kalimat: string }
    | { ok: false; error: string }
  runtime: {
    region: string | null; regionBenar: boolean | null; kalimat: string | null
    env: string | null; deploymentId: string | null; commit: string | null
  }
  timestamp: string
}

const GAYA: Record<TingkatUi, { chip: string; bar: string; teks: string; titik: string }> = {
  AMAN: { chip: 'text-emerald-300 bg-emerald-400/10 ring-emerald-400/30', bar: 'bg-emerald-400', teks: 'text-emerald-200', titik: 'bg-emerald-400' },
  WASPADA: { chip: 'text-amber-300 bg-amber-400/10 ring-amber-400/30', bar: 'bg-amber-400', teks: 'text-amber-200', titik: 'bg-amber-400' },
  BAHAYA: { chip: 'text-rose-300 bg-rose-400/10 ring-rose-400/30', bar: 'bg-rose-400', teks: 'text-rose-200', titik: 'bg-rose-400' },
}
const URUTAN: Record<TingkatUi, number> = { AMAN: 0, WASPADA: 1, BAHAYA: 2 }

function Ikon({ t, className = 'w-4 h-4' }: { t: TingkatUi; className?: string }) {
  if (t === 'AMAN') return <CheckCircle2 className={`${className} text-emerald-300`} />
  if (t === 'WASPADA') return <AlertTriangle className={`${className} text-amber-300`} />
  return <XCircle className={`${className} text-rose-300`} />
}

/** Cincin kemajuan kecil, seperti ikon di halaman Usage Vercel. */
function Cincin({ persen, tingkat, ada }: { persen: number; tingkat: TingkatUi; ada: boolean }) {
  const r = 8
  const keliling = 2 * Math.PI * r
  const isi = ada ? Math.min(100, Math.max(persen, persen > 0 ? 3 : 0)) / 100 * keliling : 0
  const warna = tingkat === 'AMAN' ? '#34d399' : tingkat === 'WASPADA' ? '#fbbf24' : '#fb7185'
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" className="shrink-0 -rotate-90" aria-hidden="true">
      <circle cx="11" cy="11" r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
      {ada && <circle cx="11" cy="11" r={r} fill="none" stroke={warna} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${isi} ${keliling}`} />}
    </svg>
  )
}

const waktu = (ms: number) => new Date(ms).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })

// ── Ringkasan gabungan: Vercel + server/database + penyimpanan ───────────────
interface PropsRingkasan {
  vercel: DataVercel | null
  server: { status: string; alasan: string[]; dbResponseMs: number } | null
  stor: { storage: { persen: number }; database: { persen: number } } | null
}

export function RingkasanAplikasi({ vercel, server, stor }: PropsRingkasan) {
  type Baris = { nama: string; ikon: React.ReactNode; tingkat: TingkatUi | null; kalimat: string }
  const baris: Baris[] = []

  // 1) Vercel
  {
    let tingkat: TingkatUi | null = null
    let kalimat = 'Memuat data Vercel…'
    if (vercel) {
      if (!vercel.terhubung) kalimat = 'Belum terhubung ke Vercel, jadi kuota CPU dan memori belum bisa dipantau. Lihat kartu "Kesehatan Vercel" di bawah.'
      else if (vercel.tingkat) { tingkat = vercel.tingkat; kalimat = vercel.ringkasan ?? '' }
      else kalimat = vercel.tagihanError ?? 'Pemakaian Vercel belum bisa dibaca.'
    }
    baris.push({ nama: 'Hosting Vercel (CPU, memori, kuota)', ikon: <Cloud className="w-4 h-4" />, tingkat, kalimat })
  }

  // 2) Server & database (Supabase), dari metrik yang sudah ada
  {
    let tingkat: TingkatUi | null = null
    let kalimat = 'Memuat status server…'
    if (server) {
      tingkat = server.status === 'KRITIS' ? 'BAHAYA' : server.status === 'BERAT' || server.status === 'WASPADA' ? 'WASPADA' : 'AMAN'
      kalimat = tingkat === 'AMAN'
        ? `Server dan database merespons normal (ping database ${server.dbResponseMs} ms), tidak ada error berarti.`
        : server.alasan.join('. ') || 'Server melambat.'
    }
    baris.push({ nama: 'Server & database (Supabase)', ikon: <Database className="w-4 h-4" />, tingkat, kalimat })
  }

  // 3) Penyimpanan Supabase
  {
    let tingkat: TingkatUi | null = null
    let kalimat = 'Memuat ukuran penyimpanan…'
    if (stor) {
      const tertinggi = Math.max(stor.storage.persen, stor.database.persen)
      const nama = stor.database.persen >= stor.storage.persen ? 'Database' : 'Penyimpanan file'
      tingkat = tertinggi >= 90 ? 'BAHAYA' : tertinggi >= 70 ? 'WASPADA' : 'AMAN'
      kalimat = tingkat === 'AMAN'
        ? `Ruang masih longgar (yang tertinggi: ${nama.toLowerCase()} ${tertinggi}%).`
        : `${nama} sudah ${tertinggi}% terpakai${tingkat === 'BAHAYA' ? ', hampir penuh.' : ', mulai penuh.'}`
    }
    baris.push({ nama: 'Penyimpanan Supabase', ikon: <HardDrive className="w-4 h-4" />, tingkat, kalimat })
  }

  const terukur = baris.filter((b): b is Baris & { tingkat: TingkatUi } => b.tingkat !== null)
  const terburuk = terukur.reduce<TingkatUi | null>((a, b) => (a === null || URUTAN[b.tingkat] > URUTAN[a] ? b.tingkat : a), null)

  const judul = terburuk === null ? 'Memeriksa kondisi aplikasi…'
    : terburuk === 'AMAN' ? 'Aplikasi AMAN'
      : terburuk === 'WASPADA' ? 'Aplikasi masih jalan, tapi perlu diperhatikan'
        : 'BAHAYA — ada bagian yang hampir penuh atau terkunci'
  const sub = terburuk === 'AMAN' ? 'Tidak ada bagian yang mendekati batas.'
    : terburuk === 'WASPADA' ? 'Lihat bagian bertanda kuning di bawah.'
      : terburuk === 'BAHAYA' ? 'Segera tangani bagian bertanda merah sebelum ujian berikutnya.' : ''

  return (
    <div className="dv-kaca rounded-2xl p-5 md:p-6">
      <div className="flex items-start gap-3">
        {terburuk ? <Ikon t={terburuk} className="w-6 h-6 mt-0.5" /> : <RefreshCw className="w-6 h-6 mt-0.5 text-slate-500 animate-spin" />}
        <div className="min-w-0">
          <h3 className={`text-lg font-bold ${terburuk ? GAYA[terburuk].teks : 'text-slate-300'}`}>{judul}</h3>
          {sub && <p className="text-sm text-slate-400 mt-0.5">{sub}</p>}
        </div>
      </div>
      <ul className="mt-4 space-y-2.5">
        {baris.map(b => (
          <li key={b.nama} className="flex gap-3 rounded-xl bg-white/[0.03] ring-1 ring-white/5 p-3">
            <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${b.tingkat ? GAYA[b.tingkat].titik : 'bg-slate-600'}`} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">{b.ikon}{b.nama}</p>
              <p className="text-sm text-slate-400 mt-0.5">{b.kalimat}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Kartu Kesehatan Vercel ───────────────────────────────────────────────────
interface PropsKartu {
  data: DataVercel | null
  gagal: string
  memuat: boolean
  onSegarkan: () => void
}

export function KartuVercel({ data, gagal, memuat, onSegarkan }: PropsKartu) {
  return (
    <div className="dv-kaca rounded-2xl p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h3 className="font-bold text-white text-sm flex items-center gap-2"><Cloud className="w-4 h-4 text-cyan-300" />Kesehatan Vercel</h3>
          {data?.terhubung && data.tingkat && (
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ring-1 ${GAYA[data.tingkat].chip}`}>{data.tingkat}</span>
          )}
        </div>
        <button onClick={onSegarkan} disabled={memuat} className="inline-flex items-center gap-1.5 text-xs text-slate-300 hover:text-white disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${memuat ? 'animate-spin' : ''}`} />Segarkan
        </button>
      </div>

      {gagal && <p className="mt-3 text-sm text-rose-300">{gagal}</p>}
      {!data && !gagal && <div className="mt-3 h-24 rounded-xl dv-skel" />}

      {data && !data.terhubung && (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-amber-200/90">{data.alasan}</p>
          <ol className="list-decimal list-inside space-y-1.5 text-sm text-slate-300">
            {data.langkah?.map(l => <li key={l}>{l}</li>)}
          </ol>
        </div>
      )}

      {data?.terhubung && (
        <div className="mt-3 space-y-4">
          {data.ringkasan && (
            <p className={`text-sm leading-relaxed ${data.tingkat ? GAYA[data.tingkat].teks : 'text-slate-300'}`}>{data.ringkasan}</p>
          )}
          {data.saran && data.saran.length > 0 && (
            <ul className="space-y-1 text-sm text-slate-300 list-disc list-inside">{data.saran.map(s => <li key={s}>{s}</li>)}</ul>
          )}

          {data.tagihanError && <p className="text-sm text-rose-300">{data.tagihanError}</p>}

          {data.terhubung && data.jumlahBaris === 0 && !data.tagihanError && (
            <div className="rounded-xl bg-amber-400/5 ring-1 ring-amber-400/20 p-3.5 space-y-2 text-sm text-amber-100/90">
              <p className="font-semibold flex items-center gap-1.5"><Info className="w-4 h-4" />Vercel tidak mengirim data pemakaian</p>
              <p>
                Token dan koneksi sudah benar (Vercel menjawab sukses), tetapi daftar pemakaian yang dikirim kosong.
                API tagihan Vercel adalah API untuk <b>biaya</b>, dan menurut dokumentasi integrasi pihak ketiga akun Hobby (gratis)
                tidak punya data tagihan di sana. Dashboard Vercel sendiri membaca angka dari jalur internal yang tidak dibuka untuk umum,
                sehingga angka persis seperti di Vercel → Usage belum bisa diambil untuk akun Hobby.
              </p>
              <p className="text-amber-100/70">
                Sementara itu aktifkan email/notifikasi batas pemakaian di Vercel (Settings → Notifications) agar Anda diberi tahu
                sebelum jatah habis. Jika kelak akun naik ke Pro, kartu ini otomatis terisi tanpa perubahan kode.
              </p>
            </div>
          )}

          {data.meter && data.meter.length > 0 && (
            <div className="rounded-xl ring-1 ring-white/10 overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 bg-white/[0.04]">
                <p className="text-sm font-semibold text-slate-100">Pemakaian {data.periode?.hari ?? 30} hari terakhir</p>
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{data.paket === 'pro' ? 'Pro' : 'Hobby'}</span>
              </div>
              <ul>
                {data.meter.map((m, i) => (
                  <li key={m.kunci} className={`px-3.5 py-2.5 ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}>
                    <div className="flex items-center gap-3">
                      <Cincin persen={m.persen} tingkat={m.tingkat} ada={m.ada} />
                      <span className="flex-1 min-w-0 text-sm text-slate-100 truncate">{m.label}</span>
                      <span className="text-sm tabular-nums text-slate-300 whitespace-nowrap">
                        {m.ada
                          ? <><span className={m.tingkat === 'AMAN' ? 'text-slate-100' : GAYA[m.tingkat].teks}>{fmtMeterVercel(m.kunci as KunciMeter, m.pakai)}</span> / {fmtMeterVercel(m.kunci as KunciMeter, m.kuota)}</>
                          : <span className="text-slate-500">—</span>}
                      </span>
                    </div>
                    {m.ada && (m.tingkat !== 'AMAN' || (m.hariTersisa !== null && m.hariTersisa < 60)) && (
                      <p className="mt-1 ml-[34px] text-xs text-slate-400">{m.kalimat}</p>
                    )}
                    {!m.ada && data.jumlahBaris !== 0 && (
                      <p className="mt-1 ml-[34px] text-xs text-slate-500">Belum ada data dari Vercel untuk bagian ini (cek &quot;Rincian mentah&quot; di bawah).</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ul className="space-y-2 text-sm">
            {data.deploy && (
              <li className="flex gap-2.5">
                <Rocket className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" />
                <span className="text-slate-300">
                  <span className="font-semibold text-slate-100">Versi terbaru: </span>
                  {data.deploy.ok
                    ? <>{data.deploy.kalimat}{data.deploy.dibuatMs ? <span className="text-slate-500"> (dibuat {waktu(data.deploy.dibuatMs)})</span> : null}</>
                    : <span className="text-slate-500">{data.deploy.error}</span>}
                </span>
              </li>
            )}
            {data.runtime.kalimat && (
              <li className="flex gap-2.5">
                <Globe className={`w-4 h-4 mt-0.5 shrink-0 ${data.runtime.regionBenar === false ? 'text-amber-300' : 'text-slate-400'}`} />
                <span className={data.runtime.regionBenar === false ? 'text-amber-200/90' : 'text-slate-300'}>
                  <span className="font-semibold text-slate-100">Lokasi server: </span>{data.runtime.kalimat}
                </span>
              </li>
            )}
            {data.periode && (
              <li className="flex gap-2.5">
                <Info className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" />
                <span className="text-slate-400">
                  Pemakaian dihitung sejak {data.periode.mulai} ({data.periode.hari} hari), paket {data.paket === 'pro' ? 'Pro' : 'Hobby'}.
                  {typeof data.biayaUsd === 'number' && data.biayaUsd > 0 && <> Tagihan periode ini: <b className="text-slate-200">${data.biayaUsd.toLocaleString('en-US')}</b>.</>}
                </span>
              </li>
            )}
          </ul>

          {data.rincian && data.rincian.length > 0 && (
            <details className="rounded-xl bg-white/[0.03] ring-1 ring-white/5 p-3.5">
              <summary className="cursor-pointer text-xs text-slate-300 select-none">Rincian mentah dari Vercel (untuk memeriksa angka)</summary>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500"><th className="py-1.5">Layanan</th><th>Jumlah</th><th>Satuan</th><th>Biaya</th></tr></thead>
                  <tbody className="text-slate-200 tabular-nums">
                    {data.rincian.map(r => (
                      <tr key={`${r.nama}|${r.satuan}`} className="border-t border-white/5">
                        <td className="py-1.5">{r.nama}</td><td>{fmtAngka(r.jumlah)}</td><td>{r.satuan || '-'}</td><td>${r.biayaUsd.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <p className="text-xs text-slate-500 flex items-start gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              Hanya angka agregat. Data pemakaian dihitung Vercel per hari dan bisa tertunda beberapa jam, jadi pakai untuk melihat tren dan sisa jatah.
              Batas paket diatur lewat env VERCEL_KUOTA_* (bawaan: batas paket Hobby).
            </span>
          </p>
        </div>
      )}
    </div>
  )
}
