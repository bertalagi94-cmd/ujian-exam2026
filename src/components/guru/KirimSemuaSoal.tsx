'use client'

// ── Tombol "Kirim Semua Soal" (akun guru → menu Buat Soal) ───────────────────
// Guru yang mengampu banyak mapel dan banyak kelas tidak perlu membuka paket
// satu per satu. Satu tombol memverifikasi lalu mengirim SEMUA paket yang
// masih DRAFT / DITOLAK (PG dan Essay) ke admin untuk divalidasi.
//
// Aturan pengiriman TIDAK diduplikasi di sini: tiap paket dikirim lewat endpoint
// yang sama dengan tombol "Kirim" biasa (/api/guru/paket/:id/kirim dan
// /api/guru/paket-essay/:id/kirim), jadi semua pemeriksaan server tetap berlaku:
//   • jumlah soal harus sesuai ketentuan admin (mis. tepat 40 soal),
//   • minimal 1 soal,
//   • sesi ujian mapel+kelas itu belum pernah dimulai.
// Paket yang tidak lolos DILEWATI (tidak mengubah apa pun di paket itu) dan
// alasannya ditampilkan apa adanya dari server, mis.
//   "Paket PG Matematika harus tepat 40 soal, saat ini baru 30".
// Paket lain tetap lanjut dikirim.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Send, ShieldCheck, FileCheck, CheckCircle2, AlertTriangle, XCircle, X } from 'lucide-react'
import { apiRequest } from '@/lib/utils'

export interface PaketKirim {
  id: string
  jenis: 'PG' | 'ESSAY'
  mapel: string
  kelas: string
  jumlah: number
}

type StatusBaris = 'antre' | 'verifikasi' | 'terkirim' | 'dilewati' | 'gagal'
interface Baris extends PaketKirim { status: StatusBaris; alasan?: string }
type Fase = 'konfirmasi' | 'proses' | 'selesai'

const SYNC_EVENT = 'guru-paket-updated'
const tidur = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export function KirimSemuaSoal({ kandidat, onSelesai }: { kandidat: PaketKirim[]; onSelesai: () => void }) {
  const [buka, setBuka] = useState(false)
  const [fase, setFase] = useState<Fase>('konfirmasi')
  const [baris, setBaris] = useState<Baris[]>([])
  const [aktif, setAktif] = useState(0)
  const barisRef = useRef<(HTMLLIElement | null)[]>([])

  const jumlahPg = useMemo(() => kandidat.filter(k => k.jenis === 'PG').length, [kandidat])
  const jumlahEssay = kandidat.length - jumlahPg

  // Kunci scroll halaman selama modal terbuka.
  useEffect(() => {
    if (!buka) return
    const lama = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = lama }
  }, [buka])

  // Gulirkan daftar supaya paket yang sedang diverifikasi selalu terlihat.
  useEffect(() => {
    if (fase !== 'proses') return
    barisRef.current[aktif]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [aktif, fase])

  function bukaModal() {
    setBaris(kandidat.map(k => ({ ...k, status: 'antre' as StatusBaris })))
    setAktif(0)
    setFase('konfirmasi')
    setBuka(true)
  }

  function tutup() {
    if (fase === 'proses') return
    const adaPerubahan = fase === 'selesai'
    setBuka(false)
    if (adaPerubahan) {
      window.dispatchEvent(new Event(SYNC_EVENT))
      onSelesai()
    }
  }

  async function mulai() {
    const daftar = baris
    setFase('proses')
    // Makin banyak paket, makin singkat jeda animasi per paket supaya tidak
    // terlalu lama menunggu, tapi tetap terlihat sedang "memverifikasi".
    const jeda = daftar.length <= 8 ? 800 : daftar.length <= 20 ? 450 : 260

    const ubah = (i: number, p: Partial<Baris>) =>
      setBaris(prev => prev.map((b, idx) => (idx === i ? { ...b, ...p } : b)))

    for (let i = 0; i < daftar.length; i++) {
      setAktif(i)
      ubah(i, { status: 'verifikasi' })
      const it = daftar[i]
      const url = it.jenis === 'PG' ? `/api/guru/paket/${it.id}/kirim` : `/api/guru/paket-essay/${it.id}/kirim`

      const [hasil] = await Promise.all([
        apiRequest(url, { method: 'POST', body: JSON.stringify({ gabungPasangan: false }) })
          .then(() => ({ ok: true as const }))
          .catch((e: unknown) => ({ ok: false as const, e })),
        tidur(jeda),
      ])

      if (hasil.ok) {
        ubah(i, { status: 'terkirim' })
      } else {
        const err = hasil.e as (Error & { status?: number }) | undefined
        const pesan = err?.message || 'Gagal mengirim'
        // 400/409 = tidak memenuhi syarat (jumlah soal, sesi sudah mulai, dst.):
        // dilewati. Selain itu (jaringan, server) = gagal teknis.
        const dilewati = err?.status === 400 || err?.status === 409
        ubah(i, { status: dilewati ? 'dilewati' : 'gagal', alasan: pesan })
      }
    }
    setFase('selesai')
  }

  const hitung = useMemo(() => ({
    terkirim: baris.filter(b => b.status === 'terkirim').length,
    dilewati: baris.filter(b => b.status === 'dilewati').length,
    gagal: baris.filter(b => b.status === 'gagal').length,
    selesai: baris.filter(b => ['terkirim', 'dilewati', 'gagal'].includes(b.status)).length,
  }), [baris])
  const persen = baris.length ? Math.round((hitung.selesai / baris.length) * 100) : 0

  if (kandidat.length === 0 && !buka) return null

  return (
    <>
      {/* ── Banner ajakan di halaman Buat Soal ── */}
      {kandidat.length > 0 && (
        <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-900 to-slate-900 p-4 sm:p-6 text-white shadow-card-lg">
          <span aria-hidden className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-sky-400/20 blur-2xl" />
          <span aria-hidden className="pointer-events-none absolute -bottom-12 -left-6 h-32 w-32 rounded-full bg-violet-500/20 blur-2xl" />
          <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <span className="flex h-11 w-11 sm:h-12 sm:w-12 flex-shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
                <Send className="h-5 w-5 sm:h-6 sm:w-6" />
              </span>
              <div className="min-w-0">
                <p className="text-base sm:text-lg font-bold leading-tight">Kirim Semua Soal</p>
                <p className="mt-0.5 text-xs sm:text-sm text-indigo-100/90 leading-snug">
                  {kandidat.length} paket belum dikirim
                  {jumlahPg > 0 && jumlahEssay > 0 ? ` (${jumlahPg} PG · ${jumlahEssay} Essay)` : jumlahEssay > 0 ? ' (Essay)' : ' (PG)'}
                  . Paket yang jumlah soalnya belum sesuai ketentuan akan dilewati.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={bukaModal}
              className="inline-flex w-full sm:w-auto flex-shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-indigo-700 shadow-md transition active:scale-[0.97] hover:bg-indigo-50"
            >
              <ShieldCheck className="h-4 w-4" />
              Verifikasi & Kirim
            </button>
          </div>
        </div>
      )}

      {/* ── Modal verifikasi & pengiriman ── */}
      {buka && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-sm sm:p-4"
          onClick={tutup}
          role="dialog"
          aria-modal="true"
          aria-label="Kirim semua soal"
        >
          <style>{`
            @keyframes ksa-scan { 0% { top: 6%; opacity: 0; } 15% { opacity: 1; } 85% { opacity: 1; } 100% { top: 88%; opacity: 0; } }
            @keyframes ksa-ring { 0% { transform: scale(.55); opacity: .55; } 100% { transform: scale(1.7); opacity: 0; } }
            @keyframes ksa-pop { 0% { transform: scale(0); } 60% { transform: scale(1.25); } 100% { transform: scale(1); } }
            @keyframes ksa-shimmer { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
            @keyframes ksa-denyut { 0%,100% { box-shadow: 0 0 0 0 rgba(14,165,233,.35); } 50% { box-shadow: 0 0 0 6px rgba(14,165,233,0); } }
            @keyframes ksa-masuk { 0% { transform: translateY(24px); opacity: 0; } 100% { transform: none; opacity: 1; } }
            .ksa-panel { animation: ksa-masuk .28s ease-out; }
            .ksa-scan { animation: ksa-scan 1.6s ease-in-out infinite; }
            .ksa-ring { animation: ksa-ring 2s ease-out infinite; }
            .ksa-ring2 { animation: ksa-ring 2s ease-out .9s infinite; }
            .ksa-pop { animation: ksa-pop .45s cubic-bezier(.34,1.56,.64,1) both; }
            .ksa-bar { background-image: linear-gradient(90deg,#0ea5e9,#6366f1,#10b981,#0ea5e9); background-size: 200% 100%; animation: ksa-shimmer 2.2s linear infinite; }
            .ksa-aktif { animation: ksa-denyut 1.3s ease-in-out infinite; }
            @media (prefers-reduced-motion: reduce) {
              .ksa-panel,.ksa-scan,.ksa-ring,.ksa-ring2,.ksa-bar,.ksa-aktif { animation: none; }
            }
          `}</style>

          <div
            onClick={e => e.stopPropagation()}
            className="ksa-panel flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-h-[88vh] sm:max-w-lg sm:rounded-3xl"
          >
            {/* Kepala: pemindai bergaya "scanner" */}
            <div className="relative flex-shrink-0 overflow-hidden bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 px-5 pb-4 pt-5 text-center text-white">
              {fase !== 'proses' && (
                <button
                  type="button"
                  onClick={tutup}
                  aria-label="Tutup"
                  className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20"
                >
                  <X className="h-4 w-4" />
                </button>
              )}

              <div className="relative mx-auto mb-2.5 flex h-[72px] w-[72px] items-center justify-center">
                {fase === 'proses' && (
                  <>
                    <span className="ksa-ring absolute inset-0 rounded-2xl border border-sky-400/60" />
                    <span className="ksa-ring2 absolute inset-0 rounded-2xl border border-indigo-400/60" />
                  </>
                )}
                <div className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-white/10 ring-1 ring-white/25">
                  {fase === 'selesai' ? (
                    <CheckCircle2 className="ksa-pop h-8 w-8 text-emerald-300" />
                  ) : (
                    <FileCheck className="h-7 w-7 text-sky-200" />
                  )}
                  {fase === 'proses' && (
                    <span className="ksa-scan absolute inset-x-1 h-0.5 rounded-full bg-sky-300 shadow-[0_0_10px_2px_rgba(125,211,252,.9)]" />
                  )}
                </div>
              </div>

              <h2 className="text-lg font-bold leading-tight">
                {fase === 'konfirmasi' && 'Kirim Semua Soal'}
                {fase === 'proses' && 'Memverifikasi soal…'}
                {fase === 'selesai' && (hitung.terkirim === baris.length ? 'Semua soal terkirim' : hitung.terkirim === 0 ? 'Tidak ada soal yang terkirim' : 'Pengiriman selesai')}
              </h2>
              <p className="mx-auto mt-1 max-w-xs text-xs leading-snug text-indigo-100/80">
                {fase === 'konfirmasi' && `${baris.length} paket akan diperiksa lalu dikirim ke admin untuk divalidasi.`}
                {fase === 'proses' && `Paket ${Math.min(aktif + 1, baris.length)} dari ${baris.length} · ${baris[aktif]?.mapel ?? ''} ${baris[aktif]?.kelas ?? ''}`}
                {fase === 'selesai' && (hitung.dilewati + hitung.gagal > 0
                  ? 'Paket yang dilewati bisa dilengkapi lalu dikirim lagi kapan saja.'
                  : 'Admin akan segera memvalidasi paket soal Anda.')}
              </p>

              {fase !== 'konfirmasi' && (
                <div className="mt-3">
                  <div className="h-2 overflow-hidden rounded-full bg-white/15">
                    <div
                      className={`h-full rounded-full transition-[width] duration-300 ease-out ${fase === 'proses' ? 'ksa-bar' : 'bg-emerald-400'}`}
                      style={{ width: `${persen}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-center gap-2 text-[11px] font-semibold">
                    <span className="rounded-full bg-emerald-400/20 px-2.5 py-1 text-emerald-200">Terkirim {hitung.terkirim}</span>
                    <span className="rounded-full bg-amber-400/20 px-2.5 py-1 text-amber-200">Dilewati {hitung.dilewati}</span>
                    {hitung.gagal > 0 && <span className="rounded-full bg-red-400/20 px-2.5 py-1 text-red-200">Gagal {hitung.gagal}</span>}
                    <span className="tabular-nums text-white/70">{persen}%</span>
                  </div>
                </div>
              )}
            </div>

            {/* Daftar paket */}
            <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto overscroll-contain px-3 py-1 sm:px-4">
              {baris.map((b, i) => (
                <li
                  key={`${b.jenis}-${b.id}`}
                  ref={el => { barisRef.current[i] = el }}
                  className={`flex items-start gap-2.5 rounded-xl px-1.5 py-2.5 transition-colors ${b.status === 'verifikasi' ? 'ksa-aktif bg-sky-50' : ''}`}
                >
                  <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center">
                    {b.status === 'antre' && <span className="h-2 w-2 rounded-full bg-slate-300" />}
                    {b.status === 'verifikasi' && <span className="h-4 w-4 animate-spin rounded-full border-2 border-sky-200 border-t-sky-500" />}
                    {b.status === 'terkirim' && <CheckCircle2 className="ksa-pop h-5 w-5 text-emerald-500" />}
                    {b.status === 'dilewati' && <AlertTriangle className="ksa-pop h-5 w-5 text-amber-500" />}
                    {b.status === 'gagal' && <XCircle className="ksa-pop h-5 w-5 text-red-500" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${b.jenis === 'PG' ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {b.jenis === 'PG' ? 'PG' : 'Essay'}
                      </span>
                      <span className="min-w-0 truncate text-sm font-semibold text-slate-800">{b.mapel}</span>
                      <span className="flex-shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{b.kelas}</span>
                    </div>
                    {b.status === 'antre' && <p className="mt-0.5 text-[11px] text-slate-400">{b.jumlah} soal · menunggu giliran</p>}
                    {b.status === 'verifikasi' && <p className="mt-0.5 text-[11px] font-medium text-sky-600">Memeriksa jumlah soal & ketentuan…</p>}
                    {b.status === 'terkirim' && <p className="mt-0.5 text-[11px] font-medium text-emerald-600">Lolos verifikasi · terkirim ke admin</p>}
                    {(b.status === 'dilewati' || b.status === 'gagal') && (
                      <p className={`mt-0.5 break-words text-[11px] leading-snug ${b.status === 'dilewati' ? 'text-amber-700' : 'text-red-600'}`}>
                        <span className="font-semibold">{b.status === 'dilewati' ? 'Dilewati: ' : 'Gagal: '}</span>{b.alasan}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {/* Kaki: tombol aksi */}
            <div className="flex flex-shrink-0 gap-2 border-t border-slate-100 bg-white px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {fase === 'konfirmasi' && (
                <>
                  <button type="button" onClick={tutup} className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 active:scale-[0.98]">
                    Batal
                  </button>
                  <button type="button" onClick={mulai} className="flex flex-[1.6] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-sky-600 px-4 py-2.5 text-sm font-bold text-white shadow-md active:scale-[0.98]">
                    <ShieldCheck className="h-4 w-4" /> Mulai Verifikasi
                  </button>
                </>
              )}
              {fase === 'proses' && (
                <button type="button" disabled className="flex w-full cursor-wait items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-500">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-500" />
                  Mohon tunggu, jangan tutup halaman…
                </button>
              )}
              {fase === 'selesai' && (
                <button type="button" onClick={tutup} className="w-full rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2.5 text-sm font-bold text-white shadow-md active:scale-[0.98]">
                  Selesai
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
