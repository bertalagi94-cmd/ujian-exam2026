import { NextRequest } from 'next/server'
import { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase'
import { verifyToken, JWTPayload } from '@/lib/auth'
import { getKepsekScope } from '@/lib/kepsek-scope'
import { computeLiveLeaderboardUntukSesi, LiveLeaderboardSesi } from '@/lib/leaderboard-live'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 60

// GET /api/layar-pantau/stream?token=...
//
// ── REALTIME, BUKAN POLLING ─────────────────────────────────────────────
// Endpoint ini membuka koneksi Server-Sent Events (SSE) yang tetap terbuka,
// lalu SERVER (bukan browser) subscribe ke Supabase Realtime memakai
// service-role key untuk memantau tabel `jawaban`, `siswa_ujian`, dan
// `sesi_ujian`. Begitu ada baris berubah, server langsung menghitung ulang
// papan (computeLiveLeaderboardUntukSesi via ambilBoardsUntukViewer di
// bawah) dan mendorongnya ke klien — tidak ada jeda "nunggu interval
// berikutnya" seperti pendekatan setInterval(fetch) sebelumnya.
//
// KENAPA SUBSCRIBE DI SERVER, BUKAN LANGSUNG DARI BROWSER KE SUPABASE:
// Kalau browser subscribe langsung, dia butuh Supabase anon key + kebijakan
// RLS yang membuka tabel-tabel di atas, artinya payload MENTAH (termasuk
// pilihan jawaban tiap siswa per soal) akan lolos ke jaringan browser tanpa
// lewat agregasi kita. Dengan server yang subscribe lalu menghitung ulang
// papan AGREGAT sebelum dikirim ke client, kunci jawaban dan jawaban mentah
// tetap tidak pernah keluar dari server.
//
// SYARAT SETUP (SEKALI SAJA, DI SUPABASE DASHBOARD):
// Tabel `jawaban`, `sesi_ujian`, dan `siswa_ujian` harus dimasukkan ke
// publication `supabase_realtime` (Database → Replication di dashboard,
// atau jalankan SQL:
//   alter publication supabase_realtime add table jawaban, sesi_ujian, siswa_ujian;
// ). Tanpa ini, event Realtime tidak akan pernah terkirim — papan tetap
// ter-update lewat jaring pengaman berkala di bawah, tapi tidak instan.
//
// EventSource browser TIDAK BISA mengirim header custom, jadi token JWT
// dikirim lewat query string (?token=...), lalu diverifikasi persis seperti
// endpoint lain — cuma sumber tokennya beda dari header Authorization.
//
// CATATAN: ambilBoardsUntukViewer() di bawah SENGAJA disalin persis sama
// dengan yang ada di data/route.ts (bukan diimpor dari satu modul bersama)
// — supaya proses deploy tidak bergantung pada satu file tambahan terpisah
// yang gampang salah taruh/salah isi saat dipindah manual.

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

      // FIX (race condition): pushBoards() bisa dipanggil dari 3 sumber
      // berbeda (muatan awal, debounce recompute, safetyTimer tiap 8 detik)
      // dan bisa saling tumpang tindih karena masing-masing menunggu
      // beberapa query async. Tanpa penanda generasi, hasil yang MULAI lebih
      // dulu tapi SELESAI belakangan bisa menimpa hasil yang lebih baru yang
      // sudah terkirim ke layar (papan "mundur sesaat"). `gen` memastikan
      // hanya hasil dari panggilan PALING TERAKHIR yang benar-benar dikirim.
      let gen = 0
      // HEMAT BANDWIDTH: jaring pengaman 8 detik tadinya selalu mengirim
      // seluruh papan walau tidak ada yang berubah. Sekarang hasil yang
      // identik dengan kiriman terakhir TIDAK dikirim lagi. Pengecualian:
      // papan KOSONG selalu dikirim (klien butuh dua hasil kosong berturut-turut
      // untuk benar-benar mengosongkan layar, lihat terapkanDataBaru di page.tsx).
      let lastSignature = ''
      const pushBoards = async () => {
        const myGen = ++gen
        try {
          const { boards, scopeWarning } = await ambilBoardsUntukViewer(db, user!)
          if (myGen !== gen) return // sudah ada panggilan lebih baru, buang hasil basi ini
          const signature = JSON.stringify({ boards, scopeWarning })
          if (boards.length > 0 && signature === lastSignature) return
          lastSignature = signature
          send('boards', {
            serverTime: new Date().toISOString(),
            viewer: { nama: user!.nama, role: user!.role },
            boards,
            scopeWarning,
          })
        } catch (e) {
          if (myGen !== gen) return
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

      // Muatan pertama, langsung begitu klien tersambung.
      await pushBoards()

      // ── Langganan Realtime ────────────────────────────────────────────
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
      // Realtime yang masuk.
      safetyTimer = setInterval(pushBoards, SAFETY_REFRESH_MS)

      // Tutup stream secara rapi sebelum batas durasi fungsi serverless
      // tercapai. EventSource di browser otomatis menyambung ulang.
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
      'X-Accel-Buffering': 'no',
    },
  })
}

// ── Sesi mana yang boleh dilihat viewer ini + hitung papan live-nya ────────
type ViewerUser = Pick<JWTPayload, 'role' | 'username'>

// FITUR (pesan "UJIAN SELESAI" + hitung mundur di Layar Pantau, diminta
// user): sebelumnya query di sini HANYA mengambil sesi status BERJALAN —
// begitu pengawas menutup sesi (status → SELESAI), papan kelas itu langsung
// tidak ikut terambil sama sekali, sehingga lenyap dari layar TANPA pesan
// apa pun (lihat riwayat diskusi). Sekarang sesi yang BARU SAJA ditutup
// (waktu_selesai masih dalam JENDELA_TAMPIL_SETELAH_TUTUP_MS terakhir) tetap
// ikut diambil, supaya frontend (LiveLeaderboardBoard) bisa menampilkan
// overlay "UJIAN SELESAI" + hitung mundur 30 detik sebelum menyembunyikannya
// SENDIRI (client-side). Jendela di sini SENGAJA dibuat lebih longgar
// (40 detik) daripada hitung mundur yang dilihat user (30 detik) — cuma
// buffer keamanan supaya sesi tidak "kepotong" query sebelum hitung mundur
// client selesai (mis. kalau ada jeda jaringan/refresh sesaat).
// CATATAN: sengaja disalin persis sama dengan data/route.ts (lihat alasan
// duplikasi fungsi ini di komentar atas file).
const JENDELA_TAMPIL_SETELAH_TUTUP_MS = 40_000

function buildStatusFilter(): string {
  const cutoffIso = new Date(Date.now() - JENDELA_TAMPIL_SETELAH_TUTUP_MS).toISOString()
  return `status.eq.BERJALAN,and(status.eq.SELESAI,waktu_selesai.gte.${cutoffIso})`
}

async function ambilBoardsUntukViewer(
  db: SupabaseClient<any>,
  user: ViewerUser
): Promise<{ boards: LiveLeaderboardSesi[]; scopeWarning?: string }> {
  let sesiRows: {
    id: string; jadwal_id: string; mapel_id: string; kelas: string
    durasi: number | null; waktu_mulai: string; paket_soal_id: string | null; status: string
    waktu_selesai: string | null
  }[] = []

  const statusFilter = buildStatusFilter()
  const kolomSesi = 'id, jadwal_id, mapel_id, kelas, durasi, waktu_mulai, paket_soal_id, status, waktu_selesai'

  if (user.role === 'GURU') {
    const { data: jadwalSaya, error: errJadwal } = await db
      .from('jadwal')
      .select('id')
      .eq('pengawas', user.username)
    if (errJadwal) throw new Error(errJadwal.message)

    const jadwalIds = (jadwalSaya ?? []).map((j: { id: string }) => j.id)
    if (jadwalIds.length === 0) return { boards: [] }

    const { data, error } = await db
      .from('sesi_ujian')
      .select(kolomSesi)
      .in('jadwal_id', jadwalIds)
      .or(statusFilter)
    if (error) throw new Error(error.message)
    sesiRows = data ?? []
  } else if (user.role === 'KEPSEK') {
    const scope = await getKepsekScope(user.username)
    if (scope.noScope || scope.kelasList.length === 0) {
      return {
        boards: [],
        scopeWarning: scope.noScope ? 'Akun Kepsek Anda belum diset sekolah/jenjangnya oleh Admin.' : undefined,
      }
    }
    const { data, error } = await db
      .from('sesi_ujian')
      .select(kolomSesi)
      .in('kelas', scope.kelasList)
      .or(statusFilter)
    if (error) throw new Error(error.message)
    sesiRows = data ?? []
  } else {
    const { data, error } = await db
      .from('sesi_ujian')
      .select(kolomSesi)
      .or(statusFilter)
    if (error) throw new Error(error.message)
    sesiRows = data ?? []
  }

  if (sesiRows.length === 0) return { boards: [] }

  const mapelIds = [...new Set(sesiRows.map(s => s.mapel_id))]
  const { data: mapelList } = await db.from('mapel').select('id, nama').in('id', mapelIds)
  const namaMapelMap = Object.fromEntries((mapelList ?? []).map((m: { id: string; nama: string }) => [m.id, m.nama]))

  const boards = (await Promise.all(
    sesiRows.map(s => computeLiveLeaderboardUntukSesi(db, s, namaMapelMap))
  )).filter((b): b is LiveLeaderboardSesi => b !== null)

  // Sesi yang masih BERJALAN didahulukan; sesi yang baru ditutup (tampil
  // sementara untuk pesan "UJIAN SELESAI") digeser ke belakang supaya tidak
  // mengganggu urutan kelas yang masih aktif dipantau.
  boards.sort((a, b) =>
    (a.statusSesi === 'SELESAI' ? 1 : 0) - (b.statusSesi === 'SELESAI' ? 1 : 0) ||
    a.kelas.localeCompare(b.kelas) ||
    a.namaMapel.localeCompare(b.namaMapel)
  )

  return { boards }
}
