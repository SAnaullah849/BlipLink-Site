-- Run once (or again safely) AFTER schema.sql and account-access.sql.
begin;

alter table public.company_profiles add column if not exists card_theme jsonb not null default '{}'
    check (jsonb_typeof(card_theme) = 'object' and octet_length(card_theme::text) <= 8192);

-- Keep the existing public card RPC and card URLs compatible with older clients.
create or replace function public.get_public_card_appearance(requested_profile_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
    select jsonb_build_object('theme', profile.card_theme, 'account_type', account.account_type, 'expires_at', subscription.expires_at)
    from public.company_profiles as profile
    join public.account_access as account on account.user_id = profile.user_id
    left join public.company_subscriptions as subscription on subscription.user_id = profile.user_id
    where profile.id = requested_profile_id and not profile.is_locked
      and public.account_is_active(profile.user_id)
      and char_length(btrim(profile.full_name)) > 0
    limit 1;
$$;
revoke all on function public.get_public_card_appearance(uuid) from public;
grant execute on function public.get_public_card_appearance(uuid) to anon, authenticated;

-- Individuals have a card editor, without access to the company CRM.
drop policy if exists "Company users can manage their CRM leads" on public.crm_leads;
create policy "Company users can manage their CRM leads"
    on public.crm_leads for all to authenticated
    using (
        owner_id = (select auth.uid())
        and public.account_is_active(owner_id)
        and exists(select 1 from public.account_access as account
            where account.user_id = (select auth.uid()) and account.account_type = 'company')
    )
    with check (
        owner_id = (select auth.uid())
        and public.account_is_active(owner_id)
        and exists(select 1 from public.account_access as account
            where account.user_id = (select auth.uid()) and account.account_type = 'company')
        and (source_exchange_id is null or exists(
            select 1 from public.card_contact_exchanges as exchange
            where exchange.id = source_exchange_id and exchange.card_owner_id = (select auth.uid())
        ))
    );

commit;
