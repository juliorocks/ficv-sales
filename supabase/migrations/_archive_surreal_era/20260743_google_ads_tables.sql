create table if not exists google_ads_campaigns (
    campaign_id         text primary key,
    campaign_name       text,
    status              text,
    advertising_channel_type text,
    synced_at           timestamptz default now()
);

create table if not exists google_ads_insights_daily (
    id                  bigserial primary key,
    campaign_id         text not null,
    campaign_name       text,
    date                date not null,
    spend               numeric(12,2) default 0,
    impressions         bigint default 0,
    clicks              bigint default 0,
    conversions         numeric(12,2) default 0,
    synced_at           timestamptz default now(),
    unique (campaign_id, date)
);

create index if not exists idx_google_ads_insights_date on google_ads_insights_daily(date);
create index if not exists idx_google_ads_insights_campaign on google_ads_insights_daily(campaign_id);
