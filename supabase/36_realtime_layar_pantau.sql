-- Layar Pantau: aktifkan Supabase Realtime untuk tabel yang dipantau
-- (/api/layar-pantau/stream). Aman dijalankan berulang kali.
-- Tanpa ini, papan hanya ter-update lewat jaring pengaman 8 detik.
do $$
declare t text;
begin
  foreach t in array array['jawaban', 'sesi_ujian', 'siswa_ujian'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
