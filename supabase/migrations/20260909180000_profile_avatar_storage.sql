-- "Meu Perfil": cada usuário edita os próprios dados. O nome já está coberto
-- (profiles_upd: id = auth.uid()). Falta a FOTO: o bucket agent-photos não tinha
-- policy de INSERT/UPDATE pra usuário comum (só service role) -> upload dava 403.
--
-- Convenção de path:
--   agent-photos/avatars/<uid>.<ext>   -> a pessoa gerencia a própria
--   agent-photos/agents/<agent_id>.*   -> admin gerencia as fotos dos agentes

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'objects' and policyname = 'avatar_self_all'
    ) then
        create policy avatar_self_all on storage.objects
            for all to authenticated
            using      (bucket_id = 'agent-photos' and name like 'avatars/' || auth.uid()::text || '.%')
            with check (bucket_id = 'agent-photos' and name like 'avatars/' || auth.uid()::text || '.%');
    end if;

    if not exists (
        select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'objects' and policyname = 'agent_photos_admin_all'
    ) then
        create policy agent_photos_admin_all on storage.objects
            for all to authenticated
            using      (bucket_id = 'agent-photos' and public.is_admin())
            with check (bucket_id = 'agent-photos' and public.is_admin());
    end if;
end $$;
