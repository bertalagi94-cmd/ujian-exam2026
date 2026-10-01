'use client'

import { useSyncExternalStore } from 'react'
import { Lock } from 'lucide-react'
import {
  startExamLock,
  getExamLockStatus,
  subscribeExamLockStatus,
  WAJIB_KUNCI_NATIVE,
  type ExamLockStatus,
} from '@/lib/exam-lock'

// Layar penutup "Penguncian layar diperlukan" khusus APK Android.
//
// Selama ujian berlangsung di APK, soal hanya boleh terlihat kalau layar
// sudah tersemat (screen pinning). Saat pin aktif, sistem Android sendiri
// menonaktifkan tombol Home/Recent, notifikasi, dan tarik layar dari atas;
// tombol Back diblokir oleh MainActivity. Status pin berasal dari plugin
// native lewat src/lib/exam-lock.ts.
//
// No-op total di browser biasa dan di luar fase ujian (status 'idle').
// z-index 9990 sengaja DI BAWAH overlay pelanggaran/sync (9999) supaya input
// kode reset tetap bisa dipakai kalau pin terlepas akibat pelanggaran.
export function KunciLayarWajib() {
  const status = useSyncExternalStore<ExamLockStatus>(
    subscribeExamLockStatus,
    getExamLockStatus,
    () => 'idle'
  )

  if (!WAJIB_KUNCI_NATIVE) return null
  if (status === 'idle' || status === 'aktif') return null

  const menunggu = status === 'menunggu'

  return (
    <div
      className="fixed inset-0 z-[9990] flex flex-col items-center justify-center"
      style={{ background: 'rgba(15,23,42,0.98)' }}
      role="alertdialog"
      aria-modal="true"
    >
      <div className="max-w-sm w-full mx-4 bg-white rounded-2xl p-8 text-center shadow-2xl">
        <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Lock className="w-8 h-8 text-blue-600" />
        </div>
        <h2 className="text-lg font-bold text-slate-900 mb-2">Penguncian Layar Diperlukan</h2>
        <p className="text-sm text-slate-600 mb-3">
          {menunggu
            ? 'Menunggu persetujuan Anda. Jika Android menampilkan dialog penyematan layar, setujui dialog tersebut.'
            : 'Soal ujian hanya tampil jika layar disematkan. Tekan tombol di bawah, lalu setujui dialog penyematan layar dari Android.'}
        </p>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-left">
          <p className="text-xs text-amber-700">
            Selama ujian, tombol Kembali, Home, dan notifikasi dinonaktifkan. Semuanya aktif lagi
            setelah ujian selesai. <strong>Waktu ujian tetap berjalan.</strong> Hubungi pengawas
            jika layar tidak bisa disematkan.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { void startExamLock() }}
          disabled={menunggu}
          className="btn-primary w-full"
        >
          {menunggu ? 'Menunggu persetujuan...' : 'Aktifkan Penguncian Layar'}
        </button>
      </div>
    </div>
  )
}
