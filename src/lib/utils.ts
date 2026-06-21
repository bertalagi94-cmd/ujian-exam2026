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

export function apiRequest<T = unknown>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  }).then(async (res) => {
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
      const err = new Error((data.error as string) || `Request gagal (${res.status})`) as Error & { data: Record<string, unknown> }
      err.data = data
      throw err
    }

    return data as T
  })
}
