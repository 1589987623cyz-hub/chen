-- EX-SENSE schema: configurations, immutable versions, helpers, and access rules.
create extension if not exists pgcrypto;

create table public.configurations (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  updated_at timestamptz not null default now()
);

create table public.configuration_versions (
  configuration_id uuid not null references public.configurations (id) on delete cascade,
  version integer not null,
  data jsonb not null,
  author_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  primary key (configuration_id, version)
);

create table public.collaborators (
  id uuid primary key default gen_random_uuid(),
  configuration_id uuid not null references public.configurations (id) on delete cascade,
  helper_id uuid references auth.users (id) on delete cascade,
  helper_email text,
  status text not null default 'pending' check (status in ('pending', 'active', 'revoked')),
  token_hash bytea unique,
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);

alter table public.configurations enable row level security;
alter table public.configuration_versions enable row level security;
alter table public.collaborators enable row level security;

create function public.is_owner(config uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from configurations where id = config and owner_id = auth.uid());
$$;

create function public.is_helper(config uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from collaborators
    where configuration_id = config and helper_id = auth.uid() and status = 'active'
  );
$$;

create policy "read own or helped configurations" on public.configurations
  for select using (public.is_owner(id) or public.is_helper(id));
create policy "owner deletes configuration" on public.configurations
  for delete using (owner_id = auth.uid());

create policy "read versions of accessible configurations" on public.configuration_versions
  for select using (public.is_owner(configuration_id) or public.is_helper(configuration_id));

create policy "owner reads collaborators" on public.collaborators
  for select using (public.is_owner(configuration_id));
create policy "owner revokes collaborators" on public.collaborators
  for update using (public.is_owner(configuration_id)) with check (status = 'revoked');

-- Writes go through this function so the feedback rule cannot be bypassed from the client.
create function public.feedback_fields(data jsonb) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'cues', data -> 'cues',
    'hapticByZone', data -> 'hapticByZone',
    'feedbackConfirmed', data -> 'feedbackConfirmed',
    'values', jsonb_build_object(
      'pmThreshold', data #> '{values,pmThreshold}',
      'uvThreshold', data #> '{values,uvThreshold}',
      'hapticLevel', data #> '{values,hapticLevel}',
      'thermalLevel', data #> '{values,thermalLevel}',
      'cueDuration', data #> '{values,cueDuration}',
      'distanceFar', data #> '{values,distanceFar}',
      'distanceMid', data #> '{values,distanceMid}',
      'distanceNear', data #> '{values,distanceNear}',
      'pulseSlow', data #> '{values,pulseSlow}',
      'pulseFast', data #> '{values,pulseFast}'
    )
  );
$$;

create function public.save_configuration(p_id uuid, p_name text, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  latest record;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  if not exists (select 1 from configurations where id = p_id) then
    insert into configurations (id, owner_id, name) values (p_id, auth.uid(), p_name);
  elsif not (is_owner(p_id) or is_helper(p_id)) then
    raise exception 'no access';
  end if;

  select version, data into latest from configuration_versions
    where configuration_id = p_id order by version desc limit 1;

  if not is_owner(p_id) and feedback_fields(latest.data) is distinct from feedback_fields(p_data) then
    raise exception 'feedback settings can only be changed by the wearer';
  end if;

  insert into configuration_versions (configuration_id, version, data, author_id)
    values (p_id, coalesce(latest.version, 0) + 1, p_data, auth.uid());
  update configurations set name = p_name, updated_at = now() where id = p_id;
end;
$$;

create function public.create_invite(p_configuration_id uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  token text := encode(gen_random_bytes(32), 'hex');
begin
  if not is_owner(p_configuration_id) then
    raise exception 'owner only';
  end if;
  insert into collaborators (configuration_id, token_hash)
    values (p_configuration_id, digest(token, 'sha256'));
  return token;
end;
$$;

create function public.accept_invite(p_token text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  invite record;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  select * into invite from collaborators
    where token_hash = digest(p_token, 'sha256') and status = 'pending' and expires_at > now();
  if invite is null then
    raise exception 'invalid invite';
  end if;
  update collaborators
    set helper_id = auth.uid(), helper_email = auth.email(), status = 'active', token_hash = null
    where id = invite.id;
  return invite.configuration_id;
end;
$$;

create function public.delete_my_data() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from configurations where owner_id = auth.uid();
  delete from collaborators where helper_id = auth.uid();
  delete from configuration_versions where author_id = auth.uid();
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.save_configuration, public.create_invite, public.accept_invite, public.delete_my_data from anon, public;
grant execute on function public.save_configuration, public.create_invite, public.accept_invite, public.delete_my_data to authenticated;
