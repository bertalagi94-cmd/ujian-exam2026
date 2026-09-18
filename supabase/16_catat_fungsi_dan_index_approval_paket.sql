-- =============================================================================
-- Migrasi 16: Catat fungsi set_status_paket_soal/essay + unique index approval
--
-- LATAR BELAKANG (temuan audit — lihat percakapan pengembangan):
-- src/app/api/admin/soal/route.ts dan src/app/api/admin/soal-essay/route.ts
-- sama-sama memanggil db.rpc('set_status_paket_soal', ...) / 'set_status_paket_essay'
-- untuk menyetujui/menolak paket soal & essay secara ATOMIK (satu transaksi,
-- row lock) sambil otomatis menurunkan paket lain yang DISETUJUI untuk
-- mapel+kelas yang sama ke DRAFT. Komentar di kedua file itu MENGKLAIM fungsi
-- ini dan sebuah unique partial index dibuat oleh migrasi 14
-- (14_snapshot_paket_dan_transaksi_atomik.sql).
--
-- MASALAHNYA: isi migrasi 14 yang sebenarnya HANYA menambah kolom
-- paket_soal_id/paket_essay_id ke sesi_ujian — TIDAK berisi fungsi maupun
-- index yang diklaim. Setelah dicek langsung ke database Supabase produksi
-- (lewat pg_proc & pg_indexes), fungsi dan index tersebut TERNYATA memang
-- ADA dan AKTIF — tapi dibuat langsung lewat SQL Editor Supabase, tidak
-- pernah disalin ke file migrasi mana pun di repo ini.
--
-- DAMPAK sebelum migrasi ini: kalau database dibuat ulang dari nol dengan
-- menjalankan seluruh file migrasi 01-15 (skenario persis yang migrasi 14
-- sendiri tulis untuk dicegah, tapi untuk bagian ini luput), tombol
-- Setujui/Tolak/Batal Setujui paket soal & essay di halaman Admin akan
-- langsung gagal dengan error "function does not exist" — bank soal admin
-- lumpuh total, silent, tanpa peringatan di kode.
--
-- Migrasi ini MEREKAM ULANG definisi fungsi & index yang sudah berjalan di
-- produksi, disalin PERSIS (bukan ditulis ulang dari tebakan) dari hasil
-- pg_get_functiondef() dan pg_indexes pada database yang sama. Aman
-- dijalankan berkali-kali: CREATE OR REPLACE FUNCTION menimpa definisi yang
-- sama (no-op kalau tidak berubah), dan CREATE UNIQUE INDEX IF NOT EXISTS
-- dilewati kalau index sudah ada.
-- =============================================================================

-- ── Fungsi approval paket_soal (PG) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_status_paket_soal(p_paket_id text, p_new_status text, p_catatan text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mapel_id TEXT;
  v_kelas_id TEXT;
  v_demoted_ids TEXT[];
BEGIN
  IF p_new_status NOT IN ('DISETUJUI', 'DITOLAK', 'DRAFT') THEN
    RAISE EXCEPTION 'set_status_paket_soal: status "%" tidak valid', p_new_status;
  END IF;

  SELECT mapel_id, kelas_id INTO v_mapel_id, v_kelas_id
  FROM paket_soal WHERE id = p_paket_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_status_paket_soal: paket_soal % tidak ditemukan', p_paket_id;
  END IF;

  IF p_new_status = 'DISETUJUI' THEN
    -- Kunci semua paket lain di mapel+kelas yang sama supaya approval dua
    -- paket berbeda untuk kombinasi yang sama tidak bisa lolos bersamaan.
    PERFORM 1 FROM paket_soal
      WHERE mapel_id = v_mapel_id AND kelas_id = v_kelas_id
      FOR UPDATE;

    SELECT ARRAY_AGG(id) INTO v_demoted_ids
    FROM paket_soal
    WHERE mapel_id = v_mapel_id AND kelas_id = v_kelas_id
      AND status = 'DISETUJUI' AND id <> p_paket_id;

    IF v_demoted_ids IS NOT NULL THEN
      UPDATE paket_soal
      SET status = 'DRAFT', notif_dibaca = false,
          catatan = 'Otomatis dikembalikan ke draft karena paket lain untuk mapel+kelas ini disetujui.'
      WHERE id = ANY(v_demoted_ids);

      UPDATE soal SET status = 'DRAFT'
      WHERE paket_id = ANY(v_demoted_ids) AND status = 'DISETUJUI';
    END IF;
  END IF;

  UPDATE paket_soal
  SET status = p_new_status, catatan = p_catatan, notif_dibaca = false
  WHERE id = p_paket_id;

  UPDATE soal SET status = p_new_status WHERE paket_id = p_paket_id;

  RETURN COALESCE(array_length(v_demoted_ids, 1), 0);
END;
$function$;

-- ── Fungsi approval paket_essay ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_status_paket_essay(p_paket_id text, p_new_status text, p_catatan text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mapel_id TEXT;
  v_kelas_id TEXT;
  v_demoted_ids TEXT[];
BEGIN
  IF p_new_status NOT IN ('DISETUJUI', 'DITOLAK', 'DRAFT') THEN
    RAISE EXCEPTION 'set_status_paket_essay: status "%" tidak valid', p_new_status;
  END IF;

  SELECT mapel_id, kelas_id INTO v_mapel_id, v_kelas_id
  FROM paket_essay WHERE id = p_paket_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_status_paket_essay: paket_essay % tidak ditemukan', p_paket_id;
  END IF;

  IF p_new_status = 'DISETUJUI' THEN
    PERFORM 1 FROM paket_essay
      WHERE mapel_id = v_mapel_id AND kelas_id = v_kelas_id
      FOR UPDATE;

    SELECT ARRAY_AGG(id) INTO v_demoted_ids
    FROM paket_essay
    WHERE mapel_id = v_mapel_id AND kelas_id = v_kelas_id
      AND status = 'DISETUJUI' AND id <> p_paket_id;

    IF v_demoted_ids IS NOT NULL THEN
      UPDATE paket_essay
      SET status = 'DRAFT', notif_dibaca = false,
          catatan = 'Otomatis dikembalikan ke draft karena paket lain untuk mapel+kelas ini disetujui.'
      WHERE id = ANY(v_demoted_ids);

      UPDATE soal_essay SET status = 'DRAFT'
      WHERE paket_essay_id = ANY(v_demoted_ids) AND status = 'DISETUJUI';
    END IF;
  END IF;

  UPDATE paket_essay
  SET status = p_new_status, catatan = p_catatan, notif_dibaca = false
  WHERE id = p_paket_id;

  UPDATE soal_essay SET status = p_new_status WHERE paket_essay_id = p_paket_id;

  RETURN COALESCE(array_length(v_demoted_ids, 1), 0);
END;
$function$;

-- ── Unique partial index — penjaga terakhir di level database ──────────────
-- Membuat mustahil secara struktur ada 2 baris DISETUJUI untuk mapel+kelas
-- yang sama, apa pun yang terjadi di level aplikasi (bug, race condition,
-- atau siapa pun yang menulis langsung ke database di luar fungsi di atas).
CREATE UNIQUE INDEX IF NOT EXISTS uq_paket_soal_disetujui_per_kelas
  ON public.paket_soal USING btree (mapel_id, kelas_id)
  WHERE (status = 'DISETUJUI'::text);

CREATE UNIQUE INDEX IF NOT EXISTS uq_paket_essay_disetujui_per_kelas
  ON public.paket_essay USING btree (mapel_id, kelas_id)
  WHERE (status = 'DISETUJUI'::text);
