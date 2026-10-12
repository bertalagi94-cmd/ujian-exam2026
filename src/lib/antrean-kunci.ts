// src/lib/antrean-kunci.ts
//
// Kunci (mutex) sederhana dalam satu tab: semua pengiriman antrean siswa
// (pelanggaran DAN reset offline) lewat sini, jadi tidak pernah ada dua
// request antrean yang berjalan bersamaan dari tab yang sama.
//
// Dipisah ke file sendiri supaya pelanggaran-outbox.ts, reset-offline-client.ts
// dan antrean-berurutan.ts bisa memakainya tanpa import melingkar.

let ekor: Promise<unknown> = Promise.resolve()

export function jalankanBerurutan<T>(fn: () => Promise<T>): Promise<T> {
  const hasil = ekor.then(fn, fn)
  // Jangan biarkan satu kegagalan memutus rantai untuk pemanggil berikutnya.
  ekor = hasil.catch(() => undefined)
  return hasil
}

/** Event yang dipancarkan supaya penjaga antrean berurutan segera flush. */
export const EVENT_PICU_ANTREAN = 'antrean-berurutan:picu'
