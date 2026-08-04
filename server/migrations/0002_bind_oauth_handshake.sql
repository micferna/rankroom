-- Binds an OAuth handshake to the browser that started it.
--
-- Without this, `state` alone decides who gets signed in — and `state` travels
-- in a URL. An attacker could start a handshake, obtain a valid code for their
-- own Twitch account, then trick someone into loading the callback: the victim's
-- browser receives a session belonging to the attacker, and everything they rank
-- afterwards lands in the attacker's account. That is login CSRF.
--
-- The fix is a second secret that never leaves the victim's browser: a nonce set
-- as a cookie at the start of the handshake, whose hash is stored here. The
-- callback must present both, so a handshake can only be finished by the browser
-- that began it.

-- Handshakes in flight during the upgrade cannot satisfy the new rule, and they
-- expire within ten minutes anyway. Clearing them is cheaper than a nullable
-- column that would let an unbound handshake through forever.
delete from oauth_states;

alter table oauth_states
    add column binding_hash bytea not null,
    add constraint oauth_states_binding_length check (octet_length(binding_hash) = 32);
