-- Who is allowed in, and who can see the instance as a whole.
--
-- Until now the sign-in callback created an account for anybody who completed a
-- Twitch handshake. That is the correct behaviour for a public service and the
-- wrong one for a service that is not ready to be public yet, and there was no
-- way to say which this was.

alter table users
    -- Set from ADMIN_LOGINS at sign-in rather than by hand, so the answer to
    -- "who is an admin" lives in the deployment's configuration and not in a
    -- row somebody edited once and forgot.
    add column is_admin boolean not null default false,
    -- A suspended account keeps its boards and cannot sign in. Deleting is the
    -- other lever and it is irreversible; this one is not, which is what makes
    -- it usable while working out what happened.
    add column suspended_at timestamptz;

create index users_admins_idx on users (id) where is_admin;
