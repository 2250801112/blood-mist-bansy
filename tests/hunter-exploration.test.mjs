import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createGame } from '../game/engine.mjs';

const read = (name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url)));
const scenes = read('scenes');
const items = read('items');
const game = createGame(scenes, items);
const start = () => game.start({ name: '调查者', gender: '未指定' });

function act(state, id) {
  const choice = game.nodes[state.node].choices.find((entry) => entry.id === id);
  assert.ok(choice, `${state.node}:${id}`);
  if (choice.region && state.home_area !== choice.region) state = game.moveRoom(state, choice.region);
  if (choice.area && game.area(state) !== choice.area) state = game.moveArea(state, choice.area);
  assert.ok(state, `${id}: area is reachable`);
  const next = game.choose(state, id);
  assert.ok(next, `${state.node}:${id} @${state.elapsed_minutes}`);
  return next;
}
const path = (state, ...ids) => ids.reduce(act, state);
const outside = () => path(start(), 'begin', 'search', 'check_door', 'quiet', 'leave', 'detour');
const day = () => path(outside(), 'wait_for_dawn', 'find_other_way');
const telegraph = () => path(day(), 'telegraph_exterior', 'read_hours', 'wait_open');
const patrol = (state) => path(state, 'inspect_tracks', 'watch_steps', 'analyze_patrol', 'verify_patrol');

function hunterTower() {
  return path(telegraph(), 'observe_blood', 'inspect_wall', 'touch', 'get_up',
    'harbor', 'record_schedule', 'lighthouse', 'wait_tide');
}

test('离港后保持06:00，实际调查值班告示后获得方向', () => {
  let state = path(outside(), 'wait_for_dawn');
  assert.equal(state.elapsed_minutes, 463);
  state = act(state, 'read_notice');
  assert.ok(game.hasFact(state, 'harbor_notice'));
  assert.equal(game.hasFact(state, 'grey_gull_schedule'), false);
});

test('普通人能观察血迹，不能使用猎人分析；晋升后可复查同一对象', () => {
  let state = act(telegraph(), 'observe_blood');
  assert.ok(game.hasFact(state, 'blood_pattern'));
  assert.equal(game.choose(state, 'analyze_blood'), null);
  state = path(state, 'inspect_wall', 'touch', 'get_up', 'telegraph_day');
  state = act(state, 'analyze_blood');
  assert.ok(game.hasFact(state, 'blood_movement'));
  const combined = game.combine(state, ['blood_pattern', 'blood_movement']);
  assert.ok(combined);
  assert.ok(game.hasFact(combined, 'blood_pattern'));
  assert.ok(game.hasFact(combined, 'blood_movement'));
  assert.equal(game.choose(combined, 'analyze_blood'), null);
});

test('巡逻核验与现场潮汐构成20分钟实际流程，猎人完整B线可达', () => {
  let state = hunterTower();
  assert.equal(game.focus(state).id, 'safe_route', '已经读到航运原件时，不应倒退要求先读码头告示');
  const from = state.elapsed_minutes;
  state = patrol(state);
  state = game.combine(state, ['patrol_tracks', 'patrol_steps']);
  assert.ok(state);
  state = game.combine(state, ['R24', 'patrol_verified']);
  assert.ok(state);
  assert.ok(game.hasFact(state, 'patrol_tracks'));
  state = path(state, 'observe_cover', 'approach_cover', 'find_route', 'record_entry');
  assert.equal(state.elapsed_minutes - from, 20);
  assert.ok(game.hasFact(state, 'safe_sea_entry'));
  assert.ok(state.stats.stamina >= 5);
  state = path(state, 'pick_signal');
  assert.equal(game.focus(state).id, 'sea_ready');
  state = path(state, 'wait_for_ship', 'swim', 'accept_isolation');
  assert.equal(state.ending, 'B');
});

test('铜杯诱导需要实际材料，放置不可复制且只能现场取回', () => {
  let state = path(start(), 'begin', 'search', 'take_copper_cup', 'check_door', 'quiet', 'leave', 'detour',
    'wait_for_dawn', 'find_other_way', 'telegraph_exterior', 'read_hours', 'wait_open',
    'inspect_wall', 'touch', 'get_up', 'harbor', 'record_schedule', 'lighthouse', 'wait_tide');
  state = game.moveArea(state, 'rear');
  assert.equal(game.choose(state, 'place_cup_lure'), null);
  state = patrol(state);
  state = act(state, 'inspect_sound');
  state = game.combine(state, ['patrol_verified', 'tower_sound']);
  assert.ok(state);
  state = act(state, 'place_cup_lure');
  assert.equal(state.item_locations.copper_cup, 'lighthouse:rear');
  assert.ok(!state.inventory.includes('copper_cup'));
  assert.equal(game.choose(state, 'place_cup_lure'), null);
  state = game.moveArea(state, 'entrance');
  assert.equal(game.retrieve(state, 'copper_cup'), null);
  state = game.retrieve(game.moveArea(state, 'rear'), 'copper_cup');
  assert.ok(state.inventory.includes('copper_cup'));
  assert.equal(game.choose(state, 'ring_lure'), null);
});

test('完整观潮链最迟17:40开始，晚一分钟不能在18:00后补记路线', () => {
  const tower = hunterTower();
  const finishPatrol = (state) => path(patrol(state), 'observe_cover', 'approach_cover');
  const onTime = finishPatrol({ ...tower, elapsed_minutes: 1163 });
  assert.equal(path(onTime, 'find_route', 'record_entry').elapsed_minutes, 1183);
  const late = game.moveArea(finishPatrol({ ...tower, elapsed_minutes: 1164 }), 'cliff');
  assert.equal(game.choose(late, 'find_route'), null);
  assert.equal(game.hasFact(late, 'safe_sea_entry'), false);
});

test('无铜杯时可用固定吊环，但必须现场推理且仅能借一次绕行', () => {
  let state = path(patrol(hunterTower()), 'observe_cover', 'inspect_sound');
  state = game.combine(state, ['patrol_verified', 'tower_sound']);
  assert.ok(state);
  assert.equal(game.choose(state, 'place_cup_lure'), null);
  state = act(state, 'ring_lure');
  assert.equal(state.flags.tower_lure_alerted, true);
  assert.equal(game.choose(state, 'ring_lure'), null);
  state = act(state, 'approach_lure');
  assert.equal(state.flags.cliff_access, true);
  assert.ok(game.hasFact(state, 'bay_approach'));
  assert.equal(game.choose(state, 'approach_lure'), null);
});

test('普通人能取卸货道表层证据，猎人规避必须结合实际响动', () => {
  let state = path(day(), 'church', 'observe_lane');
  assert.ok(game.hasFact(state, 'lane_footprints'));
  assert.equal(game.choose(state, 'analyze_tracks'), null);
  state = path(state, 'return', 'telegraph_exterior', 'read_hours', 'wait_open',
    'inspect_wall', 'touch', 'get_up', 'church', 'analyze_tracks');
  assert.equal(game.choose(state, 'avoid_corner'), null);
  state = act(state, 'listen_corner');
  state = game.combine(state, ['lane_repeated_tracks', 'lane_sounds']);
  assert.ok(state);
  state = act(state, 'avoid_corner');
  assert.ok(game.hasFact(state, 'lane_safe_approach'));
});

test('所有线索有可用于筛选的摘要、用途与事实分类', () => {
  for (const clue of items.clues) {
    assert.ok(clue.summary, clue.id);
    assert.ok(clue.use, clue.id);
    assert.ok(clue.topics?.length, clue.id);
    for (const topic of clue.topics) assert.ok(['escape', 'amnesia', 'people', 'anomaly'].includes(topic));
  }
});
