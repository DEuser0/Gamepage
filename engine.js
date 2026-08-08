// ============================================================================
// TACTICS CHESS — game engine
// Faithful JS port of the original Python rules (tactics_chess.py, v2).
// Pure logic only: no DOM, no globals besides what's attached to `window`
// (browser) or `module.exports` (Node, for testing).
// ============================================================================

const SIZE = 10;

const MOVE_RANGE = { T: 2, P: 3, S: 2, A: 1, M: 1, D: 1, I: 1, E: 1, O: 1, G: 1, R: 1 };
const CAN_MELEE = new Set(['T', 'P', 'S', 'I', 'E', 'O', 'G', 'R']);
// (min, max) taxicab firing range for T/A/M/G. D is handled separately (same shape, different rule).
const FIRE_RANGE = { T: [1, 1], A: [1, 3], M: [2, 6], G: [1, 1], D: [1, 4] };
const NAMES = {
  T: 'Tank', P: 'Plane', S: 'Special Forces', A: 'Artillery',
  M: 'Missile Launcher', D: 'Air Defense', I: 'Infantry',
  E: 'Engineer', O: 'Drone Operator', G: 'Machine Gunner', R: 'Drone',
};
// Point values for scoring. I/T/A/S/D/M come directly from the spec.
// P (Plane) and R (Drone) weren't specified, so they're assigned values in
// line with their combat role: P sits between Artillery and Tank, R (a
// disposable, hard-to-kill scout) is valued like base Infantry.
const VALUES = { I: 1, E: 2, O: 2, G: 2, T: 5, A: 3, S: 6, D: 10, M: 20, P: 4, R: 1 };

function isPiece(cell) {
  return cell !== null && cell !== 'W' && typeof cell === 'object';
}

function makePiece(type, side, damaged = false, ammo = 0) {
  return { type, side, damaged, ammo };
}

function makeBoard() {
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  const order = 'TPSAMDASPT';
  for (let c = 0; c < SIZE; c++) {
    board[0][c] = makePiece(order[c], 'white');
    board[9][c] = makePiece(order[c], 'black');
  }
  for (let c = 0; c < SIZE; c++) {
    board[1][c] = makePiece('I', 'white');
    board[8][c] = makePiece('I', 'black');
  }
  const trench = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
  return { board, trench };
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

function cloneState(board, trench) {
  const b2 = board.map((row) => row.map((cell) => (isPiece(cell) ? { ...cell } : cell)));
  const t2 = trench.map((row) => row.slice());
  return { board: b2, trench: t2 };
}

function startTurn(board, side) {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const p = board[r][c];
      if (isPiece(p) && p.side === side && (p.type === 'M' || p.type === 'O')) p.ammo += 1;
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

// Returns 'killed' | 'damaged' | 'none'. Full-health-tank-melee special case
// is handled by the caller (landOrMelee), same as in the Python original.
function resolveHit(defender, attackerType, melee) {
  if (defender.type === 'P') {
    if (attackerType === 'D' || attackerType === 'ICBM') return 'killed';
    return melee ? 'killed' : 'none';
  }
  if (defender.type === 'R') {
    if (attackerType === 'D') return 'killed';
    if (attackerType === 'T' && !melee) return 'killed';
    if (attackerType === 'P' && melee) return 'killed';
    return 'none';
  }
  if (defender.type === 'T') {
    if (attackerType === 'P' || attackerType === 'M' || attackerType === 'ICBM') return 'killed';
    return defender.damaged ? 'killed' : 'damaged';
  }
  return 'killed';
}

function landOrMelee(board, trench, piece, r1, c1, r2, c2, log, graveyard) {
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
    board[r2][c2] = piece;
    board[r1][c1] = null;
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

  // Full-health tank melee special case (unless attacker is a Plane).
  if (target.type === 'T' && !target.damaged && piece.type !== 'P') {
    board[r1][c1] = null;
    graveyard.push({ type: piece.type, side: piece.side });
    log.push(`${NAMES[piece.type]} charged a full-strength tank and was destroyed!`);
    return true;
  }

  const result = resolveHit(target, piece.type, true);
  if (result === 'none') {
    log.push(`${NAMES[piece.type]} attacked the enemy ${NAMES[target.type]}, but it had no effect.`);
    return true;
  }
  if (result === 'damaged') {
    target.damaged = true;
    log.push(`Enemy ${NAMES[target.type]} at (${r2},${c2}) is now DAMAGED.`);
    return true;
  }
  graveyard.push({ type: target.type, side: target.side });
  log.push(`Enemy ${NAMES[target.type]} at (${r2},${c2}) was DESTROYED!`);
  board[r2][c2] = piece;
  board[r1][c1] = null;
  return true;
}

function doMove(board, trench, side, r1, c1, r2, c2, log, graveyard) {
  const piece = board[r1][c1];
  if (!isPiece(piece)) { log.push('CHECK FAILED: no unit at that square.'); return false; }
  if (piece.side !== side) { log.push("CHECK FAILED: you don't own that unit."); return false; }
  const steps = lineSteps(r1, c1, r2, c2);
  if (steps === null) { log.push('CHECK FAILED: movement must be a straight orthogonal or diagonal line.'); return false; }
  if (steps > MOVE_RANGE[piece.type]) {
    log.push(`CHECK FAILED: ${NAMES[piece.type]} can move at most ${MOVE_RANGE[piece.type]} squares.`);
    return false;
  }
  for (const [pr, pc] of pathCells(r1, c1, r2, c2)) {
    if (board[pr][pc] !== null) { log.push(`CHECK FAILED: path is blocked at (${pr},${pc}).`); return false; }
  }
  return landOrMelee(board, trench, piece, r1, c1, r2, c2, log, graveyard);
}

function doAbility(board, trench, side, r1, c1, r2, c2, extra, log, graveyard) {
  const piece = board[r1][c1];
  if (!isPiece(piece)) { log.push('CHECK FAILED: no unit at that square.'); return false; }
  if (piece.side !== side) { log.push("CHECK FAILED: you don't own that unit."); return false; }

  if (piece.type === 'P') { log.push('CHECK FAILED: planes have no ability.'); return false; }

  if (piece.type === 'S') {
    const steps = lineSteps(r1, c1, r2, c2);
    if (steps === null) { log.push('CHECK FAILED: movement must be a straight orthogonal or diagonal line.'); return false; }
    if (steps > MOVE_RANGE.S) { log.push('CHECK FAILED: Special Forces can move at most 2 squares.'); return false; }
    for (const [pr, pc] of pathCells(r1, c1, r2, c2)) {
      const cell = board[pr][pc];
      if (isPiece(cell) && cell.side === side) {
        log.push(`CHECK FAILED: path is blocked by your own unit at (${pr},${pc}).`);
        return false;
      }
    }
    log.push('Special Forces phase through any enemies/wasteland in the way...');
    return landOrMelee(board, trench, piece, r1, c1, r2, c2, log, graveyard);
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
    piece.type = choice;
    log.push(`Infantry at (${r1},${c1}) promoted to ${NAMES[choice]}!`);
    return true;
  }

  if (piece.type === 'E') {
    if (r1 === r2 && c1 === c2) { log.push('CHECK FAILED: choose an adjacent tile, not your own square.'); return false; }
    if (chebyshev(r1, c1, r2, c2) !== 1) {
      log.push('CHECK FAILED: Engineers can only build/remove a trench on an adjacent tile.');
      return false;
    }
    if (board[r2][c2] === 'W') { log.push("CHECK FAILED: can't entrench a wasteland tile."); return false; }
    if (trench[r2][c2]) {
      trench[r2][c2] = false;
      log.push(`Trench at (${r2},${c2}) removed.`);
    } else {
      trench[r2][c2] = true;
      log.push(`Trench built at (${r2},${c2}).`);
    }
    return true;
  }

  if (piece.type === 'O') {
    if (chebyshev(r1, c1, r2, c2) !== 1) { log.push('CHECK FAILED: a drone must be deployed to an adjacent tile.'); return false; }
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
    if (isPiece(target)) {
      graveyard.push({ type: target.type, side: target.side });
      log.push(`ICBM strike destroys ${NAMES[target.type]} at (${r2},${c2})!`);
    }
    board[r2][c2] = 'W';
    trench[r2][c2] = false;
    const killed = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r2 + dr, nc = c2 + dc;
        if (!inBounds(nr, nc)) continue;
        const cell = board[nr][nc];
        if (!isPiece(cell)) continue;
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

// Scans all 100 squares and returns the list of [r,c] targets that would be
// legal for this action, by dry-running doMove/doAbility against a clone.
// This guarantees the highlighted squares always match the real rules,
// since it's the exact same validation code, not a re-derived subset.
function computeLegalTargets(board, trench, side, r1, c1, isMove, extra) {
  const targets = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const clone = cloneState(board, trench);
      const log = [];
      const graveyard = [];
      const ok = isMove
        ? doMove(clone.board, clone.trench, side, r1, c1, r, c, log, graveyard)
        : doAbility(clone.board, clone.trench, side, r1, c1, r, c, extra, log, graveyard);
      if (ok) targets.push([r, c]);
    }
  }
  return targets;
}

const Engine = {
  SIZE, MOVE_RANGE, CAN_MELEE, FIRE_RANGE, NAMES, VALUES,
  isPiece, makePiece, makeBoard, inBounds, taxicab, chebyshev,
  lineSteps, pathCells, cloneState, startTurn, checkWin,
  isShieldedByAirDefense, resolveHit, landOrMelee, doMove, doAbility,
  pieceValue, computeScore, computeLegalTargets,
};

if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
if (typeof window !== 'undefined') window.Engine = Engine;
