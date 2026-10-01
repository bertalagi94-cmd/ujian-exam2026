import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

// ── Jembatan ke proteksi native Android (immersive mode + screen pinning) ──
// Lihat android/app/src/main/java/com/smartexam/mtsalkhairaat/ExamLockPlugin.java
// untuk implementasi native-nya.
//
// PENTING: fungsi di file ini SELALU aman dipanggil dari mana pun, termasuk
// saat dibuka lewat browser biasa (bukan APK) — di situ Capacitor.isNativePlatform()
// akan bernilai false dan fungsi langsung berhenti tanpa melakukan apa pun,
// jadi perilaku Fullscreen API web yang sudah ada (lihat requestFullscreen di
// src/app/siswa/ujian/page.tsx) TIDAK terganggu sama sekali oleh file ini.
export type ExamLockLostReason = 'unpinned' | 'multi_window'

// true  = di APK, soal HANYA tampil setelah layar berhasil disematkan (screen
//         pinning aktif). Selama belum aktif, komponen KunciLayarWajib menutup
//         layar. Ini yang menjamin tombol Home/Recent, notifikasi, dan tarik
//         layar dari atas nonaktif selama ujian (diblokir sistem Android saat
//         pin aktif). Tombol Back diblokir terpisah oleh native.
// false = mode lunak: ujian tetap jalan walau pin gagal/ditolak (proteksi
//         berkurang). Pakai ini hanya kalau ada merek HP yang tidak mendukung
//         screen pinning dan Anda memilih ujian tetap berjalan.
export const WAJIB_KUNCI_NATIVE = true

// idle           : lock tidak diminta (di luar ujian, atau bukan APK)
// menunggu       : startLock dipanggil, menunggu siswa menyetujui dialog pin
// aktif          : layar sudah tersemat
// perlu_aktivasi : pin ditolak / terlepas / tidak didukung -> siswa harus
//                  mengaktifkan lagi
export type ExamLockStatus = 'idle' | 'menunggu' | 'aktif' | 'perlu_aktivasi'

let statusLock: ExamLockStatus = 'idle'
const pelangganStatus = new Set<() => void>()

function setStatusLock(s: ExamLockStatus) {
  if (s === statusLock) return
  statusLock = s
  pelangganStatus.forEach((f) => { try { f() } catch { /* abaikan */ } })
}

export function getExamLockStatus(): ExamLockStatus {
  return statusLock
}

export function subscribeExamLockStatus(cb: () => void): () => void {
  pelangganStatus.add(cb)
  return () => { pelangganStatus.delete(cb) }
}

interface ExamLockPluginApi {
  startLock(): Promise<{ locked: boolean }>
  endLock(): Promise<{ locked: boolean }>
  // Event dari native (hanya dikirim selama lock sedang diminta):
  //   lockLost       -> siswa melepas screen pinning / masuk split-screen
  //   lockNotGranted -> pin tidak aktif >10 detik setelah startLock()
  addListener(
    eventName: 'lockLost',
    listener: (e: { reason?: ExamLockLostReason }) => void
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'lockNotGranted',
    listener: () => void
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'lockActive',
    listener: () => void
  ): Promise<PluginListenerHandle>
}

const ExamLock = registerPlugin<ExamLockPluginApi>('ExamLock')

export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

let listenerNativeTerpasang = false

// Dipasang SEKALI. Native hanya mengirim event selama lock sedang diminta.
function pasangListenerNative() {
  if (listenerNativeTerpasang) return
  listenerNativeTerpasang = true
  const gagal = () => { listenerNativeTerpasang = false }
  ExamLock.addListener('lockActive', () => {
    if (statusLock !== 'idle') setStatusLock('aktif')
  }).catch(gagal)
  ExamLock.addListener('lockLost', () => {
    if (statusLock !== 'idle') setStatusLock('perlu_aktivasi')
  }).catch(gagal)
  ExamLock.addListener('lockNotGranted', () => {
    if (statusLock !== 'idle') setStatusLock('perlu_aktivasi')
  }).catch(gagal)
}

export async function startExamLock(): Promise<void> {
  if (!isNativeApp()) return
  pasangListenerNative()
  if (statusLock !== 'aktif') setStatusLock('menunggu')
  try {
    const res = await ExamLock.startLock()
    if (res?.locked) setStatusLock('aktif')
    // locked=false: pin menunggu persetujuan siswa; status akan berubah lewat
    // event lockActive (disetujui) atau lockNotGranted (ditolak / >10 detik).
  } catch (e) {
    // Plugin native tidak ada/gagal (mis. APK lama tanpa ExamLockPlugin).
    // Jangan memblokir ujian karena kesalahan di sisi aplikasi, bukan siswa.
    setStatusLock('idle')
    console.warn('[exam-lock] startLock gagal:', e)
  }
}

export async function endExamLock(): Promise<void> {
  if (!isNativeApp()) return
  setStatusLock('idle')
  try {
    await ExamLock.endLock()
  } catch (e) {
    console.warn('[exam-lock] endLock gagal:', e)
  }
}

// Berlangganan event "lock terlepas" dari native. Mengembalikan fungsi untuk
// berhenti berlangganan. No-op aman di luar APK (browser biasa).
//
// Kenapa perlu: siswa yang melepas screen pinning (tahan Back + Recent) tetap
// berada di aplikasi, jadi TIDAK memicu blur/visibilitychange di web. Hanya
// native yang tahu kejadian ini.
export async function onExamLockLost(
  handler: (reason: ExamLockLostReason) => void
): Promise<() => void> {
  if (!isNativeApp()) return () => {}
  try {
    const h = await ExamLock.addListener('lockLost', (e) => handler(e?.reason ?? 'unpinned'))
    return () => { h.remove().catch(() => {}) }
  } catch (e) {
    console.warn('[exam-lock] gagal berlangganan lockLost:', e)
    return () => {}
  }
}
