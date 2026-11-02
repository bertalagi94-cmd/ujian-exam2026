import { after } from 'next/server'
import { SupabaseClient } from '@supabase/supabase-js'
import { generateId } from '@/lib/utils'

// Helper bersama untuk mencatat event ke `log_aktivitas`.
//
// SEBELUMNYA: satu-satunya tempat di seluruh aplikasi yang pernah menulis
// ke tabel ini adalah endpoint login (aksi='LOGIN') — jadi Network Flow
// Monitor di admin cuma pernah bisa menampilkan "siapa login", tidak
// pernah aktivitas SESUDAHNYA (guru buat soal, siswa mulai/submit ujian,
// dst), walau kode monitor-nya (detectRole) sudah mengantisipasi aksi
// seperti BUAT_SOAL / MULAI_UJIAN / SUBMIT_UJIAN.
//
// Dipanggil TANPA `await` di titik-titik aktivitas nyata (lihat
// pemanggilnya) — sengaja fire-and-forget seperti pola `catatLoginAktivitas`
// di auth/login/route.ts, supaya pencatatan log TIDAK PERNAH memperlambat
// atau menggagalkan response utama ke pengguna.
export function catatAktivitas(
  db: SupabaseClient<any>,
  userId: string,
  aksi: string,
  detail: string
) {
  const tulis = async () => {
    try {
      const { error } = await db
        .from('log_aktivitas')
        .insert({ id: generateId('LOG'), user_id: userId, aksi, detail })
      if (error) console.error(`Gagal catat log_aktivitas (${aksi}):`, error)
    } catch (e) {
      console.error(`Gagal catat log_aktivitas (${aksi}):`, e)
    }
  }
  // PERBAIKAN: di Vercel (serverless), promise yang dibiarkan menggantung
  // setelah respons terkirim bisa dihentikan sebelum selesai, sehingga jejak
  // audit (SUBMIT_UJIAN, SYNC_TERLAMBAT, dst) hilang diam-diam. after() =
  // waitUntil: penulisan tetap dijalankan SETELAH respons dikirim (tidak
  // memperlambat pengguna) tetapi dijamin selesai. Di luar konteks request
  // after() melempar galat; saat itu jatuh ke perilaku lama.
  try {
    after(tulis)
  } catch {
    void tulis()
  }
}
