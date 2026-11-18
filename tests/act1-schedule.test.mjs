import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createGame, startNewRun, commitRun } from '../game/engine.mjs';

const read = (name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url)));
const game = createGame(read('scenes'), read('items'));
const start = () => game.start({ name: '安', gender: '未指定' });
const atAction = (state, id) => {
  const choice = game.nodes[state.node].choices.find((entry) => entry.id === id);
  if (!choice?.area || game.area(state) === choice.area) return state;
  const moved = game.moveArea(state, choice.area);
  assert.ok(moved, `${state.node}: 应能进入 ${choice.area}`);
  return moved;
};
const chooseAt = (state, id) => game.choose(atAction(state, id), id);
const walk = (state, ...ids) => ids.reduce((run, id) => {
  const choice = game.nodes[run.node].choices.find((entry) => entry.id === id);
  if (choice?.region && run.home_area !== choice.region) run = game.moveRoom(run, choice.region);
  run = atAction(run, id);
  const result = game.choose(run, id);
  assert.ok(result, `${run.node} @ ${run.elapsed_minutes}: ${id} 应可执行`);
  return result;
}, state);
const includes = (state, id) => game.actions(atAction(state, id)).some((choice) => choice.id === id);
const home = () => walk(start(), 'begin', 'search');
const street = () => walk(home(), 'receipt', 'leave_early', 'leave', 'detour');
const tavern = () => {
  const dock = walk(street(), 'dock', 'observe_sailor');
  const idea = game.combine(dock, ['captain_refusal', 'sailor_offer']);
  return walk(idea, 'pay_introduction', 'captain_terms', 'leave', 'tavern');
};
const opening = () => walk(tavern(), 'donna', 'comfort', 'wait_collision');
const day = () => walk(street(), 'wait_for_dawn', 'find_other_way');
const hunter = () => walk(day(), 'telegraph_exterior', 'read_hours', 'wait_open', 'inspect_wall', 'touch', 'get_up');
const reload = (run) => game.restore(JSON.parse(JSON.stringify(run)));
const at = (run, minute) => ({ ...run, elapsed_minutes: minute });

test('22:35 敲门打断卧室搜索，出门者留在街上', () => {
  const ready = walk(home(), 'lantern', 'letter', 'receipt');
  assert.equal(ready.elapsed_minutes, 15);
  const interrupted = walk(ready, 'box');
  assert.equal(interrupted.node, 'home_door');
  assert.equal(interrupted.elapsed_minutes, 18);
  assert.equal(interrupted.resolved_events.home_knock, 'occurred');
  const searched = walk(interrupted, 'search_quietly', 'box');
  assert.ok(searched.clues.includes('bedside_crate'));
  assert.ok(searched.stats.sanity < 100);
  assert.equal(searched.node, 'home_door');
  assert.match(searched.narration.join(''), /压下了门把/);
  const outside = street();
  assert.equal(outside.node, 'street');
  assert.match(outside.narration.join(''), /敲门|叩击/);
});

test('固定格尔曼窗口、初次回答互斥，刷新后保持阶段', () => {
  const hub = tavern();
  assert.ok(!includes(hub, 'gehrman'));
  const entry = walk(at(hub, 153), 'gehrman');
  assert.equal(game.dialogueMinutes(entry), 5);
  const answered = reload(walk(entry, 'truth'));
  assert.ok(!includes(answered, 'bluff'));
  assert.ok(!includes(answered, 'receipt'));
  assert.equal(answered.chosen_exclusive_options.gehrman_intro, 'gehrman:truth');
  assert.ok(!includes(at(hub, 173), 'gehrman'));
});

test('首次跌破 0 永久拒谈，即使救人后信任回正也不能申请担保', () => {
  const refused = reload(walk(opening(), 'gehrman', 'bluff'));
  assert.equal(refused.stats.gehrman_trust, -15);
  assert.equal(refused.flags.gehrman_refused, true);
  const recovered = walk(refused, 'return', 'investigate_rescue', 'help');
  assert.equal(recovered.stats.gehrman_trust, 20);
  assert.ok(!includes(recovered, 'gehrman'));
  const dock = walk(recovered, 'return', 'dock', 'screen', 'wait_parley');
  assert.equal(chooseAt({ ...dock, stats: { ...dock.stats, gehrman_trust: 90 } }, 'request_boarding'), null);
});

test('00:25 餐厅事件竞争时间，先调查厨房会错过救援', () => {
  const room = opening();
  assert.equal(room.elapsed_minutes, 128);
  assert.ok(includes(room, 'marena') && includes(room, 'investigate_rescue') && includes(room, 'gehrman'));
  const kitchen = walk(room, 'marena');
  assert.equal(kitchen.elapsed_minutes, 153);
  const back = reload(walk(kitchen, 'help_marena'));
  assert.ok(!includes(back, 'marena') && !includes(back, 'investigate_rescue'));
  assert.ok(includes(back, 'gehrman'));
  const other = walk(room, 'investigate_rescue', 'help');
  assert.equal(other.elapsed_minutes, 148);
  assert.ok(!includes(other, 'marena') && !includes(other, 'investigate_rescue'));
  assert.equal(other.resolved_events.donna_rescue, 'completed');
});

test('堂娜选定答复后关闭该组，餐厅旁白只自动播放一次', () => {
  const room = tavern();
  const replied = walk(reload(walk(room, 'donna')), 'comfort');
  assert.ok(!includes(replied, 'donna'));
  assert.match(replied.narration.join(''), /堂娜/);
  assert.doesNotMatch(replied.narration.join(''), /玛蕾娜：“欢迎/);
  assert.equal(replied.action_use_counts['donna_talk:comfort'], 1);
});

function evidenceRoute() {
  const first = walk(tavern(), 'donna', 'comfort', 'wait_gehrman', 'gehrman', 'truth');
  return walk(first, 'receipt', 'submit_receipt', 'verify', 'submit_evidence', 'risk', 'return');
}

function rescueRoute() {
  return walk(opening(), 'investigate_rescue', 'help', 'gehrman', 'ask_boarding', 'receipt', 'submit_receipt', 'return');
}

const permission = (room) => walk(room, 'return', 'dock', 'screen', 'wait_parley', 'request_boarding');

test('两种信任组合都能登船，05:50 到 06:00 的同刻完成优先', () => {
  for (const room of [evidenceRoute(), rescueRoute()]) {
    assert.ok(room.stats.gehrman_trust >= 60);
    const approved = reload(permission(room));
    const ready = walk(approved, 'honest_check', 'wait_boarding');
    assert.equal(ready.elapsed_minutes, 453);
    assert.equal(chooseAt(at(ready, 462), 'board'), null);
    assert.equal(chooseAt(at(ready, 463), 'board'), null);
    const escaped = walk(ready, 'board');
    assert.equal(escaped.elapsed_minutes, 463);
    assert.equal(escaped.ending, 'A');
    assert.equal(escaped.flags.ship_departed, true);
    assert.equal(escaped.stats.pathway, null);
  }
});

test('码头交涉只限 05:00–05:30，隐瞒后无法重新筛查或申请', () => {
  const room = evidenceRoute();
  const screened = walk(room, 'return', 'dock', 'screen');
  assert.equal(chooseAt(screened, 'request_boarding'), null);
  assert.equal(chooseAt(at(screened, 434), 'request_boarding'), null);
  const approved = walk(screened, 'wait_parley', 'request_boarding');
  const revoked = reload(walk(approved, 'conceal'));
  assert.equal(revoked.flags.contamination_screen_passed, false);
  for (const option of ['screen', 'request_boarding', 'resume_boarding']) {
    assert.equal(chooseAt(revoked, option), null);
  }
});

test('优先调查厨房会错过救援，剩余谈话时间不足时白玛瑙号仍照常离港', () => {
  const room = walk(opening(), 'marena', 'record_husband', 'gehrman', 'truth', 'return');
  assert.equal(room.stats.gehrman_trust, 10);
  assert.equal(chooseAt(room, 'investigate_rescue'), null);
  const dock = walk(room, 'return', 'dock', 'screen', 'wait_parley');
  assert.equal(chooseAt(dock, 'request_boarding'), null);
  const missed = walk(dock, 'wait_departure');
  assert.equal(missed.flags.ship_departed, true);
  assert.equal(missed.node, 'ship_missed');
  assert.equal(missed.resolved_events.donna_rescue, 'resolved_elsewhere');
});

test('09:39 强闯即死，跨过 09:40 后旧节点变为白天版', () => {
  const night = walk(street(), 'telegraph_night');
  assert.equal(walk(at(night, 682), 'force_entry').ending, 'E');
  const changed = reload(walk(at(night, 682), 'return', 'telegraph_day'));
  assert.equal(changed.flags.telegraph_staff_present, false);
  assert.equal(changed.node, 'telegraph_day');
  assert.ok(changed.clues.includes('missing_operators'));
  assert.ok(!includes(changed, 'talk'));
});

test('港务和潮汐按完成时间关闭，过期无收益，猎人可走 B 线', () => {
  const records = walk(hunter(), 'harbor');
  assert.equal(chooseAt(at(records, 814), 'record_schedule'), null);
  const ready = walk(records, 'record_schedule', 'lighthouse', 'pick_signal', 'wait_tide');
  assert.equal(ready.elapsed_minutes, 1063);
  const patrol = walk(ready, 'inspect_tracks', 'watch_steps', 'analyze_patrol', 'verify_patrol', 'observe_cover', 'approach_cover');
  assert.equal(chooseAt(at(patrol, 1184), 'find_route'), null);
  const shore = walk(patrol, 'find_route');
  assert.equal(chooseAt(at(shore, 1180), 'record_entry'), null);
  const sea = walk(shore, 'record_entry', 'wait_for_ship');
  assert.equal(sea.elapsed_minutes, 1803);
  assert.equal(chooseAt(at(sea, 1824), 'swim'), null);
  assert.equal(chooseAt({ ...sea, inventory: [] }, 'swim'), null);
  assert.equal(walk(at(sea, 1823), 'swim', 'accept_isolation').ending, 'B');
});

test('灯笼保护到期后提高同一区域警觉，改道和读档不会重置', () => {
  const path = walk(home(), 'lantern', 'observe_fire', 'relight_home', 'leave_early', 'leave');
  const lit = walk(path, 'light');
  assert.equal(lit.light_safety_until - lit.elapsed_minutes, 10);
  const expired = reload(walk(lit, 'watch'));
  assert.equal(expired.light_alert_by_area.night_street.level, 2);
  assert.equal(chooseAt(expired, 'light'), null);
  assert.equal(chooseAt(expired, 'cross_with_light'), null);
  const bypass = walk(expired, 'detour_alerted', 'home', 'leave_early', 'leave');
  assert.equal(bypass.light_alert_by_area.night_street.level, 2);
});

test('等待顺序触发固定事件，封存后不能用旧快照覆盖结果', () => {
  const run = day();
  const profile = startNewRun({ active: null, archive: [], achievements: [] }, run);
  const dead = walk(run, 'wait_for_doom');
  const saved = commitRun(profile, dead);
  assert.equal(dead.elapsed_minutes, 4320);
  assert.equal(dead.ending, 'C');
  assert.equal(dead.resolved_events.ship_departure, 'occurred');
  assert.equal(dead.resolved_events.telegraph_empty, 'occurred');
  assert.equal(dead.resolved_events.grey_gull_departure, 'occurred');
  assert.equal(saved.active, null);
  assert.equal(commitRun(saved, run), null);
});

test('旧存档的已兑现选择保留，提前进入的旧餐厅事件有返回出口', () => {
  const { action_use_counts, chosen_exclusive_options, resolved_events, light_alert_by_area, ...legacy } = tavern();
  legacy.used = ['donna_talk:believe', 'gehrman:bluff', 'rescue:help'];
  legacy.flags.rescue_done = true;
  legacy.clues.push('rescued_passenger');
  legacy.stats.gehrman_trust = 20;
  for (const node of ['marena_talk', 'rescue']) {
    const restored = reload({ ...legacy, node });
    assert.equal(restored.node, 'tavern');
    assert.equal(restored.flags.gehrman_refused, true);
    assert.equal(restored.resolved_events.donna_rescue, 'completed');
    assert.ok(!includes(restored, 'donna') && !includes(restored, 'investigate_rescue'));
  }
});
