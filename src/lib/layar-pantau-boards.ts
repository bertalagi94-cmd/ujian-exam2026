import { NextRequest } from 'next/server'
import { RealtimeChannel } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase'
import { verifyToken } from '@/lib/auth'
import { ambilBoardsUntukViewer } from '@/lib/layar-pantau-boards'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/layar-pantau/stream?token=...
//
// ── REALTIME, BUKAN POLLING ─────────────────────────────────────────────
// Endpoint ini membuka koneksi Server-Sent Events (SSE) yang tetap terbuka,
// lalu SERVER (bukan browser) subscribe ke Supabase Realtime memakai
// service-role key untuk memantau tabel `jawaban`, `siswa_ujian`, dan
// `sesi_ujian`. Begitu ada baris berubah, server langsung menghitung ulang
// papan (computeLiveLeaderboardUntukSesi — lewat ambilBoardsUntukViewer)
// dan mendorongnya ke klien. Tidak ada jeda "nunggu interval berikutnya"
// seperti pendekatan setInterval(fetch) sebelumnya.
//
// KENAPA SUBSCRIBE DI SERVER, BUKAN LANGSUNG DARI BROWSER KE SUPABASE:
// Kalau browser subscribe langsung, dia butuh Supabase anon key + kebijakan
// RLS yang membuka tabel-tabel di atas, artinya payload MENTAH (termasuk
// pilihan jawaban tiap siswa per soal) akan lolos ke jaringan browser tanpa
// lewat agregasi kita. Dengan server yang subscribe lalu menghitung ulang
// papan AGREGAT sebelum dikirim ke client, kunci jawaban dan jawaban mentah
// tetap tidak pernah keluar dari server — prinsip yang sama persis dengan
// yang sudah dipegang leaderboard-live.ts untuk endpoint polling lama.
//
// SYARAT SETUP (SEKALI SAJA, DI SUPABASE DASHBOARD):
// Tabel `jawaban`, `sesi_ujian`, dan `siswa_ujian` harus dimasukkan ke
// publication `supabase_realtime` (Database → Replication di dashboard,
// atau jalankan SQL:
//   alter publication supabase_realtime add table jawaban, sesi_ujian, siswa_ujian;
// ). Tanpa ini, event Realtime tidak akan pernah terkirim — papan tetap
// akan ter-update (lihat SAFETY_REFRESH_MS di bawah), tapi cuma lewat
// jaring pengaman berkala, bukan realtime instan.
//
// EventSource browser TIDAK BISA mengirim header custom, jadi token JWT
// dikirim lewat query string (?token=...), lalu diverifikasi persis seperti
// endpoint lain — cuma sumber tokennya beda dari header Authorization.

const ENCODER = new TextEncoder()
const ALLOWED_ROLES = ['GURU', 'KEPSEK', 'ADMIN']
const SAFETY_REFRESH_MS = 8000   // jaring pengaman: tetap update meski tak ada event Realtime yang masuk
const DEBOUNCE_MS = 250          // gabungkan burst perubahan (banyak siswa submit hampir bersamaan) jadi satu recompute
const MAX_STREAM_MS = 55_000     // tutup rapi sebelum batas durasi fungsi serverless; EventSource auto-reconnect

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? ''
  const user = token ? verifyToken(token) : null
  if (!user || !ALLOWED_ROLES.includes(user.role)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const db = createAdminClient()

  let closed = false
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let safetyTimer: ReturnType<typeof setInterval> | null = null
  let hardCloseTimer: ReturnType<typeof setTimeout> | null = null
  let channel: RealtimeChannel | null = null

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(ENCODER.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          // Controller sudah ditutup lewat jalur lain (race saat disconnect) — abaikan.
        }
      }

      const pushBoards = async () => {
        try {
          const { boards, scopeWarning } = await ambilBoardsUntukViewer(db, user!)
          send('boards', {
            serverTime: new Date().toISOString(),
            viewer: { nama: user!.nama, role: user!.role },
            boards,
            scopeWarning,
          })
        } catch (e) {
          send('error', { error: e instanceof Error ? e.message : 'Gagal memuat papan.' })
        }
      }

      const scheduleRecompute = () => {
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(pushBoards, DEBOUNCE_MS)
      }

      function cleanupAndClose() {
        if (closed) return
        closed = true
        if (debounceTimer) clearTimeout(debounceTimer)
        if (safetyTimer) clearInterval(safetyTimer)
        if (hardCloseTimer) clearTimeout(hardCloseTimer)
        if (channel) db.removeChannel(channel)
        try { controller.close() } catch {}
      }

      // Muatan pertama, langsung begitu klien tersambung — tidak menunggu
      // event Realtime atau interval apa pun.
      await pushBoards()

      // ── Langganan Realtime ────────────────────────────────────────────
      // Sengaja TIDAK difilter per sesi_id di level Postgres (Realtime
      // Postgres Changes cuma mendukung filter kesetaraan satu kolom).
      // Setiap perubahan pada ketiga tabel ini memicu recompute yang tetap
      // dibatasi scope viewer oleh ambilBoardsUntukViewer() — jadi tidak
      // ada data yang bocor ke viewer yang tidak berhak, hanya kemungkinan
      // recompute sedikit lebih sering dari perlu (murah, dan di-debounce).
      channel = db
        .channel(`layar-pantau-${user.username}-${Date.now()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'jawaban' }, scheduleRecompute)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'sesi_ujian' }, scheduleRecompute)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'siswa_ujian' }, scheduleRecompute)
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') send('status', { realtime: 'tersambung' })
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') send('status', { realtime: 'terputus' })
        })

      // Jaring pengaman: tetap recompute berkala walau TIDAK ada event
      // Realtime yang masuk (mis. publication belum diaktifkan, atau
      // koneksi Realtime sedang bermasalah) — papan tidak pernah "beku".
      safetyTimer = setInterval(pushBoards, SAFETY_REFRESH_MS)

      // Tutup stream secara rapi sebelum batas durasi fungsi serverless
      // tercapai. EventSource di browser otomatis menyambung ulang dalam
      // hitungan detik (lihat komentar `retry` di page.tsx), jadi ini
      // nyaris tidak terasa sebagai jeda oleh penonton.
      hardCloseTimer = setTimeout(() => {
        send('status', { realtime: 'menyambung ulang' })
        cleanupAndClose()
      }, MAX_STREAM_MS)

      req.signal.addEventListener('abort', cleanupAndClose)
    },
    cancel() {
      closed = true
      if (debounceTimer) clearTimeout(debounceTimer)
      if (safetyTimer) clearInterval(safetyTimer)
      if (hardCloseTimer) clearTimeout(hardCloseTimer)
      if (channel) db.removeChannel(channel)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // matikan buffering proxy (mis. Nginx) supaya event tidak tertahan
    },
  })
}
