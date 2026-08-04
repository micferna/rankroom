-- RankRoom's optional backend.
--
-- Everything a client sends is re-validated in the application before it gets
-- here, and every constraint below is a second, independent line: the database
-- refuses malformed rows even if a future handler forgets to.

create extension if not exists "pgcrypto";

create table users (
    id              uuid primary key default gen_random_uuid(),
    -- Twitch's immutable numeric id. Logins can be renamed; this cannot.
    twitch_id       text        not null unique,
    login           text        not null,
    display_name    text        not null,
    avatar_url      text,
    created_at      timestamptz not null default now(),
    last_seen_at    timestamptz not null default now(),

    constraint users_login_shape check (login ~ '^[a-zA-Z0-9_]{1,25}$'),
    constraint users_display_length check (char_length(display_name) between 1 and 60)
);

create unique index users_login_lower_idx on users (lower(login));

-- Opaque sessions rather than JWTs: revoking one has to be instant, and at this
-- scale a table lookup costs nothing worth optimising away.
create table sessions (
    -- SHA-256 of the token. A database leak must not hand over live sessions.
    token_hash      bytea       primary key,
    user_id         uuid        not null references users (id) on delete cascade,
    created_at      timestamptz not null default now(),
    expires_at      timestamptz not null,
    user_agent      text,

    constraint sessions_hash_length check (octet_length(token_hash) = 32)
);

create index sessions_user_idx on sessions (user_id);
create index sessions_expiry_idx on sessions (expires_at);

-- Short-lived OAuth handshakes. Rows are deleted on use and expire quickly.
create table oauth_states (
    state_hash      bytea       primary key,
    pkce_verifier   text        not null,
    created_at      timestamptz not null default now(),
    expires_at      timestamptz not null,

    constraint oauth_states_hash_length check (octet_length(state_hash) = 32)
);

create index oauth_states_expiry_idx on oauth_states (expires_at);

create table boards (
    id              uuid        primary key default gen_random_uuid(),
    owner_id        uuid        not null references users (id) on delete cascade,
    title           text        not null,
    -- Stable, guessable-resistant public identifier, independent of the title.
    slug            text        not null unique,
    is_public       boolean     not null default false,
    item_count      integer     not null default 0,
    document        jsonb       not null,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),

    constraint boards_title_length check (char_length(title) between 1 and 120),
    constraint boards_slug_shape check (slug ~ '^[a-z0-9]{12,32}$'),
    constraint boards_items_sane check (item_count between 0 and 400),
    -- The application validates the shape; this catches the rest.
    constraint boards_document_is_object check (jsonb_typeof(document) = 'object'),
    constraint boards_document_schema check ((document ->> 'schema') = '1')
);

create index boards_owner_idx on boards (owner_id, updated_at desc);
create index boards_public_idx on boards (owner_id, updated_at desc) where is_public;

-- The live overlay reads by key rather than by session, so OBS can hold the URL
-- without holding a login. Rotating the key revokes every overlay instantly.
create table overlay_keys (
    user_id         uuid        primary key references users (id) on delete cascade,
    key_hash        bytea       not null unique,
    created_at      timestamptz not null default now(),

    constraint overlay_keys_hash_length check (octet_length(key_hash) = 32)
);
