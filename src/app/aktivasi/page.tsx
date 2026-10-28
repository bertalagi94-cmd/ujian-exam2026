'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { School, Hash, Mail, Lock, Phone, Eye, EyeOff, CheckCircle2, ArrowLeft, ShieldCheck, Send, Clock, Rocket, FileText } from 'lucide-react'

// Pengajuan aktivasi sekolah baru. Hanya masuk antrean; sekolah bisa dipakai
// setelah developer menyetujui (lihat /developer).

const CSS = `
@keyframes av-melayang { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(18px,-26px) scale(1.06); } }
@keyframes av-muncul { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
@keyframes av-pop { 0% { transform: scale(0.4); opacity: 0; } 70% { transform: scale(1.12); } 100% { transform: scale(1); opacity: 1; } }
@keyframes av-kilau { 0% { transform: translateX(-120%) skewX(-20deg); } 60%,100% { transform: translateX(260%) skewX(-20deg); } }
.av-blob { animation: av-melayang 11s ease-in-out infinite; }
.av-kartu { animation: av-muncul .6s ease-out both; }
.av-pop { animation: av-pop .6s cubic-bezier(.2,.9,.3,1.2) both; }
.av-tombol::after { content: ''; position: absolute; top: 0; bottom: 0; width: 35%; background: linear-gradient(90deg, transparent, rgba(255,255,255,.45), transparent); animation: av-kilau 3.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .av-blob, .av-kartu, .av-pop, .av-tombol::after { animation: none !important; } }
`

const inputCls =
  'w-full pl-10 pr-3 py-2.5 rounded-xl text-sm text-slate-900 bg-white/80 border border-sky-100 placeholder:text-slate-400 ' +
  'focus:outline-none focus:ring-2 focus:ring-sky-400/70 focus:border-sky-300 transition shadow-sm'

function Bingkai({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-screen overflow-hidden flex items-center justify-center p-4 py-8"
      style={{ background: 'linear-gradient(160deg, #3d9be0 0%, #6cbcf0 30%, #bfe3fb 62%, #dff4f2 100%)' }}>
      <style>{CSS}</style>
      <div className="av-blob absolute -top-24 -left-24 w-80 h-80 rounded-full bg-cyan-300/40 blur-3xl" aria-hidden="true" />
      <div className="av-blob absolute top-1/3 -right-28 w-96 h-96 rounded-full bg-indigo-300/30 blur-3xl" style={{ animationDelay: '-4s' }} aria-hidden="true" />
      <div className="av-blob absolute -bottom-28 left-1/4 w-96 h-96 rounded-full bg-teal-200/50 blur-3xl" style={{ animationDelay: '-7s' }} aria-hidden="true" />
      <div className="av-kartu relative w-full max-w-lg rounded-3xl overflow-hidden bg-white/75 backdrop-blur-xl border border-white/80 shadow-[0_30px_80px_rgba(15,60,110,0.28)]">
        {children}
      </div>
    </main>
  )
}

function KepalaKartu({ judul, sub }: { judul: string; sub: string }) {
  return (
    <div className="relative px-6 pt-7 pb-6 text-white overflow-hidden"
      style={{ background: 'linear-gradient(120deg, #0284c7 0%, #0ea5e9 45%, #14b8a6 100%)' }}>
      <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-white/15" aria-hidden="true" />
      <div className="absolute right-16 -bottom-12 w-28 h-28 rounded-full bg-white/10" aria-hidden="true" />
      <div className="relative flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-white/20 border border-white/40 backdrop-blur flex items-center justify-center shadow-lg">
          <School className="w-7 h-7" />
        </div>
        <div>
          <h1 className="text-xl font-extrabold leading-tight">{judul}</h1>
          <p className="text-sm text-white/85 mt-0.5">{sub}</p>
        </div>
      </div>
    </div>
  )
}

function Medan({ label, ikon, hint, ekstra, children }: {
  label: React.ReactNode; ikon: React.ReactNode; hint?: React.ReactNode; ekstra?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-sm font-semibold text-slate-700">{label}</label>
        {ekstra}
      </div>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sky-500 pointer-events-none">{ikon}</span>
        {children}
      </div>
      {hint && <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{hint}</p>}
    </div>
  )
}

function kekuatan(pw: string): { skor: number; label: string; warna: string } {
  let n = 0
  if (pw.length >= 8) n++
  if (pw.length >= 12) n++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) n++
  if (/\d/.test(pw)) n++
  if (/[^A-Za-z0-9]/.test(pw)) n++
  if (!pw) return { skor: 0, label: '', warna: '' }
  if (n <= 2) return { skor: 1, label: 'Lemah', warna: 'bg-rose-400' }
  if (n <= 3) return { skor: 2, label: 'Cukup', warna: 'bg-amber-400' }
  return { skor: 3, label: 'Kuat', warna: 'bg-emerald-500' }
}

export default function AktivasiPage() {
  const [dibuka, setDibuka] = useState<boolean | null>(null)
  const [f, setF] = useState({ nama_sekolah: '', npsn: '', username: '', password: '', ulangi: '', no_hp: '', website: '' })
  const [lihatPw, setLihatPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [terkirim, setTerkirim] = useState(false)

  useEffect(() => {
    fetch('/api/public/pengajuan').then(r => r.json()).then(j => setDibuka(!!j?.data?.dibuka)).catch(() => setDibuka(false))
  }, [])

  async function kirim(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (f.password !== f.ulangi) { setError('Konfirmasi password tidak sama'); return }
    setLoading(true)
    try {
      const { ulangi, ...isi } = f
      const res = await fetch('/api/public/pengajuan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isi),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Pengajuan gagal')
      setTerkirim(true)
    } catch (err) {
      setError(err instanceof TypeError ? 'Tidak ada koneksi internet.' : (err as Error).message)
    } finally { setLoading(false) }
  }

  if (dibuka === null) return null

  if (!dibuka) {
    return (
      <Bingkai>
        <KepalaKartu judul="Aktivasi Sekolah Baru" sub="Daftarkan sekolah Anda ke aplikasi ujian" />
        <div className="p-6 space-y-4">
          <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
            <Clock className="w-5 h-5 mt-0.5 shrink-0" />
            <p>Pendaftaran sekolah baru belum dibuka. Silakan coba lagi nanti.</p>
          </div>
          <Link href="/login" className="inline-flex items-center gap-1.5 text-sm text-sky-700 font-semibold hover:underline">
            <ArrowLeft className="w-4 h-4" /> Kembali ke login
          </Link>
        </div>
      </Bingkai>
    )
  }

  if (terkirim) {
    return (
      <Bingkai>
        <KepalaKartu judul="Pengajuan Terkirim" sub="Terima kasih, data Anda sudah kami terima" />
        <div className="p-6 space-y-5">
          <div className="flex justify-center">
            <div className="av-pop w-20 h-20 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-500/30">
              <CheckCircle2 className="w-11 h-11 text-white" />
            </div>
          </div>
          <p className="text-sm text-slate-600 text-center leading-relaxed">
            Pengajuan aktivasi <b className="text-slate-800">{f.nama_sekolah}</b> sedang menunggu persetujuan.
            Setelah disetujui, login memakai email <b className="text-slate-800">{f.username}</b> dan password
            yang baru Anda isi. Akun itu otomatis menjadi admin sekolah.
          </p>
          <div className="p-3 rounded-xl bg-sky-50 border border-sky-100 text-xs text-sky-800 text-center">
            Sebelum disetujui, mencoba login akan menampilkan status pengajuan Anda.
          </div>
          <Link href="/login" className="flex items-center justify-center gap-1.5 text-sm text-sky-700 font-semibold hover:underline">
            <ArrowLeft className="w-4 h-4" /> Kembali ke login
          </Link>
        </div>
      </Bingkai>
    )
  }

  const kuat = kekuatan(f.password)
  const cocok = f.ulangi.length > 0 && f.password === f.ulangi

  return (
    <Bingkai>
      <KepalaKartu judul="Aktivasi Sekolah Baru" sub="Daftarkan sekolah Anda ke aplikasi ujian" />

      {/* Tiga langkah proses */}
      <div className="grid grid-cols-3 gap-2 px-5 pt-5">
        {[
          { i: <FileText className="w-4 h-4" />, t: 'Isi data', c: 'from-sky-500 to-cyan-400' },
          { i: <ShieldCheck className="w-4 h-4" />, t: 'Diperiksa', c: 'from-indigo-500 to-sky-500' },
          { i: <Rocket className="w-4 h-4" />, t: 'Mulai pakai', c: 'from-teal-500 to-emerald-400' },
        ].map((s, n) => (
          <div key={n} className="flex items-center gap-2 rounded-xl bg-white/70 border border-white px-2.5 py-2 shadow-sm">
            <span className={`w-7 h-7 shrink-0 rounded-lg bg-gradient-to-br ${s.c} text-white flex items-center justify-center`}>{s.i}</span>
            <span className="text-[11px] font-semibold text-slate-600 leading-tight">{n + 1}. {s.t}</span>
          </div>
        ))}
      </div>

      <form onSubmit={kirim} className="p-5 pt-4 space-y-4">
        {error && (
          <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm">{error}</div>
        )}

        <Medan label="Nama sekolah" ikon={<School className="w-4 h-4" />}>
          <input className={inputCls} required minLength={3} maxLength={120} placeholder="Contoh: SMA Negeri 1 Manado"
            value={f.nama_sekolah} onChange={e => setF({ ...f, nama_sekolah: e.target.value })} />
        </Medan>

        <Medan label="NPSN" ikon={<Hash className="w-4 h-4" />}
          ekstra={<span className={`text-xs font-semibold ${f.npsn.length === 8 ? 'text-emerald-600' : 'text-slate-400'}`}>{f.npsn.length}/8</span>}>
          <input className={inputCls} required inputMode="numeric" pattern="\d{8}" maxLength={8} placeholder="8 digit angka"
            value={f.npsn} onChange={e => setF({ ...f, npsn: e.target.value.replace(/\D/g, '') })} />
        </Medan>

        <Medan label="Email admin" ikon={<Mail className="w-4 h-4" />}
          hint="Boleh email apa saja, misalnya Gmail. Email ini hanya dipakai sebagai nama untuk login, tidak perlu aktif dan tidak ada pesan yang dikirim ke alamat ini.">
          <input type="email" className={inputCls} required maxLength={100} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            inputMode="email" placeholder="namaanda@gmail.com" value={f.username}
            onChange={e => setF({ ...f, username: e.target.value.trim().toLowerCase() })} />
        </Medan>

        <Medan label="Password" ikon={<Lock className="w-4 h-4" />}
          ekstra={kuat.label ? <span className="text-xs font-semibold text-slate-500">{kuat.label}</span> : undefined}>
          <input type={lihatPw ? 'text' : 'password'} className={`${inputCls} pr-10`} required minLength={8} maxLength={72}
            autoComplete="new-password" placeholder="Minimal 8 karakter" value={f.password}
            onChange={e => setF({ ...f, password: e.target.value })} />
          <button type="button" onClick={() => setLihatPw(v => !v)} aria-label={lihatPw ? 'Sembunyikan password' : 'Tampilkan password'}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-sky-600">
            {lihatPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </Medan>
        {f.password && (
          <div className="flex gap-1.5 -mt-2" aria-hidden="true">
            {[1, 2, 3].map(n => <div key={n} className={`h-1.5 flex-1 rounded-full transition-colors ${kuat.skor >= n ? kuat.warna : 'bg-slate-200'}`} />)}
          </div>
        )}

        <Medan label="Ulangi password" ikon={<Lock className="w-4 h-4" />}
          ekstra={f.ulangi ? <span className={`text-xs font-semibold ${cocok ? 'text-emerald-600' : 'text-rose-500'}`}>{cocok ? 'Cocok ✓' : 'Belum sama'}</span> : undefined}>
          <input type={lihatPw ? 'text' : 'password'} className={inputCls} required autoComplete="new-password" placeholder="Ketik ulang password"
            value={f.ulangi} onChange={e => setF({ ...f, ulangi: e.target.value })} />
        </Medan>

        <Medan label={<>No. WhatsApp <span className="text-slate-400 font-normal">(opsional)</span></>} ikon={<Phone className="w-4 h-4" />}
          hint="Dipakai untuk mengabari hasil pengajuan.">
          <input className={inputCls} inputMode="tel" maxLength={20} placeholder="08xxxxxxxxxx"
            value={f.no_hp} onChange={e => setF({ ...f, no_hp: e.target.value })} />
        </Medan>

        {/* Honeypot: disembunyikan dari manusia, bot biasanya mengisinya. */}
        <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
          <label>Website</label>
          <input tabIndex={-1} autoComplete="off" value={f.website} onChange={e => setF({ ...f, website: e.target.value })} />
        </div>

        <button disabled={loading}
          className="av-tombol relative overflow-hidden w-full py-3 rounded-xl text-white font-bold flex items-center justify-center gap-2 shadow-lg shadow-sky-500/30 hover:shadow-sky-500/50 hover:-translate-y-0.5 active:translate-y-0 transition disabled:opacity-60 disabled:hover:translate-y-0"
          style={{ background: 'linear-gradient(120deg, #0284c7, #0ea5e9 50%, #14b8a6)' }}>
          {loading
            ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Mengirim...</>
            : <><Send className="w-4 h-4" />Ajukan Aktivasi</>}
        </button>

        <Link href="/login" className="flex items-center justify-center gap-1.5 text-sm text-slate-500 hover:text-sky-700 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Kembali ke login
        </Link>
      </form>
    </Bingkai>
  )
}
