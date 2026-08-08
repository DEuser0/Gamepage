// ============================================================================
// TACTICS CHESS — game engine (v3)
// Pure logic only: no DOM. Exposed as `Engine` on window (browser) or
// module.exports (Node, for testing).
//
// CHANGELOG vs v2 (bug fixes + new features requested):
//  - Infantry promotion now restricted to the far row (row 9 for white, row 0
//    for black) — pawn-style, instead of anywhere on the board.
//  - Tanks now take progressive melee damage (full -> damaged -> destroyed)
//    from ordinary melee attackers, and the attacker survives and stays put
//    on a non-killing hit (previously the *attacker* was destroyed instead).
//    A Tank-vs-Tank melee, or any Plane attack (melee or ranged-via-fire is
//    N/A, Planes have no ranged ability), or a Missile/ICBM hit, destroys a
//    Tank outright regardless of its current HP.
//  - Special Forces' Phase Move ability now ignores friendly units too (not
//    just enemies/wasteland) while moving — it only cares about the
//    destination square.
//  - Planes: only Air Defense fire and another Plane's melee can harm a
//    Plane now; ground melee from anything else has no effect.
//  - Drones: only Air Defense fire or a Plane moving onto them can kill a
//    Drone now (ranged Tank fire no longer works). When a Drone melees
//    anything else (that isn't immune, i.e. not a Plane), the attack is a
//    kamikaze run: BOTH the Drone and its target are destroyed.
//  - New Plane ability: Carpet Bomb — flies over units in a straight line
//    (ignores blocking) and destroys everything in the flight path AND the
//    landing square, any side, friendly fire included. Costs 1 fuel like any
//    plane move.
//  - New Plane resource: fuel. Starts at 8, -1 every time a plane moves or
//    carpet-bombs, and a plane sitting on a friendly-or-not (airfields are
//    side agnostic) Airfield tile regains +1 fuel at the start of its side's
//    turn, capped at 8, whether or not it was used that turn. A plane with 0
//    fuel can't move or carpet bomb.
//  - New structure: Airfields. Planes now start the game sitting on one.
//    Engineers can build/remove additional Airfields (same adjacency rule as
//    trenches), side agnostic.
//  - Entrenchment clarified: it does nothing against melee/ground attacks.
//    It only stops ranged Tank fire, Artillery fire, Missile fire, and
//    Machine Gunner fire from a *direct hit* the first time — the trench
//    itself is destroyed by that shot (Artillery/Missile don't also damage
//    the occupant; Tank/Machine Gunner fire damages the occupant too). This
//    matches the original ruling and required no logic change, just
//    confirming it's distinct from the new Nuclear Bunker below.
//  - New structure: Nuclear Bunkers. Air Defense can build one on an
//    adjacent tile for 1 ammo (Air Defense now also earns 1 ammo/turn, to
//    have something to spend — see ASSUMPTIONS). A unit standing on a bunker
//    tile is completely unaffected by *indirect* ICBM blast damage (doesn't
//    even destroy the bunker). A *direct* ICBM hit on a bunker tile destroys
//    the bunker instead of the tile/unit — the unit survives and the tile
//    does NOT turn to wasteland.
//  - Drone Operator deploy range fixed from chebyshev (8-directional
//    "adjacent") to strict taxicab distance 1 (orthogonal neighbors only),
//    matching how Tank/Machine Gunner "radius 1" fire already worked.
//  - Drones are now worth 0 points (they're free to produce from ammo).
//
// ASSUMPTIONS MADE TO RESOLVE NEW AMBIGUITY:
//  - Air Defense gains +1 ammo per turn (like Missile Launcher / Drone
//    Operator) since bunkers need an ammo source to spend from. Firing its
//    weapon ability is still free, unaffected by this ammo pool.
//  - Carpet Bomb's range matches the Plane's normal move range (3 squares,
//    straight line) and requires the landing tile to be empty-able the same
//    way a normal Plane landing would be (not wasteland, not entrenched).
//  - Nuclear Bunkers are built with the same 8-directional adjacency as
//    trenches ("next to it"), and building one costs 1 ammo while removing
//    one is free. Only a direct ICBM interacts with a bunker; every other
//    attack type ignores it entirely.
//  - Airfields use the same 8-directional adjacency as trenches for
//    Engineers to build/remove, and are side agnostic (any plane from either
//    side refuels while sitting on one).
// ============================================================================

const SIZE = 10;

const MOVE_RANGE = { T: 2, P: 3, S: 2, A: 1, M: 1, D: 1, I: 1, E: 1, O: 1, G: 1, R: 1 };
const CAN_MELEE = new Set(['T', 'P', 'S', 'I', 'E', 'O', 'G', 'R']);
// (min, max) taxicab firing range for T/A/M/G/D.
const FIRE_RANGE = { T: [1, 1], A: [1, 3], M: [2, 6], G: [1, 1], D: [1, 4] };
const NAMES = {
  T: 'Tank', P: 'Plane', S: 'Special Forces', A: 'Artillery',
  M: 'Missile Launcher', D: 'Air Defense', I: 'Infantry',
  E: 'Engineer', O: 'Drone Operator', G: 'Machine Gunner', R: 'Drone',
};
// Point values for scoring. Drones are worth 0 — they're a renewable,
// ammo-funded resource, not a strategic asset in themselves.
const VALUES = { I: 1, E: 2, O: 2, G: 2, T: 5, A: 3, S: 6, D: 10, M: 20, P: 4, R: 0 };

const PLANE_MAX_FUEL = 8;

function isPiece(cell) {
  return cell !== null && cell !== 'W' && typeof cell === 'object';
}

function makePiece(type, side, damaged = false, ammo = 0, fuel = 0) {
  return { type, side, damaged, ammo, fuel };
}

function makeBoard() {
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  const order = 'TPSAMDASPT';
  const airfield = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
  for (let c = 0; c < SIZE; c++) {
    const wt = order[c], bt = order[c];
    board[0][c] = wt === 'P' ? makePiece('P', 'white', false, 0, PLANE_MAX_FUEL) : makePiece(wt, 'white');
    board[9][c] = bt === 'P' ? makePiece('P', 'black', false, 0, PLANE_MAX_FUEL) : makePiece(bt, 'black');
    if (wt === 'P') airfield[0][c] = true;
    if (bt === 'P') airfield[9][c] = true;
  }
  for (let c = 0; c < SIZE; c++) {
    board[1][c] = makePiece('I', 'white');
    board[8][c] = makePiece('I', 'black');
  }
  const trench = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
  const bunker = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
  return { board, trench, airfield, bunker };
}

function inBounds(r, c) {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

function taxicab(r1, c1, r2, c2) {
  return Math.abs(r1 - r2) + Math.abs(c1 - c2);
}

function chebyshev(r1, c1, r2, c2) {
  return Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2));
}

function lineSteps(r1, c1, r2, c2) {
  const dr = r2 - r1, dc = c2 - c1;
  if (dr === 0 && dc === 0) return null;
  if (dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc)) return Math.max(Math.abs(dr), Math.abs(dc));
  return null;
}

function pathCells(r1, c1, r2, c2) {
  const steps = lineSteps(r1, c1, r2, c2);
  const dr = Math.sign(r2 - r1), dc = Math.sign(c2 - c1);
  const cells = [];
  for (let i = 1; i < steps; i++) cells.push([r1 + dr * i, c1 + dc * i]);
  return cells;
}

function cloneState(board, trench, airfield, bunker) {
  const b2 = board.map((row) => row.map((cell) => (isPiece(cell) ? { ...cell } : cell)));
  const t2 = trench.map((row) => row.slice());
  const a2 = airfield.map((row) => row.slice());
  const k2 = bunker.map((row) => row.slice());
  return { board: b2, trench: t2, airfield: a2, bunker: k2 };
}

function startTurn(board, side, airfield) {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const p = board[r][c];
      if (!isPiece(p) || p.side !== side) continue;
      if (p.type === 'M' || p.type === 'O' || p.type === 'D') p.ammo += 1;
      if (p.type === 'P' && airfield[r][c]) p.fuel = Math.min(PLANE_MAX_FUEL, p.fuel + 1);
    }
  }
}

function checkWin(board) {
  const counts = { white: 0, black: 0 };
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const p = board[r][c];
      if (isPiece(p)) counts[p.side] += 1;
    }
  }
  if (counts.white === 0) return 'black';
  if (counts.black === 0) return 'white';
  return null;
}

function isShieldedByAirDefense(board, r, c, side) {
  const deltas = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dr, dc] of deltas) {
    const nr = r + dr, nc = c + dc;
    if (inBounds(nr, nc)) {
      const cell = board[nr][nc];
      if (isPiece(cell) && cell.type === 'D' && cell.side === side) return true;
    }
  }
  return false;
}

// Ranged-fire resolution only now (melee for Plane/Tank/Drone targets is
// handled directly in landOrMelee, since those now have asymmetric rules
// that don't fit a single melee/ranged toggle any more).
// Returns 'killed' | 'damaged' | 'none'.
function resolveHit(defender, attackerType, melee) {
  if (defender.type === 'P') {
    // Ranged: only Air Defense (or an ICBM) can touch a plane.
    if (attackerType === 'D' || attackerType === 'ICBM') return 'killed';
    return 'none';
  }
  if (defender.type === 'R') {
    // Ranged: only Air Defense can touch a drone now.
    if (attackerType === 'D') return 'killed';
    return 'none';
  }
  if (defender.type === 'T') {
    if (attackerType === 'M' || attackerType === 'ICBM') return 'killed';
    return defender.damaged ? 'killed' : 'damaged';
  }
  return 'killed';
}

// Moves `piece` onto (r2,c2), decrementing fuel if it's a Plane. Assumes the
// caller has already fully validated the move/kill.
function relocate(board, piece, r1, c1, r2, c2) {
  board[r2][c2] = piece;
  board[r1][c1] = null;
  if (piece.type === 'P') piece.fuel -= 1;
}

function landOrMelee(board, trench, airfield, piece, r1, c1, r2, c2, log, graveyard) {
  const target = board[r2][c2];
  if (target === 'W') {
    log.push("CHECK FAILED: that square is wasteland, you can't move there.");
    return false;
  }
  if (piece.type === 'P' && trench[r2][c2]) {
    log.push('CHECK FAILED: planes cannot move onto an entrenched tile.');
    return false;
  }
  if (target === null) {
    relocate(board, piece, r1, c1, r2, c2);
    log.push(`${NAMES[piece.type]} moved to (${r2},${c2}).`);
    return true;
  }
  if (isPiece(target) && target.side === piece.side) {
    log.push('CHECK FAILED: that square is occupied by your own unit.');
    return false;
  }
  if (!CAN_MELEE.has(piece.type)) {
    log.push(`CHECK FAILED: ${NAMES[piece.type]} cannot melee attack.`);
    return false;
  }

  // --- Drone attacker: kamikaze rules (checked before target-type branches) ---
  if (piece.type === 'R') {
    if (target.type === 'P') {
      log.push(`Drone rams the enemy Plane at (${r2},${c2}) but planes are immune to anything but Air Defense or another plane.`);
      return true;
    }
    graveyard.push({ type: target.type, side: target.side });
    graveyard.push({ type: piece.type, side: piece.side });
    log.push(`Drone rams the enemy ${NAMES[target.type]} at (${r2},${c2}) — both are destroyed!`);
    board[r1][c1] = null;
    board[r2][c2] = null;
    return true;
  }

  // --- Plane target: only another Plane can kill it in melee ---
  if (target.type === 'P') {
    if (piece.type === 'P') {
      graveyard.push({ type: target.type, side: target.side });
      log.push(`Enemy Plane at (${r2},${c2}) was shot down in a dogfight!`);
      relocate(board, piece, r1, c1, r2, c2);
      return true;
    }
    log.push(`${NAMES[piece.type]} attacked the enemy Plane, but planes are immune to anything but Air Defense or another plane.`);
    return true;
  }

  // --- Drone target (attacker isn't a Drone, handled above): only a Plane can kill it ---
  if (target.type === 'R') {
    if (piece.type === 'P') {
      graveyard.push({ type: target.type, side: target.side });
      log.push(`Enemy Drone at (${r2},${c2}) was shot down!`);
      relocate(board, piece, r1, c1, r2, c2);
      return true;
    }
    log.push(`${NAMES[piece.type]} attacked the enemy Drone, but it had no effect (only Air Defense or a plane can down a drone).`);
    return true;
  }

  // --- Tank target: progressive damage, except Tank/Plane attackers one-shot it ---
  if (target.type === 'T') {
    if (piece.type === 'P') {
      graveyard.push({ type: target.type, side: target.side });
      log.push(`Enemy Tank at (${r2},${c2}) was DESTROYED (plane strike)!`);
      relocate(board, piece, r1, c1, r2, c2);
      return true;
    }
    if (piece.type === 'T') {
      graveyard.push({ type: target.type, side: target.side });
      log.push(`Enemy Tank at (${r2},${c2}) was DESTROYED in a tank duel!`);
      relocate(board, piece, r1, c1, r2, c2);
      return true;
    }
    if (target.damaged) {
      graveyard.push({ type: target.type, side: target.side });
      log.push(`Enemy Tank at (${r2},${c2}) was DESTROYED!`);
      relocate(board, piece, r1, c1, r2, c2);
      return true;
    }
    target.damaged = true;
    log.push(`Enemy Tank at (${r2},${c2}) is now DAMAGED (attacker holds its ground).`);
    return true;
  }

  // --- Everyone else dies in one hit to any successful melee ---
  graveyard.push({ type: target.type, side: target.side });
  log.push(`Enemy ${NAMES[target.type]} at (${r2},${c2}) was DESTROYED!`);
  relocate(board, piece, r1, c1, r2, c2);
  return true;
}

function doMove(board, trench, airfield, bunker, side, r1, c1, r2, c2, log, graveyard) {
  const piece = board[r1][c1];
  if (!isPiece(piece)) { log.push('CHECK FAILED: no unit at that square.'); return false; }
  if (piece.side !== side) { log.push("CHECK FAILED: you don't own that unit."); return false; }
  if (piece.type === 'P' && piece.fuel <= 0) { log.push('CHECK FAILED: this plane is out of fuel and grounded.'); return false; }
  const steps = lineSteps(r1, c1, r2, c2);
  if (steps === null) { log.push('CHECK FAILED: movement must be a straight orthogonal or diagonal line.'); return false; }
  if (steps > MOVE_RANGE[piece.type]) {
    log.push(`CHECK FAILED: ${NAMES[piece.type]} can move at most ${MOVE_RANGE[piece.type]} squares.`);
    return false;
  }
  for (const [pr, pc] of pathCells(r1, c1, r2, c2)) {
    if (board[pr][pc] !== null) { log.push(`CHECK FAILED: path is blocked at (${pr},${pc}).`); return false; }
  }
  return landOrMelee(board, trench, airfield, piece, r1, c1, r2, c2, log, graveyard);
}

function doAbility(board, trench, airfield, bunker, side, r1, c1, r2, c2, extra, log, graveyard) {
  const piece = board[r1][c1];
  if (!isPiece(piece)) { log.push('CHECK FAILED: no unit at that square.'); return false; }
  if (piece.side !== side) { log.push("CHECK FAILED: you don't own that unit."); return false; }

  // --- Plane: Carpet Bomb (only ability) ---
  if (piece.type === 'P') {
    if ((extra || '').toLowerCase() !== 'carpetbomb') {
      log.push('CHECK FAILED: planes can only use Carpet Bomb as an ability.');
      return false;
    }
    if (piece.fuel <= 0) { log.push('CHECK FAILED: this plane is out of fuel and grounded.'); return false; }
    const steps = lineSteps(r1, c1, r2, c2);
    if (steps === null) { log.push('CHECK FAILED: carpet bomb runs must follow a straight orthogonal or diagonal line.'); return false; }
    if (steps > MOVE_RANGE.P) { log.push(`CHECK FAILED: carpet bomb range is at most ${MOVE_RANGE.P} squares.`); return false; }
    const target = board[r2][c2];
    if (target === 'W') { log.push("CHECK FAILED: that square is already wasteland, nothing to bomb or land on."); return false; }
    if (trench[r2][c2]) { log.push('CHECK FAILED: planes cannot land on an entrenched tile.'); return false; }

    const hitCells = [...pathCells(r1, c1, r2, c2), [r2, c2]];
    let anyHit = false;
    for (const [rr, cc] of hitCells) {
      const cell = board[rr][cc];
      if (isPiece(cell)) {
        anyHit = true;
        graveyard.push({ type: cell.type, side: cell.side });
        const friendly = cell.side === side ? ' (friendly fire!)' : '';
        log.push(`Carpet bomb destroys ${cell.side} ${NAMES[cell.type]} at (${rr},${cc})${friendly}.`);
        board[rr][cc] = null;
      }
      trench[rr][cc] = false;
      airfield[rr][cc] = false;
    }
    if (!anyHit) log.push('Carpet bomb run finds nothing but empty ground.');
    board[r2][c2] = piece;
    board[r1][c1] = null;
    piece.fuel -= 1;
    log.push(`Plane completes its bombing run and lands at (${r2},${c2}).`);
    return true;
  }

  if (piece.type === 'S') {
    const steps = lineSteps(r1, c1, r2, c2);
    if (steps === null) { log.push('CHECK FAILED: movement must be a straight orthogonal or diagonal line.'); return false; }
    if (steps > MOVE_RANGE.S) { log.push('CHECK FAILED: Special Forces can move at most 2 squares.'); return false; }
    // Phase Move ignores everything in the path — friendlies, enemies, and
    // wasteland alike. Only the landing square's own rules matter.
    log.push('Special Forces phase through anything in the way...');
    return landOrMelee(board, trench, airfield, piece, r1, c1, r2, c2, log, graveyard);
  }

  if (piece.type === 'I') {
    const choice = (extra || '').toUpperCase();
    if (!['E', 'O', 'G'].includes(choice)) {
      log.push('CHECK FAILED: specify a promotion - E (Engineer), O (Drone Operator), or G (Machine Gunner).');
      return false;
    }
    if (!(r1 === r2 && c1 === c2)) {
      log.push('CHECK FAILED: promotion targets itself - use the same coordinates twice.');
      return false;
    }
    const farRow = side === 'white' ? SIZE - 1 : 0;
    if (r1 !== farRow) {
      log.push(`CHECK FAILED: infantry can only promote on the far row (row ${farRow}), like a chess pawn.`);
      return false;
    }
    piece.type = choice;
    log.push(`Infantry at (${r1},${c1}) promoted to ${NAMES[choice]}!`);
    return true;
  }

  if (piece.type === 'E') {
    const structure = (extra || 'trench').toLowerCase();
    if (!['trench', 'airfield'].includes(structure)) {
      log.push('CHECK FAILED: Engineers can build a trench or an airfield.');
      return false;
    }
    if (r1 === r2 && c1 === c2) { log.push('CHECK FAILED: choose an adjacent tile, not your own square.'); return false; }
    if (chebyshev(r1, c1, r2, c2) !== 1) {
      log.push('CHECK FAILED: Engineers can only build/remove structures on an adjacent tile.');
      return false;
    }
    if (board[r2][c2] === 'W') { log.push("CHECK FAILED: can't build on a wasteland tile."); return false; }
    if (structure === 'trench') {
      if (trench[r2][c2]) { trench[r2][c2] = false; log.push(`Trench at (${r2},${c2}) removed.`); }
      else { trench[r2][c2] = true; log.push(`Trench built at (${r2},${c2}).`); }
    } else {
      if (airfield[r2][c2]) { airfield[r2][c2] = false; log.push(`Airfield at (${r2},${c2}) removed.`); }
      else { airfield[r2][c2] = true; log.push(`Airfield built at (${r2},${c2}).`); }
    }
    return true;
  }

  if (piece.type === 'O') {
    if (taxicab(r1, c1, r2, c2) !== 1) { log.push('CHECK FAILED: a drone must be deployed to a tile at distance 1 (orthogonal neighbor).'); return false; }
    if (piece.ammo < 2) { log.push(`CHECK FAILED: not enough drone ammo (${piece.ammo}/2).`); return false; }
    if (board[r2][c2] !== null) { log.push('CHECK FAILED: target tile must be empty.'); return false; }
    let drones = 0, operators = 0;
    for (let rr = 0; rr < SIZE; rr++) {
      for (let cc = 0; cc < SIZE; cc++) {
        const cell = board[rr][cc];
        if (isPiece(cell) && cell.side === side) {
          if (cell.type === 'R') drones++;
          if (cell.type === 'O') operators++;
        }
      }
    }
    if (drones + 1 > 2 * operators) { log.push("CHECK FAILED: drone:operator ratio can't exceed 2:1."); return false; }
    piece.ammo -= 2;
    board[r2][c2] = makePiece('R', side);
    log.push(`Drone deployed at (${r2},${c2})!`);
    return true;
  }

  if (piece.type === 'D') {
    const wantsBunker = (extra || '').toLowerCase() === 'bunker';
    if (wantsBunker) {
      if (r1 === r2 && c1 === c2) { log.push('CHECK FAILED: choose an adjacent tile, not your own square.'); return false; }
      if (chebyshev(r1, c1, r2, c2) !== 1) { log.push('CHECK FAILED: a nuclear bunker must be built on an adjacent tile.'); return false; }
      if (board[r2][c2] === 'W') { log.push("CHECK FAILED: can't build a bunker on wasteland."); return false; }
      if (bunker[r2][c2]) {
        bunker[r2][c2] = false;
        log.push(`Nuclear bunker at (${r2},${c2}) dismantled.`);
        return true;
      }
      if (piece.ammo < 1) { log.push(`CHECK FAILED: not enough ammunition to build a bunker (${piece.ammo}/1).`); return false; }
      piece.ammo -= 1;
      bunker[r2][c2] = true;
      log.push(`Nuclear bunker built at (${r2},${c2}).`);
      return true;
    }

    const [minR, maxR] = FIRE_RANGE.D;
    const dist = taxicab(r1, c1, r2, c2);
    if (!(dist >= minR && dist <= maxR)) {
      log.push(`CHECK FAILED: Air Defense fire range is ${minR}-${maxR} (taxicab).`);
      return false;
    }
    const target = board[r2][c2];
    if (!isPiece(target) || target.side === side || !['P', 'R'].includes(target.type)) {
      log.push('CHECK FAILED: Air Defense can only target an enemy plane or drone.');
      return false;
    }
    const result = resolveHit(target, 'D', false);
    if (result === 'killed') {
      graveyard.push({ type: target.type, side: target.side });
      log.push(`Enemy ${NAMES[target.type]} at (${r2},${c2}) was DESTROYED!`);
      board[r2][c2] = null;
    } else {
      log.push(`Air Defense fired but it had no effect on the ${NAMES[target.type]}.`);
    }
    return true;
  }

  if (piece.type === 'M' && (extra || '').toLowerCase() === 'icbm') {
    if (piece.ammo < 10) { log.push(`CHECK FAILED: not enough ammunition for an ICBM (${piece.ammo}/10).`); return false; }
    const dist = taxicab(r1, c1, r2, c2);
    if (dist <= 1) { log.push("CHECK FAILED: adjacent tiles can't be hit with missiles."); return false; }
    const target = board[r2][c2];
    if (isPiece(target) && target.type === 'D') { log.push('CHECK FAILED: ICBMs cannot directly target Air Defense.'); return false; }
    piece.ammo -= 10;

    if (bunker[r2][c2]) {
      bunker[r2][c2] = false;
      if (isPiece(target)) {
        log.push(`Direct ICBM strike on (${r2},${c2}) is absorbed by the nuclear bunker — the bunker is destroyed but the ${NAMES[target.type]} inside survives!`);
      } else {
        log.push(`Direct ICBM strike destroys an empty nuclear bunker at (${r2},${c2}).`);
      }
      trench[r2][c2] = false;
    } else {
      if (isPiece(target)) {
        graveyard.push({ type: target.type, side: target.side });
        log.push(`ICBM strike destroys ${NAMES[target.type]} at (${r2},${c2})!`);
      }
      board[r2][c2] = 'W';
      trench[r2][c2] = false;
      airfield[r2][c2] = false;
    }

    const killed = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r2 + dr, nc = c2 + dc;
        if (!inBounds(nr, nc)) continue;
        const cell = board[nr][nc];
        if (!isPiece(cell)) continue;
        if (bunker[nr][nc]) { log.push(`  Unit at (${nr},${nc}) is unaffected — sheltered in a nuclear bunker.`); continue; }
        if (cell.type === 'D') { log.push(`  Air Defense at (${nr},${nc}) is immune and survives.`); continue; }
        if (isShieldedByAirDefense(board, nr, nc, cell.side)) {
          log.push(`  Unit at (${nr},${nc}) is shielded by a nearby Air Defense.`);
          continue;
        }
        killed.push([nr, nc, cell]);
      }
    }
    for (const [nr, nc, cell] of killed) {
      board[nr][nc] = null;
      graveyard.push({ type: cell.type, side: cell.side });
      log.push(`  Blast kills ${cell.side} ${NAMES[cell.type]} at (${nr},${nc}).`);
    }
    log.push(`ICBM launched! (${piece.ammo} ammo remaining on this launcher)`);
    return true;
  }

  if (['T', 'A', 'M', 'G'].includes(piece.type)) {
    const [minR, maxR] = FIRE_RANGE[piece.type];
    const dist = taxicab(r1, c1, r2, c2);
    if (!(dist >= minR && dist <= maxR)) {
      log.push(`CHECK FAILED: ${NAMES[piece.type]} fire range is ${minR}-${maxR} (taxicab).`);
      return false;
    }
    if (piece.type === 'M' && piece.ammo < 1) {
      log.push('CHECK FAILED: out of ammunition (wait a turn to build more, or skip firing).');
      return false;
    }
    const target = board[r2][c2];
    if (target === 'W') { log.push('CHECK FAILED: nothing to target there.'); return false; }
    if (isPiece(target) && target.side === side) { log.push("CHECK FAILED: that's your own unit."); return false; }

    if (trench[r2][c2]) {
      trench[r2][c2] = false;
      log.push(`Trench at (${r2},${c2}) destroyed by the attack.`);
      if (piece.type === 'A' || piece.type === 'M') {
        if (isPiece(target)) log.push('The entrenched unit was protected from the blast.');
        if (piece.type === 'M') piece.ammo -= 1;
        return true;
      }
      if (isPiece(target)) {
        const result = resolveHit(target, piece.type, false);
        if (result === 'killed') {
          graveyard.push({ type: target.type, side: target.side });
          log.push(`Enemy ${NAMES[target.type]} at (${r2},${c2}) was DESTROYED!`);
          board[r2][c2] = null;
        } else if (result === 'damaged') {
          target.damaged = true;
          log.push(`Enemy ${NAMES[target.type]} at (${r2},${c2}) is now DAMAGED.`);
        } else {
          log.push(`${NAMES[piece.type]} fired but it had no effect on the ${NAMES[target.type]}.`);
        }
      }
      return true;
    }

    if (!isPiece(target)) { log.push('CHECK FAILED: no unit at target square.'); return false; }
    const result = resolveHit(target, piece.type, false);
    if (result === 'killed') {
      graveyard.push({ type: target.type, side: target.side });
      log.push(`Enemy ${NAMES[target.type]} at (${r2},${c2}) was DESTROYED!`);
      board[r2][c2] = null;
    } else if (result === 'damaged') {
      target.damaged = true;
      log.push(`Enemy ${NAMES[target.type]} at (${r2},${c2}) is now DAMAGED.`);
    } else {
      log.push(`${NAMES[piece.type]} fired but it had no effect on the ${NAMES[target.type]}.`);
    }
    if (piece.type === 'M') piece.ammo -= 1;
    return true;
  }

  log.push('CHECK FAILED: that unit has no usable ability here.');
  return false;
}

function pieceValue(type) {
  return VALUES[type] || 0;
}

function computeScore(board, graveyard, side) {
  let score = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = board[r][c];
      if (isPiece(cell) && cell.side === side) score += pieceValue(cell.type);
    }
  }
  for (const g of graveyard) {
    if (g.side !== side) score += pieceValue(g.type);
  }
  return score;
}

// Returns the board coordinates of every Drone belonging to `side`, for a UI
// to walk the player through "move your drones first" before their main
// action (drone moves are free and don't end the turn on their own).
function dronesForSide(board, side) {
  const out = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = board[r][c];
      if (isPiece(cell) && cell.side === side && cell.type === 'R') out.push([r, c]);
    }
  }
  return out;
}

// Scans all 100 squares and returns the list of [r,c] targets that would be
// legal for this action, by dry-running doMove/doAbility against a clone.
function computeLegalTargets(board, trench, airfield, bunker, side, r1, c1, isMove, extra) {
  const targets = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const clone = cloneState(board, trench, airfield, bunker);
      const log = [];
      const graveyard = [];
      const ok = isMove
        ? doMove(clone.board, clone.trench, clone.airfield, clone.bunker, side, r1, c1, r, c, log, graveyard)
        : doAbility(clone.board, clone.trench, clone.airfield, clone.bunker, side, r1, c1, r, c, extra, log, graveyard);
      if (ok) targets.push([r, c]);
    }
  }
  return targets;
}

const Engine = {
  SIZE, MOVE_RANGE, CAN_MELEE, FIRE_RANGE, NAMES, VALUES, PLANE_MAX_FUEL,
  isPiece, makePiece, makeBoard, inBounds, taxicab, chebyshev,
  lineSteps, pathCells, cloneState, startTurn, checkWin,
  isShieldedByAirDefense, resolveHit, landOrMelee, doMove, doAbility,
  pieceValue, computeScore, dronesForSide, computeLegalTargets,
};

if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
if (typeof window !== 'undefined') window.Engine = Engine;
