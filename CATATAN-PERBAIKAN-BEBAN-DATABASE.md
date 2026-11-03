# Perbaikan beban database (3 Nov 2026)

Timpa file berikut di repo (path sama persis dengan di dalam zip):

| File | Perubahan |
|---|---|
| `src/lib/supabase.ts` | Timeout 30 detik untuk setiap permintaan ke Supabase dari server. Env opsional `SUPABASE_FETCH_TIMEOUT_MS`. |
| `src/lib/metrik.ts` | Penulisan `metrik_sistem` digabung: banyak baris ditulis dalam satu INSERT. |
| `src/lib/dipantau.ts` | Log error dipotong 300 karakter (tidak lagi menumpahkan HTML Cloudflare). |
| `vercel.json` | `maxDuration` 30 dtk untuk `/api/siswa/ujian/sync` dan `/cek-sesi`. |

## Yang TIDAK diubah
Logika bisnis, fungsi SQL (`sync_jawaban_atomik` dll), aturan revisi/kunci/device,
heartbeat, interval sync dan polling di sisi siswa. Tidak perlu migrasi SQL.

## Catatan perilaku
- Timeout: permintaan database yang macet kini gagal dalam <=30 dtk sebagai error biasa
  (bukan menggantung 300 dtk). Route berat (backup/restore/impor) punya maxDuration 60 dtk,
  jadi 30 dtk dipilih agar tidak memotong pekerjaan normal. Jika ada operasi sah yang lebih
  lama dari 30 dtk per permintaan, naikkan lewat `SUPABASE_FETCH_TIMEOUT_MS`.
- Metrik: isi data sama (satu baris per request, `created_at` dicatat saat request selesai),
  sehingga panel monitoring tidak berubah. Saat trafik sepi baris ditulis langsung; saat ramai
  digabung. Jika trafik berhenti tepat setelah satu penulisan, sisa baris (maks ~25) baru
  tertulis pada request berikutnya di instance yang sama.

## Verifikasi
`npx tsc --noEmit` lulus. Simulasi: 60 request -> 3 INSERT (sebelumnya 60), created_at terisi,
status error tercatat.

## Yang masih perlu kamu lakukan (bukan kode)
Naikkan compute Supabase (Pro + Small/Medium) sebelum ujian serentak, lalu uji loadtest
bertahap sambil memantau CPU di Reports -> Database.
