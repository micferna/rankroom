-- People other than the owner who may edit a board.
--
-- A co-host placing tiles during a stream, or a moderator running the board
-- while the streamer talks. Narrow on purpose: a collaborator edits the board
-- and nothing else. Publishing it, deleting it, and deciding who else gets in
-- stay with the owner, because those are decisions about the owner's account
-- rather than about the ranking.
--
-- There is no lock. Saves here are explicit and often minutes apart, so a lock
-- would be either too short — stealing the board mid-session — or too long,
-- blocking a legitimate takeover, with no setting that is right for both. What
-- actually prevents two people overwriting each other is that every write says
-- which version it was based on, and the server refuses one built on a version
-- that has since moved. Combined with `board_versions`, nothing is ever lost:
-- the writer is told what happened and can look at what changed.

create table board_collaborators (
    board_id        uuid        not null references boards (id) on delete cascade,
    user_id         uuid        not null references users (id) on delete cascade,
    -- Who granted this, kept so an owner can see it later. Null once that
    -- account is gone, which does not revoke the collaboration.
    added_by        uuid        references users (id) on delete set null,
    added_at        timestamptz not null default now(),

    primary key (board_id, user_id)
);

-- The access check on every write by a collaborator, and the list an owner
-- sees. Both directions are read often enough to index.
create index board_collaborators_user_idx on board_collaborators (user_id);
