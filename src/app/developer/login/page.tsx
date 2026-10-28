'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

// Login akun developer. Token disimpan di kunci 'dev_token' (BUKAN 'token'),
// sehingga tidak pernah tercampur dengan sesi admin/guru/siswa di perangkat yang sama.
// Tampilan: latar hitam + hujan kode + jaringan titik bergerak (canvas), form bergaya terminal.

const BOOT_LINES = [
  '> inisialisasi modul keamanan ........ [ OK ]',
  '> enkripsi kanal TLS ................. [ OK ]',
  '> memeriksa batas percobaan login .... [ OK ]',
  '> menunggu kredensial developer_',
]

// Pesan ejekan saat username/password salah. Dipilih acak (tidak berulang berturut-turut).
const PESAN_TAWA = [
  'Salah lagi! Yakin kamu developernya, bukan cuma lewat doang?',
  'Kredensial ditolak. Ini konsol developer, bukan tempat coba-coba keberuntungan.',
  'Coba cek Caps Lock-nya. Atau mungkin kucingmu tadi sempat menginjak keyboard? 🐈',
  'Hacker beneran nggak bakal salah ketik sampai segini. Pelan-pelan saja, ya.',
  'Password-nya nggak hilang kok, cuma kamu yang lupa. Tarik napas, coba lagi. 😂',
  'Sistem ini ketawa dulu, baru menolakmu dengan sopan.',
  'Username atau password meleset. Jangan asal tebak, nanti dikira maling. 🕵️',
  'Akses ditolak! Mau tebak sampai pagi pun, pintunya tetap terkunci. 🔒',
]
const DURASI_TAWA_MS = 7000

const GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEF<>/\\{}[]=+*#$%&'

export default function LoginDeveloperPage() {
  const router = useRouter()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [tampilPw, setTampilPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [berhasil, setBerhasil] = useState(false)
  const [baris, setBaris] = useState(0)
  const [getar, setGetar] = useState(false)
  const [tawa, setTawa] = useState<{ pesan: string; id: number } | null>(null)
  const tawaTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tawaTerakhir = useRef(-1)
  const tawaId = useRef(0)

  // Popup tawa: muncul saat login gagal, memudar pelan, hilang sendiri dalam 7 detik.
  function tampilkanTawa() {
    let i = Math.floor(Math.random() * PESAN_TAWA.length)
    if (i === tawaTerakhir.current) i = (i + 1) % PESAN_TAWA.length
    tawaTerakhir.current = i
    tawaId.current += 1
    if (tawaTimer.current) clearTimeout(tawaTimer.current)
    setTawa({ pesan: PESAN_TAWA[i], id: tawaId.current })
    tawaTimer.current = setTimeout(() => setTawa(null), DURASI_TAWA_MS)
  }
  function tutupTawa() {
    if (tawaTimer.current) clearTimeout(tawaTimer.current)
    setTawa(null)
  }
  useEffect(() => () => { if (tawaTimer.current) clearTimeout(tawaTimer.current) }, [])

  useEffect(() => {
    try { if (localStorage.getItem('dev_token')) router.replace('/developer') } catch { /* abaikan */ }
  }, [router])

  // Teks boot muncul baris demi baris.
  useEffect(() => {
    if (baris >= BOOT_LINES.length) return
    const t = setTimeout(() => setBaris(b => b + 1), 450)
    return () => clearTimeout(t)
  }, [baris])

  // ── Latar canvas: hujan kode + jaringan titik yang mengikuti kursor ──────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const kurangGerak = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let w = 0, h = 0, dpr = 1, raf = 0, frame = 0
    const mouse = { x: -9999, y: -9999 }
    const FONT = 15
    let tetes: number[] = []
    type Node = { x: number; y: number; vx: number; vy: number }
    let nodes: Node[] = []

    const ukur = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = window.innerWidth; h = window.innerHeight
      canvas.width = w * dpr; canvas.height = h * dpr
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h)
      tetes = Array.from({ length: Math.ceil(w / FONT) }, () => Math.random() * -50)
      const jumlah = Math.min(90, Math.floor((w * h) / 18000))
      nodes = Array.from({ length: jumlah }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.6, vy: (Math.random() - 0.5) * 0.6,
      }))
    }

    const gambar = () => {
      frame++
      // Jejak memudar (efek ekor pada hujan kode dan titik).
      ctx.fillStyle = 'rgba(0, 0, 0, 0.16)'
      ctx.fillRect(0, 0, w, h)

      // Hujan kode: bergerak setiap 2 frame.
      ctx.font = `${FONT}px monospace`
      if (frame % 2 === 0) {
        for (let i = 0; i < tetes.length; i++) {
          const ch = GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
          const x = i * FONT, y = tetes[i] * FONT
          ctx.fillStyle = 'rgba(190, 255, 210, 0.9)'
          ctx.fillText(ch, x, y)
          ctx.fillStyle = 'rgba(0, 255, 120, 0.28)'
          ctx.fillText(GLYPHS[Math.floor(Math.random() * GLYPHS.length)], x, y - FONT)
          if (y > h && Math.random() > 0.975) tetes[i] = 0
          tetes[i] += 1
        }
      }

      // Jaringan titik: bergerak bebas, saling terhubung bila dekat.
      for (const n of nodes) {
        n.x += n.vx; n.y += n.vy
        if (n.x < 0 || n.x > w) n.vx *= -1
        if (n.y < 0 || n.y > h) n.vy *= -1
        const dx = mouse.x - n.x, dy = mouse.y - n.y
        const d2 = dx * dx + dy * dy
        if (d2 < 200 * 200 && d2 > 1) { n.x += dx * 0.004; n.y += dy * 0.004 }
      }
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i]
        ctx.fillStyle = 'rgba(0, 255, 200, 0.95)'
        ctx.beginPath(); ctx.arc(a.x, a.y, 1.8, 0, Math.PI * 2); ctx.fill()
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j]
          const dx = a.x - b.x, dy = a.y - b.y
          const d = Math.sqrt(dx * dx + dy * dy)
          if (d < 140) {
            ctx.strokeStyle = `rgba(0, 255, 200, ${(1 - d / 140) * 0.55})`
            ctx.lineWidth = 0.7
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
          }
        }
        const mx = a.x - mouse.x, my = a.y - mouse.y
        const dm = Math.sqrt(mx * mx + my * my)
        if (dm < 180) {
          ctx.strokeStyle = `rgba(80, 200, 255, ${(1 - dm / 180) * 0.8})`
          ctx.lineWidth = 0.9
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke()
        }
      }
      raf = requestAnimationFrame(gambar)
    }

    const gerak = (e: PointerEvent) => { mouse.x = e.clientX; mouse.y = e.clientY }
    const keluar = () => { mouse.x = -9999; mouse.y = -9999 }

    ukur()
    window.addEventListener('resize', ukur)
    window.addEventListener('pointermove', gerak)
    window.addEventListener('pointerleave', keluar)
    if (kurangGerak) { for (let i = 0; i < 40; i++) gambar(); cancelAnimationFrame(raf) } else raf = requestAnimationFrame(gambar)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', ukur)
      window.removeEventListener('pointermove', gerak)
      window.removeEventListener('pointerleave', keluar)
    }
  }, [])

  async function masuk(e: React.FormEvent) {
    e.preventDefault()
    setError(''); tutupTawa(); setLoading(true)
    try {
      const res = await fetch('/api/developer/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        // 401 = username/password salah -> popup tawa. Error lain (mis. terlalu
        // banyak percobaan) tetap tampil sebagai pesan biasa supaya jelas.
        if (res.status === 401) tampilkanTawa()
        else setError(json.error || 'Gagal masuk')
        setGetar(true); setTimeout(() => setGetar(false), 500)
        return
      }
      localStorage.setItem('dev_token', json.token)
      localStorage.setItem('dev_user', JSON.stringify({ username: json.username, nama: json.nama }))
      setBerhasil(true)
      setTimeout(() => router.replace('/developer'), 700)
    } catch {
      setError('Tidak bisa terhubung ke server')
      setGetar(true); setTimeout(() => setGetar(false), 500)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="dv-root relative min-h-screen overflow-hidden bg-black flex items-center justify-center p-4">
      <style>{CSS}</style>
      <canvas ref={canvasRef} className="absolute inset-0" aria-hidden="true" />
      <div className="dv-vignette absolute inset-0 pointer-events-none" aria-hidden="true" />
      <div className="dv-scan absolute inset-0 pointer-events-none" aria-hidden="true" />

      <div className={`dv-card relative w-full max-w-md ${getar ? 'dv-getar' : ''} ${berhasil ? 'dv-ok' : ''}`}>
        <span className="dv-sudut dv-tl" /><span className="dv-sudut dv-tr" />
        <span className="dv-sudut dv-bl" /><span className="dv-sudut dv-br" />

        {/* Bilah judul ala jendela terminal */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-emerald-400/20">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-400/80" />
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
        </div>

        <div className="p-6 sm:p-7 space-y-5">
          <div className="text-center">
            <div className="dv-ikon mx-auto mb-3" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2 4 5v6c0 5 3.4 8.7 8 11 4.6-2.3 8-6 8-11V5l-8-3Z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            </div>
            <h1 className="dv-judul font-mono font-bold text-2xl tracking-[0.25em]" data-teks="DEV CONSOLE">DEV CONSOLE</h1>
            <p className="text-[11px] text-emerald-300/60 font-mono mt-1 tracking-wider">AKSES TERBATAS · KHUSUS PENGELOLA APLIKASI</p>
          </div>

          {/* Log boot */}
          <div className="font-mono text-[11px] leading-5 text-emerald-300/80 min-h-[88px]" aria-live="polite">
            {BOOT_LINES.slice(0, baris).map((l, i) => (
              <div key={i} className={i === BOOT_LINES.length - 1 ? 'dv-kursor' : ''}>{l}</div>
            ))}
          </div>

          {error && (
            <div role="alert" className="font-mono text-xs px-3 py-2 rounded border border-red-500/50 bg-red-500/10 text-red-300">
              <span className="font-bold">ACCESS DENIED</span> — {error}
            </div>
          )}
          {berhasil && (
            <div className="font-mono text-xs px-3 py-2 rounded border border-emerald-400/60 bg-emerald-400/10 text-emerald-300">
              <span className="font-bold">ACCESS GRANTED</span> — membuka konsol...
            </div>
          )}

          <form onSubmit={masuk} className="space-y-4">
            <label className="block">
              <span className="block font-mono text-[11px] text-emerald-300/70 mb-1 tracking-wider">USERNAME</span>
              <div className="dv-input">
                <span aria-hidden="true">$</span>
                <input autoComplete="username" required spellCheck={false} autoCapitalize="none"
                  value={username} onChange={e => setUsername(e.target.value)} disabled={loading || berhasil} />
              </div>
            </label>
            <label className="block">
              <span className="block font-mono text-[11px] text-emerald-300/70 mb-1 tracking-wider">PASSWORD</span>
              <div className="dv-input">
                <span aria-hidden="true">#</span>
                <input type={tampilPw ? 'text' : 'password'} autoComplete="current-password" required
                  value={password} onChange={e => setPassword(e.target.value)} disabled={loading || berhasil} />
                <button type="button" onClick={() => setTampilPw(v => !v)}
                  className="text-[10px] tracking-wider text-emerald-300/60 hover:text-emerald-200 font-mono"
                  aria-label={tampilPw ? 'Sembunyikan password' : 'Tampilkan password'}>
                  {tampilPw ? 'HIDE' : 'SHOW'}
                </button>
              </div>
            </label>

            <button disabled={loading || berhasil} className="dv-tombol w-full py-3 font-mono font-bold tracking-[0.3em] text-sm disabled:opacity-60">
              {loading ? 'AUTHENTICATING...' : berhasil ? 'GRANTED' : 'AUTHENTICATE'}
            </button>
          </form>

          <button type="button" onClick={() => router.push('/login')}
            className="w-full text-center font-mono text-[11px] text-emerald-300/50 hover:text-emerald-200 tracking-wider">
            ← kembali ke login sekolah
          </button>
        </div>

        {/* Kredit pembuat — di bagian paling bawah kartu */}
        <div className="px-4 py-3 border-t border-emerald-400/20 text-center font-mono text-[11px] tracking-wider text-emerald-300/70">
          Developed by : <span className="text-emerald-200 font-bold">Tasrif A. Abbas</span>
        </div>
      </div>

      {tawa && (
        <div className="dv-tawa-lapis" aria-hidden={false}>
          <div key={tawa.id} role="alert" aria-live="assertive" className="dv-tawa"
            style={{ ['--dur' as string]: `${DURASI_TAWA_MS}ms` }}>
            <button type="button" onClick={tutupTawa} className="dv-tawa-x" aria-label="Tutup">×</button>
            <div className="dv-tawa-emoji" aria-hidden="true">🤣</div>
            <div className="dv-tawa-ha" aria-hidden="true">
              {'HAHAHAHA'.split('').map((c, i) => (
                <span key={i} style={{ animationDelay: `${i * 0.08}s` }}>{c}</span>
              ))}
            </div>
            <div className="dv-tawa-judul font-mono">ACCESS DENIED</div>
            <p className="dv-tawa-pesan">{tawa.pesan}</p>
            <div className="dv-tawa-bar"><span /></div>
          </div>
        </div>
      )}
    </main>
  )
}

const CSS = `
.dv-root { color: #b6ffd9; }
.dv-vignette { background: radial-gradient(ellipse at center, rgba(0,0,0,0) 30%, rgba(0,0,0,0.85) 100%); }
.dv-scan { background: repeating-linear-gradient(0deg, rgba(0,255,150,0.035) 0, rgba(0,255,150,0.035) 1px, transparent 1px, transparent 3px); mix-blend-mode: screen; }
.dv-scan::after { content: ''; position: absolute; left: 0; right: 0; height: 120px; top: -120px;
  background: linear-gradient(180deg, transparent, rgba(0,255,170,0.07), transparent); animation: dv-sapu 7s linear infinite; }
@keyframes dv-sapu { to { transform: translateY(calc(100vh + 240px)); } }

.dv-card { background: rgba(2, 10, 8, 0.82); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  border: 1px solid rgba(52, 255, 160, 0.35); border-radius: 10px;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.6), 0 0 28px rgba(0,255,150,0.18), 0 0 90px rgba(0,255,200,0.08), inset 0 0 40px rgba(0,255,150,0.04);
  animation: dv-muncul 0.7s ease-out both; }
@keyframes dv-muncul { from { opacity: 0; transform: translateY(14px) scale(0.98); filter: blur(4px); } to { opacity: 1; transform: none; filter: none; } }
.dv-card.dv-ok { border-color: rgba(52,255,160,0.9); box-shadow: 0 0 40px rgba(0,255,150,0.5), 0 0 120px rgba(0,255,150,0.25); }
.dv-getar { animation: dv-getar 0.45s linear; }
@keyframes dv-getar { 0%,100% { transform: translateX(0); } 20% { transform: translateX(-9px); } 40% { transform: translateX(8px); } 60% { transform: translateX(-6px); } 80% { transform: translateX(5px); } }

.dv-sudut { position: absolute; width: 14px; height: 14px; border-color: #34ffa0; border-style: solid; opacity: 0.9; }
.dv-tl { top: -1px; left: -1px; border-width: 2px 0 0 2px; border-top-left-radius: 10px; }
.dv-tr { top: -1px; right: -1px; border-width: 2px 2px 0 0; border-top-right-radius: 10px; }
.dv-bl { bottom: -1px; left: -1px; border-width: 0 0 2px 2px; border-bottom-left-radius: 10px; }
.dv-br { bottom: -1px; right: -1px; border-width: 0 2px 2px 0; border-bottom-right-radius: 10px; }

.dv-ikon { width: 56px; height: 56px; display: grid; place-items: center; color: #34ffa0; border: 1px solid rgba(52,255,160,0.5);
  border-radius: 50%; box-shadow: 0 0 18px rgba(52,255,160,0.35), inset 0 0 14px rgba(52,255,160,0.15); animation: dv-denyut 2.4s ease-in-out infinite; }
@keyframes dv-denyut { 50% { box-shadow: 0 0 30px rgba(52,255,160,0.65), inset 0 0 20px rgba(52,255,160,0.3); } }

.dv-judul { position: relative; color: #d9ffe9; text-shadow: 0 0 12px rgba(52,255,160,0.7); animation: dv-glitch 5s steps(1) infinite; }
.dv-judul::before, .dv-judul::after { content: attr(data-teks); position: absolute; inset: 0; opacity: 0; }
.dv-judul::before { color: #00e5ff; transform: translate(-2px, 0); }
.dv-judul::after { color: #ff2e7a; transform: translate(2px, 0); }
@keyframes dv-glitch {
  0%, 92%, 100% { text-shadow: 0 0 12px rgba(52,255,160,0.7); }
  93% { text-shadow: -3px 0 #00e5ff, 3px 0 #ff2e7a; transform: translateX(1px); }
  95% { text-shadow: 3px 0 #00e5ff, -3px 0 #ff2e7a; transform: translateX(-1px); }
  97% { text-shadow: -2px 0 #00e5ff, 2px 0 #ff2e7a; transform: none; }
}

.dv-kursor::after { content: '█'; margin-left: 4px; animation: dv-kedip 1s steps(1) infinite; }
@keyframes dv-kedip { 50% { opacity: 0; } }

.dv-input { display: flex; align-items: center; gap: 8px; padding: 0 12px; background: rgba(0, 20, 14, 0.7);
  border: 1px solid rgba(52,255,160,0.25); border-radius: 6px; transition: border-color .2s, box-shadow .2s; }
.dv-input:focus-within { border-color: #34ffa0; box-shadow: 0 0 0 1px rgba(52,255,160,0.4), 0 0 16px rgba(52,255,160,0.25); }
.dv-input > span { color: #34ffa0; font-family: ui-monospace, monospace; }
.dv-input input { flex: 1; min-width: 0; background: transparent; outline: none; border: 0; padding: 11px 0; color: #d9ffe9;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; caret-color: #34ffa0; }
.dv-input input:-webkit-autofill { -webkit-text-fill-color: #d9ffe9; transition: background-color 9999s; }

.dv-tombol { position: relative; overflow: hidden; color: #031a10; background: linear-gradient(90deg, #34ffa0, #00e5ff);
  border-radius: 6px; box-shadow: 0 0 20px rgba(52,255,160,0.4); transition: transform .15s, box-shadow .2s; }
.dv-tombol:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 0 34px rgba(52,255,160,0.75); }
.dv-tombol::after { content: ''; position: absolute; top: 0; bottom: 0; width: 40%; left: -60%;
  background: linear-gradient(100deg, transparent, rgba(255,255,255,0.55), transparent); animation: dv-kilau 3.2s ease-in-out infinite; }
@keyframes dv-kilau { 60%, 100% { left: 130%; } }

/* Popup tertawa saat login salah: tampil, bergoyang, lalu memudar pelan sampai hilang (7 detik). */
.dv-tawa-lapis { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 16px; pointer-events: none; }
.dv-tawa { position: relative; pointer-events: auto; width: 100%; max-width: 380px; text-align: center; padding: 22px 22px 18px;
  background: rgba(14, 2, 6, 0.92); border: 1px solid rgba(255, 70, 110, 0.7); border-radius: 14px;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.7), 0 0 36px rgba(255,46,122,0.45), 0 0 110px rgba(255,46,122,0.22), inset 0 0 34px rgba(255,46,122,0.08);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  animation: dv-tawa-masuk 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both, dv-tawa-pudar var(--dur, 7s) ease-in forwards; }
@keyframes dv-tawa-masuk { from { opacity: 0; transform: translateY(24px) scale(0.8) rotate(-3deg); } to { opacity: 1; transform: none; } }
@keyframes dv-tawa-pudar { 0%, 45% { opacity: 1; filter: none; } 100% { opacity: 0; filter: blur(5px); transform: translateY(-14px) scale(0.96); } }
.dv-tawa-emoji { font-size: 54px; line-height: 1; display: inline-block; animation: dv-tawa-goyang 0.5s ease-in-out infinite alternate; transform-origin: 50% 80%; }
@keyframes dv-tawa-goyang { from { transform: rotate(-14deg) scale(1); } to { transform: rotate(14deg) scale(1.12); } }
.dv-tawa-ha { margin-top: 6px; display: flex; justify-content: center; gap: 1px; font-family: ui-monospace, monospace; font-weight: 800; font-size: 26px; letter-spacing: 0.08em; color: #ff5c8a; text-shadow: 0 0 14px rgba(255,46,122,0.8); }
.dv-tawa-ha span { display: inline-block; animation: dv-tawa-lompat 0.7s ease-in-out infinite; }
@keyframes dv-tawa-lompat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-7px); } }
.dv-tawa-judul { margin-top: 4px; font-size: 11px; font-weight: 700; letter-spacing: 0.35em; color: #ffb3c6; }
.dv-tawa-pesan { margin: 10px 0 0; font-size: 14px; line-height: 1.5; color: #ffe3ea; }
.dv-tawa-bar { margin-top: 14px; height: 3px; border-radius: 3px; background: rgba(255,255,255,0.1); overflow: hidden; }
.dv-tawa-bar > span { display: block; height: 100%; width: 100%; background: linear-gradient(90deg, #ff2e7a, #ffb36b); transform-origin: left; animation: dv-tawa-hitung var(--dur, 7s) linear forwards; }
@keyframes dv-tawa-hitung { to { transform: scaleX(0); } }
.dv-tawa-x { position: absolute; top: 6px; right: 10px; color: rgba(255,200,215,0.6); font-size: 22px; line-height: 1; }
.dv-tawa-x:hover { color: #fff; }

@media (prefers-reduced-motion: reduce) {
  .dv-tawa-emoji, .dv-tawa-ha span { animation: none !important; }
  .dv-tawa { animation: dv-tawa-pudar var(--dur, 7s) ease-in forwards !important; }
  .dv-card, .dv-ikon, .dv-judul, .dv-scan::after, .dv-kursor::after, .dv-tombol::after { animation: none !important; }
}
`
