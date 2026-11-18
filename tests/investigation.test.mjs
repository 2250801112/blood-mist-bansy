import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createGame, commitRun, startNewRun } from '../game/engine.mjs';

const read = (name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url)));
const game = createGame(read('scenes'), read('items'));
const start = () => game.start({ name: '安', gender: '未指定' });
const walk = (state, ...ids) => ids.reduce((run, id) => {
  const choice = game.nodes[run.node].choices.find((entry) => entry.id === id);
  if (choice?.region && run.home_area !== choice.region) run = game.moveRoom(run, choice.region);
  const next = game.choose(run, id);
  assert.ok(next, `${run.node} @ ${run.elapsed_minutes}: ${id}`);
  return next;
}, state);
const home = () => walk(start(), 'begin', 'search');
const outside = () => walk(home(), 'receipt', 'window', 'record_light', 'check_door', 'talk', 'quiet', 'leave', 'detour');
const has = (state, id) => game.actions(state).some((choice) => choice.id === id);
const reload = (state) => game.restore(JSON.parse(JSON.stringify(state)));

test('苏醒登记任务，房内移动零分钟且刀只在厨房可取，放下后位置保留', () => {
  const awake = walk(start(), 'begin');
  assert.equal(awake.tasks.amnesia.status, 'active');
  assert.equal(awake.elapsed_minutes, 0);
  const room = walk(awake, 'search');
  assert.equal(has(room, 'knife'), false);
  const kitchen = game.moveRoom(room, 'kitchen');
  assert.equal(kitchen.elapsed_minutes, 0);
  assert.equal(kitchen.movement, null);
  const picked = walk(kitchen, 'knife');
  const dropped = game.drop(picked, 'rusty_knife');
  assert.equal(dropped.item_locations.rusty_knife, 'home:kitchen');
  const living = reload(game.moveRoom(dropped, 'living'));
  assert.equal(game.retrieve(living, 'rusty_knife'), null);
  assert.ok(game.retrieve(game.moveRoom(living, 'kitchen'), 'rusty_knife').inventory.includes('rusty_knife'));
});

test('组合消耗卡片、保留来源与事实用途，交换顺序一致，刷新与重查不复制', () => {
  const raw = walk(home(), 'receipt');
  const remembered = walk(raw, 'recall', 'record_memory');
  const merged = game.combine(remembered, ['church_receipt', 'last_night_job']);
  assert.ok(merged);
  assert.ok(!merged.clues.includes('church_receipt') && !merged.clues.includes('last_night_job'));
  assert.ok(game.hasFact(merged, 'church_receipt'));
  assert.equal(merged.elapsed_minutes, remembered.elapsed_minutes);
  assert.equal(merged.discoveries.church_receipt.minute, 5);
  assert.equal(merged.discoveries.church_receipt.event, 'home_search:receipt');
  assert.equal(game.combine(reload(merged), ['church_receipt', 'last_night_job']), null);
  const reverse = game.combine(remembered, ['last_night_job', 'church_receipt']);
  assert.deepEqual(reverse.cards, merged.cards);
  const failed = game.combine(remembered, ['memory_gap', 'church_receipt']);
  assert.equal(failed, null);
  assert.deepEqual(remembered.clues, ['memory_gap', 'church_receipt', 'last_night_job']);
});

test('共享事实的配方可在一张结果卡内继续推演，知识不能因合并顺序丢失', () => {
  const raw = walk(home(), 'window', 'record_light', 'lantern', 'observe_fire', 'relight_home');
  const lit = walk(raw, 'check_door', 'quiet', 'leave', 'light', 'watch');
  const one = game.combine(lit, ['floating_light', 'lamp_illumination']);
  const two = game.combine(one, [one.clues.find((id) => id === 'R07'), 'lamp_hesitation']);
  const three = game.combine(two, ['R08', 'lamp_expiry']);
  assert.ok(game.hasFact(three, 'floating_light'));
  assert.ok(game.hasFact(three, 'lamp_illumination'));
  assert.deepEqual(three.deductions.filter((id) => ['R07','R08','R09'].includes(id)), ['R07','R08','R09']);
  assert.equal(three.light_alert_by_area.night_street.expires_at, lit.light_alert_by_area.night_street.expires_at);
});

function introduced(run = outside()) {
  let dock = walk(run, 'dock', 'observe_sailor');
  assert.equal(has(dock, 'pay_introduction'), false);
  dock = game.combine(dock, ['captain_refusal', 'sailor_offer']);
  return walk(dock, 'pay_introduction', 'captain_terms');
}

test('码头引荐由线索组合开放，实际付款后才获得行踪，提前不显示专属人物话题', () => {
  const unknown = walk(outside(), 'tavern', 'wait_gehrman');
  assert.equal(has(unknown, 'gehrman'), false);
  const dock = introduced();
  assert.equal(dock.money, 16);
  assert.equal(game.hasFact(dock, 'gehrman_whereabouts'), true);
  assert.equal(dock.tasks.find_gehrman.status, 'active');
  const known = walk(dock, 'leave', 'tavern', 'wait_gehrman');
  assert.equal(has(known, 'gehrman'), true);
});

test('收据合并后仍能出示，同组信任奖励不能因换卡重复领取', () => {
  const raw = walk(home(), 'receipt', 'recall', 'record_memory');
  const merged = game.combine(raw, ['church_receipt', 'last_night_job']);
  const street = walk(merged, 'check_door', 'quiet', 'leave', 'detour');
  const dock = introduced(street);
  let room = walk(dock, 'leave', 'tavern', 'wait_gehrman', 'gehrman', 'truth');
  assert.equal(has(room, 'receipt'), true);
  room = walk(room, 'receipt', 'submit_receipt');
  assert.equal(room.stats.gehrman_trust, 35);
  assert.equal(game.choose(reload(room), 'receipt'), null);
});

test('情报按原始事实付款，组合前售过的事实不能再次卖，物品出售改变所有权', () => {
  const raw = walk(home(), 'receipt', 'recall', 'record_memory', 'lantern', 'check_door', 'quiet', 'leave', 'detour', 'market', 'observe_goods', 'observe_news');
  const sold = game.trade(raw, 'information', 'church_receipt');
  assert.equal(sold.money - raw.money, 25);
  assert.equal(game.trade(reload(sold), 'information', 'church_receipt'), null);
  const merged = game.combine(sold, ['church_receipt', 'last_night_job']);
  assert.equal(game.quote(merged, 'information', 'R01').price, 10);
  const resold = game.trade(merged, 'information', 'R01');
  assert.equal(resold.money - merged.money, 10);
  assert.ok(game.hasFact(resold, 'church_receipt'));
  const lampSold = game.trade(resold, 'item', 'brass_lantern');
  assert.ok(!lampSold.inventory.includes('brass_lantern'));
  assert.equal(lampSold.item_locations.brass_lantern, 'buyer');
  assert.equal(game.trade(lampSold, 'item', 'brass_lantern'), null);
  const bought = game.trade(lampSold, 'buyback', 'brass_lantern');
  assert.ok(bought.money < lampSold.money - 20);
});

test('重燃只恢复照明，实际火源与收费线索必需，原路段的十分钟不能重置', () => {
  const raw = walk(home(), 'lantern', 'observe_fire', 'relight_home', 'check_door', 'quiet', 'leave', 'light', 'watch', 'detour_alerted', 'tavern');
  const until = raw.light_alert_by_area.night_street.expires_at;
  assert.equal(has(raw, 'relight_paid'), false);
  const prepared = walk(raw, 'extinguish', 'observe_fire', 'ask_fire');
  const relit = walk(prepared, 'relight_paid');
  assert.equal(relit.money, prepared.money - 2);
  assert.equal(relit.lamp_lit, true);
  assert.equal(relit.light_alert_by_area.night_street.expires_at, until);
  assert.equal(relit.light_alert_by_area.night_street.level, 2);
});

test('提示显示实际属性差值，晋升卡刷新不重复发奖、主动确认才关闭', () => {
  const day = walk(outside(), 'rest_to_day', 'find_other_way', 'telegraph_day', 'inspect_wall');
  const low = { ...day, stats: { ...day.stats, sanity: 4 } };
  const depleted = walk(low, 'sketch');
  assert.ok(depleted.notifications.some((entry) => entry.text.includes('理智 −4')));
  const awakened = walk(day, 'touch');
  assert.equal(awakened.pending_presentation.kind, 'promotion');
  assert.equal(reload(awakened).stats.stamina, 7);
  const ack = game.acknowledge(awakened);
  assert.equal(ack.pending_presentation, null);
  assert.equal(ack.stats.loss_of_control, 50);
  assert.equal(game.acknowledge(ack), null);
  assert.equal(ack.tasks.amnesia.status, 'active');
});

test('版本迁移保留证据和奖励，不把灯笼持有误当作实测，不重发金钱', () => {
  const run = home();
  const legacy = structuredClone(run);
  delete legacy.save_version;
  delete legacy.cards;
  delete legacy.discoveries;
  delete legacy.money;
  legacy.clues = ['church_receipt'];
  legacy.inventory = ['brass_lantern'];
  legacy.flags.receipt_shown = true;
  const restored = reload(legacy);
  assert.equal(restored.save_version, 2);
  assert.ok(game.hasFact(restored, 'church_receipt'));
  assert.equal(game.hasFact(restored, 'lamp_hesitation'), false);
  assert.equal(restored.money, 24);
  assert.equal(reload(restored).money, 24);
  const profile = startNewRun({ active: null, archive: [], achievements: [] }, restored);
  assert.ok(commitRun(profile, game.moveRoom(restored, 'kitchen')));
  const lost = structuredClone(legacy);
  lost.inventory = [];
  lost.action_use_counts['home_search:lantern'] = 1;
  assert.equal(reload(lost).item_locations.brass_lantern, 'legacy_unknown');
});

test('高价路线用实际调查和售卖筹资，在合法船期成交，筛查与欺骗仍能阻止登船', () => {
  let run = walk(home(), 'receipt', 'letter', 'recall', 'record_memory', 'check_door', 'talk', 'quiet', 'pack',
    'window', 'record_light', 'box', 'take_old_coat', 'leave_early', 'leave', 'detour');
  run = introduced(run);
  run = walk(run, 'observe_cost');
  assert.equal(has(run, 'ask_price'), false);
  run = game.combine(run, ['captain_requirements', 'berth_cost']);
  run = walk(run, 'ask_price', 'leave', 'market', 'observe_goods', 'observe_news');
  run = game.trade(run, 'item', 'old_coat');
  for (const id of [...run.clues]) {
    if (game.quote(run, 'information', id)) run = game.trade(run, 'information', id);
  }
  run = walk(run, 'return', 'telegraph_night', 'talk', 'peek', 'bloodied_paper', 'return', 'church', 'record_tracks', 'market');
  for (const id of [...run.clues]) {
    if (game.quote(run, 'information', id)) run = game.trade(run, 'information', id);
  }
  assert.equal(run.money, 123);
  assert.ok(run.elapsed_minutes < 403);
  const funded = walk(run, 'return', 'dock', 'screen', 'wait_parley');
  assert.equal(funded.stats.gehrman_trust, 0);
  assert.equal(game.choose({ ...funded, elapsed_minutes: 431 }, 'pay_berth'), null);
  assert.equal(game.choose({ ...funded, flags: { ...funded.flags, contamination_screen_passed: false } }, 'pay_berth'), null);
  assert.equal(game.choose({ ...funded, money: 119 }, 'pay_berth'), null);
  const approved = reload(walk(funded, 'pay_berth'));
  assert.equal(approved.money, 3);
  assert.equal(approved.elapsed_minutes, 406);
  const revoked = walk(approved, 'conceal');
  assert.equal(game.choose(revoked, 'resume_boarding'), null);
  assert.equal(game.choose(revoked, 'pay_berth'), null);
  const escaped = walk(approved, 'honest_check', 'board');
  assert.equal(escaped.ending, 'A');
  assert.equal(escaped.elapsed_minutes, 416);
  assert.equal(escaped.tasks.escape.status, 'completed');
  assert.equal(escaped.tasks.amnesia.status, 'active');
});

test('重叠的灯光与目击推理允许同卡继续推演，重复发现不让原卡重现', () => {
  let run = walk(home(), 'window', 'record_light', 'lantern', 'observe_fire', 'relight_home', 'check_door', 'quiet', 'leave', 'light', 'cross_with_light', 'tavern', 'donna', 'believe');
  run = game.combine(run, ['floating_light', 'donna_testimony']);
  run = game.combine(run, ['R03', 'lamp_illumination']);
  run = game.combine(run, ['R07', 'lamp_hesitation']);
  assert.deepEqual(run.cards.R08.deductions, ['R03','R07','R08']);
  assert.ok(game.hasFact(run, 'donna_testimony'));
  const revisited = walk(run, 'return', 'home', 'window', 'record_light');
  assert.ok(!revisited.clues.includes('floating_light'));
  assert.ok(game.hasFact(revisited, 'floating_light'));
});

test('整理线索与确认演出不重复上次步行；听到汽笛即登记离港任务', () => {
  const street = outside();
  assert.equal(street.tasks.escape.status, 'active');
  const dock = walk(street, 'dock', 'observe_sailor');
  const combined = game.combine(dock, ['captain_refusal', 'sailor_offer']);
  assert.equal(combined.movement, null);
  const awake = walk(start(), 'begin');
  assert.ok(awake.movement);
  const acknowledged = game.acknowledge(awake);
  assert.equal(acknowledged.movement, null);
  assert.ok(acknowledged.notifications.some((notice) => notice.kind === 'task'));
});

test('夜路不能凭空重燃熄灭的灯，必须先在实际火源点燃再举灯', () => {
  const unlit = walk(home(), 'lantern', 'check_door', 'quiet', 'leave');
  assert.equal(game.choose(unlit, 'light'), null);
});

test('迁移只追赶世界钟，不把错过的本地事件补成亲眼目击', () => {
  const legacy = walk(outside(), 'tavern', 'wait_gehrman');
  delete legacy.save_version;
  delete legacy.cards;
  delete legacy.discoveries;
  legacy.elapsed_minutes = 200;
  const restored = reload(legacy);
  assert.equal(restored.resolved_events.tavern_collision, 'occurred');
  assert.equal(game.hasFact(restored, 'rescue_warning'), false);
  assert.equal(game.hasFact(restored, 'kitchen_argument'), false);
});
