import jwt from 'jsonwebtoken'
import { NextRequest } from 'next/server'

// FIX (keamanan): sebelumnya `process.env.JWT_SECRET!` memakai non-null
// assertion tanpa validasi apapun. Kalau env var ini tidak ter-set di
// deployment, `SECRET` menjadi `undefined` — TypeScript tetap menganggapnya
// `string` karena `!`, tapi runtime-nya `jsonwebtoken` akan mengubah
// `undefined` menjadi string literal "undefined" saat sign/verify.
// Akibatnya SEMUA token ditandatangani dengan secret yang sama & bisa
// ditebak ("undefined") — ini bukan cuma "auth gagal total", tapi celah
// keamanan nyata (siapa pun bisa memalsukan token ADMIN/GURU/SISWA).
// Sekarang: gagal cepat (throw) saat modul pertama kali dimuat kalau
// JWT_SECRET tidak ada atau terlalu pendek, supaya deployment yang salah
// konfigurasi langsung ketahuan di log, bukan diam-diam membuka celah.
// Dibungkus fungsi (bukan langsung `const SECRET = process.env.JWT_SECRET`)
// supaya TypeScript tahu PASTI tipe hasilnya `string`, bukan `string | undefined`.
// Tanpa ini, build gagal dengan "Type error: No overload matches this call"
// di jwt.sign()/jwt.verify(), karena TypeScript tidak bisa menjamin closure
// signToken()/verifyToken() (yang dipanggil belakangan) masih melihat SECRET
// sebagai string setelah pengecekan di atasnya.
function getValidatedSecret(): string {
  const raw = process.env.JWT_SECRET
  if (!raw || raw.length < 16) {
    throw new Error(
      'JWT_SECRET tidak diset atau terlalu pendek (minimal 16 karakter). ' +
      'Set environment variable JWT_SECRET di Vercel/deployment sebelum aplikasi berjalan.'
    )
  }
  return raw
}

const SECRET: string = getValidatedSecret()

export interface JWTPayload {
  username: string
  nama: string
  role: 'ADMIN' | 'GURU' | 'KEPSEK' | 'SISWA'
  nis?: string
  kelas?: string
  // ── Mode "Lihat sebagai" (view-as) ────────────────────────────────────────
  // Token khusus yang diterbitkan ADMIN untuk melihat aplikasi persis seperti
  // GURU/KEPSEK/SISWA tertentu. `role`/`username`/`nis` berisi identitas
  // TARGET (supaya semua endpoint lama otomatis menampilkan data target),
  // sedangkan `impersonator*` mencatat admin aslinya untuk audit.
  // Token ini HANYA-BACA: requireRole() menolak semua method selain GET/HEAD.
  viewAs?: boolean
  impersonatorUsername?: string
  impersonatorNama?: string
  // ID sesi Lihat-sebagai (khusus target SISWA) — dipakai menandai siswa
  // "sedang dipantau" (lihat src/lib/dipantau.ts).
  viewAsSid?: string
  iat?: number
  exp?: number
}

export function signToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, SECRET, { expiresIn: '10h' })
}

// Batas keras umur token "Lihat sebagai". Bukan untuk UX normal (admin
// menutup sesi manual lewat tombol "Kembali ke Admin"), melainkan jaring
// pengaman kalau tab admin tertutup sebelum sempat kembali.
export const VIEW_AS_MAX_SECONDS = 2 * 60 * 60

export function signViewAsToken(
  payload: Omit<JWTPayload, 'iat' | 'exp' | 'viewAs'>
): string {
  return jwt.sign({ ...payload, viewAs: true }, SECRET, { expiresIn: VIEW_AS_MAX_SECONDS })
}

// Khusus untuk mencatat AKHIR sesi "Lihat sebagai" ke log audit: token yang
// sudah kedaluwarsa tetap diterima (signature tetap divalidasi), asalkan
// memang token viewAs. JANGAN dipakai untuk otorisasi endpoint lain.
export function verifyViewAsTokenAllowExpired(token: string): JWTPayload | null {
  try {
    const p = jwt.verify(token, SECRET, { ignoreExpiration: true }) as JWTPayload
    return p.viewAs === true && p.impersonatorUsername ? p : null
  } catch {
    return null
  }
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, SECRET) as JWTPayload
  } catch {
    return null
  }
}

export function getTokenFromRequest(req: NextRequest): JWTPayload | null {
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  return verifyToken(auth.slice(7))
}

export function requireRole(
  req: NextRequest,
  allowedRoles: JWTPayload['role'][]
): { user: JWTPayload } | { error: Response } {
  const user = getTokenFromRequest(req)
  if (!user) {
    return {
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    }
  }
  if (!allowedRoles.includes(user.role)) {
    return {
      error: new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    }
  }
  // ── Penegakan read-only untuk mode "Lihat sebagai" ────────────────────────
  // SATU titik untuk semua endpoint yang memakai requireRole(): token viewAs
  // hanya boleh GET/HEAD. Semua POST/PUT/PATCH/DELETE (submit jawaban, ganti
  // password, kirim pelanggaran, dst) otomatis ditolak tanpa mengubah
  // endpoint satu per satu. Catatan: GET yang punya efek samping (mis.
  // cek-sesi → last_heartbeat) tetap harus mengecek `user.viewAs` sendiri.
  if (user.viewAs && !['GET', 'HEAD'].includes(req.method.toUpperCase())) {
    return {
      error: new Response(
        JSON.stringify({ error: 'Mode "Lihat sebagai" bersifat hanya-baca.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      ),
    }
  }
  return { user }
}
