-- Previous states of a board, so a ranking somebody ruined is recoverable.
--
-- Every version is a whole document, not a diff. Diffs would be smaller and
-- would also mean a restore depends on every version between here and there
-- still being intact — which is exactly the property that fails when storage is
-- being reclaimed under pressure. A version that stands alone can be thrown
-- away without harming any other.
--
-- That matters because these are throwable. Versions count against the owner's
-- storage quota and are pruned oldest-first to make room, so saving the board
-- you are working on never fails because of history you are not.

create table board_versions (
    id              uuid        primary key default gen_random_uuid(),
    board_id        uuid        not null references boards (id) on delete cascade,
    -- Kept alongside the document so the list can be shown without loading
    -- megabytes of board to render a row of text.
    title           text        not null,
    item_count      integer     not null default 0,
    document        jsonb       not null,
    saved_at        timestamptz not null default now(),

    constraint board_versions_title_length check (char_length(title) between 1 and 120),
    constraint board_versions_items_sane check (item_count between 0 and 400),
    constraint board_versions_document_is_object check (jsonb_typeof(document) = 'object')
);

-- Both access patterns: newest-first for one board, and oldest-first across an
-- owner when reclaiming space.
create index board_versions_board_idx on board_versions (board_id, saved_at desc);
create index board_versions_age_idx on board_versions (saved_at);
