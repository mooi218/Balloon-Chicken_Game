create or replace function public.set_turn_event(p_room_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_happening_roll double precision := random();
  v_event_roll double precision;
  v_event_type text := null;
  v_required integer := 1;
begin
  if v_happening_roll < 0.03 then
    v_event_roll := random();
    if v_event_roll < 0.333 then
      v_event_type := 'force';
      v_required := floor(random() * 4)::integer + 2;
    elsif v_event_roll < 0.666 then
      v_event_type := 'powerful';
    else
      v_event_type := 'giant';
    end if;
  end if;

  update public.rooms
  set current_player_id = p_player_id,
      turn_pumps = 0,
      event_type = v_event_type,
      event_required_pumps = v_required,
      version = version + 1,
      updated_at = now()
  where id = p_room_id;
end;
$$;
