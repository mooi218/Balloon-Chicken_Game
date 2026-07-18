create extension if not exists pgcrypto;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (char_length(code) = 6),
  host_token_hash text not null,
  host_player_id uuid,
  status text not null default 'waiting' check (status in ('waiting', 'playing', 'finished')),
  current_player_id uuid,
  loser_player_id uuid,
  total_pumps integer not null default 0 check (total_pumps >= 0),
  risk_bps integer not null default 0 check (risk_bps between 0 and 10000),
  turn_pumps integer not null default 0 check (turn_pumps >= 0),
  event_type text check (event_type in ('force', 'powerful', 'giant')),
  event_required_pumps integer not null default 1 check (event_required_pumps between 1 and 5),
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 18),
  player_token_hash text not null,
  seat integer not null check (seat >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (room_id, player_token_hash),
  unique (room_id, seat)
);

alter table public.rooms
  add constraint rooms_host_player_fk foreign key (host_player_id) references public.players(id) on delete set null;
alter table public.rooms
  add constraint rooms_current_player_fk foreign key (current_player_id) references public.players(id) on delete set null;
alter table public.rooms
  add constraint rooms_loser_player_fk foreign key (loser_player_id) references public.players(id) on delete set null;

create index if not exists players_room_active_seat_idx on public.players(room_id, active, seat);
create index if not exists rooms_code_idx on public.rooms(code);

create or replace function public.token_digest(p_token text)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(digest(p_token, 'sha256'), 'hex');
$$;

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

create or replace function public.advance_turn(p_room_id uuid, p_current_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_seat integer;
  v_next_player_id uuid;
begin
  select seat into v_current_seat
  from public.players
  where id = p_current_player_id and room_id = p_room_id;

  select id into v_next_player_id
  from public.players
  where room_id = p_room_id and active = true and seat > v_current_seat
  order by seat
  limit 1;

  if v_next_player_id is null then
    select id into v_next_player_id
    from public.players
    where room_id = p_room_id and active = true
    order by seat
    limit 1;
  end if;

  perform public.set_turn_event(p_room_id, v_next_player_id);
end;
$$;

create or replace function public.create_room(p_nickname text, p_player_token text)
returns table(room_code text, player_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_player_id uuid;
  v_code text;
  v_attempt integer := 0;
  v_index integer;
begin
  if coalesce(char_length(trim(p_nickname)), 0) = 0 or coalesce(char_length(p_player_token), 0) < 16 then
    raise exception 'ニックネームまたは参加情報が不正です。';
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_code := '';
    for v_index in 1..6 loop
      v_code := v_code || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', floor(random() * 32)::integer + 1, 1);
    end loop;
    exit when not exists (select 1 from public.rooms where code = v_code);
    if v_attempt > 20 then raise exception '部屋コードを発行できませんでした。もう一度お試しください。'; end if;
  end loop;

  insert into public.rooms (code, host_token_hash)
  values (v_code, public.token_digest(p_player_token))
  returning id into v_room_id;

  insert into public.players (room_id, nickname, player_token_hash, seat)
  values (v_room_id, left(trim(p_nickname), 18), public.token_digest(p_player_token), 0)
  returning id into v_player_id;

  update public.rooms set host_player_id = v_player_id where id = v_room_id;
  return query select v_code, v_player_id;
end;
$$;

create or replace function public.join_room(p_room_code text, p_nickname text, p_player_token text)
returns table(room_code text, player_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_player_id uuid;
  v_seat integer;
  v_count integer;
begin
  if coalesce(char_length(trim(p_nickname)), 0) = 0 or coalesce(char_length(p_player_token), 0) < 16 then
    raise exception 'ニックネームまたは参加情報が不正です。';
  end if;

  select * into v_room from public.rooms where code = upper(trim(p_room_code)) for update;
  if not found then raise exception '部屋が見つかりません。コードを確認してください。'; end if;
  if v_room.status <> 'waiting' then raise exception 'この部屋のゲームはすでに始まっています。'; end if;

  select id into v_player_id
  from public.players
  where room_id = v_room.id and player_token_hash = public.token_digest(p_player_token);
  if v_player_id is not null then return query select v_room.code, v_player_id; return; end if;

  select count(*), coalesce(max(seat), -1) + 1 into v_count, v_seat
  from public.players where room_id = v_room.id and active = true;
  if v_count >= 8 then raise exception 'この部屋は満員です。'; end if;

  insert into public.players (room_id, nickname, player_token_hash, seat)
  values (v_room.id, left(trim(p_nickname), 18), public.token_digest(p_player_token), v_seat)
  returning id into v_player_id;

  update public.rooms set version = version + 1, updated_at = now() where id = v_room.id;
  return query select v_room.code, v_player_id;
end;
$$;

create or replace function public.start_game(p_room_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_first_player uuid;
  v_count integer;
begin
  select * into v_room from public.rooms where code = upper(trim(p_room_code)) for update;
  if not found then raise exception '部屋が見つかりません。'; end if;
  if v_room.host_token_hash <> public.token_digest(p_player_token) then raise exception 'ゲームを開始できるのは部屋主だけです。'; end if;

  select count(*) into v_count from public.players where room_id = v_room.id and active = true;
  select id into v_first_player from public.players where room_id = v_room.id and active = true order by seat limit 1;
  if v_count < 2 then raise exception '2人以上参加すると開始できます。'; end if;

  update public.rooms
  set status = 'playing', total_pumps = 0, risk_bps = 0, loser_player_id = null,
      version = version + 1, updated_at = now()
  where id = v_room.id;
  perform public.set_turn_event(v_room.id, v_first_player);
  select * into v_room from public.rooms where id = v_room.id;
  return to_jsonb(v_room);
end;
$$;

create or replace function public.inflate_balloon(p_room_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_actor_id uuid;
  v_new_total integer;
  v_increment integer;
  v_new_risk integer;
  v_new_turn_pumps integer;
  v_is_burst boolean;
begin
  select * into v_room from public.rooms where code = upper(trim(p_room_code)) for update;
  if not found then raise exception '部屋が見つかりません。'; end if;
  if v_room.status <> 'playing' then raise exception 'ゲームは進行中ではありません。'; end if;

  select id into v_actor_id from public.players
  where id = v_room.current_player_id and room_id = v_room.id and active = true
    and player_token_hash = public.token_digest(p_player_token);
  if v_actor_id is null then raise exception '今はあなたの手番ではありません。'; end if;

  v_new_total := v_room.total_pumps + 1;
  if v_room.event_type = 'giant' then
    v_increment := (floor(random() * 5)::integer + 1) * 100;
  elsif v_new_total <= 50 then
    v_increment := case when v_room.event_type = 'powerful' then 2 else 1 end;
  elsif v_new_total < 150 then
    v_increment := case when v_room.event_type = 'powerful' then 20 else 10 end;
  else
    v_increment := case when v_room.event_type = 'powerful' then 40 else 20 end;
  end if;

  v_new_risk := least(10000, v_room.risk_bps + v_increment);
  v_new_turn_pumps := v_room.turn_pumps + 1;
  v_is_burst := random() < (v_new_risk::double precision / 10000.0);

  if v_is_burst then
    update public.rooms
    set status = 'finished', loser_player_id = v_actor_id, total_pumps = v_new_total,
        risk_bps = v_new_risk, turn_pumps = v_new_turn_pumps,
        version = version + 1, updated_at = now()
    where id = v_room.id;
  else
    update public.rooms
    set total_pumps = v_new_total, risk_bps = v_new_risk, turn_pumps = v_new_turn_pumps,
        version = version + 1, updated_at = now()
    where id = v_room.id;
    if v_room.event_type = 'giant' then perform public.advance_turn(v_room.id, v_actor_id); end if;
  end if;

  select * into v_room from public.rooms where id = v_room.id;
  return to_jsonb(v_room);
end;
$$;

create or replace function public.pass_turn(p_room_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_actor_id uuid;
begin
  select * into v_room from public.rooms where code = upper(trim(p_room_code)) for update;
  if not found then raise exception '部屋が見つかりません。'; end if;
  if v_room.status <> 'playing' then raise exception 'ゲームは進行中ではありません。'; end if;

  select id into v_actor_id from public.players
  where id = v_room.current_player_id and room_id = v_room.id and active = true
    and player_token_hash = public.token_digest(p_player_token);
  if v_actor_id is null then raise exception '今はあなたの手番ではありません。'; end if;
  if v_room.turn_pumps < v_room.event_required_pumps then
    raise exception 'このターンはあと%回、膨らませる必要があります。', v_room.event_required_pumps - v_room.turn_pumps;
  end if;

  perform public.advance_turn(v_room.id, v_actor_id);
  select * into v_room from public.rooms where id = v_room.id;
  return to_jsonb(v_room);
end;
$$;

create or replace function public.restart_game(p_room_code text, p_player_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_first_player uuid;
begin
  select * into v_room from public.rooms where code = upper(trim(p_room_code)) for update;
  if not found then raise exception '部屋が見つかりません。'; end if;
  if v_room.host_token_hash <> public.token_digest(p_player_token) then raise exception '再戦を開始できるのは部屋主だけです。'; end if;
  select id into v_first_player from public.players where room_id = v_room.id and active = true order by seat limit 1;

  update public.rooms
  set status = 'playing', total_pumps = 0, risk_bps = 0, turn_pumps = 0,
      loser_player_id = null, event_type = null, event_required_pumps = 1,
      version = version + 1, updated_at = now()
  where id = v_room.id;
  perform public.set_turn_event(v_room.id, v_first_player);
  select * into v_room from public.rooms where id = v_room.id;
  return to_jsonb(v_room);
end;
$$;

alter table public.rooms enable row level security;
alter table public.players enable row level security;

create policy "rooms are readable by room code" on public.rooms for select to anon, authenticated using (true);
create policy "players are readable in lobbies" on public.players for select to anon, authenticated using (true);

revoke all on public.rooms from anon, authenticated;
revoke all on public.players from anon, authenticated;
grant select on public.rooms to anon, authenticated;
grant select on public.players to anon, authenticated;

revoke all on function public.create_room(text, text) from public;
revoke all on function public.join_room(text, text, text) from public;
revoke all on function public.start_game(text, text) from public;
revoke all on function public.inflate_balloon(text, text) from public;
revoke all on function public.pass_turn(text, text) from public;
revoke all on function public.restart_game(text, text) from public;
revoke all on function public.set_turn_event(uuid, uuid) from public;
revoke all on function public.advance_turn(uuid, uuid) from public;
grant execute on function public.create_room(text, text) to anon, authenticated;
grant execute on function public.join_room(text, text, text) to anon, authenticated;
grant execute on function public.start_game(text, text) to anon, authenticated;
grant execute on function public.inflate_balloon(text, text) to anon, authenticated;
grant execute on function public.pass_turn(text, text) to anon, authenticated;
grant execute on function public.restart_game(text, text) to anon, authenticated;

alter table public.rooms replica identity full;
alter table public.players replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.rooms;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.players;
exception when duplicate_object then null;
end $$;
