-- Public read-only links. Measurements stay private: only what the viewer needs leaves the database.
alter table public.configurations add column shared boolean not null default false;

create function public.set_configuration_shared(p_id uuid, p_shared boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner(p_id) then
    raise exception 'owner only';
  end if;
  update configurations set shared = p_shared where id = p_id;
end;
$$;

create function public.get_shared_configuration(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select feedback_fields(v.data) || jsonb_build_object(
    'schemaVersion', v.data -> 'schemaVersion',
    'id', c.id,
    'name', c.name,
    'updatedAt', c.updated_at,
    'enabledZones', v.data -> 'enabledZones'
  )
  from configurations c
  join configuration_versions v on v.configuration_id = c.id
  where c.id = p_id and c.shared
  order by v.version desc
  limit 1;
$$;

revoke all on function public.set_configuration_shared, public.get_shared_configuration from anon, public;
grant execute on function public.set_configuration_shared to authenticated;
grant execute on function public.get_shared_configuration to anon, authenticated;
