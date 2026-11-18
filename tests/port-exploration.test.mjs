import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createGame, commitRun } from '../game/engine.mjs';

const read = (name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url)));
const data = read('scenes');
const items = read('items');
const game = createGame(data, items);
const start = () => game.start({ name: '探路人', gender: '未指定' });
const walk = (state, ...ids) => ids.reduce((run, id) => {
  const choice = game.nodes[run.node].choices.find((entry) => entry.id === id);
  if (choice?.region && run.home_area !== choice.region) run = game.moveRoom(run, choice.region);
  if (choice?.area && game.area(run) !== choice.area) run = game.moveArea(run, choice.area);
  const next = game.choose(run, id);
  assert.ok(next, `${run.node}:${id}`);
  return next;
}, state);
const outside = () => walk(start(), 'begin', 'search', 'check_door', 'quiet', 'leave', 'detour');

test('场景区域移动零分钟，隔区人物行动必须先走到人物所在区域', () => {
  const dock = walk(outside(), 'dock');
  const action = game.nodes.dock.choices.find((choice) => choice.id === 'observe_sailor');
  const other = game.areas(dock).find((area) => area.id !== action.area);
  const apart = game.area(dock) === other.id ? dock : game.moveArea(dock, other.id);
  assert.equal(game.choose(apart, 'observe_sailor'), null);
  const moved = game.moveArea(apart, action.area);
  assert.equal(moved.elapsed_minutes, apart.elapsed_minutes);
  assert.equal(moved.turn, apart.turn + 1);
  const observed = game.choose(moved, 'observe_sailor');
  assert.ok(observed);
  assert.equal(game.hasFact(observed, 'sailor_offer'), true);
  assert.equal(game.moveArea(observed, 'nonexistent-room'), null);
});

test('在码头放下的实体物品不能在另一区域隔空取回', () => {
  const armed = walk(start(), 'begin', 'search', 'knife', 'check_door', 'quiet', 'leave', 'detour', 'dock');
  const dropped = game.drop(armed, 'rusty_knife');
  assert.ok(dropped);
  assert.match(dropped.item_locations.rusty_knife, /^dock:/);
  const origin = game.area(dropped);
  const other = game.areas(dropped).find((area) => area.id !== origin);
  const away = game.moveArea(dropped, other.id);
  assert.equal(game.retrieve(away, 'rusty_knife'), null);
  const returned = game.moveArea(away, origin);
  assert.equal(game.retrieve(returned, 'rusty_knife').inventory.includes('rusty_knife'), true);
});

test('版本2迁移保留知识与金钱，不伪造旧版物品所在分区', () => {
  const owned = walk(start(), 'begin', 'search', 'knife', 'check_door', 'quiet', 'leave', 'detour', 'dock');
  const saved = game.drop(owned, 'rusty_knife');
  saved.save_version = 2;
  delete saved.area_by_site;
  saved.money = 17;
  saved.item_locations.rusty_knife = '码头';
  const facts = structuredClone(saved.discoveries);
  const migrated = game.restore(saved);
  assert.equal(migrated.save_version, 3);
  assert.equal(migrated.money, 17);
  assert.deepEqual(migrated.discoveries, facts);
  assert.equal(migrated.item_locations.rusty_knife, 'legacy:dock');
  assert.match(game.describePlace('legacy:dock'), /未记录分区/);
  assert.deepEqual(game.restore(migrated), migrated);
  const sealed = game.restore({ ...saved, ending: 'D', stats: { ...saved.stats, vitality: 0 } });
  assert.equal(sealed.ending, 'D');
  assert.equal(sealed.stats.vitality, 0);
});

test('全港出行按真实道路逐段计时，多段移动只提交一个回合', () => {
  const source = outside();
  const quote = game.mapRoutes(source).find((route) => route.id === 'dock');
  assert.equal(quote.available, true);
  assert.equal(quote.minutes, 10);
  const arrived = game.travel(source, 'dock');
  assert.equal(game.site(arrived), 'dock');
  assert.equal(arrived.elapsed_minutes, source.elapsed_minutes + 10);
  assert.equal(arrived.turn, source.turn + 1);
  assert.ok(commitRun({ active: source, archive: [], achievements: [] }, arrived));
  assert.equal(game.travel(source, 'unseen-secret'), null);
});

test('首次离家途中遭遇危险时停在街口，不越过遭遇直达目的地', () => {
  const door = walk(start(), 'begin', 'approach_door', 'quiet');
  const arrived = game.travel(door, 'tavern');
  assert.ok(arrived);
  assert.equal(arrived.node, 'street_encounter');
  assert.equal(arrived.elapsed_minutes, door.elapsed_minutes + 5);
  assert.equal(arrived.turn, door.turn + 1);
  assert.equal(game.travel(arrived, 'tavern'), null);
});

test('尚未离家的调查不能借地图跳过门口，第一夜电报局没有室内区域入口', () => {
  const bedroom = walk(start(), 'begin', 'search');
  assert.equal(game.travel(bedroom, 'dock'), null);
  const door = walk(bedroom, 'check_door', 'quiet');
  assert.equal(game.mapRoutes(door).find((entry) => entry.id === 'tavern').minutes, 17);
  const night = walk(outside(), 'telegraph_night');
  assert.deepEqual(game.areas(night).map((entry) => entry.id), ['porch', 'window']);
  assert.equal(game.moveArea(night, 'workroom'), null);
});

test('旧版未调查的初始物品保留调查成本，已放下的遗留物可在该地点认领', () => {
  const saved = walk(outside(), 'dock');
  saved.save_version = 2;
  saved.item_locations.signal_cloth = '旧灯塔';
  saved.item_locations.old_watch = '餐厅';
  const restored = game.restore(saved);
  assert.equal(restored.item_locations.signal_cloth, 'lighthouse:rear');
  assert.equal(restored.placed_items.includes('signal_cloth'), false);
  let owned = walk(start(), 'begin', 'search', 'knife', 'check_door', 'quiet', 'leave', 'detour', 'dock');
  owned = game.drop(owned, 'rusty_knife');
  owned.save_version = 2;
  owned.item_locations.rusty_knife = '码头';
  const migrated = game.restore(owned);
  assert.ok(game.retrieve(migrated, 'rusty_knife').inventory.includes('rusty_knife'));
});

test('路途中跨过06:00后船已离港，地图不会把角色送回可登船状态', () => {
  const source = outside();
  source.elapsed_minutes = 460;
  const arrived = game.travel(source, 'dock');
  assert.ok(arrived);
  assert.equal(arrived.flags.ship_departed, true);
  assert.equal(arrived.node, 'ship_missed');
  assert.equal(game.actions(arrived).some((action) => ['board', 'request_boarding'].includes(action.id)), false);
});

test('地图在正在交谈的节点只供查看，不绕过交谈进度出行', () => {
  const conversation = walk(outside(), 'tavern', 'donna');
  assert.equal(game.mapRoutes(conversation).some((route) => route.available), false);
  assert.equal(game.travel(conversation, 'dock'), null);
});

test('地图保留亲见状态与观察时间，不把世界钟当成远程调查', () => {
  const dock = walk(outside(), 'dock');
  const street = walk(dock, 'leave');
  const before = game.mapRoutes(street).find((entry) => entry.id === 'dock');
  assert.match(before.observation.text, /泊位/);
  assert.equal(before.observation.minute, dock.elapsed_minutes);
  const later = { ...street, elapsed_minutes: 460 };
  const home = game.travel(later, 'home');
  assert.equal(home.flags.ship_departed, true);
  assert.deepEqual(game.mapRoutes(home).find((entry) => entry.id === 'dock').observation, before.observation);
  const missed = game.travel(home, 'dock');
  assert.match(game.mapRoutes(missed).find((entry) => entry.id === 'dock').observation.text, /离港/);
});

test('货棚休整在看顾结束时中断，体力按实际整小时恢复', () => {
  let run = walk(outside(), 'wait_for_dawn', 'find_other_way', 'market');
  run.elapsed_minutes = 1123;
  run = walk(run, 'observe_goods_day', 'observe_shelter', 'ask_shelter');
  run.stats.stamina = 0;
  const rested = walk(run, 'safe_rest');
  assert.equal(rested.elapsed_minutes, 1183);
  assert.equal(rested.stats.stamina, 0);
  assert.equal(game.choose(rested, 'safe_rest'), null);
});

test('休整预览只提醒已经取得的时间线索，越过离港后目标立即更新', () => {
  let run = walk(outside(), 'wait_for_dawn', 'read_notice');
  const departed = walk(run, 'find_other_way');
  assert.equal(departed.elapsed_minutes - run.elapsed_minutes, 10, '离开海堤也须支付真实路程');
  run = game.travel(run, 'home');
  run = walk(run, 'confirm_shelter');
  for (let i = 0; i < 5; i++) run = walk(run, 'safe_rest');
  assert.ok(game.timeWarnings(run, 60).some((entry) => entry.name === '港务原件查阅' && entry.change === '结束'));
  assert.equal(game.timeWarnings(outside(), 1000).some((entry) => entry.name === '港务原件查阅'), false);
  const away = outside();
  away.elapsed_minutes = 460;
  const home = game.travel(away, 'home');
  assert.equal(game.hasFact(home, 'white_agate_departed'), false);
  assert.equal(game.focus(home).id, 'other_ship');
});

test('临下海核对只使用已知事实，未知航线和求救方式不提前给答案', () => {
  const run = outside();
  const rows = game.seaReadiness(run);
  assert.equal(rows.find((entry) => entry.name === '外海航线').text, '尚未确认');
  assert.equal(rows.find((entry) => entry.name === '求救方式').text, '尚未确认');
  assert.equal(rows.some((entry) => entry.text.includes('灰鸥号')), false);
});

test('安全休整按已完成的整小时恢复体力，中断不兑现未完成时间', () => {
  const fixture = structuredClone(data);
  fixture.nodes.find((node) => node.id === 'home_search').choices.push({
    id: 'rest_contract', label: '安全休整两小时', minutes: 120, next: 'home_search', rest: true
  });
  fixture.scheduled_events.push({ id: 'rest_interrupt', at_minute: 90, go_to: 'home_door',
    interrupt_when: [{ type: 'node_in', ids: ['home_search'] }] });
  const engine = createGame(fixture, items);
  let run = engine.choose(engine.start({ name: '休整者', gender: '未指定' }), 'begin');
  run = engine.choose(run, 'search');
  run.elapsed_minutes = 30;
  run.stats.stamina = 0;
  const interrupted = engine.choose(run, 'rest_contract');
  assert.equal(interrupted.node, 'home_door');
  assert.equal(interrupted.elapsed_minutes, 90);
  assert.equal(interrupted.stats.stamina, 2);
  assert.equal(interrupted.stats.loss_of_control, run.stats.loss_of_control);
  run.elapsed_minutes = 100;
  run.stats.stamina = 3;
  const completed = engine.choose(run, 'rest_contract');
  assert.equal(completed.elapsed_minutes, 220);
  assert.equal(completed.stats.stamina, 4);
});
