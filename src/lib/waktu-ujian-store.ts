// Penyimpan waktu ujian di LUAR state React.
//
// LATAR BELAKANG: timer halaman ujian siswa dulu memakai useState di komponen
// halaman (5.000+ baris, tanpa memo), sehingga SELURUH halaman -- soal, pilihan
// jawaban, daftar nomor -- dirender ulang setiap detik. Di HP kelas bawah ini
// terasa berat/menggantung, terlepas dari kondisi server.
//
// Sekarang detik berjalan disimpan di sini. Hanya komponen kecil yang
// berlangganan (jam, hitung mundur batas minimal submit) yang dirender ulang
// tiap detik. Halaman hanya dirender ulang saat sebuah BOOLEAN berubah
// (useBelumCukupWaktu), yaitu sekali saja.
import { useSyncExternalStore } from 'react'

let sisaDetik = 0
let terpakaiDetik = 0
const pendengar = new Set<() => void>()

function beritahu(): void {
  pendengar.forEach(fn => { try { fn() } catch { /* pendengar rusak tidak boleh mematikan yang lain */ } })
}

function berlangganan(fn: () => void): () => void {
  pendengar.add(fn)
  return () => { pendengar.delete(fn) }
}

export function setSisaWaktuUjian(n: number): void {
  if (n === sisaDetik) return
  sisaDetik = n
  beritahu()
}

export function setWaktuTerpakaiUjian(n: number): void {
  if (n === terpakaiDetik) return
  terpakaiDetik = n
  beritahu()
}

export function getSisaWaktuUjian(): number { return sisaDetik }
export function getWaktuTerpakaiUjian(): number { return terpakaiDetik }

/** Dipanggil saat halaman ujian dibuka, supaya sisa nilai sesi lain tidak terbawa. */
export function resetWaktuUjian(): void {
  sisaDetik = 0
  terpakaiDetik = 0
  beritahu()
}

/** Sisa waktu (detik). Memicu render ulang PEMAKAINYA tiap detik -- pakai hanya di komponen kecil. */
export function useSisaWaktuUjian(): number {
  return useSyncExternalStore(berlangganan, getSisaWaktuUjian, () => 0)
}

/** Waktu terpakai (detik). Sama seperti di atas: hanya untuk komponen kecil. */
export function useWaktuTerpakaiUjian(): number {
  return useSyncExternalStore(berlangganan, getWaktuTerpakaiUjian, () => 0)
}

/**
 * Apakah batas minimal submit belum tercapai? Mengembalikan boolean, jadi
 * pemakainya hanya dirender ulang saat nilainya BERUBAH, bukan tiap detik.
 */
export function useBelumCukupWaktu(minDetik: number): boolean {
  return useSyncExternalStore(
    berlangganan,
    () => minDetik > 0 && terpakaiDetik < minDetik,
    () => false
  )
}

export function formatWaktuUjian(detik: number): string {
  const m = Math.floor(detik / 60)
  const s = detik % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
