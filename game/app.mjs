import { createGame, SAVE_KEY, startNewRun, commitRun } from './engine.mjs';
import { createNarrator } from './narration.mjs';
import { createSound } from './sound.mjs';

const app = document.querySelector('#app');
const art = document.querySelector('#art');
const journalDialog = document.querySelector('#journal-dialog');
const eventDialog = document.querySelector('#event-dialog');
const notices = document.querySelector('#notices');
const transition = document.querySelector('#transition');
const sound = createSound();
const narrator = createNarrator(document.querySelector('#narration'), (line) => {
  const colon = line.indexOf('：');
  if (colon < 1 || colon > 14) return null;
  const speaker = line.slice(0, colon);
  const entry = portraits.find(({ speakers }) => speakers.some((name) => speaker.startsWith(name)));
  return entry ? artwork[entry.id] : null;
});
let game, scenes, achievements, artwork, hunter, portraits;
let activeRun, view = 'menu', busy = false, audioEnabled = false;
let selectedObject = null, noticeTimer, transitionTimer;

function el(tag, options = {}, ...children) {
  const element = Object.assign(document.createElement(tag), options);
  element.append(...children);
  return element;
}

function button(label, onclick, options = {}, ...children) {
  return el('button', { type: 'button', onclick, ...options }, label, ...children);
}

function show(mode, scroll = 0) {
  narrator.dismiss();
  clearTimeout(transitionTimer);
  transition.hidden = true;
  clearTimeout(noticeTimer);
  notices.replaceChildren();
  if (journalDialog.open) journalDialog.close();
  if (eventDialog.open) eventDialog.close();
  view = mode;
  draw();
  app.querySelector('h1')?.focus({ preventScroll: true });
  window.scrollTo(0, scroll);
}

function profile() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return { active: null, archive: [], achievements: [] };
  const stored = JSON.parse(raw);
  if (stored.active) stored.active = game.restore(stored.active);
  stored.archive = stored.archive.map((run) => game.restore(run));
  return stored;
}

function backdrop(id) {
  document.body.dataset.scene = id;
  document.body.classList.toggle('has-art', Boolean(artwork[id]));
  art.style.backgroundImage = artwork[id] ? `url("${artwork[id]}")` : '';
}

function heading(text, options = {}) {
  return el('h1', { textContent: text, tabIndex: -1, ...options });
}

function reportError(error) {
  narrator.dismiss();
  clearTimeout(transitionTimer);
  transition.hidden = true;
  if (eventDialog.open) eventDialog.close();
  if (journalDialog.open) journalDialog.close();
  const message = `游戏暂时无法继续。请确认本地服务仍在运行，并允许浏览器保存本地数据。\n${error.message}`;
  view = 'error';
  app.className = 'cover';
  app.replaceChildren(el('section', { className: 'sheet' }, heading('无法运行游戏'),
    el('p', { className: 'error', textContent: message }),
    button('重新载入', () => location.reload(), { className: 'action' })));
}

function soundButton() {
  return button(audioEnabled ? '关闭声音' : '开启声音', async (event) => {
    const control = event.currentTarget;
    const enabled = !audioEnabled;
    control.disabled = true;
    try {
      await sound.setEnabled(enabled);
      audioEnabled = enabled;
      control.textContent = audioEnabled ? '关闭声音' : '开启声音';
    } catch (error) {
      reportError(error);
    } finally {
      control.disabled = false;
    }
  }, { className: 'utility sound-toggle' });
}

function playIntro() {
  sound.intro();
  narrator.open({
    label: '灰雾之上', pages: game.text(activeRun), skipIntro: true,
    finishLabel: '进入第一幕', onFinish: () => play('begin')
  });
}

function narrate(run) {
  narrator.open({ label: game.nodes[run.node].title, pages: run.narration,
    onFinish: () => run.pending_presentation?.kind === 'promotion' ? promotion(run) : notify(run) });
}

function notify(run) {
  clearTimeout(noticeTimer);
  notices.replaceChildren();
  if (run.ending) return;
  let index = 0;
  function next() {
    notices.replaceChildren();
    const notice = run.notifications[index++];
    if (!notice || view !== 'story' || activeRun.turn !== run.turn) return;
    const toast = button(notice.text, () => {
      clearTimeout(noticeTimer);
      notices.replaceChildren();
      if (notice.kind === 'clue') openClues(notice.id);
    }, { className: `notice notice-${notice.kind}` });
    notices.append(toast);
    noticeTimer = setTimeout(next, 4000);
  }
  next();
}

function present(run) {
  if (run.node === 'intro') { playIntro(); return; }
  if (run.pending_presentation?.kind === 'wake') {
    eventDialog.className = 'wake-scene';
    eventDialog.replaceChildren(el('h2', { id: 'event-title', textContent: '苏醒' }),
      el('p', { textContent: '头……好痛。\n我睡了多久？' }),
      button('睁开眼睛', () => {
        clearTimeout(transitionTimer);
        eventDialog.close();
        act((state) => game.acknowledge(state));
      }, { className: 'utility' }));
    eventDialog.showModal();
    transitionTimer = setTimeout(() => eventDialog.querySelector('button').click(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 300 : 3400);
    return;
  }
  narrate(run);
}

function promotion(run) {
  eventDialog.className = 'promotion-card';
  eventDialog.replaceChildren(
    el('img', { src: artwork.hunter_awakening, alt: '墙内封存的暗红结晶破裂，特性经伤口异常进入身体。', className: 'event-art' }),
    el('div', { className: 'promotion-copy' },
      el('p', { className: 'location', textContent: '你成为了非凡者' }),
      el('h2', { id: 'event-title', textContent: '红祭司途径 · 序列 9 · 猎人' }),
      el('p', { className: 'change-control', textContent: `失控度 ${run.stats.loss_of_control}%` }),
      el('meter', { min: 0, max: 100, value: run.stats.loss_of_control, ariaLabel: '当前失控度' }),
      el('p', { textContent: `体力上限 4 → ${run.stats.stamina_max}，当前体力 ${run.stats.stamina}` }),
      el('h3', { textContent: `解锁技能 · ${hunter.skill_name}` }),
      el('p', { textContent: '更容易察觉陷阱、追踪目标、分辨环境中的异常痕迹。' }),
      el('p', { textContent: '你异常吸收了封存于墙体内的猎人非凡特性，未经正规魔药晋升。污染与失控风险已经显现。' }),
      button(run.pending_presentation ? '记下变化，继续调查' : '关闭', () => {
        eventDialog.close();
        if (run.pending_presentation) act((state) => game.acknowledge(state));
      }, { className: 'action' })));
  eventDialog.showModal();
}

function walkTransition(run, done) {
  if (!run.movement || matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return; }
  transition.hidden = false;
  const stopSteps = sound.steps();
  transition.querySelector('p').textContent = `${run.movement.from} → ${run.movement.to} · ${run.movement.minutes} 分钟`;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(transitionTimer);
    transition.hidden = true;
    stopSteps?.();
    done();
  };
  transition.onclick = finish;
  transition.onkeydown = (event) => { if (event.key === ' ' || event.key === 'Enter') finish(); };
  transition.focus();
  transitionTimer = setTimeout(finish, 1000);
}

async function save(update) {
  if (busy) return;
  busy = true;
  try {
    const result = await navigator.locks.request(SAVE_KEY, () => {
      const current = profile();
      const changed = update(current);
      if (changed) localStorage.setItem(SAVE_KEY, JSON.stringify(changed.profile));
      return changed;
    });
    if (result) {
      const previous = view === 'story' ? activeRun : null;
      const scroll = previous?.node === result.run.node ? window.scrollY : 0;
      activeRun = result.run;
      selectedObject = null;
      show('story', scroll);
      walkTransition(activeRun, () => present(activeRun));
    } else {
      if (view === 'create' && profile().active) show('menu');
      else synchronize();
    }
  } catch (error) {
    reportError(error);
  } finally {
    busy = false;
  }
}

function play(action, item) {
  act((state) => item ? game.drop(state, item) : game.choose(state, action));
}

function act(update) {
  if (narrator.isOpen || !transition.hidden || eventDialog.open) return;
  const snapshot = activeRun;
  void save((current) => {
    const next = update(snapshot);
    if (!next) return null;
    const changed = commitRun(current, next);
    return changed ? { profile: changed, run: next } : null;
  });
}

function synchronize() {
  const stored = profile();
  if (view === 'story') {
    const latest = stored.active?.id === activeRun.id ? stored.active :
      stored.archive.find((run) => run.id === activeRun.id);
    if (latest) {
      if (latest.turn === activeRun.turn) return;
      activeRun = latest;
      show('story');
      present(latest);
      return;
    }
  }
  if (view !== 'create') show(view === 'story' ? 'menu' : view);
}

function menu() {
  const stored = profile();
  const resume = stored.active;
  const options = el('nav', { className: 'menu-options', ariaLabel: '主菜单' },
    button('开始游戏', () => show('create'), { disabled: Boolean(resume), className: 'menu-button' }),
    button('继续游戏', () => {
      activeRun = profile().active;
      show(activeRun ? 'story' : 'menu');
      if (activeRun) {
        if (activeRun.pending_presentation || activeRun.node === 'intro') present(activeRun);
      }
    }, { disabled: !resume, className: 'menu-button' },
    resume ? el('small', { textContent: resume.identity.name }) : ''),
    button('成就', () => show('archive'), { className: 'menu-button' }),
    button('退出游戏', async () => {
      await sound.setEnabled(false);
      audioEnabled = false;
      show('exit');
    }, { className: 'menu-button' }));
  return el('section', { className: 'title-card' },
    el('p', { className: 'series', textContent: '诡秘之主' }),
    heading('血雾班西', { className: 'game-title' }),
    el('div', { className: 'title-divider', ariaHidden: 'true' }, '◆'),
    el('p', { className: 'act', textContent: '第一幕　今夜，请不要开门。' }),
    options,
    soundButton(),
    el('p', { className: 'credit', textContent: '非官方同人游戏 · 改编时间线' }));
}

function createCharacter() {
  const name = el('input', { name: 'name', type: 'text', maxLength: 16, required: true, autocomplete: 'off' });
  const gender = el('select', { name: 'gender' },
    ...['未指定', '女', '男', '其他'].map((value) => el('option', { value, textContent: value })));
  const form = el('form', {
    onsubmit(event) {
      event.preventDefault();
      if (!name.value.trim()) {
        name.setCustomValidity('请输入角色姓名。');
        name.reportValidity();
        return;
      }
      const identity = { name: name.value.trim(), gender: gender.value };
      void save((current) => {
        const run = game.start(identity);
        const changed = startNewRun(current, run);
        return changed ? { profile: changed, run } : null;
      });
    }
  }, el('label', {}, '姓名', name), el('label', {}, '性别', gender),
  el('div', { className: 'utilities' },
    el('button', { type: 'submit', className: 'action primary', textContent: '进入序章' }),
    button('返回', () => show('menu'), { className: 'utility' })));
  name.oninput = () => name.setCustomValidity('');
  return el('section', { className: 'sheet' }, heading('创建角色'),
    el('p', { textContent: '你是一名班西港杂工。' }), form);
}

function archive() {
  const stored = profile();
  const seen = new Set(stored.archive.map((run) => run.ending));
  const entries = (values, unlocked) => el('ul', { className: 'archive-list' }, ...values.map(
    ([id, label]) => el('li', { className: unlocked.has(id) ? 'unlocked' : '' },
      el('span', { textContent: unlocked.has(id) ? label : '未解锁' }),
      el('small', { textContent: unlocked.has(id) ? '已记录' : '◇' }))
  ));
  const rows = [...stored.archive].reverse().map((run) => button(
    `${run.identity.name} · ${scenes.endings[run.ending]}`,
    () => { activeRun = run; show('story'); },
    { className: 'action' }
  ));
  return el('section', { className: 'sheet archive' },
    el('header', { className: 'archive-header' }, heading('成就与结局'),
      button('返回主菜单', () => show('menu'), { className: 'utility' })),
    el('div', { className: 'archive-grid' },
      el('section', {}, el('h2', { textContent: `成就 ${stored.achievements.length}／${achievements.length}` }),
        entries(achievements.map(({ id, name }) => [id, name]), new Set(stored.achievements))),
      el('section', {}, el('h2', { textContent: `结局 ${seen.size}／${Object.keys(scenes.endings).length}` }),
        entries(Object.entries(scenes.endings), seen))),
    ...(rows.length ? [el('h2', { textContent: '封存的角色' }), el('div', { className: 'actions' }, ...rows)] : []));
}

function intro(run) {
  return el('section', { className: 'intro-card' }, heading(game.nodes[run.node].title),
    el('div', { className: 'utilities' },
      button('播放序章', playIntro, { className: 'action primary' }),
      button('跳过序章', () => play('begin'), { className: 'utility' }),
      button('返回主菜单', () => show('menu'), { className: 'utility' })));
}

function journalHeader(title) {
  journalDialog.className = 'journal-modal';
  journalDialog.replaceChildren(el('header', { className: 'journal-toolbar' },
    el('h2', { id: 'journal-title', textContent: title }),
    button('关闭', () => journalDialog.close(), { className: 'utility' })),
  el('nav', { className: 'utilities', ariaLabel: '记录分类' },
    button('线索簿', () => openClues(), { className: 'utility' }),
    button('任务簿', openTasks, { className: 'utility' }),
    button('行动记录', openLog, { className: 'utility' })));
  if (!journalDialog.open) journalDialog.showModal();
}

function openClues(focusId) {
  const run = activeRun;
  journalHeader('线索与推理');
  const selected = new Set();
  const result = el('p', { className: 'journal-result', role: 'status' });
  const cards = el('div', { className: 'clue-cards' });
  const details = el('section', { className: 'clue-detail', ariaLabel: '线索详情' });
  function detail(id) {
    const card = run.cards[id];
    const definition = game.clues[id];
    details.replaceChildren(el('h3', { textContent: definition.name }),
      el('p', { className: 'location', textContent: definition.kind }),
      el('p', { textContent: definition.text }),
      ...(card.deductions.length ? [el('h4', { textContent: '推理过程' }), ...card.deductions.map((recipe) =>
        el('p', { textContent: game.clues[recipe].text }))] : []),
      el('h4', { textContent: '原始事实与来源' }),
      ...card.facts.map((fact) => {
        const found = run.discoveries[fact];
        const place = found.location.startsWith('home:') ? game.homeRegions[found.location.slice(5)].name : found.location;
        return el('article', { className: 'fact-record' },
          el('strong', { textContent: game.clues[fact].name }),
          el('p', { textContent: game.clues[fact].text }),
          el('small', { textContent: `${place} · ${found.minute === null ? '旧版未记录时间' : game.clock({ ...run, elapsed_minutes: found.minute })} · ${found.source}` }),
          ...(run.sold_facts[fact] ? [el('small', { textContent: '情报副本已出售 · 知识继续保留' })] : []));
      }),
      ...(id === 'fire_source' || card.facts.includes('fire_source') ? [el('p', { textContent: `已发现火源 ${run.fire_sources.map((source) => source.startsWith('home:') ? game.homeRegions[source.slice(5)].name : source).join('、')}` })] : []),
      ...(id === 'gehrman_whereabouts' && run.elapsed_minutes >= 173 ? [el('p', { textContent: '这条行踪记录已经过时。' })] : []),
      ...(!run.ending ? [button('在这张卡中继续推演', () => attempt([id]), { className: 'action' })] : []));
  }
  function attempt(ids) {
    if (run.ending || !ids.length) return;
    const combined = game.combine(run, ids);
    if (!combined) {
      result.textContent = '这些记录还不足以形成新的判断。事实的来源、时间或独立核验仍有缺口，原卡片保持不变。';
      return;
    }
    journalDialog.close();
    act((state) => game.combine(state, ids));
  }
  for (const id of run.clues) {
    const check = el('input', { type: 'checkbox', ariaLabel: `选择${game.clues[id].name}`, disabled: Boolean(run.ending) });
    check.onchange = () => {
      if (check.checked && selected.size === 2) { check.checked = false; result.textContent = '每次选两张卡。卡内已有的事实也可以继续推演。'; return; }
      if (check.checked) selected.add(id); else selected.delete(id);
      result.textContent = `已选择 ${selected.size} 张卡`;
    };
    cards.append(el('article', { className: 'clue-card' }, check,
      button(game.clues[id].name, () => detail(id), { className: 'clue-title' }),
      el('small', { textContent: `${game.clues[id].kind} · ${run.cards[id].facts.length} 条事实` })));
  }
  journalDialog.append(el('p', { className: 'muted', textContent: '点开卡片查看详情。选两张尝试关联，成功后原卡片归入结果。阅读与组合不消耗游戏时间。' }),
    cards, button('尝试关联', () => attempt([...selected]), { className: 'action', disabled: Boolean(run.ending) }), result, details);
  const actual = run.clues.find((id) => id === focusId || run.cards[id].facts.includes(focusId));
  if (actual) detail(actual);
}

function openTasks() {
  journalHeader('任务簿');
  const labels = { active: '调查中', completed: '已完成', sealed: '已封存' };
  journalDialog.append(...Object.values(activeRun.tasks).map((task) => el('section', { className: 'task-record' },
    el('h3', { textContent: task.name }), el('small', { textContent: labels[task.status] }),
    ...task.entries.map((entry) => el('p', { textContent: entry })))));
}

function openLog() {
  journalHeader('行动记录');
  journalDialog.append(button('回看当前剧情', () => {
    journalDialog.close();
    narrator.open({ label: game.nodes[activeRun.node].title, pages: [...activeRun.feedback, ...game.text(activeRun)] });
  }, { className: 'action' }),
  ...(activeRun.stats.pathway ? [button('查阅猎人晋升', () => { journalDialog.close(); promotion(activeRun); }, { className: 'utility' })] : []),
  ...activeRun.settlement_log.filter((entry) => entry.entries.length).slice().reverse().map((entry) =>
    el('section', { className: 'task-record' }, el('small', { textContent: `${game.clock({ ...activeRun, elapsed_minutes: entry.minute })} · ${entry.action}` }),
      ...entry.entries.map((notice) => el('p', { className: `change-${notice.kind}`, textContent: notice.text })))));
}

function confirmAction(choice) {
  const spending = (choice.effects ?? []).filter((effect) => effect.type === 'add_money' && effect.value < 0).reduce((sum, effect) => sum - effect.value, 0);
  if (!choice.map && !spending) { play(choice.id); return; }
  journalHeader(choice.map ? '确认出发' : '确认交涉');
  journalDialog.append(el('h3', { textContent: choice.label }),
    el('p', { textContent: `本次需要 ${choice.duration} 分钟，预计完成于 ${game.clock({ ...activeRun, elapsed_minutes: activeRun.elapsed_minutes + choice.duration })}。` }),
    ...(spending ? [el('p', { textContent: `支付 ${spending}，当前金钱 ${activeRun.money}。` })] : []),
    ...(choice.id === 'pay_berth' ? [el('p', { textContent: '通过筛查后方可成交。登船另需十分钟，最迟须在06:00完成。' })] : []),
    button(choice.map ? '出发' : '确认支付', () => { journalDialog.close(); play(choice.id); }, { className: 'action' }),
    button('取消', () => journalDialog.close(), { className: 'utility' }));
}

function tradePanel(run) {
  if (run.node !== 'market' || run.ending) return [];
  const offers = [
    ...run.clues.map((id) => game.quote(run, 'information', id)),
    ...run.inventory.map((id) => game.quote(run, 'item', id)),
    ...Object.keys(game.items).map((id) => game.quote(run, 'buyback', id))
  ].filter(Boolean);
  if (!offers.length) return [];
  return [el('section', { className: 'trade-panel' }, el('h2', { textContent: '收货人的报价' }),
    el('p', { className: 'muted', textContent: '情报只交付副本。按尚未出售的独立事实计价，每次交易两分钟。' }),
    ...offers.map((offer) => button(`${offer.kind === 'buyback' ? '买回' : '出售'}《${offer.name}》 · ${offer.price}`, () => {
      journalHeader('确认交易');
      journalDialog.append(el('h3', { textContent: offer.name }),
        el('p', { textContent: `${offer.buyer} · ${offer.price} · ${offer.minutes} 分钟` }),
        el('p', { textContent: offer.kind === 'information' ? `交付情报副本 ${offer.facts.map((id) => game.clues[id].name).join('、')}。卡片保留。` : `${offer.kind === 'buyback' ? '收回' : '交出'}实际物品，背包与所有权同时改变。` }),
        button('确认交易', () => { journalDialog.close(); act((state) => game.trade(state, offer.kind, offer.id)); }, { className: 'action' }),
        button('取消', () => journalDialog.close(), { className: 'utility' }));
    }, { className: 'action', disabled: offer.kind === 'buyback' && (run.money < offer.price || game.bagUsed(run) + game.items[offer.id].occupies_slots > run.inventory_limit) })))];
}

function status(run, node) {
  const { stats } = run;
  const statRows = [
    ['理智', stats.sanity], ['失控度', `${stats.loss_of_control}%`],
    ['体力', `${stats.stamina}／${stats.stamina_max}`],
    [game.hasFact(run, 'gehrman_whereabouts') ? '格尔曼信任' : '旅客关系', game.hasFact(run, 'gehrman_whereabouts') ? stats.gehrman_trust : '尚未结识']
  ];
  const slots = Array.from({ length: run.inventory_limit }, (_, index) => {
    const occupied = run.inventory.flatMap((id) => Array(game.items[id].occupies_slots).fill(id));
    const id = occupied[index];
    if (!id) return el('li', { className: 'slot empty', textContent: '空位' });
    const item = game.items[id];
    if (index > 0 && occupied[index - 1] === id) return el('li', { className: 'slot', textContent: `${item.name} · 占用第二格` });
    return el('li', { className: 'slot' },
      el('span', { textContent: item.name, title: [item.description, item.limitation].filter(Boolean).join('。') }),
      ...(node.safe_inventory && !run.ending
        ? [button('放下', () => play(null, id), { className: 'inline-button', ariaLabel: `放下${item.name}` })] : []));
  });
  const evidence = run.clues.map((id) => {
    const clue = game.clues[id];
    return el('li', {}, button(clue.name, () => openClues(id), { className: 'clue-link' }));
  });
  return el('aside', { className: 'sidebar', ariaLabel: '角色状态' },
    el('section', { className: 'journal' },
      el('h2', { textContent: run.identity.name }),
      el('p', { className: 'identity', textContent: stats.pathway ? `序列 ${stats.sequence} · ${hunter.name}` : '普通人 · 班西港杂工' }),
      el('dl', { className: 'stats' }, ...statRows.map(([label, value]) => el('div', {},
        el('dt', { textContent: label }), el('dd', { textContent: value })))),
      ...(run.skills.includes(hunter.skill_id) ? [el('p', { className: 'skill', textContent: hunter.skill_name })] : []),
      el('p', { className: 'wallet', textContent: `金钱 ${run.money}` }),
      ...(run.inventory.includes('brass_lantern') ? [el('p', { className: 'skill', textContent: run.lamp_lit ? '手提灯 · 已点燃' : '手提灯 · 已熄灭' })] : []),
      ...(run.light_safety_until > run.elapsed_minutes
        ? [el('p', { className: 'skill', textContent: `灯火掩护 · 剩余 ${run.light_safety_until - run.elapsed_minutes} 分钟` })] : [])),
    el('section', { className: 'journal' },
      el('h2', { textContent: `行囊 ${game.bagUsed(run)}／${run.inventory_limit}` }),
      el('ul', { className: 'slots' }, ...slots),
      ...(!run.ending && node.safe_inventory ? Object.keys(game.items).filter((id) => run.item_locations[id] === game.place(run) && run.settlement_log.some((entry) => entry.dropped === id)).map((id) =>
        button(`重新拿起${game.items[id].name}`, () => act((state) => game.retrieve(state, id)), { className: 'utility', disabled: game.bagUsed(run) + game.items[id].occupies_slots > run.inventory_limit })) : [])),
    el('section', { className: 'journal' }, button('打开任务簿', openTasks, { className: 'clue-link' }),
      ...Object.values(run.tasks).map((task) => el('p', { className: 'muted', textContent: task.name }))),
    el('section', { className: 'journal' },
      el('h2', { textContent: `线索簿 ${run.clues.length}` }),
      button('整理与组合', () => openClues(), { className: 'utility' }),
      evidence.length ? el('ul', { className: 'clues' }, ...evidence) :
        el('p', { className: 'muted', textContent: '还没有记录。' })));
}

function actionButton(choice) {
  const moneyCondition = choice.requires?.find((rule) => rule.type === 'money_gte');
  const shortfall = moneyCondition ? Math.max(0, moneyCondition.value - activeRun.money) : 0;
  return el('button', {
    type: 'button', className: 'action', disabled: !choice.available,
    onclick: () => confirmAction(choice)
  },
  el('span', { className: 'choice-copy' }, choice.label,
    ...(!choice.available ? [el('small', { textContent: shortfall ? `还差 ${shortfall}` : choice.fallback ?? '条件尚未满足' })] : [])),
  el('span', { className: 'choice-meta', textContent: choice.duration ? `${choice.duration} 分钟` : '' }));
}

function houseMap(run) {
  if (!['home_wake','home_search','home_exit','home_window','home_remember'].includes(run.node) || run.ending) return [];
  const map = el('nav', { className: 'house-map', ariaLabel: '住宅区域' },
    ...Object.entries(game.homeRegions).map(([id, area]) => button(area.name, () => act((state) => game.moveRoom(state, id)),
      { className: `room room-${id}`, ariaCurrent: id === run.home_area ? 'location' : 'false', disabled: run.node === 'home_search' && id === run.home_area },
      el('small', { textContent: id === run.home_area ? '你在这里' : '前往' }))));
  map.style.backgroundImage = `url("${artwork.house_plan}")`;
  return [el('section', { className: 'house-exploration' },
    el('h2', { textContent: '住宅平面图' }),
    el('p', { className: 'muted', textContent: '房内移动不计时。选择区域，再点选具体物件调查。' }),
    map)];
}

function objectActions(run, choices) {
  const grouped = choices.filter((choice) => choice.object);
  const plain = choices.filter((choice) => !choice.object);
  const names = [...new Set((run.node === 'home_search'
    ? game.nodes[run.node].choices.filter((choice) => choice.region === run.home_area && choice.object)
    : grouped).map((choice) => choice.object))];
  if (!names.includes(selectedObject)) selectedObject = null;
  const panel = el('section', { className: 'object-panel' });
  function select(name) {
    selectedObject = name;
    draw();
    app.querySelector('.object-panel')?.scrollIntoView({ block: 'nearest' });
  }
  if (names.length) panel.append(el('h2', { textContent: run.node === 'home_search' ? `${game.homeRegions[run.home_area].name} · 可调查物件` : '观察与交谈' }),
    el('div', { className: 'object-hotspots' }, ...names.map((name) => {
      const related = game.nodes[run.node].choices.filter((choice) => choice.object === name);
      const seen = related.some((choice) => run.action_use_counts[`${run.node}:${choice.id}`]);
      return button(name, () => select(name), { className: 'object-hotspot', ariaPressed: selectedObject === name },
        el('small', { textContent: seen ? '已调查' : '查看' }));
    })),
    ...(selectedObject ? [el('div', { className: 'object-operations' },
      el('h3', { textContent: selectedObject }), ...grouped.filter((choice) => choice.object === selectedObject).map(actionButton),
      ...(grouped.some((choice) => choice.object === selectedObject) ? [] : [el('p', { className: 'muted', textContent: '物件已经取走，或调查记录已存入线索簿。' })]),
      button('收起', () => select(null), { className: 'utility' }))] : [el('p', { className: 'muted', textContent: '点选眼前的人或物，查看当前可以采取的行动。' })]));
  panel.onclick = (event) => { if (event.target === panel) select(null); };
  if (plain.length) panel.append(el('div', { className: 'actions' }, ...plain.map(actionButton)));
  return panel;
}

function story(run) {
  const node = game.nodes[run.node];
  const dialogueMinutes = game.dialogueMinutes(run);
  const choices = game.actions(run);
  const map = choices.filter((choice) => choice.map);
  const text = el('div', { className: 'narrative' },
    ...game.text(run).map((line) => el('p', { textContent: line })));
  const actions = choices.filter((choice) => !choice.map);
  const chapter = run.ending ? `结局 ${run.ending === 'SEA_FAIL' ? '· 海上遇难' : run.ending}` : node.location;
  const roomView = ['home_search','home_exit','home_door','door_talk','door_peek','door_confirm'].includes(run.node);
  const image = roomView ? artwork.house_plan : artwork[node.background];
  const illustration = image ? el('img', { className: 'scene-illustration', src: image, alt: '', decoding: 'async' }) : null;
  if (roomView && image) {
    illustration.className += ` room-view room-view-${run.home_area}`;
  }
  const sceneHeading = el('header', { className: `scene-heading${image ? ' illustrated' : ''}` },
    ...(illustration ? [illustration] : []),
    el('div', { className: 'scene-caption' },
      el('p', { className: 'location', textContent: roomView ? `${chapter} · ${game.homeRegions[run.home_area].name}` : chapter }), heading(node.title)));
  const feedback = run.feedback.length
    ? [el('div', { className: 'feedback' }, ...run.feedback.map((line) => el('p', { textContent: line })))] : [];
  const ending = run.ending
    ? [el('p', { className: 'seal', textContent: '本次角色已封存。' }),
      el('div', { className: 'utilities' },
        button('返回主菜单', () => show('menu'), { className: 'action primary' }),
        button('查看成就', () => show('archive'), { className: 'utility' }))]
    : [];
  return el('div', { className: 'game-shell' },
    el('header', { className: 'game-bar' },
      el('span', { className: 'brand', textContent: '血雾班西' }),
      el('time', { className: 'world-time', textContent: game.clock(run), ariaLabel: `游戏时间 ${game.clock(run)}` }),
      soundButton(),
      button('任务', openTasks, { className: 'utility' }),
      button('日志', openLog, { className: 'utility' }),
      button('主菜单', () => show('menu'), { className: 'utility' })),
    el('div', { className: 'game-grid' },
      el('article', { className: 'story' },
        sceneHeading,
        ...(dialogueMinutes === null ? [] : [
          el('p', { className: 'dialogue-time', textContent: `剩余交谈时间 ${dialogueMinutes} 分钟` })
        ]),
        el('details', { className: 'recap', open: Boolean(run.ending) },
          el('summary', { textContent: '回看剧情' }), ...feedback, text),
        ...houseMap(run),
        ...(actions.length ? [objectActions(run, actions)] : []),
        ...tradePanel(run),
        ...(map.length ? [el('nav', { className: 'map', ariaLabel: '班西地区地图' },
          el('h2', { textContent: '班西地区地图' }),
          el('p', { className: 'current-location', textContent: `● 当前位置 ${node.location}` }),
          el('div', { className: 'map-links route-map' }, ...map.map(actionButton)))] : []),
        ...ending),
      status(run, node)));
}

const exitScreen = () => el('section', { className: 'sheet' }, heading('已退出游戏'),
  el('p', { textContent: '当前进度已保存。你可以关闭此页面。' }),
  button('返回主菜单', () => show('menu'), { className: 'action' }));

function draw() {
  app.className = view === 'story' && activeRun.node !== 'intro' ? 'play' : 'cover';
  backdrop(view === 'story' ? game.nodes[activeRun.node].background : 'main_menu');
  const views = { menu, create: createCharacter, archive, exit: exitScreen };
  const content = view === 'story' ? (activeRun.node === 'intro' ? intro(activeRun) : story(activeRun)) : views[view]();
  app.replaceChildren(content);
}

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`无法读取 ${url}（${response.status}）`);
  return response.json();
}

try {
  const [sceneData, itemData, achievementData, pathwayData, artList] = await Promise.all([
    json('./data/scenes.json'), json('./data/items.json'), json('./data/achievements.json'),
    json('./data/pathways.json'), json('./data/assets.json')
  ]);
  scenes = sceneData;
  game = createGame(scenes, itemData);
  achievements = achievementData.achievements;
  artwork = Object.fromEntries(artList.assets.filter((asset) => asset.status === 'ready').map((asset) => [asset.id, new URL(asset.path, document.baseURI).href]));
  portraits = artList.assets.filter((asset) => asset.image_type === 'portrait');
  hunter = pathwayData.pathways.find((pathway) => pathway.implemented_act1).sequence_9;
  eventDialog.oncancel = (event) => { event.preventDefault(); };
  draw();
  window.addEventListener('storage', (event) => {
    if (event.key === SAVE_KEY && view !== 'error') synchronize();
  });
} catch (error) {
  reportError(error);
}
