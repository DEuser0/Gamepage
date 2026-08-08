(function () {
  'use strict';
  const E = window.Engine;
  const SIZE = E.SIZE;

  // ---------------------------------------------------------------------
  // Piece icons — minimalist 2D line-art, one per unit type.
  // ---------------------------------------------------------------------
  const ICONS = {
    T: `<rect class="linepart" x="9" y="19" width="22" height="10" rx="2"/>
        <circle class="linepart" cx="20" cy="18" r="6.5"/>
        <line class="linepart" x1="20" y1="16" x2="31" y2="10"/>`,
    P: `<polygon class="linepart" points="20,7 32,29 20,23 8,29"/>
        <line class="linepart" x1="20" y1="17" x2="20" y2="24"/>`,
    S: `<polygon class="linepart" points="20,6 23.5,16.5 34.5,16.5 25.7,23 29,33.5 20,27 11,33.5 14.3,23 5.5,16.5 16.5,16.5"/>`,
    A: `<polygon class="linepart" points="12,27 29,27 24,13"/>
        <circle class="dotpart" cx="14.5" cy="29.5" r="2.6"/>
        <circle class="dotpart" cx="26.5" cy="29.5" r="2.6"/>`,
    M: `<polygon class="linepart" points="20,6 27,27 20,22.5 13,27"/>
        <line class="linepart" x1="14.5" y1="24" x2="9" y2="30"/>
        <line class="linepart" x1="25.5" y1="24" x2="31" y2="30"/>`,
    D: `<path class="linepart" d="M8,27 A12,12 0 0 1 32,27"/>
        <line class="linepart" x1="20" y1="27" x2="20" y2="32"/>
        <circle class="dotpart" cx="20" cy="16" r="2.2"/>`,
    I: `<circle class="dotpart" cx="20" cy="14" r="5"/>
        <line class="linepart" x1="20" y1="19.5" x2="20" y2="30"/>
        <line class="linepart" x1="13" y1="23.5" x2="27" y2="23.5"/>
        <line class="linepart" x1="20" y1="30" x2="15" y2="35"/>
        <line class="linepart" x1="20" y1="30" x2="25" y2="35"/>`,
    E: `<polygon class="linepart" points="20,7 28,12 28,22 20,27 12,22 12,12"/>
        <circle class="linepart" cx="20" cy="17" r="4"/>`,
    O: `<path class="linepart" d="M13,29 A10,10 0 0 1 27,29"/>
        <path class="linepart" d="M16.5,25 A5.5,5.5 0 0 1 23.5,25"/>
        <circle class="dotpart" cx="20" cy="24" r="2.6"/>`,
    G: `<circle class="linepart" cx="20" cy="20" r="10"/>
        <line class="linepart" x1="20" y1="6" x2="20" y2="14"/>
        <line class="linepart" x1="20" y1="26" x2="20" y2="34"/>
        <line class="linepart" x1="6" y1="20" x2="14" y2="20"/>
        <line class="linepart" x1="26" y1="20" x2="34" y2="20"/>
        <circle class="dotpart" cx="20" cy="20" r="2.4"/>`,
    R: `<circle class="dotpart" cx="20" cy="20" r="2.8"/>
        <line class="linepart" x1="20" y1="20" x2="10" y2="10"/>
        <line class="linepart" x1="20" y1="20" x2="30" y2="10"/>
        <line class="linepart" x1="20" y1="20" x2="10" y2="30"/>
        <line class="linepart" x1="20" y1="20" x2="30" y2="30"/>
        <circle class="linepart" cx="10" cy="10" r="3"/>
        <circle class="linepart" cx="30" cy="10" r="3"/>
        <circle class="linepart" cx="10" cy="30" r="3"/>
        <circle class="linepart" cx="30" cy="30" r="3"/>`,
  };

  function pieceIconSVG(piece, extraClass) {
    const cls = ['piece-icon', piece.side === 'white' ? 'side-white' : 'side-black'];
    if (piece.damaged) cls.push('damaged');
    if (extraClass) cls.push(extraClass);
    return `<svg class="${cls.join(' ')}" viewBox="0 0 40 40" aria-hidden="true">${ICONS[piece.type] || ''}</svg>`;
  }

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  let state = null;

  function newState() {
    const { board, trench } = E.makeBoard();
    const side = 'white';
    E.startTurn(board, side);
    return {
      board, trench, side, turnNum: 1, graveyard: [],
      logEntries: [{ text: `— WHITE's turn (turn 1) —`, kind: 'turnmark' }],
      selected: null, mode: null, extra: null, legalTargets: [],
      gameOver: false, winner: null,
    };
  }

  // ---------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------
  const menuScreen = document.getElementById('menu-screen');
  const gameScreen = document.getElementById('game-screen');
  const boardGrid = document.getElementById('board-grid');
  const actionBar = document.getElementById('action-bar');
  const logPanel = document.getElementById('log-panel');
  const turnPill = document.getElementById('turn-pill');
  const toastEl = document.getElementById('toast');

  const panels = {
    white: {
      score: document.getElementById('score-white'),
      ammo: document.getElementById('ammo-white'),
      count: document.getElementById('count-white'),
    },
    black: {
      score: document.getElementById('score-black'),
      ammo: document.getElementById('ammo-black'),
      count: document.getElementById('count-black'),
    },
  };

  // ---------------------------------------------------------------------
  // Menu wiring
  // ---------------------------------------------------------------------
  document.getElementById('btn-new-game').addEventListener('click', () => {
    state = newState();
    showGame();
  });

  const loadPanel = document.getElementById('load-panel');
  document.getElementById('btn-show-load').addEventListener('click', () => {
    loadPanel.classList.toggle('hidden');
  });
  document.getElementById('save-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { document.getElementById('save-text-input').value = String(reader.result).trim(); };
    reader.readAsText(file);
  });
  document.getElementById('btn-load-confirm').addEventListener('click', () => {
    const raw = document.getElementById('save-text-input').value.trim();
    const errEl = document.getElementById('load-error');
    errEl.classList.remove('show');
    if (!raw) { errEl.textContent = 'Paste a save code or choose a file first.'; errEl.classList.add('show'); return; }
    try {
      state = deserializeSave(raw);
      showGame();
    } catch (e) {
      errEl.textContent = "Couldn't read that save code — it may be corrupted or from a different version.";
      errEl.classList.add('show');
    }
  });

  document.getElementById('btn-back-to-menu').addEventListener('click', () => {
    if (confirm('Return to the main menu? Any unsaved progress in this match will be lost.')) {
      showMenu();
    }
  });

  function showGame() {
    menuScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    document.getElementById('load-error').classList.remove('show');
    document.getElementById('save-text-input').value = '';
    loadPanel.classList.add('hidden');
    renderAll();
  }
  function showMenu() {
    gameScreen.classList.add('hidden');
    menuScreen.classList.remove('hidden');
  }

  // ---------------------------------------------------------------------
  // Board rendering
  // ---------------------------------------------------------------------
  function buildBoardSkeleton() {
    boardGrid.innerHTML = '';
    // visual row 0 (top) = board row 9 (black home); visual row 9 (bottom) = board row 0 (white home)
    for (let vr = 0; vr < SIZE; vr++) {
      const r = SIZE - 1 - vr;
      for (let c = 0; c < SIZE; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell' + ((r + c) % 2 === 0 ? ' light' : '');
        cell.dataset.r = r;
        cell.dataset.c = c;
        cell.addEventListener('click', () => onCellClick(r, c));
        boardGrid.appendChild(cell);
      }
    }
  }

  function targetKind(r, c) {
    const cell = state.board[r][c];
    if (E.isPiece(cell) && cell.side !== state.side) return 'attack';
    return state.mode === 'move' ? 'move' : 'ability';
  }

  function renderBoard() {
    const targetMap = new Map(state.legalTargets.map(([r, c]) => [`${r},${c}`, targetKind(r, c)]));
    for (const cellEl of boardGrid.children) {
      const r = Number(cellEl.dataset.r), c = Number(cellEl.dataset.c);
      const val = state.board[r][c];
      cellEl.classList.remove('wasteland', 'trenched', 'selected', 'target-move', 'target-attack', 'target-ability', 'selectable');
      cellEl.innerHTML = '';

      if (state.trench[r][c] && val !== 'W') cellEl.classList.add('trenched');

      if (val === 'W') {
        cellEl.classList.add('wasteland');
      } else if (E.isPiece(val)) {
        cellEl.innerHTML = pieceIconSVG(val);
        if ((val.type === 'M' || val.type === 'O') && val.ammo > 0) {
          const badge = document.createElement('span');
          badge.className = 'ammo-badge';
          badge.textContent = val.ammo;
          cellEl.appendChild(badge);
        }
      }

      if (state.selected && state.selected.r === r && state.selected.c === c) {
        cellEl.classList.add('selected');
      }
      const key = `${r},${c}`;
      if (targetMap.has(key)) {
        cellEl.classList.add('target-' + targetMap.get(key));
        cellEl.classList.add('selectable');
      } else if (!state.gameOver && E.isPiece(val) && val.side === state.side && !state.mode) {
        cellEl.classList.add('selectable');
      }
    }
  }

  // ---------------------------------------------------------------------
  // Interaction
  // ---------------------------------------------------------------------
  function onCellClick(r, c) {
    if (state.gameOver) return;
    const key = `${r},${c}`;
    const isTarget = state.selected && state.mode && state.legalTargets.some(([tr, tc]) => tr === r && tc === c);

    if (isTarget) {
      performAction(r, c);
      return;
    }

    const cell = state.board[r][c];
    if (E.isPiece(cell) && cell.side === state.side) {
      if (state.selected && state.selected.r === r && state.selected.c === c) {
        deselect();
      } else {
        selectPiece(r, c);
      }
      return;
    }
    if (state.selected) deselect();
  }

  function selectPiece(r, c) {
    state.selected = { r, c };
    state.mode = null;
    state.extra = null;
    state.legalTargets = [];
    renderAll();
  }

  function deselect() {
    state.selected = null;
    state.mode = null;
    state.extra = null;
    state.legalTargets = [];
    renderAll();
  }

  function chooseMode(kind, extra) {
    const { r, c } = state.selected;
    const targets = E.computeLegalTargets(state.board, state.trench, state.side, r, c, kind === 'move', extra);
    if (targets.length === 0) {
      showToast('No legal targets for that action right now.');
      return;
    }
    state.mode = kind;
    state.extra = extra;
    state.legalTargets = targets;
    renderAll();
  }

  function performAction(r2, c2) {
    const { r: r1, c: c1 } = state.selected;
    const actingType = state.board[r1][c1].type;
    const log = [];
    const ok = state.mode === 'move'
      ? E.doMove(state.board, state.trench, state.side, r1, c1, r2, c2, log, state.graveyard)
      : E.doAbility(state.board, state.trench, state.side, r1, c1, r2, c2, state.extra, log, state.graveyard);
    pushLog(log);
    if (!ok) { showToast(log[log.length - 1] || 'Action failed.'); return; }
    finishAction(state.mode === 'move', actingType);
  }

  function performInstantAbility(r1, c1, extra) {
    const log = [];
    const ok = E.doAbility(state.board, state.trench, state.side, r1, c1, r1, c1, extra, log, state.graveyard);
    pushLog(log);
    if (!ok) { showToast(log[log.length - 1] || 'Action failed.'); return; }
    finishAction(false, state.board[r1][c1].type);
  }

  function finishAction(wasMove, actingType) {
    const winner = E.checkWin(state.board);
    state.selected = null;
    state.mode = null;
    state.extra = null;
    state.legalTargets = [];

    if (winner) {
      state.gameOver = true;
      state.winner = winner;
      renderAll();
      showWinnerModal(winner);
      return;
    }

    if (wasMove && actingType === 'R') {
      pushLog([{ text: `(Drone move — doesn't cost the turn. ${cap(state.side)} goes again.)`, kind: 'note' }]);
    } else {
      state.side = state.side === 'white' ? 'black' : 'white';
      if (state.side === 'white') state.turnNum += 1;
      E.startTurn(state.board, state.side);
      pushLog([{ text: `— ${cap(state.side)}'s turn (turn ${state.turnNum}) —`, kind: 'turnmark' }]);
    }
    renderAll();
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function pushLog(entries) {
    for (const e of entries) {
      if (typeof e === 'string') {
        let kind = 'line';
        if (e.startsWith('CHECK FAILED')) kind = 'fail';
        else if (/DESTROYED|kills|ICBM launched/.test(e)) kind = 'kill';
        state.logEntries.push({ text: e, kind });
      } else {
        state.logEntries.push(e);
      }
    }
    if (state.logEntries.length > 300) state.logEntries.splice(0, state.logEntries.length - 300);
  }

  // ---------------------------------------------------------------------
  // Action bar
  // ---------------------------------------------------------------------
  const ABILITY_LABEL = {
    S: 'Phase Move', E: 'Trench', O: 'Deploy Drone', D: 'Fire',
    T: 'Fire', A: 'Fire', G: 'Fire',
  };

  function renderActionBar() {
    actionBar.innerHTML = '';
    if (!state.selected) {
      actionBar.innerHTML = `<div class="placeholder-text">Select one of your units on the board to move or act with it.</div>`;
      return;
    }
    const { r, c } = state.selected;
    const piece = state.board[r][c];
    if (!piece) { state.selected = null; return; }

    const info = document.createElement('div');
    info.className = 'selection-info';
    info.innerHTML = `
      <div class="selection-icon">${pieceIconSVG(piece)}</div>
      <div class="selection-text">
        <div class="unit-name">${E.NAMES[piece.type]}${piece.damaged ? ' (damaged)' : ''}</div>
        <div class="unit-coord">${cap(piece.side)} unit${(piece.type === 'M' || piece.type === 'O') ? ' · ammo ' + piece.ammo : ''}</div>
      </div>`;
    actionBar.appendChild(info);

    const btnRow = document.createElement('div');
    btnRow.className = 'action-buttons';

    const moveBtn = mkBtn('Move', state.mode === 'move', () => chooseMode('move', null));
    btnRow.appendChild(moveBtn);

    if (piece.type === 'I') {
      const promoWrap = document.createElement('div');
      promoWrap.className = 'promote-row';
      promoWrap.appendChild(mkBtn('→ Engineer', false, () => performInstantAbility(r, c, 'E')));
      promoWrap.appendChild(mkBtn('→ Drone Op.', false, () => performInstantAbility(r, c, 'O')));
      promoWrap.appendChild(mkBtn('→ MG Gunner', false, () => performInstantAbility(r, c, 'G')));
      btnRow.appendChild(promoWrap);
    } else if (piece.type === 'M') {
      btnRow.appendChild(mkBtn('Fire', state.mode === 'ability' && state.extra !== 'icbm', () => chooseMode('ability', null)));
      if (piece.ammo >= 10) {
        btnRow.appendChild(mkBtn('Launch ICBM', state.mode === 'ability' && state.extra === 'icbm', () => chooseMode('ability', 'icbm')));
      }
    } else if (piece.type !== 'P' && piece.type !== 'R') {
      const label = ABILITY_LABEL[piece.type] || 'Ability';
      btnRow.appendChild(mkBtn(label, state.mode === 'ability', () => chooseMode('ability', null)));
    }

    btnRow.appendChild(mkBtn('Cancel', false, deselect, 'btn-ghost'));
    actionBar.appendChild(btnRow);
  }

  function mkBtn(label, active, onClick, extraClass) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn' + (active ? ' active' : '') + (extraClass ? ' ' + extraClass : '');
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  // ---------------------------------------------------------------------
  // Side panels
  // ---------------------------------------------------------------------
  function renderPanels() {
    for (const side of ['white', 'black']) {
      const p = panels[side];
      p.score.textContent = E.computeScore(state.board, state.graveyard, side);
      const ammoUnits = [];
      let unitCount = 0;
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          const cell = state.board[r][c];
          if (E.isPiece(cell) && cell.side === side) {
            unitCount++;
            if (cell.type === 'M' || cell.type === 'O') ammoUnits.push({ r, c, type: cell.type, ammo: cell.ammo });
          }
        }
      }
      p.count.textContent = `${unitCount} unit${unitCount === 1 ? '' : 's'} on the field`;
      p.ammo.innerHTML = '';
      if (ammoUnits.length === 0) {
        const li = document.createElement('li');
        li.className = 'ammo-empty';
        li.textContent = 'No missile launchers or drone operators';
        p.ammo.appendChild(li);
      } else {
        for (const u of ammoUnits) {
          const li = document.createElement('li');
          const label = u.type === 'M' ? 'Missile Launcher' : 'Drone Operator';
          li.innerHTML = `<span>${label} (${u.r},${u.c})</span><span class="ammo-val">${u.ammo}${u.type === 'M' ? '/10' : '/2'}</span>`;
          li.addEventListener('click', () => {
            if (E.isPiece(state.board[u.r][u.c]) && state.board[u.r][u.c].side === state.side && !state.gameOver) {
              selectPiece(u.r, u.c);
            }
          });
          p.ammo.appendChild(li);
        }
      }
    }
  }

  function renderTurnPill() {
    if (state.gameOver) {
      turnPill.textContent = `${cap(state.winner)} wins`;
      turnPill.className = 'turn-pill side-' + state.winner;
      return;
    }
    turnPill.textContent = `${cap(state.side)}'s turn — turn ${state.turnNum}`;
    turnPill.className = 'turn-pill side-' + state.side;
  }

  function renderLog() {
    logPanel.innerHTML = state.logEntries
      .map((e) => `<div class="log-line log-${e.kind}">${escapeHtml(e.text)}</div>`)
      .join('');
    logPanel.scrollTop = logPanel.scrollHeight;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  function renderAll() {
    if (boardGrid.children.length !== SIZE * SIZE) buildBoardSkeleton();
    renderBoard();
    renderActionBar();
    renderPanels();
    renderTurnPill();
    renderLog();
  }

  // ---------------------------------------------------------------------
  // Winner modal
  // ---------------------------------------------------------------------
  function showWinnerModal(winner) {
    const overlay = document.getElementById('winner-modal');
    overlay.classList.remove('hidden');
    const banner = document.getElementById('winner-banner-side');
    banner.textContent = cap(winner);
    banner.className = 'win-side ' + winner;
  }
  document.getElementById('winner-close').addEventListener('click', () => {
    document.getElementById('winner-modal').classList.add('hidden');
  });
  document.getElementById('winner-menu').addEventListener('click', () => {
    document.getElementById('winner-modal').classList.add('hidden');
    showMenu();
  });

  // ---------------------------------------------------------------------
  // Save / Load
  // ---------------------------------------------------------------------
  function b64encode(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }
  function b64decode(str) {
    return decodeURIComponent(escape(atob(str)));
  }

  function serializeSave() {
    const cells = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const v = state.board[r][c];
        if (v === null) cells.push(0);
        else if (v === 'W') cells.push('W');
        else cells.push([v.type, v.side === 'white' ? 1 : 0, v.damaged ? 1 : 0, v.ammo]);
      }
    }
    const trenchFlat = [];
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) trenchFlat.push(state.trench[r][c] ? 1 : 0);
    const graveyard = state.graveyard.map((g) => [g.type, g.side === 'white' ? 1 : 0]);
    const payload = {
      v: 1,
      cells,
      trench: trenchFlat,
      graveyard,
      side: state.side === 'white' ? 1 : 0,
      turnNum: state.turnNum,
    };
    return 'TCX1-' + b64encode(JSON.stringify(payload));
  }

  function deserializeSave(raw) {
    let body = raw.trim();
    if (body.startsWith('TCX1-')) body = body.slice(5);
    const payload = JSON.parse(b64decode(body));
    if (!payload || !Array.isArray(payload.cells) || payload.cells.length !== SIZE * SIZE) {
      throw new Error('bad payload');
    }
    const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
    for (let i = 0; i < SIZE * SIZE; i++) {
      const r = Math.floor(i / SIZE), c = i % SIZE;
      const cellVal = payload.cells[i];
      if (cellVal === 0) board[r][c] = null;
      else if (cellVal === 'W') board[r][c] = 'W';
      else board[r][c] = E.makePiece(cellVal[0], cellVal[1] === 1 ? 'white' : 'black', !!cellVal[2], cellVal[3] || 0);
    }
    const trench = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
    if (Array.isArray(payload.trench) && payload.trench.length === SIZE * SIZE) {
      for (let i = 0; i < SIZE * SIZE; i++) {
        const r = Math.floor(i / SIZE), c = i % SIZE;
        trench[r][c] = !!payload.trench[i];
      }
    }
    const graveyard = Array.isArray(payload.graveyard)
      ? payload.graveyard.map((g) => ({ type: g[0], side: g[1] === 1 ? 'white' : 'black' }))
      : [];
    const side = payload.side === 1 ? 'white' : 'black';
    const turnNum = payload.turnNum || 1;
    const winner = E.checkWin(board);
    return {
      board, trench, side, turnNum, graveyard,
      logEntries: [{ text: `Save loaded — ${cap(side)}'s turn (turn ${turnNum}).`, kind: 'turnmark' }],
      selected: null, mode: null, extra: null, legalTargets: [],
      gameOver: !!winner, winner,
    };
  }

  document.getElementById('btn-save-game').addEventListener('click', () => {
    const code = serializeSave();
    document.getElementById('save-output').value = code;
    document.getElementById('save-modal').classList.remove('hidden');
  });
  document.getElementById('save-modal-close').addEventListener('click', () => {
    document.getElementById('save-modal').classList.add('hidden');
  });
  document.getElementById('btn-copy-save').addEventListener('click', async () => {
    const ta = document.getElementById('save-output');
    ta.select();
    try {
      await navigator.clipboard.writeText(ta.value);
      showToast('Save code copied to clipboard.');
    } catch (e) {
      showToast('Copy failed — select the text and copy manually.');
    }
  });
  document.getElementById('btn-download-save').addEventListener('click', () => {
    const code = document.getElementById('save-output').value;
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tactics-chess-save-turn${state.turnNum}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
})();
