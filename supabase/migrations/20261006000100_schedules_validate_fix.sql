-- The first validator only caught errors in the fields the matcher happened to
-- evaluate (and cron_field_matches returned at the first matching part), so
-- "0 25 * * *" and "0,99 * * * *" were accepted. Check every part of every field.

create or replace function public.cron_field_matches(field text, val int, lo int, hi int)
returns boolean language plpgsql immutable as $$
declare
  part text; stepn int; a int; b int; matched boolean := false;
begin
  foreach part in array string_to_array(field, ',') loop
    stepn := 1;
    if position('/' in part) > 0 then
      stepn := split_part(part, '/', 2)::int;
      part := split_part(part, '/', 1);
      if stepn < 1 then raise exception 'bad step'; end if;
    end if;
    if part = '*' then
      a := lo; b := hi;
    elsif position('-' in part) > 0 then
      a := split_part(part, '-', 1)::int; b := split_part(part, '-', 2)::int;
    else
      a := part::int;
      b := case when stepn > 1 then hi else a end;
    end if;
    if a < lo or b > hi or a > b then raise exception 'cron value out of range'; end if;
    if val >= a and val <= b and (val - a) % stepn = 0 then matched := true; end if;
  end loop;
  return matched;
end $$;

create or replace function public.validate_schedule() returns trigger
language plpgsql as $$
declare f text[];
begin
  perform now() at time zone new.timezone;
  f := regexp_split_to_array(btrim(new.cron), '\s+');
  if array_length(f, 1) <> 5 then raise exception 'cron needs 5 fields'; end if;
  perform public.cron_field_matches(f[1], 0, 0, 59);
  perform public.cron_field_matches(f[2], 0, 0, 23);
  perform public.cron_field_matches(f[3], 1, 1, 31);
  perform public.cron_field_matches(f[4], 1, 1, 12);
  perform public.cron_field_matches(f[5], 0, 0, 7);
  return new;
exception when others then
  raise exception 'invalid schedule (cron "%" / timezone "%"): %', new.cron, new.timezone, sqlerrm;
end $$;
