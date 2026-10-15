begin;

alter function public.ml_ex_p2p_take_offer(uuid, text, numeric)
  set search_path = '';

alter function public.ml_ex_p2p_cancel_reserved(uuid, text)
  set search_path = '';

revoke execute on function public.ml_ex_p2p_take_offer(uuid, text, numeric)
  from public, anon, authenticated;
revoke execute on function public.ml_ex_p2p_cancel_reserved(uuid, text)
  from public, anon, authenticated;

grant execute on function public.ml_ex_p2p_take_offer(uuid, text, numeric)
  to service_role;
grant execute on function public.ml_ex_p2p_cancel_reserved(uuid, text)
  to service_role;

commit;
