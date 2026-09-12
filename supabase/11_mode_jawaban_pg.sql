-- =============================================================================
-- FITUR BARU: Mode Jawaban (DIGITAL / KERTAS) untuk paket soal PG.
--
-- Sebelumnya kolom mode_jawaban cuma ada di tabel paket_essay. Paket soal PG
-- (paket_soal) tidak punya konsep ini sama sekali, padahal guru butuh bisa
-- menentukan (dan mengubah) apakah siswa menjawab PG secara digital di
-- aplikasi atau di kertas.
--
-- Aturan pengubahan mode_jawaban (ditegakkan di API, bukan di DB):
--   - Status DRAFT / MENUNGGU / DITOLAK -> guru boleh mengubah mode kapan
--     saja (selama sesi ujian mapel+kelas itu belum pernah dibuka).
--   - Status DISETUJUI -> guru TIDAK bisa mengubah mode langsung. Admin
--     harus membatalkan persetujuan (aksi BATAL_SETUJUI di
--     /api/admin/soal, sudah ada) supaya paket kembali ke DRAFT, baru guru
--     bisa mengubah mode.
--   - Kapan pun, kalau sesi ujian untuk mapel+kelas itu SUDAH PERNAH dibuka
--     (BERJALAN atau SELESAI), mode tidak bisa diubah sama sekali — lihat
--     cekSesiMapelKelasSudahMulai() di src/lib/sesi-kelas.ts.
-- =============================================================================

ALTER TABLE paket_soal
  ADD COLUMN IF NOT EXISTS mode_jawaban TEXT DEFAULT 'DIGITAL';

-- Data lama (dibuat sebelum kolom ini ada) dianggap DIGITAL, karena itu
-- perilaku aplikasi sebelum fitur mode kertas/digital untuk PG ada.
UPDATE paket_soal SET mode_jawaban = 'DIGITAL' WHERE mode_jawaban IS NULL;
