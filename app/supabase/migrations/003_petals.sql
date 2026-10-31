-- Petal settings. Motion changes what the wearer feels, so it joins the fields only the wearer may change.
-- Look changes nothing about how the mask works, so a helper may edit it, and a public link may show it.
create or replace function public.feedback_fields(data jsonb) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'cues', data -> 'cues',
    'hapticByZone', data -> 'hapticByZone',
    'motion', data -> 'motion',
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

create or replace function public.get_shared_configuration(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select feedback_fields(v.data) || jsonb_build_object(
    'schemaVersion', v.data -> 'schemaVersion',
    'id', c.id,
    'name', c.name,
    'updatedAt', c.updated_at,
    'enabledZones', v.data -> 'enabledZones',
    'look', v.data -> 'look'
  )
  from configurations c
  join configuration_versions v on v.configuration_id = c.id
  where c.id = p_id and c.shared
  order by v.version desc
  limit 1;
$$;
