import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createGame, startNewRun, commitRun } from '../game/engine.mjs';

const read = (name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url)));
const game = createGame(read('scenes'), read('items'));
const start = () => game.start({ name: '安', gender: '未指定' });
const walk = (state, ...actions) => actions.reduce((run, action) => {
  const choice = game.nodes[run.node].choices.find((entry) => entry.id === action);
  if (choice?.region && run.home_area !== choice.region) run = game.moveRoom(run, choice.region);
  const result = game.choose(run, action);
  assert.ok(result, `${run.node}: ${action} 应可执行`);
  return result;
}, state);
const bedroom = () => walk(start(), 'begin', 'search');
const street = () => walk(bedroom(), 'window', 'record_light', 'check_door', 'quiet', 'leave', 'detour');
const secondDay = () => walk(street(), 'rest_to_day', 'find_other_way');
const hunter = () => walk(secondDay(), 'telegraph_day', 'inspect_wall', 'touch', 'get_up');
const introduce = (run) => {
  const dock = walk(run, 'dock', 'observe_sailor');
  const idea = game.combine(dock, ['captain_refusal', 'sailor_offer']);
  return walk(idea, 'pay_introduction', 'captain_terms', 'leave');
};
const restaurant = () => walk(introduce(street()), 'tavern');
const topics = (state) => game.actions(state).map(({ id }) => id);

test('回应堂娜后回到餐厅，存档往返不会重播餐厅开场', () => {
  const firstVisit = restaurant();
  assert.match(firstVisit.narration.join(''), /玛蕾娜：“欢迎/);
  const conversation = walk(firstVisit, 'donna');
  const resumed = JSON.parse(JSON.stringify(conversation));
  const back = walk(resumed, 'believe');
  assert.doesNotMatch(back.narration.join(''), /你推开餐厅木门|玛蕾娜：“欢迎/);
  assert.match(back.narration.join(''), /堂娜/);
  assert.ok(game.text(back).some((line) => line.includes('玛蕾娜')));
  assert.ok(!topics(back).includes('donna'));
});

test('堂娜和玛蕾娜的回应各只能选一次，互斥答复随后消失', () => {
  const comforted = walk(restaurant(), 'donna', 'comfort');
  assert.equal(game.choose(comforted, 'donna'), null);
  assert.ok(comforted.clues.includes('donna_testimony'));
  const helped = walk(comforted, 'wait_collision', 'marena', 'help_marena');
  assert.equal(game.choose(helped, 'marena'), null);
  assert.equal(helped.stats.marena_favor, 10);
});

test('旧存档可继续行动，当前场景和新出现的内容从更新后计入播放记录', () => {
  const {
    action_use_counts, chosen_exclusive_options, resolved_events, light_alert_by_area, narrated, narration, ...oldSave
  } = restaurant();
  const back = walk(game.restore(oldSave), 'donna', 'believe');
  assert.doesNotMatch(back.narration.join(''), /玛蕾娜|你推开餐厅木门/);
});

test('接近堂娜离席时，只能回答在剩余时间内可完成的问题', () => {
  const late = { ...restaurant(), elapsed_minutes: 160 };
  const conversation = walk(late, 'donna');
  assert.deepEqual(topics(conversation), ['comfort', 'return']);
  const back = walk(conversation, 'comfort');
  assert.equal(back.elapsed_minutes, 168);
  assert.equal(back.node, 'tavern');
});

test('同场景行动弹出新旁白，进入新场景则按剧本顺序播放', () => {
  const search = bedroom();
  const receipt = walk(search, 'receipt');
  assert.match(receipt.narration.join(''), /收货人：风暴教堂，米勒主教/);
  const door = walk(receipt, 'check_door');
  const pages = door.narration;
  assert.match(pages[0], /^咚。咚。咚。/);
  assert.match(pages.at(-1), /我……看见……灯……了……/);
});

test('场景内拾取实体道具也有行动旁白', () => {
  const search = bedroom();
  const carried = walk(search, 'lantern');
  assert.match(carried.narration.join(''), /黄铜手提灯/);
  assert.equal(carried.narration.length, 1);
});

test('序章免费，阅读信件和收据不占实体格，叩门按调查时间触发', () => {
  const awake = walk(start(), 'begin');
  assert.equal(awake.elapsed_minutes, 0);
  const run = walk(awake, 'search', 'lantern', 'knife', 'letter', 'receipt', 'meal');
  assert.deepEqual(run.inventory, ['brass_lantern', 'rusty_knife']);
  assert.deepEqual(run.clues, ['memory_gap', 'unsent_letter', 'church_receipt']);
  assert.equal(run.stats.sanity, 100);
  assert.equal(run.node, 'home_door');
  assert.equal(walk(run, 'search_quietly', 'meal').stats.sanity, 94);
});

test('开门前有预警，确认后永久封存且新角色保留成就', () => {
  const initial = startNewRun({ active: null, archive: [], achievements: [] }, start());
  const atDoor = ['begin', 'approach_door', 'open'].reduce(
    (save, action) => commitRun(save, walk(save.active, action)), initial
  );
  const warning = atDoor.active;
  assert.equal(warning.ending, null);
  const dead = walk(warning, 'confirm_open');
  const saved = commitRun(atDoor, dead);
  assert.equal(saved.active, null);
  assert.equal(saved.archive[0].ending, 'D');
  assert.equal(game.choose(dead, 'confirm_open'), null);
  assert.equal(commitRun(saved, warning), null);
  const fresh = startNewRun(saved, start());
  assert.notEqual(fresh.active.id, dead.id);
  assert.deepEqual(fresh.achievements, ['curiosity_price']);
});

test('灯最多保护十分钟，同一遭遇无法重燃，过时贸闯即死', () => {
  const encounter = walk(bedroom(), 'lantern', 'observe_fire', 'relight_home', 'check_door', 'quiet', 'leave');
  const lit = walk(encounter, 'light');
  assert.equal(lit.light_safety_until - lit.elapsed_minutes, 10);
  assert.equal(game.choose(lit, 'light'), null);
  assert.equal(walk(lit, 'cross_with_light').node, 'street');
  const expired = walk(lit, 'watch');
  assert.equal(game.choose(expired, 'cross_with_light'), null);
  assert.equal(walk(expired, 'rush').ending, 'D');
});

test('第一夜电报局可隔门取证但强闯必死，09:40 起换成空电报局', () => {
  const night = walk(street(), 'telegraph_night', 'talk', 'bloodied_paper');
  assert.ok(night.clues.includes('telegram_notes'));
  assert.ok(night.clues.includes('bloodied_telegram'));
  assert.equal(walk(night, 'force_entry').ending, 'E');
  assert.equal(game.choose({ ...night, elapsed_minutes: 682 }, 'peek'), null);
  assert.equal(walk({ ...night, elapsed_minutes: 682 }, 'return', 'telegraph_day').node, 'telegraph_day');
});

test('可信情报只记一次，担保仍要求核验、筛查和至少 60 信任', () => {
  const outside = walk(
    bedroom(), 'receipt', 'check_door', 'peek', 'lock_and_wait', 'leave', 'detour',
  );
  const run = walk(introduce(outside),
    'tavern', 'donna', 'comfort', 'wait_gehrman', 'gehrman', 'ask_boarding', 'receipt', 'submit_receipt',
    'verify', 'submit_evidence', 'risk'
  );
  assert.equal(run.stats.gehrman_trust, 60);
  assert.equal(game.choose(run, 'receipt'), null);
  assert.equal(game.choose(run, 'verify'), null);
  const unscreened = walk(run, 'return', 'return', 'dock', 'wait_parley');
  assert.equal(game.choose(unscreened, 'request_boarding'), null);
  const screened = walk(unscreened, 'screen');
  assert.equal(game.choose({ ...screened, stats: { ...screened.stats, gehrman_trust: 59 } }, 'request_boarding'), null);
  assert.equal(game.choose({ ...screened, flags: { ...screened.flags, has_verified_evidence: false } }, 'request_boarding'), null);
  assert.equal(walk(screened, 'request_boarding').node, 'dock_board');
  assert.equal(game.choose({ ...unscreened, elapsed_minutes: 462 }, 'screen'), null);
});

test('带满两件实体物品须腾出格子，危险场景禁止整理', () => {
  const run = walk(bedroom(), 'lantern', 'knife', 'check_door', 'quiet', 'leave', 'detour');
  assert.equal(game.drop(run, 'rusty_knife'), null);
  const day = walk(run, 'rest_to_day', 'find_other_way');
  const tower = walk(day, 'lighthouse');
  assert.equal(game.choose(tower, 'pick_signal'), null);
  const lightened = game.drop(day, 'rusty_knife');
  assert.ok(lightened);
  assert.deepEqual(walk(lightened, 'lighthouse', 'pick_signal').inventory, ['brass_lantern', 'signal_cloth']);
});

test('异常吸收后猎人体力为7，备齐四项才能在窗口末分钟脱险', () => {
  const run = hunter();
  assert.equal(run.stats.pathway, 'red_priest');
  assert.equal(run.stats.sequence, 9);
  assert.equal(run.stats.loss_of_control, 50);
  assert.equal(run.stats.stamina, 7);
  assert.deepEqual(run.skills, ['hunter_instinct']);
  const prepared = walk(run, 'harbor', 'record_schedule', 'lighthouse', 'wait_tide', 'find_route', 'record_entry', 'pick_signal', 'wait_for_ship');
  assert.equal(prepared.elapsed_minutes, 1803);
  const swimActions = (state) => game.actions(state).filter(({ id }) => id === 'swim' || id === 'unsafe_swim');
  for (const state of [prepared, { ...prepared, inventory: [] }]) {
    const options = swimActions(state);
    assert.equal(options.length, 1);
    assert.equal(options[0].label, '下海');
    assert.equal(options[0].available, true);
  }
  assert.equal(game.choose({ ...prepared, elapsed_minutes: 1802 }, 'swim'), null);
  assert.equal(game.choose({ ...prepared, elapsed_minutes: 1824 }, 'swim'), null);
  assert.equal(game.choose({ ...prepared, inventory: [] }, 'swim'), null);
  assert.equal(walk({ ...prepared, elapsed_minutes: 1823 }, 'swim', 'accept_isolation').ending, 'B');
});

test('普通人贸然下海会遇难，海上失败解释缺失条件', () => {
  const sea = walk(secondDay(), 'harbor', 'wait_records', 'record_schedule', 'lighthouse', 'wait_for_ship');
  assert.equal(game.choose(sea, 'swim'), null);
  const end = walk(sea, 'unsafe_swim');
  assert.equal(end.ending, 'SEA_FAIL');
  assert.match(game.text(end).join(''), /体力/);
});

test('时钟不回退，72小时终局与猎人失控优先结算', () => {
  const doom = walk(secondDay(), 'wait_for_doom');
  assert.equal(doom.ending, 'C');
  assert.equal(doom.elapsed_minutes, 4320);
  const late = walk({ ...secondDay(), elapsed_minutes: 4319 }, 'rest');
  assert.equal(late.elapsed_minutes, 4320);
  const previous = walk(hunter(), 'telegraph_day', 'inspect_wall', 'listen_risk');
  const failed = walk(previous, 'listen_risk');
  assert.equal(failed.stats.loss_of_control, 100);
  assert.equal(failed.ending, 'F');
  assert.equal(game.choose(failed, 'swim'), null);
});
