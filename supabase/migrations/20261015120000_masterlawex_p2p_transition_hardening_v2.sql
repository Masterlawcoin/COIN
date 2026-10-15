create index if not exists ml_ex_auth_challenges_wallet_created_idx on public.ml_ex_auth_challenges (wallet, created_at desc);
create index if not exists ml_ex_sessions_expires_idx on public.ml_ex_sessions (expires_at) where revoked_at is null;
create unique index if not exists ml_ex_disputes_one_open_idx on public.ml_ex_p2p_disputes (trade_id) where status in ('open','review');

create or replace function public.ml_ex_p2p_transition(
  p_trade uuid,
  p_requester text,
  p_action text,
  p_reason text default null,
  p_description text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_trade public.ml_ex_p2p_trades%rowtype;
  v_requester text := lower(coalesce(p_requester,''));
  v_dispute uuid;
begin
  select * into v_trade
  from public.ml_ex_p2p_trades
  where id = p_trade
  for update;

  if not found then raise exception 'trade_not_found'; end if;
  if v_requester = '' then raise exception 'unauthorized'; end if;

  if p_action = 'mark_paid' then
    if v_requester <> lower(v_trade.buyer_wallet) then raise exception 'unauthorized'; end if;
    if v_trade.status <> 'reserved' then raise exception 'invalid_transition'; end if;
    if now() > v_trade.deadline then raise exception 'deadline_passed'; end if;

    update public.ml_ex_p2p_trades
      set status='payment_marked', updated_at=now()
      where id=p_trade;

    return jsonb_build_object('ok',true,'action','mark_paid','state','payment_marked');

  elsif p_action = 'release' then
    if v_requester <> lower(v_trade.seller_wallet) then raise exception 'unauthorized'; end if;
    if v_trade.status <> 'payment_marked' then raise exception 'invalid_transition'; end if;

    update public.ml_ex_p2p_trades
      set status='released', updated_at=now()
      where id=p_trade;

    update public.ml_ex_p2p_profiles
      set completed_trades=completed_trades+1,
          reputation=least(100::numeric,reputation+0.2),
          updated_at=now()
      where wallet in (lower(v_trade.buyer_wallet), lower(v_trade.seller_wallet));

    return jsonb_build_object('ok',true,'action','release','state','released');

  elsif p_action = 'dispute' then
    if v_requester <> lower(v_trade.buyer_wallet) and v_requester <> lower(v_trade.seller_wallet) then
      raise exception 'unauthorized';
    end if;
    if v_trade.status not in ('reserved','payment_marked') then raise exception 'invalid_transition'; end if;

    insert into public.ml_ex_p2p_disputes(trade_id,opened_by,reason_category,description)
      values(p_trade,v_requester,left(coalesce(nullif(p_reason,''),'OTHER'),40),left(coalesce(p_description,''),1000))
      returning id into v_dispute;

    update public.ml_ex_p2p_trades
      set status='disputed', updated_at=now()
      where id=p_trade;

    return jsonb_build_object('ok',true,'action','dispute','state','disputed','dispute_id',v_dispute);
  end if;

  raise exception 'unsupported_action';
end;
$function$;

revoke all on function public.ml_ex_p2p_transition(uuid,text,text,text,text) from public;
revoke all on function public.ml_ex_p2p_transition(uuid,text,text,text,text) from anon, authenticated;
grant execute on function public.ml_ex_p2p_transition(uuid,text,text,text,text) to service_role;
