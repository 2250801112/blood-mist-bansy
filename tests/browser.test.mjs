import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { createGame, SAVE_KEY } from '../game/engine.mjs';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label) {
  for (let i = 0; i < 150; i++) {
    const value = await check();
    if (value) return value;
    await delay(50);
  }
  throw new Error(label);
}

test('真实浏览器验收调查、五秒旁白、证据继承、交易、晋升、结局与仓库子路径', { timeout: 120000 }, async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'bansy-edge-'));
  const server = spawn('python', ['-B', '-X', 'utf8', 'tools/play.py', '--port', '0', '--base-path', '/preview/'], { stdio: ['ignore','pipe','ignore'] });
  const edge = spawn(join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'), [
    '--headless=new', '--no-first-run', '--disable-background-networking', '--remote-debugging-port=0',
    '--user-data-dir=' + sandbox, '--window-size=1440,1000', 'about:blank'
  ], { stdio: 'ignore' });
  let socket, call;
  try {
    const [line] = await once(server.stdout, 'data');
    const origin = line.toString().match(/http:\/\/127\.0\.0\.1:\d+/)[0];
    const url = origin + '/preview/';
    const port = (await until(() => readFile(join(sandbox, 'DevToolsActivePort'), 'utf8').catch(() => null), 'Edge 未启动')).split(/\r?\n/)[0];
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
    await once(socket, 'open');
    let sequence = 0;
    const pending = new Map(), errors = [];
    socket.addEventListener('message', ({ data }) => {
      const { id, method, params, result, error } = JSON.parse(data);
      if (id) {
        const task = pending.get(id);
        pending.delete(id);
        if (error) task.reject(new Error(JSON.stringify(error))); else task.resolve(result);
      }
      if (method === 'Runtime.exceptionThrown' || (method === 'Runtime.consoleAPICalled' && params.type === 'error')) errors.push(JSON.stringify(params));
      if (method === 'Network.responseReceived' && params.response.url.startsWith(origin) && params.response.status >= 400) errors.push(params.response.url);
      if (method === 'Log.entryAdded' && params.entry.level === 'error') errors.push(params.entry.text);
    });
    call = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    for (const domain of ['Runtime','Page','Network','Log']) await call(`${domain}.enable`);
    const run = async (expression) => {
      const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
      if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
      return response.result.value;
    };
    const state = () => run(`JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}))?.active`);
    const click = async (text, root = '#app') => {
      const found = await run(`(() => {
        const button = [...document.querySelector(${JSON.stringify(root)}).querySelectorAll('button')].find(button =>
          (button.querySelector('.choice-copy')?.firstChild?.textContent ?? button.firstChild?.textContent ?? button.textContent).trim() === ${JSON.stringify(text)});
        if (!button || button.disabled) return false;
        button.click(); return true;
      })()`);
      assert.ok(found, `未找到可点击按钮 ${text}`);
    };
    const skipTransition = async () => {
      if (await run('!document.querySelector("#transition").hidden')) await run('document.querySelector("#transition").click()');
    };
    const drain = async () => {
      await skipTransition();
      await run(`(() => { let guard = 0; const dialog = document.querySelector('#narration'); while(dialog.open && guard++ < 500) dialog.querySelector('.narration-passage').click(); })()`);
    };
    const room = async (id) => {
      const before = await state();
      await run(`document.querySelector('.room-${id}').click(); document.querySelector('.room-${id}').click()`);
      await until(async () => (await state()).turn > before.turn, '区域移动未保存');
      await drain();
      assert.equal((await state()).turn, before.turn + 1, '连续点按区域只能结算一次');
    };
    const act = async (id) => {
      const before = await state();
      const action = await run(`(async () => (await import('./game/engine.mjs')).createGame(await (await fetch('./data/scenes.json')).json(), await (await fetch('./data/items.json')).json()).actions(${JSON.stringify(before)}).find(a => a.id === ${JSON.stringify(id)}))()`);
      assert.ok(action?.available, `不可用行动 ${before.node}:${id}`);
      if (action.object) await click(action.object);
      await click(action.label);
      if (action.map || action.effects?.some((effect) => effect.type === 'add_money' && effect.value < 0)) {
        await click(action.map ? '出发' : '确认支付', '#journal-dialog');
      }
      await until(async () => {
        const latest = await state();
        return !latest || latest.turn > before.turn;
      }, `行动未保存 ${id}`);
      await drain();
    };
    await call('Page.navigate', { url });
    await until(() => run('document.querySelector(".game-title")?.textContent === "血雾班西"'), '主菜单未显示');
    await click('开启声音');
    await until(() => run('[...document.querySelectorAll("button")].some(b => b.textContent === "关闭声音")'), '声音开关未启用');
    await click('开始游戏');
    await run('document.querySelector("input[name=name]").value = "调查者"');
    await click('进入序章');
    await until(() => run('document.querySelector("#narration").open'), '序章未显示');
    assert.equal(await run('document.querySelector(".narration-next")'), null);
    assert.equal(await run('getComputedStyle(document.querySelector("#narration")).borderTopWidth'), '0px');
    await click('跳过序章', '#narration');
    await until(async () => (await state())?.node === 'home_wake', '苏醒未保存');
    await skipTransition();
    await until(() => run('document.querySelector("#event-dialog").open'), '苏醒演出未显示');
    await click('睁开眼睛', '#event-dialog');
    await until(() => run('document.querySelector("#narration").open'), '苏醒旁白未显示');
    const frozen = await state();
    const progress = () => run('document.querySelector(".narration-progress").textContent');
    await run('document.querySelector(".narration-passage").click()');
    const first = await progress();
    await delay(4700);
    assert.equal(await progress(), first);
    await until(async () => await progress() !== first, '全文显示后五秒未翻页');
    assert.equal((await state()).elapsed_minutes, 0);
    assert.equal((await state()).turn, frozen.turn);
    await run('document.querySelector(".reading-settings").open = true');
    const paused = await progress();
    await delay(5200);
    assert.equal(await progress(), paused);
    await run('document.querySelector(".reading-settings").open = false');
    await drain();
    await act('search');
    await room('living');
    await until(() => run('document.querySelector(".scene-illustration").naturalWidth > 0'), '住宅插画未加载');
    await act('receipt');
    await room('bedroom');
    await act('recall');
    await act('record_memory');
    await click('整理与组合');
    await run('document.querySelector("input[aria-label=选择教堂运输收据]").click(); document.querySelector("input[aria-label=选择昨夜的委托]").click()');
    await click('尝试关联', '#journal-dialog');
    await until(async () => (await state()).deductions.includes('R01'), '线索组合未保存');
    await drain();
    await click('教堂运输委托');
    assert.ok(await run('document.querySelector(".clue-detail").textContent.includes("教堂运输收据")'));
    await click('关闭', '#journal-dialog');
    await room('kitchen');
    await act('knife');
    await click('放下');
    await until(async () => (await state()).item_locations.rusty_knife === 'home:kitchen', '物品放置未保存');
    await drain();
    await room('living');
    await call('Page.reload');
    await until(() => run('Boolean(document.querySelector(".game-title"))'), '刷新未返回菜单');
    await click('继续游戏');
    assert.equal((await state()).home_area, 'living');
    assert.ok(await run('!document.querySelector("#app").textContent.includes("重新拿起生锈水果刀")'));
    await room('kitchen');
    await click('重新拿起生锈水果刀');
    await until(async () => (await state()).inventory.includes('rusty_knife'), '取回物品未保存');
    await drain();
    const beforeOverlay = await state();
    await click('日志');
    await click('回看当前剧情', '#journal-dialog');
    await run('document.querySelector("#narration").click()');
    assert.equal((await state()).turn, beforeOverlay.turn, '旁白点击穿透到底层');
    await drain();
    const screenshot = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(tmpdir(), 'bansy-investigation-desktop.png'), Buffer.from(screenshot.data, 'base64'));
    console.log('浏览器通过：五秒阅读、暂停、点击不穿透、区域调查、合并证据和刷新取回。');

    const read = async (name) => JSON.parse(await readFile(new URL(`../data/${name}.json`, import.meta.url), 'utf8'));
    const game = createGame(await read('scenes'), await read('items'));
    const walk = (initial, ...ids) => ids.reduce((current, id) => {
      const action = game.nodes[current.node].choices.find((choice) => choice.id === id);
      if (action?.region && current.home_area !== action.region) current = game.moveRoom(current, action.region);
      const next = game.choose(current, id);
      assert.ok(next, `浏览器路线准备 ${current.node}:${id}`);
      return next;
    }, initial);
    const outside = walk(game.start({ name: '航海者', gender: '未指定' }), 'begin','search','receipt','check_door','quiet','leave','detour');
    const install = async (fixture) => {
      if (fixture.pending_presentation?.kind === 'wake') fixture = game.acknowledge(fixture);
      await run(`localStorage.setItem(${JSON.stringify(SAVE_KEY)}, ${JSON.stringify(JSON.stringify({ active: fixture, archive: [], achievements: [] }))})`);
      await call('Page.reload');
      await until(() => run('Boolean(document.querySelector(".game-title"))'), '载入路线存档未显示菜单');
      await click('继续游戏');
      await drain();
    };
    const market = walk(outside, 'market','observe_goods','observe_news');
    await install(market);
    await click('出售《教堂运输收据》 · 25');
    await click('确认交易', '#journal-dialog');
    await until(async () => (await state()).money === 49, '情报交易未结算');
    await drain();
    assert.equal(await run('document.querySelector("#app").textContent.includes("出售《教堂运输收据》 · 25")'), false);
    let dock = walk(outside, 'dock','observe_sailor');
    dock = game.combine(dock, ['captain_refusal','sailor_offer']);
    let evidence = walk(dock, 'pay_introduction','captain_terms','leave','tavern','donna','comfort','wait_gehrman','gehrman','truth','receipt','submit_receipt','verify','submit_evidence','risk','return','return','dock','screen','wait_parley');
    await install(evidence);
    await act('request_boarding');
    await act('honest_check');
    await act('board');
    assert.equal(await state(), null);
    assert.equal(await run(`JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)})).archive[0].ending`), 'A');
    const mural = walk(outside, 'rest_to_day','find_other_way','telegraph_day','inspect_wall');
    await install(mural);
    await act('touch');
    assert.equal(await run('document.querySelector("#event-dialog").open'), true);
    const promoted = await state();
    assert.equal(promoted.stats.loss_of_control, 50);
    await call('Page.reload');
    await until(() => run('Boolean(document.querySelector(".game-title"))'), '晋升刷新未显示菜单');
    await click('继续游戏');
    await drain();
    assert.equal(await run('document.querySelector("#event-dialog").open'), true);
    await click('记下变化，继续调查', '#event-dialog');
    await until(async () => !(await state()).pending_presentation, '晋升确认未保存');
    assert.equal((await state()).stats.stamina, 7);
    let sea = walk(game.acknowledge(walk(mural, 'touch')), 'get_up','harbor','record_schedule','lighthouse','pick_signal','wait_tide','find_route','record_entry','wait_for_ship');
    await install(sea);
    await act('swim');
    await act('accept_isolation');
    assert.equal(await run(`JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)})).archive[0].ending`), 'B');
    const door = walk(game.start({ name: '过客', gender: '未指定' }), 'begin','approach_door','open');
    await install(door);
    await act('confirm_open');
    assert.equal(await state(), null);
    await click('返回主菜单');
    assert.equal(await run('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="继续游戏").disabled'), true);
    await install(walk(mural, 'touch'));
    await click('记下变化，继续调查', '#event-dialog');
    await until(async () => !(await state()).pending_presentation, '移动端准备未保存');
    await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await delay(150);
    assert.ok(await run('document.documentElement.scrollWidth <= innerWidth + 1'), '移动端出现横向溢出');
    await click('任务');
    assert.ok(await run('document.querySelector("#journal-dialog").getBoundingClientRect().right <= innerWidth'), '任务卡超出屏幕');
    await click('关闭', '#journal-dialog');
    const mobile = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(tmpdir(), 'bansy-investigation-mobile.png'), Buffer.from(mobile.data, 'base64'));
    await install(game.acknowledge(walk(game.start({ name: '调查者', gender: '未指定' }), 'begin','search')));
    await room('kitchen');
    assert.ok(await run('document.documentElement.scrollWidth <= innerWidth + 1'), '移动端住宅出现横向溢出');
    assert.ok(await run('document.querySelector(".room-kitchen").getBoundingClientRect().height >= 44'), '移动端区域点击目标过小');
    await writeFile(join(tmpdir(), 'bansy-house-mobile.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    assert.deepEqual(errors, [], '浏览器 console 或 HTTP 出错');
    console.log('浏览器通过：情报交易、担保 A 线、晋升刷新确认、B 线、死亡封存、移动端及 /preview/ 子路径，console 与 HTTP 错误为 0。');
  } finally {
    if (call && socket?.readyState === WebSocket.OPEN) await call('Browser.close');
    socket?.close();
    server.kill();
    edge.kill();
    assert.equal(dirname(sandbox), resolve(tmpdir()));
    assert.ok(basename(sandbox).startsWith('bansy-edge-'));
    await rm(sandbox, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
  }
});
