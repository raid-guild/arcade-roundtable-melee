# Roundtable Melee Implementation Plan

## Goal

Build `Roundtable Melee` as a Raid Guild Portal external module: a realtime,
multiplayer, top-down hack-and-slash arena where Portal-launched players choose
a character, enter the currently open match, attack each other, collect hams,
break treasure chests, and compete on a live points leaderboard.

The app should follow the existing arcade module patterns from `brood-tapper/`
and `hack-thy-sack/` for Portal launch auth, local player sessions, canvas
rendering, generated pixel-art sprite sheets, Drizzle/Postgres persistence, and
Railway-friendly deployment.

## Locked V1 Decisions

- All players must launch from the Raid Guild Portal.
- Any Portal `member` can start a game; only that starting member can end the
  active game early.
- One match runs at a time.
- Admin-started games enter a lobby countdown before combat begins.
- Lobby countdown defaults to `15` seconds and must be easy to configure.
- Match duration defaults to `3` minutes.
- Target active player count is `10`.
- Characters are cosmetic in v1.
- Character-specific abilities are a future enhancement.
- Frozen players remain blocking collision bodies.
- Frozen players cannot be damaged.
- Attacks cause knockback.
- Players spawn randomly.
- Slays are worth `200` points.
- Deaths are worth `-150` points.
- Treasure chests are worth `50` points.
- Treasure chests take `3` to `5` hits to open.
- Chest points go to the player who lands the final hit.
- Hams are visible to everyone and are first-come-first-served.
- Hams spawn randomly and infrequently, with configurable `15` to `60` second
  delays.
- Chests spawn randomly and infrequently, with configurable `15` to `60` second
  delays.
- Match results persist only at match end.
- Reconnect behavior should use the easiest v1 path: preserve player state while
  the in-memory match still exists, without cross-process or post-restart
  recovery.
- Disconnected players freeze in place, remain blocking, and use a visual state
  distinct from death/frozen players.

## Portal Integration

Use the signed-launch pattern from the Portal external module integration guide:

```txt
/portal/callback?token=<jwt>
```

The app verifies:

- JWT signature.
- `typ === "portal_module_launch"`.
- expected issuer.
- expected audience.
- expected `moduleSlug`.
- expiration.

After verification, upsert a local player record and create an `iron-session`
cookie.

Recommended local identity fields:

- `portalUserId`: durable Portal account link, required when present.
- `portalProfileId`: optional display/profile link.
- `handle`: display name from launch claim fallback chain.
- `picture`: optional avatar URL.
- `roles`: launch-time role snapshot.
- `lastSeenAt`: latest successful Portal launch.

Because all play requires Portal launch, anonymous play should be disabled. A
missing session should redirect to or render a launch-required screen with a link
back to the Portal modules page.

For local development only, support an explicit Portal bypass:

- `ALLOW_DEV_LOGIN=true` enables `/api/dev-login` outside production.
- `/api/dev-login` creates a synthetic local `member` session and redirects to
  `/play`.
- `DEV_PLAYER_HANDLE` can set the default local handle.
- The route must return `404` when `NODE_ENV === "production"` or
  `ALLOW_DEV_LOGIN` is not exactly `true`.
- Local dev login does not upsert a Portal player and should not be used for
  deployed play.

## App Structure

Suggested directory structure:

```txt
roundtable-melee/
  app/
    admin/page.tsx
    api/
      admin/game/end/route.ts
      admin/game/start/route.ts
      auth/callback/route.ts
      game/socket-token/route.ts
      session/route.ts
    launch-error/page.tsx
    play/GameCanvas.tsx
    play/page.tsx
    portal/callback/route.ts
    globals.css
    layout.tsx
    page.tsx
  assets-src/
    build-character-sprites.mjs
    build-arena.mjs
  docs/
    implementation-plan.md
  game/
    characters.ts
    client/
      interpolation.ts
      render.ts
      sprites.ts
    shared/
      constants.ts
      protocol.ts
      types.ts
    server/
      collision.ts
      match-manager.ts
      simulation.ts
      spawning.ts
  lib/
    db/
      index.ts
      schema.ts
    launch-token.ts
    session.ts
  public/
    sprites/
  server/
    index.ts
```

`app/` should own screens, auth callbacks, API routes, and session reads.
`game/shared/` should contain protocol and constants used by both browser and
server code. `game/server/` should own authoritative simulation. `game/client/`
should own canvas rendering and client-side smoothing only.

## Realtime Architecture

Roundtable Melee needs an authoritative realtime server. Clients send inputs;
the server owns the match state.

Client sends:

- connect/auth token.
- selected character.
- movement direction.
- attack press.
- reconnect/leave events.

Server owns:

- active match lifecycle.
- player positions and facing.
- collision.
- health.
- attack cooldowns.
- hit detection.
- freeze/thaw timers.
- ham spawning and pickup.
- treasure chest spawning, health, and final-hit reward.
- scoring.
- match timer.
- final match persistence.

Recommended approach:

- Run a custom Node server beside Next.
- Use `ws` or `socket.io` for realtime transport.
- Have Next mint a short-lived socket token at `/api/game/socket-token`.
- Socket server verifies that token before accepting a connection.
- Keep the simulation process authoritative and in memory for the active match.
- Persist only completed match results at match end.

Ticking:

- Simulate at `30` or `60` Hz.
- Broadcast snapshots at `10` to `20` Hz.
- Render clients with `requestAnimationFrame`.
- Use simple interpolation between snapshots for remote players.

## Game Lifecycle

Only one match can exist in an active state at a time.

States:

- `idle`: no active match.
- `lobby`: match created, lobby countdown running, players may join/select.
- `running`: combat, timer, pickups, and scoring active.
- `ending`: final snapshot and persistence in progress.
- `ended`: match complete; clients can view final results.

Admin flow:

1. Portal-launched member opens the admin screen or admin panel.
2. Admin starts a match.
3. Server creates the match in `lobby` state.
4. Lobby countdown starts at configurable `15` seconds.
5. Players who launch the module during lobby or running enter the active match.
6. Match runs for configurable `3` minutes.
7. The member who started the match may end it early.
8. Server persists final results once at match end.
9. Server returns to `idle` after final results are available.

Player flow:

1. Player launches from Portal.
2. App verifies launch and creates a local session.
3. Player lands on the module status screen.
4. If no match is active, player sees a waiting/status screen.
5. If a match is active, player chooses a character if needed.
6. Player enters lobby or running match.
7. Reconnects should restore the player to the current match when the in-memory
   match still has that player state.

## Configuration

Put gameplay knobs in a single shared config file so tuning changes are
reviewable and deploy with the app:

```ts
export const GAME_CONFIG = {
  lobbyCountdownSeconds: 15,
  matchDurationSeconds: 180,
  finalResultsSeconds: 30,
  maxPlayers: 10,
  freezeSeconds: 15,
  playerMaxHealth: 100,
  hamHealAmount: 25,
  slayScore: 200,
  deathScore: -150,
  chestScore: 50,
  hamSpawnMinSeconds: 15,
  hamSpawnMaxSeconds: 60,
  maxActiveHams: 2,
  chestSpawnMinSeconds: 15,
  chestSpawnMaxSeconds: 60,
  maxActiveChests: 2,
  chestMinHits: 3,
  chestMaxHits: 5,
  attackDamage: 25,
  attackCooldownMs: 580,
  attackActiveMs: 150,
  maxInputMessagesPerSecond: 45,
  playfieldMinX: 46,
  playfieldMaxX: 674,
  playfieldMinY: 126,
  playfieldMaxY: 486,
};
```

Admin controls can expose match duration, lobby countdown, scoring, and spawn
rates later, but v1 keeps gameplay tuning in `game/shared/config-values.mjs`.

## Database Model

Use Drizzle/Postgres, following the existing arcade module style.

Roundtable Melee will reuse the shared arcade Postgres database used by other
Raid Guild arcade modules. To avoid collisions, every table owned by this app
must use the `melee_` prefix.

`melee_players`

- `id`: internal UUID.
- `portal_user_id`: durable Portal user id.
- `portal_profile_id`: optional Portal profile id.
- `handle`: display handle.
- `picture`: optional avatar URL.
- `roles`: text array or JSON role snapshot.
- `created_at`.
- `last_seen_at`.

`melee_matches`

- `id`: internal UUID.
- `status`: final status, usually `completed` or `ended_early`.
- `started_by_player_id`.
- `ended_by_player_id`.
- `lobby_countdown_seconds`.
- `duration_seconds`.
- `started_at`.
- `combat_started_at`.
- `ended_at`.
- `created_at`.

`melee_match_players`

- `id`: internal UUID.
- `match_id`.
- `player_id`.
- `character_id`.
- `score`.
- `slays`.
- `deaths`.
- `damage_dealt`.
- `damage_taken`.
- `hams_collected`.
- `chests_opened`.
- `final_rank`.
- `joined_at`.

Optional future table:

- `melee_match_events` for replay/debug/audit, not required for v1.

Because v1 persists only at match end, the realtime server can keep live state
in memory and write one match row plus final participant rows when the match
finishes.

## Character Selection

Character source art:

```txt
brood-tapper/tapper-images/characters/
```

Initial character list:

- alchemist
- archer
- cleric
- druid
- dwarf
- healer
- hunter
- monk
- necromancer
- paladin
- ranger
- rogue
- scribe
- tavern-keeper
- warrior
- wizard

V1 characters are cosmetic. All players share the same stats:

- same max health.
- same movement speed.
- same attack damage.
- same attack range.
- same cooldown.

Character records should still use a data-driven config so future unique
abilities can be added without rewriting selection, rendering, or protocol code.

Example:

```ts
export const CHARACTERS = [
  {
    id: "warrior",
    name: "Warrior",
    spriteKey: "warrior",
    futureAbilitySlot: null,
  },
];
```

## Sprite And Art Pipeline

Style target:

- 8-bit/pixel-art.
- top-down, above-and-behind angle similar to Diablo or Gauntlet.
- readable silhouettes at small size.

Needed poses per character:

- idle/down.
- idle/up.
- idle/left.
- idle/right.
- attack/down.
- attack/up.
- attack/left.
- attack/right.
- frozen.

Optional later poses:

- walk/down.
- walk/up.
- walk/left.
- walk/right.
- hurt.
- thaw.

Pipeline:

1. Use the existing character SVGs as identity references.
2. Generate pose sheets at the correct vantage point.
3. Review each generated sheet manually for readability.
4. Crop and normalize each pose into a consistent cell.
5. Generate pickup and object sprites for hams and treasure chests.
6. Build sprite atlases and JSON metadata.
7. Load atlases in the browser renderer.

Suggested output:

```txt
public/sprites/characters.png
public/sprites/characters.json
public/sprites/items.png
public/sprites/items.json
```

The renderer should support placeholder shapes before final sprites are ready so
gameplay can be built and tested independently from the art pass.

## Arena

V1 should use a single shared gameplay space.

Arena requirements:

- top-down/isometric-ish room or battleground.
- supports up to `10` players without becoming unreadable.
- clear collision boundaries.
- simple spawn points around the perimeter.
- enough empty space for melee movement.
- right-side leaderboard outside or beside the canvas.

The first implementation can use a flat collision rectangle with visual arena
art layered underneath. More detailed obstacle collision can be a later pass.

Arena image generation prompt:

```txt
Create an 8-bit pixel-art dungeon arena for a top-down, slightly above-and-behind
multiplayer melee game, similar camera angle to classic Gauntlet or Diablo.
The arena should have grey and blue stone brick floors, darker brick walls,
torch sconces mounted along the walls, small warm torchlight accents, and a
clear open central fighting space for up to ten small character sprites. Keep
the composition readable for gameplay: obvious walkable floor, clear boundaries,
minimal clutter, no large central obstacles, and enough empty space for melee
movement. Use a moody dungeon palette dominated by greys, slate blues, deep
blue shadows, and small orange flame highlights. Output as crisp pixel art with
hard edges, no blur, no painterly texture, no text, and no UI elements.
```

Also generate item sprites for:

- ham pickup, readable as food at small size.
- closed treasure chest.
- damaged/opening treasure chest, optional.
- opened treasure chest, optional.

## Player State

Server-side player state:

- `id`.
- `playerId`.
- `handle`.
- `characterId`.
- `x`, `y`.
- `vx`, `vy`.
- `facing`: `up | down | left | right`.
- `health`.
- `maxHealth`.
- `status`: `alive | frozen`.
- `freezeEndsAt`.
- `attackCooldownEndsAt`.
- `attackActiveUntil`.
- `score`.
- `slays`.
- `deaths`.
- `damageDealt`.
- `damageTaken`.
- `hamsCollected`.
- `chestsOpened`.
- `connected`.

Frozen players:

- cannot move.
- cannot attack.
- remain visible.
- remain blocking collision bodies.
- cannot be damaged.
- thaw after `15` seconds.
- restore health on thaw.

Disconnected players:

- freeze immediately in their current position.
- remain blocking collision bodies.
- use a distinct disconnected-frozen visual state.
- do not count as death/frozen for scoring.
- can reclaim their in-memory state if they reconnect before the match ends.
- are not restored after server restart.

## Movement And Controls

Controls:

- `ArrowLeft`: move left.
- `ArrowRight`: move right.
- `ArrowUp`: move up.
- `ArrowDown`: move down.
- `Space`: attack.

Movement should be normalized diagonally so diagonal movement is not faster than
cardinal movement.

Client input messages should include sequence numbers so the server can process
ordered input and the client can later add prediction/reconciliation if needed.

## Combat

V1 attack model:

- one melee attack shared by all characters.
- directional hitbox in front of player.
- short active window.
- cooldown after each attack.
- successful hits cause knockback.
- server validates all hits.

Recommended starting numbers:

- max health: `100`.
- attack damage: `25`.
- attacks to slay from full health: `4`.
- attack cooldown: `500` to `650` ms.
- active hit window: `120` to `180` ms.

Slay flow:

1. Attacker lands damage.
2. Target health reaches `0`.
3. Attacker gains slay points.
4. Target receives death penalty.
5. Target enters frozen state for `15` seconds.
6. Frozen target remains blocking.
7. Target thaws with restored health.

Scoring constants should be centralized. Suggested defaults:

```ts
export const SCORE_SLAY = 200;
export const SCORE_DEATH = -150;
export const SCORE_CHEST = 50;
```

Do not trust client-reported hits or scores.

## Pickups And Chests

Hams:

- spawn randomly and infrequently during running matches.
- use a configurable random delay between `15` and `60` seconds.
- more than one ham can exist at once.
- visible to all players.
- first player to collide with a ham receives healing.
- disappear immediately after pickup.
- do not heal above max health.

Treasure chests:

- spawn randomly and infrequently during running matches.
- use a configurable random delay between `15` and `60` seconds.
- more than one chest can exist at once.
- visible to all players.
- each chest requires a random `3` to `5` hits to open.
- all players can attack a chest.
- the final hit opens the chest.
- final hitter receives the point bonus.
- chest disappears after opening.

Spawn rules:

- spawn players randomly.
- avoid spawning on top of players.
- avoid spawning outside arena bounds.
- optionally avoid immediate respawn in the same spot.
- cap active hams and chests to keep the arena readable.

## Live Leaderboard

The right-side leaderboard updates from server snapshots.

Display:

- rank.
- handle.
- score.
- slays/deaths, if space allows.
- local player highlight.
- match timer above or near the board.

Sort by:

1. score descending.
2. slays descending.
3. deaths ascending.
4. joined time ascending.

During lobby, leaderboard can show joined players and selected characters.

## Screens

`/`

- Requires Portal session.
- Shows active match status.
- Routes players to `/play`.
- Shows admin start control for members.

`/play`

- Canvas gameplay screen.
- Character select overlay before spawning.
- Lobby countdown overlay.
- Live match UI and leaderboard.
- Final results overlay.

`/admin`

- Deferred for v1.
- V1 uses member-only in-game websocket controls for start/end.
- Add a separate member-only admin route later only if Portal operators need a
  control surface outside the play screen.

`/launch-error`

- Clear error state for missing/expired/invalid Portal launch tokens.
- Link back to Portal modules.

## API And Socket Protocol

HTTP routes:

- `GET /api/session`
- `GET /api/game/socket-token`
- `GET /api/game/config`
- `GET /portal/callback`
- `GET /api/auth/callback`

Socket client-to-server messages:

- `join_match`
- `select_character`
- `input`
- `ping`

Socket server-to-client messages:

- `match_state`
- `snapshot`
- `player_joined`
- `player_left`
- `error`
- `match_ended`

Snapshots should include only render-relevant state, not raw Portal identity
fields.

## Security And Abuse Controls

- Require Portal launch for all gameplay.
- Never log raw launch tokens.
- Never let clients submit score deltas.
- Verify socket tokens server-side.
- Rate-limit or coalesce input messages.
- Enforce max `10` active players in a match.
- Treat Portal roles as launch-time authorization.
- Use server time for cooldowns, timers, spawn intervals, freeze durations, and
  match end.

For v1, any Portal member can start a match, but only the member who started the
active match can end it early. If this becomes too loose, future work can add
stricter admin roles or override rules.

## Deployment Notes

The existing arcade modules are normal Next apps using `railway.json`,
Nixpacks, standalone Next output, a migration `preDeployCommand`, and a
standalone server start command. Roundtable Melee should use the same baseline,
but likely needs a custom server entrypoint so Next and the websocket server run
inside one Railway service.

Relevant Railway docs:

- Next.js deployment: <https://docs.railway.com/guides/nextjs>
- Config as code: <https://docs.railway.com/config-as-code>
- Config reference: <https://docs.railway.com/config-as-code/reference>
- WebSocket/Socket.IO guide: <https://docs.railway.com/guides/socketio>
- Public networking limits: <https://docs.railway.com/networking/public-networking/specs-and-limits>

Railway service shape:

- Use a single web service for v1 so the active in-memory match is not split
  across multiple instances.
- Bind the custom server to `0.0.0.0`.
- Read the listen port from Railway's `PORT` environment variable.
- Serve both HTTP routes and websocket upgrades from the same public domain.
- Add a simple health route such as `GET /health`.
- Configure a health check path in Railway once the route exists.
- Use `restartPolicyType: "ON_FAILURE"`.
- Avoid horizontal scaling until realtime state is moved to Redis or another
  shared coordinator.

Suggested `railway.json` shape:

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "preDeployCommand": "if [ -n \"$DATABASE_URL\" ]; then npm run db:migrate; else echo \"Skipping migrations: DATABASE_URL is not set\"; fi",
    "startCommand": "HOSTNAME=0.0.0.0 node server/index.js",
    "healthcheckPath": "/health",
    "restartPolicyType": "ON_FAILURE"
  }
}
```

If the custom server is written in TypeScript, compile it during `npm run build`
or add a dedicated build step so Railway starts compiled JavaScript. Keep the
Next standalone copy step from the existing modules so `public/` and
`.next/static/` are present in the deployed image.

Deployment should provide:

- `DATABASE_URL`.
- `SESSION_SECRET`.
- `MODULE_LAUNCH_SECRET`.
- `PORTAL_ISSUER`.
- `MODULE_SLUG`.
- `PORTAL_MODULES_URL`.
- `SOCKET_TOKEN_SECRET`, unless the session secret is deliberately reused.

Deployment flow:

1. Add a Railway project and Postgres service.
2. Set `DATABASE_URL` from the Railway Postgres service.
3. Set all Portal launch and session variables on the web service.
4. Deploy from the repo with the service root pointed at `roundtable-melee/`.
5. Let the `preDeployCommand` run Drizzle migrations.
6. Generate or attach the public Railway/custom domain.
7. Configure the Portal external module callback to the deployed
   `/portal/callback` URL.
8. Launch from Portal and verify session creation, websocket connection, admin
   start, lobby countdown, and match end persistence.

The Portal module should be configured as:

```txt
moduleKind: external
authMode: signed_launch
externalCallbackURL: https://roundtable-melee.example.com/portal/callback
launchSecretEnvKey: ROUNDTABLE_MELEE_MODULE_LAUNCH_SECRET
launchAudience: roundtable-melee
visibility: member
enabled: true
```

## Implementation Phases

Current status:

- Phase 6 is complete for the initial roster: all `16` characters have approved
  runtime pose sheets, preview sprites, frozen poses, and disconnected-frozen
  poses.
- Phase 7 is complete for v1: match-end persistence exists, final results
  overlay exists, and recent match results are available at `/results` and
  `/api/matches/recent`.
- Phase 8 is in progress: health bars, disconnected-freeze visuals, hit/score
  popups, impact flashes, crunchy arcade sound cues, directional attack effects,
  reconnect status, and a socket bot harness are in place; larger multiplayer
  soak testing remains.

Current implementation notes from the June 20, 2026 review:

- Build and typecheck pass.
- Core v1 gameplay is present: Portal session flow, local dev login,
  authenticated websocket connect, one active match, lobby/running/ended phases,
  player collision, melee attacks, knockback, freeze/thaw, hams, chests,
  scoring, live leaderboard, sprite rendering, match-end persistence, final
  results overlay, recent results page, and Railway service configuration.
- Shared config defaults now live in `game/shared/config-values.mjs`, with the
  TypeScript app config and custom websocket server both reading from those
  values. Gameplay tuning changes are made in code and deployed with the app.
- Ended matches now hold final results briefly, then reset to `idle` and prune
  disconnected players so stale sessions do not permanently fill the match.
- Match persistence no longer marks a match as persisted before the database
  write succeeds.
- Character selection is gated to `lobby` and `running` so idle players see the
  waiting/status overlay first.
- Persistence is namespaced for reuse of the shared arcade database:
  `melee_players`, `melee_matches`, and `melee_match_players`.
- V1 uses the in-game websocket start/end controls instead of a separate
  `/admin` page or admin HTTP routes.
- The current migration is the pre-deploy baseline. No rename migration is
  needed because the app has not yet been deployed against the shared arcade DB.
- Runtime gameplay config is exposed at `GET /api/game/config`, and server-side
  UI reads from the same committed config values as the websocket server.
- Current melee slash/swipe overlays are accepted for V1 playtesting; attack
  pose art can be revisited after multiplayer feedback.
- Crunchy arcade-style sound effects are implemented with a lightweight
  WebAudio synth and an in-game sound toggle.
- A socket bot harness is available through `npm run bots` for local multiplayer
  smoke/soak testing.
- Server input handling now rejects stale input sequence numbers and coalesces
  excessive input floods with a configurable `MAX_INPUT_MESSAGES_PER_SECOND`.
- Reconnect polish now distinguishes connecting/rejoining states and displays a
  short rejoined-current-match notice after recovery.
- Thaw and chest-break visual effects are implemented.

Remaining implementation work:

- Run the socket bot harness against local dev, then do a human multiplayer
  playtest. Tune bot behavior if it fails to surface useful load issues.
- Verify deployed Railway behavior with real Portal signed launch, websocket
  upgrade, migrations, match completion, and result persistence.
- Refactor for maintainability when v1 behavior stabilizes: the plan's
  `game/server/*` and `game/client/*` modules are still mostly represented by a
  monolithic `server/index.mjs` and `app/play/GameCanvas.tsx`.
- Decide tuned defaults for `maxActiveHams` and `maxActiveChests` after
  playtesting.

### Phase 1: App Shell And Portal Auth

- Scaffold `roundtable-melee` from existing arcade module patterns.
- Add Portal callback verification.
- Add local session.
- Add launch-required behavior.
- Add Drizzle schema and initial migration.
- Add `/api/session`.

### Phase 2: Realtime Server Skeleton

- Add custom server process.
- Add websocket transport.
- Add socket token route.
- Add authenticated connect/disconnect.
- Add active match manager with `idle`, `lobby`, `running`, and `ended` states.

### Phase 3: Admin Match Lifecycle

- Add member-only start/end controls.
- Allow any Portal member to start a match.
- Allow only the starting member to end that active match early.
- Add 15-second configurable lobby countdown.
- Add 3-minute configurable match timer.
- Enforce one active match.
- Broadcast match status to connected clients.

### Phase 4: Gray-Box Gameplay

- Add placeholder arena.
- Add player movement.
- Add collision between players.
- Add random player spawning.
- Add blocking frozen state.
- Prevent damage to frozen players.
- Add disconnected-frozen state for players who drop mid-match.
- Add basic attack hitboxes.
- Add attack knockback.
- Add health, slays, deaths, and scoring.
- Add live leaderboard.

### Phase 5: Pickups And Chests

- Add ham spawning and healing.
- Use configurable random ham spawn delays between 15 and 60 seconds.
- Add chest spawning.
- Use configurable random chest spawn delays between 15 and 60 seconds.
- Add 3-to-5-hit chest health.
- Award chest points to final hitter.
- Tune active ham and chest caps.

### Phase 6: Character Select And Sprites

- Add character select UI. Complete.
- Generate an art-review pack before production extraction. Complete.
- Pause for visual approval before scaling the pipeline across all characters.
  Complete.
- Build sprite generation pipeline from character source art. Complete.
- Generate directional idle and attack poses. Complete for the initial roster.
- Approved production pose sheets exist for the full initial character roster.
- Add frozen pose. Complete.
- Add disconnected-frozen pose. Complete.
- Integrate sprite atlas into renderer. Complete.
- Keep placeholder fallback for missing sprites. Complete.

### Phase 7: Persistence And Results

- Persist match and player result rows only at match end. Complete.
- Add final results overlay. Complete.
- Add all-time or recent match score view if desired. Recent match view added at
  `/results`.
- Add agent/reporting endpoints later if needed.

### Phase 8: Polish And Hardening

- Add crunchy arcade sound effects. Complete.
- Add hit flashes, health bars, thaw effects, chest break effects. Complete.
- Replace debug attack hitbox visuals with character attack poses and directional
  slash/swipe effects. Complete.
- Keep explicit hitbox rendering behind a debug flag such as
  `NEXT_PUBLIC_SHOW_HITBOXES=true`. Complete.
- Add short impact flashes when attacks connect. Complete.
- Add reconnect polish. Complete for v1: disconnected players freeze with a
  distinct visual state, clients reconnect automatically, and recovery notices
  are shown.
- Test with multiple local clients.
- Test up to 10 connected players.
- Verify deployment with Portal launch callback.

## Future Enhancements

- Unique character abilities.
- Character-specific stats.
- Additional attacks or charged attacks.
- Mobile controls.
- Arena hazards.
- Obstacles and richer collision maps.
- Multiple arena skins.
- Team mode.
- Match history/replay event log.
- Spectator mode.
- Stronger admin permissions beyond `member`.
- Client prediction and reconciliation if movement feels laggy.

## Open Questions

- What should `maxActiveHams` and `maxActiveChests` default to after playtesting?
