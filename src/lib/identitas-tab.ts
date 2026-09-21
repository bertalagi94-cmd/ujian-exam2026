// Pengikat identitas siswa ke SATU tab browser.
//
// MASALAH (audit): token login disimpan di localStorage yang DIBAGI semua tab
// dalam satu profil browser, sedangkan server mengenali siswa dari token itu.
// Kalau siswa B login di tab lain sementara tab siswa A masih terbuka, request
// dari tab A (autosync, outbox, submit) membawa token B. `deviceId` sama (juga
// di localStorage), jadi pemeriksaan device pun lolos -- jawaban A bisa
// tersimpan atas nama B tanpa ada yang menolak.
//
// SOLUSI berlapis:
//  1) Layout siswa MENGUNCI nis tab ini saat dimuat (kunciIdentitasTab).
//  2) apiRequest() untuk /api/siswa/* menolak MENGIRIM request kalau token saat
//     ini bukan milik nis yang dikunci (IdentitasBerubahError -- sengaja tanpa
//     `status`, sehingga pemanggil memperlakukannya seperti "belum bisa
//     terkirim": jawaban tetap aman di perangkat dan dicoba lagi nanti, TIDAK
//     jadi GAGAL permanen), dan selain itu menyertakan header X-Nis-Klien.
//  3) Server (requireRole) menolak kalau X-Nis-Klien tidak cocok dengan token --
//     jaring pengaman kalau token berubah persis di antara langkah 2 dan request.
//
// Berkas ini SENGAJA tidak mengimpor apa pun dari utils.ts (hindari sirkular).

let nisTerkunci: string | null = null

export function kunciIdentitasTab(nis: string | null): void {
  nisTerkunci = nis
}

export function nisTerkunciTab(): string | null {
  return nisTerkunci
}

/** Baca `nis` dari payload JWT di localStorage TANPA verifikasi (verifikasi = tugas server). */
export function nisDariToken(): string | null {
  try {
    const token = localStorage.getItem('token')
    if (!token) return null
    const bagian = token.split('.')[1]
    if (!bagian) return null
    const b64 = bagian.replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(
      atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '='))
        .split('')
        .map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('')
    )
    const nis = (JSON.parse(json) as { nis?: unknown }).nis
    return typeof nis === 'string' ? nis : null
  } catch {
    return null
  }
}

/** True kalau tab ini sudah terkunci ke satu siswa TAPI token di browser kini milik akun lain / hilang. */
export function identitasTabBerubah(): boolean {
  if (!nisTerkunci) return false
  return nisDariToken() !== nisTerkunci
}

export class IdentitasBerubahError extends Error {
  kode = 'IDENTITAS_BERUBAH' as const
  constructor() {
    super('Akun yang login di browser ini berubah. Permintaan tidak dikirim supaya data tidak tercampur.')
    this.name = 'IdentitasBerubahError'
  }
}
