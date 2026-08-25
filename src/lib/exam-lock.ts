import { Capacitor, registerPlugin } from '@capacitor/core'

// ── Jembatan ke proteksi native Android (immersive mode + screen pinning) ──
// Lihat android/app/src/main/java/com/smartexam/mtsalkhairaat/ExamLockPlugin.java
// untuk implementasi native-nya.
//
// PENTING: fungsi di file ini SELALU aman dipanggil dari mana pun, termasuk
// saat dibuka lewat browser biasa (bukan APK) — di situ Capacitor.isNativePlatform()
// akan bernilai false dan fungsi langsung berhenti tanpa melakukan apa pun,
// jadi perilaku Fullscreen API web yang sudah ada (lihat requestFullscreen di
// src/app/siswa/ujian/page.tsx) TIDAK terganggu sama sekali oleh file ini.
interface ExamLockPluginApi {
  startLock(): Promise<{ locked: boolean }>
  endLock(): Promise<{ locked: boolean }>
}

const ExamLock = registerPlugin<ExamLockPluginApi>('ExamLock')

export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

export async function startExamLock(): Promise<void> {
  if (!isNativeApp()) return
  try {
    await ExamLock.startLock()
  } catch (e) {
    // Sengaja tidak dilempar ke pemanggil — kalau native lock gagal, ujian
    // tetap harus bisa dilanjutkan siswa (proteksi berkurang, bukan ujian
    // macet total). Immersive mode & Fullscreen API web tetap jalan sebagai
    // lapisan cadangan.
    console.warn('[exam-lock] startLock gagal:', e)
  }
}

export async function endExamLock(): Promise<void> {
  if (!isNativeApp()) return
  try {
    await ExamLock.endLock()
  } catch (e) {
    console.warn('[exam-lock] endLock gagal:', e)
  }
}
