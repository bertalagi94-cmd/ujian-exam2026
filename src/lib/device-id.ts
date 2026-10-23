// Identitas perangkat siswa (dipakai client). Dibuat sekali, disimpan di
// localStorage, dipakai konsisten sepanjang ujian. Server membandingkannya
// dengan siswa_ujian.device_id untuk menegakkan aturan "satu siswa satu
// perangkat" (lihat src/lib/device-guard.ts).
//
// Implementasi dan kunci localStorage SENGAJA identik dengan getDeviceId() lama
// di src/app/siswa/ujian/page.tsx supaya device_id yang sudah terdaftar tetap
// cocok. Modul ini dipisah ke src/lib supaya outbox (pelanggaran-outbox.ts,
// reset-offline-client.ts) juga bisa memakainya tanpa mengimpor halaman.
export const KUNCI_DEVICE_ID = 'ujian_device_id'

export function getDeviceId(): string {
  try {
    const stored = localStorage.getItem(KUNCI_DEVICE_ID)
    if (stored) return stored
    const id = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    localStorage.setItem(KUNCI_DEVICE_ID, id)
    return id
  } catch {
    return `dev_fallback_${Math.random().toString(36).slice(2, 9)}`
  }
}
