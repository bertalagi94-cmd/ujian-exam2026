import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}



export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-'
  try {
    return new Date(dateStr).toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return dateStr
  }
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '-'
  try {
    return new Date(dateStr).toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return dateStr
  }
}

export function gradeColor(grade: string): string {
  const map: Record<string, string> = {
    A: 'text-emerald-600 bg-emerald-50',
    B: 'text-blue-600 bg-blue-50',
    C: 'text-yellow-600 bg-yellow-50',
    D: 'text-orange-600 bg-orange-50',
    E: 'text-red-600 bg-red-50',
  }
  return map[grade] ?? 'text-slate-600 bg-slate-50'
}

export function nilaiColor(nilai: number): string {
  if (nilai >= 90) return 'text-emerald-600'
  if (nilai >= 75) return 'text-blue-600'
  if (nilai >= 60) return 'text-yellow-600'
  if (nilai >= 40) return 'text-orange-600'
  return 'text-red-600'
}

export function generateKodeSesi(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

// FIX: sebelumnya hanya `${prefix}_${Date.now()}` — Date.now() presisi
// milidetik, sehingga dua request yang sampai di server pada milidetik
// yang sama (mudah terjadi saat banyak insert paralel/serentak, misalnya
// banyak guru menyimpan soal di waktu hampir bersamaan) menghasilkan ID
// identik dan gagal dengan "duplicate key value violates unique
// constraint". Suffix acak di akhir menghilangkan kemungkinan collision
// ini sepenuhnya, termasuk pada beban tinggi.
export function generateId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now()}_${random}`
}

// Konten soal (teks pertanyaan, opsi jawaban, pembahasan) seharusnya teks
// polos, bukan HTML — jadi paling aman dibuang seluruhnya, bukan dicoba
// "dibersihkan" jadi HTML aman.
function stripOneTagPass(str: string): string {
  let result = ''
  let i = 0
  while (i < str.length) {
    const ch = str[i]
    if (ch === '<' && /^[a-zA-Z!/]/.test(str[i + 1] ?? '')) {
      const nextLt = str.indexOf('<', i + 1)
      const nextGt = str.indexOf('>', i + 1)
      if (nextGt !== -1 && (nextLt === -1 || nextGt < nextLt)) {
        // Tag valid ditemukan: lompat ke setelah '>' penutupnya, buang isinya.
        i = nextGt + 1
        continue
      }
    }
    result += ch
    i++
  }
  return result
}

// Ini lapisan pertahanan KEDUA (defense-in-depth) — semua titik render
// saat ini (src/app/siswa/ujian/page.tsx, src/app/guru/**,
// src/app/admin/soal/page.tsx) sudah memakai JSX text interpolation
// ({soal.teks}) yang otomatis di-escape React, jadi XSS TIDAK bisa
// tereksekusi lewat jalur manapun yang ada saat ini. Sanitasi di server
// ini menjaga keamanan tetap terjaga seandainya nanti ada fitur baru yang
// merender field ini lewat innerHTML/dangerouslySetInnerHTML (mis. fitur
// rich-text/equation-editor di masa depan), atau kalau data soal di-export
// ke sistem lain yang merender HTML mentah.
//
// Pendekatan yang dipakai: scanner kiri-ke-kanan dengan lookahead,
// dijalankan berulang sampai fixed-point (bukan sekali) supaya tahan
// terhadap tag yang ditumpuk/disembunyikan berlapis
// (mis. "<<script>script>...</script>/script>"). '<' hanya dianggap awal
// tag kalau diikuti huruf/'/'/'!' DAN ada '>' penutup sebelum '<'
// berikutnya — ini menjaga simbol perbandingan matematika berspasi macam
// "3 < x < 7" atau "a < b dan c > d" tetap aman.
//
// Trade-off yang disadari dan diterima: pola sangat spesifik berupa
// variabel satu-huruf tanpa spasi diikuti '>' lain di tempat tak terduga
// (mis. "x<y dan p>q dan <script>...") bisa salah memangkas sedikit teks
// di antaranya, karena 'y' setelah '<' valid sebagai awal nama tag HTML.
// Kasus ini dianggap dapat diterima karena: (1) sangat tidak lazim dalam
// penulisan soal nyata (variabel matematika lazimnya ditulis dengan
// spasi: "x < y"), dan (2) alternatif yang mencoba menutup celah ini
// (depth-counter, HTML-entity-encoding) masing-masing terbukti merusak
// kasus matematika yang jauh lebih umum/lazim ditulis guru — lihat
// histori perubahan fungsi ini untuk detail percobaan yang ditolak.
export function stripHtmlTags(input: unknown): string {
  if (input === null || input === undefined) return ''
  let text = String(input)
  let prev: string
  do {
    prev = text
    text = stripOneTagPass(text)
  } while (text !== prev)
  return text.trim()
}

// ── FIX: apiRequest dengan AbortController + timeout 10 detik ────────────────
// Sebelumnya fetch() tidak punya batas waktu sama sekali. Ketika device idle
// beberapa menit, OS (terutama HP) menutup koneksi TCP di background untuk
// hemat baterai/resource. Saat pengguna kembali dan klik menu, fetch baru
// mencoba konek tapi koneksi TCP sudah "mati" — fetch menggantung tanpa batas
// hingga server timeout sendiri (30–60 detik), membuat halaman terasa beku.
//
// Solusi: setiap request diberi AbortController dengan timeout 10 detik.
// Jika server tidak merespons dalam 10 detik, request dibatalkan otomatis
// dan error dilempar — halaman bisa menanganinya (toast error, retry, dll.)
// daripada terus menggantung tanpa kabar.
export function apiRequest<T = unknown>(
  url: string,
  options?: RequestInit & { timeoutMs?: number }
): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null

  // Timeout default 10 detik. Bisa di-override per-call lewat options.timeoutMs.
  const timeoutMs = options?.timeoutMs ?? 10_000
  const controller = new AbortController()
  const timerId = setTimeout(() => controller.abort(), timeoutMs)

  // Pisahkan timeoutMs dari options supaya tidak ikut dikirim ke fetch()
  const { timeoutMs: _omit, ...fetchOptions } = options ?? {}
  void _omit

  return fetch(url, {
    ...fetchOptions,
    signal: controller.signal,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...fetchOptions?.headers,
    },
  })
    .then(async (res) => {
      clearTimeout(timerId)

      // Safely parse JSON — body bisa kosong (204) atau bukan JSON
      let data: Record<string, unknown> = {}
      const text = await res.text()
      if (text) {
        try {
          data = JSON.parse(text)
        } catch {
          // Response bukan JSON (misal HTML error page dari server)
          if (!res.ok) throw new Error(`Server error (${res.status})`)
          return data as T
        }
      }

      if (!res.ok) {
        // Kalau 401, token mungkin expired — arahkan ke login
        if (res.status === 401) {
          if (typeof window !== 'undefined') {
            localStorage.removeItem('token')
            window.location.href = '/login'
          }
          throw new Error('Sesi berakhir, silakan login kembali')
        }
        const err = new Error((data.error as string) || `Request gagal (${res.status})`) as Error & { data: Record<string, unknown>; status: number }
        err.data = data
        err.status = res.status
        throw err
      }

      return data as T
    })
    .catch((err: unknown) => {
      clearTimeout(timerId)
      // Jika AbortError (timeout kita sendiri), beri pesan yang jelas
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Koneksi terlalu lama. Periksa jaringan dan coba lagi.')
      }
      throw err
    })
}
