// Penjaga "satu siswa satu perangkat" untuk endpoint SISWA (sisi server).
//
// Dipakai oleh /api/siswa/ujian/pelanggaran dan /api/siswa/ujian/verifikasi-reset
// yang DULU tidak memeriksa perangkat sama sekali (endpoint lain — sync, selesai,
// essay/* — sudah punya pemeriksaan sendiri dengan aturan yang sama).
//
// Aturan:
//   - Baris siswa_ujian belum punya device_id (data lama)  -> OK (tidak ada yang dibandingkan).
//   - Request mengirim deviceId  -> harus SAMA PERSIS dengan yang terdaftar, kalau tidak 'BEDA'.
//   - Request TIDAK mengirim deviceId (client/APK lama):
//       * DEVICE_LOCK_STRICT=true  -> 'TIDAK_DIKIRIM' (ditolak, sama seperti route sync).
//       * selain itu (default)     -> OK + peringatan di log, supaya rilis bertahap
//         tidak membuat siswa dengan APK lama tersangkut di tengah ujian.
//     Setelah semua perangkat memakai versi baru, set DEVICE_LOCK_STRICT=true di Vercel.

export type HasilCekDevice = 'OK' | 'BEDA' | 'TIDAK_DIKIRIM'

export function deviceLockKetat(): boolean {
  return process.env.DEVICE_LOCK_STRICT === 'true'
}

export function cekDeviceSiswa(
  deviceIdTerdaftar: string | null | undefined,
  deviceIdRequest: unknown,
  konteks: string
): HasilCekDevice {
  if (!deviceIdTerdaftar) return 'OK'

  if (typeof deviceIdRequest === 'string' && deviceIdRequest) {
    return deviceIdRequest === deviceIdTerdaftar ? 'OK' : 'BEDA'
  }

  if (deviceLockKetat()) return 'TIDAK_DIKIRIM'
  console.warn(`[device-guard] ${konteks}: request tanpa deviceId (client lama?) — diloloskan karena DEVICE_LOCK_STRICT belum aktif`)
  return 'OK'
}

export const PESAN_DEVICE_LAIN =
  'Sesi ujian Anda sedang aktif di perangkat lain. Permintaan dari perangkat ini ditolak.'

// Dipakai saat DEVICE_LOCK_STRICT=true dan request tidak membawa deviceId
// (client/APK lama) — jangan menyalahkan "perangkat lain", masalahnya versi aplikasi.
export const PESAN_APLIKASI_LAMA =
  'Versi aplikasi di perangkat ini sudah usang. Perbarui aplikasi lalu coba lagi.'

export function pesanDevice(hasil: HasilCekDevice): string {
  return hasil === 'TIDAK_DIKIRIM' ? PESAN_APLIKASI_LAMA : PESAN_DEVICE_LAIN
}
