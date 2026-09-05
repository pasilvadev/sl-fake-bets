-- =============================================================================
-- Avatars bucket (UX-022's "plus custom image upload").
--
-- Declared as a migration rather than a config.toml [storage.buckets] block on
-- purpose: design-stack §Hosting requires the same schema and migrations to
-- carry local → hosted unchanged (the ARC-011→012 path). A config.toml bucket
-- exists only on a developer machine and would have to be recreated by hand in
-- the hosted project.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  -- Public read. Avatars render next to every name in every bet and comment
  -- (UX-022), so private objects would mean a signed URL per avatar per render
  -- — needless latency on exactly the low-end devices UX-006 protects, and more
  -- moving parts than ARC-003 tolerates. Nothing secret lives in this bucket.
  true,
  2097152,  -- 2 MiB. Profile pictures, not photo storage (UX-006).
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

-- Path convention: `<user uuid>/<filename>`. The first path segment IS the
-- authorization boundary — it is what lets a write policy tell "my avatar" from
-- "someone else's" without a lookup table.

create policy avatars_read_anyone on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'avatars');

create policy avatars_insert_own_folder on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Re-uploading a new avatar overwrites the old object, so update is part of the
-- normal flow, not an edge case.
create policy avatars_update_own_folder on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy avatars_delete_own_folder on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
