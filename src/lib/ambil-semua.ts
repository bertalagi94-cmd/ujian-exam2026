// src/lib/ambil-semua.ts
//
// Supabase/PostgREST membatasi satu query maksimal `max_rows` baris (default
// 1000). Query tanpa .range() yang hasilnya lebih dari itu DIPOTONG DIAM-DIAM
// tanpa error. Helper ini mengambil halaman demi halaman sampai habis.
//
// PENTING: query yang dibungkus HARUS punya .order() yang stabil (unik),
// kalau tidak, baris bisa terlewat/ganda antar halaman.
//
// Perilaku error sengaja sama seperti query biasa: tidak melempar exception,
// mengembalikan { data, error }. Kalau satu halaman gagal, baris yang sudah
// terkumpul tetap dikembalikan bersama error-nya.

const UKURAN_HALAMAN = 1000
const BATAS_HALAMAN = 200 // pengaman: maksimal 200.000 baris

export async function ambilSemuaBaris<T>(
  buat: (dari: number, sampai: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<{ data: T[]; error: { message: string } | null }> {
  const semua: T[] = []
  for (let hal = 0; hal < BATAS_HALAMAN; hal++) {
    const dari = hal * UKURAN_HALAMAN
    const { data, error } = await buat(dari, dari + UKURAN_HALAMAN - 1)
    if (error) return { data: semua, error }
    const baris = data ?? []
    semua.push(...baris)
    if (baris.length < UKURAN_HALAMAN) break
  }
  return { data: semua, error: null }
}
