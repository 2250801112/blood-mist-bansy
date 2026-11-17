import { createGame, SAVE_KEY, startNewRun, commitRun } from './engine.mjs';
import { createNarrator } from './narration.mjs';
import { createSound } from './sound.mjs';

const app = document.querySelector('#app');
const art = document.querySelector('#art');
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
  const message = `游戏暂时无法继续。请重新载入页面，并允许浏览器保存站点数据。\n${error.message}`;
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
  narrator.open({ label: game.nodes[run.node].title, pages: run.narration });
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
      show('story', scroll);
      if (activeRun.node === 'intro') playIntro();
      else narrate(activeRun);
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
  if (narrator.isOpen) return;
  const snapshot = activeRun;
  void save((current) => {
    const next = item ? game.drop(snapshot, item) : game.choose(snapshot, action);
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
      if (latest.narration) narrate(latest);
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
      if (activeRun?.node === 'intro') playIntro();
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

function status(run, node) {
  const { stats } = run;
  const statRows = [
    ['理智', stats.sanity], ['失控度', `${stats.loss_of_control}%`],
    ['体力', `${stats.stamina}／${stats.stamina_max}`], ['格尔曼信任', stats.gehrman_trust]
  ];
  const slots = Array.from({ length: run.inventory_limit }, (_, index) => {
    const id = run.inventory[index];
    if (!id) return el('li', { className: 'slot empty', textContent: '空位' });
    const item = game.items[id];
    return el('li', { className: 'slot' },
      el('span', { textContent: item.name, title: [item.description, item.limitation].filter(Boolean).join('。') }),
      ...(node.safe_inventory && !run.ending
        ? [button('放下', () => play(null, id), { className: 'inline-button', ariaLabel: `放下${item.name}` })] : []));
  });
  const evidence = run.clues.map((id) => {
    const clue = game.clues[id];
    return el('li', {}, clue.name, ...(clue.text ? [el('small', { textContent: clue.text })] : []));
  });
  return el('aside', { className: 'sidebar', ariaLabel: '角色状态' },
    el('section', { className: 'journal' },
      el('h2', { textContent: run.identity.name }),
      el('p', { className: 'identity', textContent: stats.pathway ? `序列 ${stats.sequence} · ${hunter.name}` : '普通人 · 班西港杂工' }),
      el('dl', { className: 'stats' }, ...statRows.map(([label, value]) => el('div', {},
        el('dt', { textContent: label }), el('dd', { textContent: value })))),
      ...(run.skills.includes(hunter.skill_id) ? [el('p', { className: 'skill', textContent: hunter.skill_name })] : []),
      ...(run.light_safety_until > run.elapsed_minutes
        ? [el('p', { className: 'skill', textContent: `灯火掩护 · 剩余 ${run.light_safety_until - run.elapsed_minutes} 分钟` })] : [])),
    el('section', { className: 'journal' },
      el('h2', { textContent: `行囊 ${game.bagUsed(run)}／${run.inventory_limit}` }),
      el('ul', { className: 'slots' }, ...slots)),
    el('section', { className: 'journal' },
      el('h2', { textContent: `线索簿 ${run.clues.length}` }),
      evidence.length ? el('ul', { className: 'clues' }, ...evidence) :
        el('p', { className: 'muted', textContent: '还没有记录。' })));
}

function actionButton(choice) {
  return el('button', {
    type: 'button', className: 'action', disabled: !choice.available,
    onclick: () => play(choice.id)
  },
  el('span', { className: 'choice-copy' }, choice.label,
    ...(!choice.available ? [el('small', { textContent: choice.fallback ?? '条件尚未满足' })] : [])),
  el('span', { className: 'choice-meta', textContent: choice.duration ? `${choice.duration} 分钟` : '' }));
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
  const image = artwork[node.background];
  const sceneHeading = el('header', { className: `scene-heading${image ? ' illustrated' : ''}` },
    ...(image ? [el('img', { className: 'scene-illustration', src: image, alt: '', decoding: 'async' })] : []),
    el('div', { className: 'scene-caption' },
      el('p', { className: 'location', textContent: chapter }), heading(node.title)));
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
      button('主菜单', () => show('menu'), { className: 'utility' })),
    el('div', { className: 'game-grid' },
      el('article', { className: 'story' },
        sceneHeading,
        ...(dialogueMinutes === null ? [] : [
          el('p', { className: 'dialogue-time', textContent: `剩余交谈时间 ${dialogueMinutes} 分钟` })
        ]),
        el('details', { className: 'recap', open: Boolean(run.ending) },
          el('summary', { textContent: '回看剧情' }), ...feedback, text),
        ...(map.length ? [el('nav', { className: 'map', ariaLabel: '班西地图' },
          el('h2', { textContent: '班西地图' }),
          el('div', { className: 'map-links' }, ...map.map(actionButton)))] : []),
        ...(actions.length ? [el('div', { className: 'actions' },
          ...actions.map(actionButton))] : []),
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
  const [sceneData, itemData, achievementData, pathwayData, artData, artList] = await Promise.all([
    json('./data/scenes.json'), json('./data/items.json'), json('./data/achievements.json'),
    json('./data/pathways.json'), json('./art.json'), json('./data/assets.json')
  ]);
  scenes = sceneData;
  game = createGame(scenes, itemData);
  achievements = achievementData.achievements;
  artwork = artData;
  portraits = artList.assets.filter((asset) => asset.image_type === 'portrait');
  hunter = pathwayData.pathways.find((pathway) => pathway.implemented_act1).sequence_9;
  draw();
  window.addEventListener('storage', (event) => {
    if (event.key === SAVE_KEY && view !== 'error') synchronize();
  });
} catch (error) {
  reportError(error);
}
