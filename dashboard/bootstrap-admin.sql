-- Run once in Supabase SQL Editor AFTER schema.sql and account-access.sql.
-- This never changes a password or sends an invitation.
do $$
declare admin_id uuid;
begin
    select id into admin_id from auth.users where lower(email) = lower('devops@shaunco.ai');
    if admin_id is null then
        raise exception 'Invite devops@shaunco.ai in Supabase Authentication first, then run this script again.';
    end if;
    insert into public.app_admins(user_id) values(admin_id) on conflict (user_id) do nothing;
end;
$$;
