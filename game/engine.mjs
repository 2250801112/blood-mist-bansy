export const SAVE_KEY = 'blood-mist-bansy-v1';

const addUnique = (array, value) => {
  if (!array.includes(value)) array.push(value);
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function startNewRun(profile, state) {
  if (profile.active) return null;
  return { ...profile, active: state };
}

export function commitRun(profile, state) {
  if (profile.active?.id !== state.id || profile.active.turn + 1 !== state.turn) return null;
  const achievements = [...new Set([...profile.achievements, ...state.achievements])];
  if (state.ending) {
    return { active: null, archive: [...profile.archive, state], achievements };
  }
  return { ...profile, active: state, achievements };
}

export function createGame(data, itemData) {
  const nodes = Object.fromEntries(data.nodes.map((node) => [node.id, node]));
  const items = Object.fromEntries(itemData.items.map((item) => [item.id, item]));
  const clues = Object.fromEntries(itemData.clues.map((clue) => [clue.id, clue]));
  const recipes = itemData.recipes;
  const exploration = data.exploration;
  const events = [...data.scheduled_events].sort((a, b) => a.at_minute - b.at_minute);
  const startTime = Date.parse(data.world_clock.start_local.replace(' ', 'T') + ':00Z');
  const bagUsed = (state) => state.inventory.reduce((slots, id) => slots + items[id].occupies_slots, 0);
  const hasFact = (state, id) => state.clues.some((card) => state.cards[card].facts.includes(id));
  const site = (state) => nodes[state.node].site;
  const area = (state) => site(state) === 'home' ? state.home_area : state.area_by_site[site(state)];
  const areas = (state) => exploration.sites[site(state)].areas.filter((entry) => matches(state, entry.requires));
  const place = (state) => `${site(state)}:${area(state)}`;
  const defaultAreas = () => Object.fromEntries(Object.entries(exploration.sites).map(([id, entry]) => [id, entry.default_area]));

  function describePlace(location) {
    const [siteId, areaId] = location.split(':');
    if (siteId === 'legacy') return `${exploration.sites[areaId].name}（旧记录未记录分区）`;
    const locationSite = exploration.sites[siteId];
    if (!locationSite) return location;
    return `${locationSite.name} · ${locationSite.areas.find((entry) => entry.id === areaId).name}`;
  }

  function discover(state, id, source) {
    if (state.discoveries[id]) return;
    state.discoveries[id] = { minute: state.elapsed_minutes, location: place(state), source, event: state.action_source_id };
    state.cards[id] = { facts: [id], deductions: [] };
    state.clues.push(id);
  }

  function dialogueMinutes(state, id = nodes[state.node].dialogue_window) {
    if (!id) return null;
    const window = data.dialogue_windows[id];
    return Math.max(0, data.world_clock[window.closes_at] - state.elapsed_minutes);
  }

  const conditions = {
    flag_true: (state, rule) => state.flags[rule.key] === true,
    flag_false: (state, rule) => state.flags[rule.key] !== true,
    clue: (state, rule) => hasFact(state, rule.id),
    clue_any: (state, rule) => rule.ids.some((id) => hasFact(state, id)),
    deduction: (state, rule) => state.deductions.includes(rule.id),
    money_gte: (state, rule) => state.money >= rule.value,
    lamp_lit: (state, rule) => state.lamp_lit === rule.value,
    fire_here: (state) => state.fire_sources.includes(place(state)),
    item_at: (state, rule) => state.item_locations[rule.id] === place(state),
    boarding_valid: (state) => state.flags.boarding_approved && !state.flags.boarding_revoked &&
      (state.flags.paid_berth || (!state.flags.gehrman_refused && state.stats.gehrman_trust >= 60 && state.flags.has_verified_evidence)),
    signal_ready: (state) => state.inventory.includes('signal_cloth') || (state.inventory.includes('brass_lantern') && state.lamp_lit),
    item: (state, rule) => state.inventory.includes(rule.id),
    item_any: (state, rule) => rule.ids.some((id) => state.inventory.includes(id)),
    item_missing: (state, rule) => !state.inventory.includes(rule.id),
    item_missing_all: (state, rule) => rule.ids.every((id) => !state.inventory.includes(id)),
    stat_gte: (state, rule) => state.stats[rule.key] >= rule.value,
    stat_lt: (state, rule) => state.stats[rule.key] < rule.value,
    stat_lte: (state, rule) => state.stats[rule.key] <= rule.value,
    minute_lt: (state, rule) => state.elapsed_minutes < rule.value,
    minute_gt: (state, rule) => state.elapsed_minutes > rule.value,
    minute_gte: (state, rule) => state.elapsed_minutes >= rule.value,
    minute_lte: (state, rule) => state.elapsed_minutes <= rule.value,
    pathway: (state, rule) => state.stats.pathway === rule.id && state.stats.sequence === rule.sequence,
    inventory_space: (state, rule) => state.inventory_limit - bagUsed(state) >= rule.value,
    light_active: (state, rule) => state.inventory.includes('brass_lantern') && state.lamp_lit && state.elapsed_minutes + rule.value <= state.light_safety_until,
    exclusive_open: (state, rule) => !state.chosen_exclusive_options[rule.id],
    event_pending: (state, rule) => !state.resolved_events[rule.id],
    node_in: (state, rule) => rule.ids.includes(state.node),
    light_alert_gte: (state, rule) => (state.light_alert_by_area[rule.id]?.level ?? 0) >= rule.value,
    light_alert_lt: (state, rule) => (state.light_alert_by_area[rule.id]?.level ?? 0) < rule.value
  };
  const matches = (state, rules = []) => rules.every(
    (rule) => conditions[rule.type](state, rule)
  );

  function setStat(state, key, value) {
    state.stats[key] = value;
    if (key === 'gehrman_trust' && value < 0) state.flags.gehrman_refused = true;
  }

  const effects = {
    resolve_event: (state, effect) => { state.resolved_events[effect.id] ??= effect.value; },
    set_flag: (state, effect) => { state.flags[effect.key] = effect.value; },
    add_clue: (state, effect) => discover(state, effect.id, state.action_source),
    add_money: (state, effect) => { state.money += effect.value; },
    set_lamp: (state, effect) => { state.lamp_lit = effect.value; },
    record_fire: (state) => addUnique(state.fire_sources, place(state)),
    sell_facts: (state, effect) => {
      for (const id of effect.ids) state.sold_facts[id] = { buyer: 'harbor_buyer', minute: state.elapsed_minutes };
    },
    add_item: (state, effect) => {
      if (state.inventory.includes(effect.id)) return;
      if (bagUsed(state) + items[effect.id].occupies_slots > state.inventory_limit) {
        throw new Error(`背包无法放入 ${effect.id}`);
      }
      state.inventory.push(effect.id);
      state.item_locations[effect.id] = 'inventory';
    },
    remove_item: (state, effect) => {
      if (state.inventory.includes(effect.id) && effect.destination.includes(':')) addUnique(state.placed_items, effect.id);
      state.inventory = state.inventory.filter((id) => id !== effect.id);
      state.item_locations[effect.id] = effect.destination;
      if (effect.id === 'brass_lantern') state.lamp_lit = false;
    },
    add_stat: (state, effect) => {
      const min = effect.key === 'gehrman_trust' ? -100 : 0;
      const max = effect.key === 'stamina' ? state.stats.stamina_max : 100;
      setStat(state, effect.key, clamp(state.stats[effect.key] + effect.value, min, max));
    },
    set_stat: (state, effect) => setStat(state, effect.key, effect.value),
    set_stat_min: (state, effect) => {
      setStat(state, effect.key, Math.max(state.stats[effect.key], effect.value));
    },
    unlock_skill: (state, effect) => addUnique(state.skills, effect.id),
    unlock_achievement: (state, effect) => addUnique(state.achievements, effect.id),
    end: (state, effect) => {
      state.ending = effect.id;
      if (effect.id !== 'A' && effect.id !== 'B') state.stats.vitality = 0;
    },
    light_for_minutes: (state, effect) => {
      state.lamp_lit = true;
      discover(state, 'lamp_illumination', state.action_source);
      discover(state, 'lamp_hesitation', state.action_source);
      if (state.light_alert_by_area[effect.id]) return;
      state.light_safety_until = state.elapsed_minutes + effect.value;
      state.light_alert_by_area[effect.id] = { level: 1, expires_at: state.light_safety_until };
    }
  };
  const apply = (state, changes = []) => {
    for (const effect of changes) {
      if (matches(state, effect.when)) effects[effect.type](state, effect);
    }
  };

  function enter(state, id) {
    const visited = new Set();
    let destination = id;
    while (true) {
      if (visited.has(destination)) throw new Error(`场景跳转形成循环：${destination}`);
      visited.add(destination);
      const redirect = nodes[destination].redirects?.find((rule) => matches(state, rule.requires));
      if (!redirect) break;
      destination = redirect.next;
    }
    const changed = state.node !== destination;
    state.node = destination;
    if (nodes[destination].entry_area) state.area_by_site[site(state)] = nodes[destination].entry_area;
    if (['home_door', 'door_talk', 'door_peek', 'door_confirm', 'home_exit'].includes(destination)) state.home_area = 'hall';
    if (changed) {
      apply(state, nodes[destination].on_enter);
      if (destination === 'hunter_awaken') {
        state.pending_presentation = { kind: 'promotion', turn: state.turn };
      }
      if (destination === 'home_wake') state.pending_presentation = { kind: 'wake', turn: state.turn };
    }
    if (destination !== 'intro' && !state.ending) {
      const observation = exploration.sites[site(state)].observations.find((entry) => matches(state, entry.requires));
      state.site_observations[site(state)] = { text: observation.text, risk: observation.risk ?? '', minute: state.elapsed_minutes };
    }
  }

  function start(identity) {
    const state = {
      ...structuredClone(data.initial_state),
      identity, id: crypto.randomUUID(), node: null, turn: 0,
      action_use_counts: {}, chosen_exclusive_options: {}, resolved_events: {},
      light_alert_by_area: {}, achievements: [], feedback: [],
      light_safety_until: -1, save_version: 3, home_area: 'bedroom', area_by_site: defaultAreas(), placed_items: [], cards: {}, discoveries: {}, deductions: [],
      money: 24, sold_facts: {}, transactions: [], tasks: {}, fire_sources: [], lamp_lit: false, site_observations: {},
      item_locations: Object.fromEntries(itemData.items.map((item) => [item.id, item.initial_location])),
      notifications: [], settlement_log: [], pending_presentation: null, action_source: '序章', action_source_id: 'intro:start'
    };
    enter(state, data.start_node);
    return rememberNarration(state);
  }

  function finishTime(state, choice) {
    const finish = Math.max(state.elapsed_minutes + choice.minutes,
      ...(choice.effects ?? []).filter((effect) => effect.type === 'advance_to_minute').map((effect) => effect.value));
    if (choice.rest && site(state) === 'market') {
      const window = exploration.sites.market.trade_windows.find(([from, to]) => state.elapsed_minutes >= from && state.elapsed_minutes < to);
      if (window) return Math.min(finish, window[1]);
    }
    return finish;
  }

  function actions(state) {
    const node = nodes[state.node];
    if (state.ending) return [];
    const visible = [];
    for (const choice of node.choices) {
      const finish = finishTime(state, choice);
      const duration = finish - state.elapsed_minutes;
      const uses = state.action_use_counts[`${node.id}:${choice.id}`] ?? 0;
      const limit = choice.max_uses ?? (choice.once ? 1 : Infinity);
      if (uses >= limit || state.chosen_exclusive_options[choice.exclusive_group] ||
          (choice.region && state.home_area !== choice.region) ||
          (choice.area && area(state) !== choice.area) ||
          state.flags[choice.permanent_lock] === true || state.elapsed_minutes < (choice.available_from ?? 0) ||
          finish > (choice.available_until ?? Infinity) || !matches(state, choice.visible_when)) continue;
      visible.push({ ...choice, duration, available: matches(state, choice.requires) });
    }
    return visible.filter((choice, _, choices) => {
      if (choice.alternative_to) {
        return !choices.some((primary) => primary.id === choice.alternative_to && primary.available);
      }
      return choice.available || !choices.some((alternative) => alternative.alternative_to === choice.id && alternative.available);
    });
  }

  function updateLight(state) {
    for (const alert of Object.values(state.light_alert_by_area)) {
      if (alert.level === 1 && state.elapsed_minutes >= alert.expires_at) {
        alert.level = 2;
        if (state.node === 'street_encounter' && state.lamp_lit && state.inventory.includes('brass_lantern')) {
          discover(state, 'lamp_expiry', '灯火掩护结束时的街口观察');
        }
      }
    }
  }

  function dispatch(state, event, historical = false) {
    if (state.resolved_events[event.id]) return null;
    state.resolved_events[event.id] = 'occurred';
    const source = state.action_source_id;
    state.action_source_id = `world:${event.id}`;
    apply(state, historical ? (event.effects ?? []).filter((effect) => effect.type !== 'add_clue') : event.effects);
    state.action_source_id = source;
    if (historical || state.ending) return null;
    if (event.notice && matches(state, event.notice.requires)) state.feedback.push(...event.notice.text);
    return event.go_to && matches(state, event.interrupt_when) ? event.go_to : null;
  }

  function choose(state, id) {
    const choice = actions(state).find((action) => action.id === id);
    if (!choice?.available) return null;
    return settle(state, choice);
  }

  function settle(state, choice, record = true) {
    const next = structuredClone(state);
    next.turn += 1;
    next.feedback = [];
    next.action_source = choice.label;
    next.action_source_id = `${state.node}:${choice.id}`;
    next.movement = null;
    const changes = choice.effects ?? [];
    const travelEnd = state.elapsed_minutes + choice.duration;
    const finishRest = () => {
      if (choice.rest) next.stats.stamina = Math.min(next.stats.stamina_max,
        next.stats.stamina + Math.floor((next.elapsed_minutes - state.elapsed_minutes) / 60) * 2);
    };
    // A boarding operation completed on the departure minute gets its berth first.
    for (const event of events) {
      if (event.at_minute > travelEnd || state.elapsed_minutes >= event.at_minute) continue;
      if (choice.finish_before_events && event.at_minute === travelEnd) continue;
      next.elapsed_minutes = event.at_minute;
      updateLight(next);
      const interruption = dispatch(next, event);
      if (interruption) {
        finishRest();
        enter(next, interruption);
        return record ? rememberNarration(next, state) : next;
      }
    }
    next.elapsed_minutes = travelEnd;
    finishRest();
    updateLight(next);
    const ref = `${state.node}:${choice.id}`;
    next.action_use_counts[ref] = (next.action_use_counts[ref] ?? 0) + 1;
    if (choice.exclusive_group) next.chosen_exclusive_options[choice.exclusive_group] = ref;
    next.feedback.push(...(choice.feedback ?? []));
    apply(next, changes.filter((effect) => effect.type !== 'advance_to_minute'));
    const failure = data.global_failure_rules.find((rule) => matches(next, [rule.if]));
    enter(next, failure ? failure.go_to : choice.next);
    if (choice.finish_before_events) {
      for (const event of events.filter((entry) => entry.at_minute === travelEnd)) {
        const interruption = dispatch(next, event);
        if (interruption) enter(next, interruption);
      }
    }
    return record ? rememberNarration(next, state) : next;
  }

  function restore(state) {
    if (state.save_version === 3 && state.action_use_counts && state.cards) return state;
    if (state.save_version === 2 && state.action_use_counts && state.cards) return migratePlaces(state);
    // Upgrade runs from before the world timetable without resetting earned rewards.
    const next = structuredClone(state);
    next.action_use_counts ??= {};
    next.chosen_exclusive_options ??= {};
    next.resolved_events ??= {};
    next.light_alert_by_area ??= {};
    let previousTrust = 0;
    for (const ref of next.used ?? []) {
      next.action_use_counts[ref] = 1;
      const [nodeId, choiceId] = ref.split(':');
      const choice = nodes[nodeId]?.choices.find((entry) => entry.id === choiceId);
      if (choice?.exclusive_group) next.chosen_exclusive_options[choice.exclusive_group] ??= ref;
      for (const effect of choice?.effects ?? []) {
        if (effect.type !== 'add_stat' || effect.key !== 'gehrman_trust') continue;
        previousTrust = clamp(previousTrust + effect.value, -100, 100);
        if (previousTrust < 0) next.flags.gehrman_refused = true;
      }
    }
    if (next.stats.gehrman_trust < 0) next.flags.gehrman_refused = true;
    if (next.chosen_exclusive_options.gehrman_intro || next.flags.receipt_shown || next.flags.verified_given || next.flags.admitted_risk) {
      next.flags.gehrman_intro_done = true;
    }
    if (next.flags.rescue_done) {
      next.resolved_events.donna_rescue = next.clues.includes('rescued_passenger') ? 'completed' : 'resolved_elsewhere';
    }
    if (next.chosen_exclusive_options.marena_reply) next.resolved_events.marena_kitchen = 'completed';
    if (next.flags.ship_schedule_known) next.resolved_events.harbor_records = 'completed';
    if (next.flags.safe_sea_route_known) next.resolved_events.lighthouse_tide = 'completed';
    if (next.light_safety_until >= 0) {
      next.light_alert_by_area.night_street = { level: 1, expires_at: next.light_safety_until };
    }
    next.save_version = 2;
    next.home_area = 'bedroom';
    next.area_by_site = defaultAreas();
    next.placed_items = [];
    next.site_observations = {};
    if (nodes[next.node].entry_area) next.area_by_site[site(next)] = nodes[next.node].entry_area;
    next.cards = {};
    next.discoveries = {};
    next.deductions = [];
    next.money = 24;
    next.sold_facts = {};
    next.transactions = [];
    next.fire_sources = [];
    next.lamp_lit = next.light_safety_until > next.elapsed_minutes;
    next.tasks = {};
    next.notifications = [];
    next.settlement_log = [];
    next.pending_presentation = null;
    next.action_source_id = 'save:legacy';
    next.item_locations = Object.fromEntries(itemData.items.map((item) => [item.id,
      next.inventory.includes(item.id) ? 'inventory' : item.initial_location]));
    for (const [ref, uses] of Object.entries(next.action_use_counts)) {
      if (!uses) continue;
      const [nodeId, choiceId] = ref.split(':');
      for (const effect of nodes[nodeId]?.choices.find((choice) => choice.id === choiceId)?.effects ?? []) {
        if (effect.type === 'add_item' && !next.inventory.includes(effect.id)) next.item_locations[effect.id] = 'legacy_unknown';
      }
    }
    const previousClues = [...next.clues];
    next.clues = [];
    for (const id of previousClues) {
      discover(next, id, '旧版存档已有记录，原取得时间未保存');
      next.discoveries[id].minute = null;
    }
    updateLight(next);
    if (next.node !== 'intro') discover(next, 'memory_gap', '旧版角色已苏醒');
    // Earlier introductions were implicit; only prior personal contact preserves that access.
    if (next.flags.gehrman_intro_done || next.flags.boarding_approved) {
      for (const id of ['gehrman_whereabouts', 'captain_requirements', 'captain_schedule', 'sailor_introduced']) {
        discover(next, id, '旧版已完成的接触或许可');
      }
    }
    for (const event of events) {
      if (event.at_minute <= next.elapsed_minutes) dispatch(next, event, true);
    }
    if (!next.ending) {
      next.action_source = '继续旧版角色时观察当前地点';
      enter(next, next.node === 'dock_board' ? 'dock' : next.node);
      apply(next, (nodes[next.node].on_enter ?? []).filter((effect) => effect.type === 'add_clue'));
    }
    updateTasks(next);
    return migratePlaces(next);
  }

  function migratePlaces(state) {
    const next = structuredClone(state);
    next.save_version = 3;
    next.area_by_site = defaultAreas();
    next.placed_items = [];
    next.site_observations = {};
    if (nodes[next.node].entry_area) next.area_by_site[site(next)] = nodes[next.node].entry_area;
    const legacySites = Object.fromEntries(data.nodes.map((node) => [node.location, node.site]));
    for (const [id, location] of Object.entries(next.item_locations)) {
      if (legacySites[location]) {
        const acquired = Object.entries(next.action_use_counts).some(([ref, count]) => {
          const [nodeId, choiceId] = ref.split(':');
          return count > 0 && nodes[nodeId]?.choices.find((choice) => choice.id === choiceId)?.effects?.some((effect) => effect.type === 'add_item' && effect.id === id);
        });
        if (acquired || next.settlement_log.some((entry) => entry.dropped === id)) {
          next.item_locations[id] = `legacy:${legacySites[location]}`;
          next.placed_items.push(id);
        } else next.item_locations[id] = items[id].initial_location;
      } else if (location.startsWith('home:') && next.settlement_log.some((entry) => entry.dropped === id)) next.placed_items.push(id);
    }
    next.fire_sources = next.fire_sources.map((location) => {
      const oldSite = legacySites[location];
      return oldSite && exploration.sites[oldSite].fire_area ? `${oldSite}:${exploration.sites[oldSite].fire_area}` : location;
    });
    return next;
  }

  function drop(state, item) {
    if (state.ending || !nodes[state.node].safe_inventory || !state.inventory.includes(item)) return null;
    const next = structuredClone(state);
    next.turn += 1;
    effects.remove_item(next, { id: item, destination: place(state) });
    next.action_source = `放下${items[item].name}`;
    next.feedback = [`你放下了「${items[item].name}」。`];
    return rememberNarration(next, state);
  }

  function retrieve(state, id) {
    if (state.ending || !items[id] || nodes[state.node].map_locked ||
        ![place(state), `legacy:${site(state)}`].includes(state.item_locations[id]) ||
        bagUsed(state) + items[id].occupies_slots > state.inventory_limit) return null;
    // Initial pickups carry authored investigation text and costs.
    if (!state.placed_items.includes(id)) return null;
    const next = structuredClone(state);
    next.turn += 1;
    effects.add_item(next, { id });
    next.action_source = `重新拿起${items[id].name}`;
    next.feedback = [`你重新拿起「${items[id].name}」。`];
    return rememberNarration(next, state);
  }

  function moveRoom(state, area) {
    if (state.ending || !data.home_regions[area] || nodes[state.node].location !== '玩家住所' ||
        !['home_wake', 'home_search', 'home_exit', 'home_window', 'home_remember'].includes(state.node) ||
        (state.node === 'home_search' && state.home_area === area)) return null;
    const next = structuredClone(state);
    next.turn += 1;
    next.home_area = area;
    next.action_source = `前往${data.home_regions[area].name}`;
    next.node = 'home_search';
    next.feedback = [];
    return rememberNarration(next, state);
  }

  function moveArea(state, id) {
    if (site(state) === 'home') return moveRoom(state, id);
    if (state.ending || nodes[state.node].map_locked || id === area(state) || !areas(state).some((entry) => entry.id === id)) return null;
    const next = structuredClone(state);
    next.turn += 1;
    next.area_by_site[site(state)] = id;
    next.action_source = `前往${areas(state).find((entry) => entry.id === id).name}`;
    next.feedback = [];
    return rememberNarration(next, state);
  }

  function routeTo(state, destination) {
    const frontier = [{ id: site(state), minutes: 0, legs: [] }];
    const visited = new Set();
    while (frontier.length) {
      frontier.sort((a, b) => a.minutes - b.minutes);
      const current = frontier.shift();
      if (visited.has(current.id)) continue;
      if (current.id === destination) return current;
      visited.add(current.id);
      for (const leg of exploration.routes.filter((entry) => entry.from === current.id)) {
        if (!matches(state, leg.requires) || !matches(state, exploration.sites[leg.to].visible_when) ||
            !matches(state, exploration.sites[leg.to].requires)) continue;
        const duration = state.node === 'home_exit' && leg.from === 'home' ? actions(state).find((choice) => choice.id === 'leave').duration : leg.minutes;
        frontier.push({ id: leg.to, minutes: current.minutes + duration, legs: [...current.legs, { ...leg, minutes: duration }] });
      }
    }
    return null;
  }

  function mapRoutes(state) {
    const firstExitPending = site(state) === 'home' && !state.action_use_counts['home_exit:leave'];
    const locked = state.ending || (nodes[state.node].map_locked && state.node !== 'home_exit') ||
      (firstExitPending && state.node !== 'home_exit');
    return Object.entries(exploration.sites).filter(([, entry]) => matches(state, entry.visible_when)).map(([id, entry]) => {
      const route = routeTo(state, id);
      const available = !locked && id !== site(state) && Boolean(route) && matches(state, entry.requires);
      return { id, name: entry.name, minutes: route?.minutes ?? 0, legs: route?.legs ?? [], available, observation: state.site_observations[id],
        reason: state.ending ? '这一轮旅程已经结束' : locked ? '请先处理眼前的对话或危险' : id === site(state) ? '当前位置' : !route ? '尚未确认通行路线' : '' };
    });
  }

  function travel(state, destination) {
    const route = mapRoutes(state).find((entry) => entry.id === destination);
    if (!route?.available) return null;
    let next = state;
    const feedback = [];
    for (const leg of route.legs) {
      if (!matches(next, leg.requires) || !matches(next, exploration.sites[leg.to].requires)) {
        feedback.push('途中通行条件已经变化，你停在了当前地点。');
        break;
      }
      const departure = { ...next, turn: state.turn };
      const firstExit = next.node === 'home_exit' && leg.from === 'home';
      const choice = firstExit ? actions(departure).find((entry) => entry.id === 'leave') : {
        id: `travel_${leg.id}`, label: `前往${exploration.sites[leg.to].name}`, duration: leg.minutes,
        next: exploration.sites[leg.to].entry
      };
      if (!choice || choice.available === false) return null;
      next = settle(departure, choice, false);
      feedback.push(...next.feedback);
      if (next.ending || nodes[next.node].map_locked) break;
    }
    next.action_source = `前往${exploration.sites[destination].name}`;
    next.feedback = feedback;
    return rememberNarration(next, state);
  }

  function combine(state, ids) {
    if (state.ending || ids.length < 1 || ids.length > 2 || new Set(ids).size !== ids.length || ids.some((id) => !state.clues.includes(id))) return null;
    const facts = [...new Set(ids.flatMap((id) => state.cards[id].facts))].sort();
    const deductions = [...new Set(ids.flatMap((id) => state.cards[id].deductions))];
    const recipe = recipes.find((entry) => !state.deductions.includes(entry.id) &&
      entry.facts.every((id) => facts.includes(id)) && entry.after.every((id) => deductions.includes(id)));
    if (!recipe) return null;
    const next = structuredClone(state);
    next.turn += 1;
    for (const id of ids) delete next.cards[id];
    next.clues = next.clues.filter((id) => !ids.includes(id));
    next.clues.push(recipe.id);
    next.cards[recipe.id] = { facts, deductions: [...deductions, recipe.id].sort() };
    next.deductions.push(recipe.id);
    next.action_source = `关联线索《${clues[recipe.id].name}》`;
    next.feedback = [recipe.reasoning, '原卡片已归入结果详情，原始记录与话题依据继续保留。'];
    return rememberNarration(next, state);
  }

  function quote(state, kind, id) {
    if (state.ending || state.node !== 'market' || area(state) !== 'counter' ||
        !exploration.sites.market.trade_windows.some(([from, to]) => state.elapsed_minutes >= from && state.elapsed_minutes + 2 <= to)) return null;
    if (kind === 'information') {
      if (!hasFact(state, 'buyer_information') || !state.clues.includes(id)) return null;
      const facts = state.cards[id].facts.filter((fact) => !state.sold_facts[fact] && clues[fact].sale_price > 0);
      if (!facts.length) return null;
      return { kind, id, facts, price: facts.reduce((sum, fact) => sum + clues[fact].sale_price, 0), minutes: 2, name: clues[id].name, buyer: '港边收货人' };
    }
    if (!hasFact(state, 'buyer_goods') || !items[id]?.sale_price) return null;
    if (kind === 'item' && state.inventory.includes(id)) return { kind, id, price: items[id].sale_price, minutes: 2, name: items[id].name, buyer: '港边收货人' };
    if (kind === 'buyback' && state.item_locations[id] === 'buyer') return { kind, id, price: Math.ceil(items[id].sale_price * 1.5), minutes: 2, name: items[id].name, buyer: '港边收货人' };
    return null;
  }

  function trade(state, kind, id) {
    const offer = quote(state, kind, id);
    if (!offer || (kind === 'buyback' && (state.money < offer.price || bagUsed(state) + items[id].occupies_slots > state.inventory_limit))) return null;
    const changes = [{ type: 'add_money', value: kind === 'buyback' ? -offer.price : offer.price }];
    if (kind === 'information') changes.push({ type: 'sell_facts', ids: offer.facts });
    else if (kind === 'item') changes.push({ type: 'remove_item', id, destination: 'buyer' });
    else changes.push({ type: 'add_item', id });
    const next = settle(state, { id: `trade_${kind}_${id}`, label: `${kind === 'buyback' ? '买回' : '出售'}${offer.name}`,
      duration: offer.minutes, next: state.node, effects: changes,
      feedback: [kind === 'information' ? '收货人记下了消息。你的知识仍留在线索簿中。' : `你与收货人交接了「${offer.name}」。`] });
    if (next.node === 'market' && !next.ending) next.transactions.push({ ...offer, minute: next.elapsed_minutes });
    return next;
  }

  function acknowledge(state) {
    if (state.ending || !state.pending_presentation) return null;
    const next = structuredClone(state);
    next.turn += 1;
    if (next.pending_presentation.kind === 'promotion') {
      next.narration = [];
      next.notifications = [];
    }
    next.pending_presentation = null;
    next.movement = null;
    return next;
  }

  function updateTasks(state) {
    if (hasFact(state, 'memory_gap')) {
      state.tasks.amnesia = { name: '调查你失忆的原因', status: state.ending && !['A', 'B'].includes(state.ending) ? 'sealed' : 'active',
        entries: ['调查住所，尝试回忆白天的经历。',
          ...(hasFact(state, 'unsent_letter') ? ['自己写过一封信，却想不起要隐瞒什么。'] : []),
          ...(hasFact(state, 'church_receipt') ? ['核实教堂运输委托；木箱内容与记忆空白的关系仍待调查。'] : []),
          ...(['A','B'].includes(state.ending) ? ['你已离开班西；失忆的真正原因仍未解开。'] : [])] };
    }
    if (hasFact(state, 'harbor_whistle') || hasFact(state, 'captain_schedule') || hasFact(state, 'white_agate_lead') || hasFact(state, 'grey_gull_schedule')) {
      state.tasks.escape = { name: '离开班西港', status: ['A','B'].includes(state.ending) ? 'completed' : state.ending ? 'sealed' : 'active',
        entries: state.ending ? [['A','B'].includes(state.ending) ? '你已经离开班西港。' : '本轮角色的逃生调查已经封存。'] : [focus(state).name, focus(state).hint] };
    }
    if (hasFact(state, 'gehrman_whereabouts')) state.tasks.find_gehrman = {
      name: '寻找格尔曼·斯帕罗', status: state.flags.gehrman_intro_done ? 'completed' : state.ending ? 'sealed' : 'active',
      entries: [state.elapsed_minutes >= 173 ? '餐厅的行踪记录已过时。' : '船长说他在青柠檬餐厅。黑礼服，戴礼帽，带上能核对的证据。'] };
  }

  function focus(state) {
    if (state.ending) return null;
    const goal = (id, name, hint, ids) => ({ id, name, hint, clue_ids: ids.filter((key) => hasFact(state, key)) });
    if (state.flags.ship_departed || hasFact(state, 'grey_gull_schedule')) {
      if (!state.flags.ship_schedule_known && !hasFact(state, 'harbor_notice')) return goal('other_ship', '寻找其他离港方式',
        hasFact(state, 'white_agate_departed') ? '调查空泊位附近的值班告示，寻找下一条消息。' : '清晨的汽笛已经远去，去码头核实船只和其他航务消息。',
        ['harbor_whistle', 'captain_schedule', 'white_agate_departed', 'white_agate_lead']);
      if (!state.flags.ship_schedule_known) return goal('harbor_records', '核对外海船只的消息',
        state.resolved_events.harbor_records === 'missed' ? '告示上的查阅窗口已过，保留记录并继续调查求生条件。' : '按海堤告示，在港务交班窗口查阅原件。',
        ['white_agate_departed', 'harbor_notice']);
      if (!state.flags.is_hunter) return goal('survival', '寻找接近外海的办法',
        hasFact(state, 'mural_sketch') ? '旧墙的异常仍待你决定如何处理。' : '普通人的体力不足以游向外海；继续调查电报局留下的异常。',
        ['grey_gull_schedule', 'missing_operators', 'blood_pattern', 'mural_sketch']);
      if (!state.flags.safe_sea_route_known) return goal('safe_route', '确认安全的下海路线',
        state.resolved_events.lighthouse_tide === 'missed' ? '可核验的潮汐窗口已经结束，这次航线尚未得到确认。' :
          hasFact(state, 'bay_approach') ? '已接近崖边；在观潮窗口核对漂浮物和浪线。' :
            hasFact(state, 'patrol_verified') ? '寻找入口掩体，利用亲眼核验的巡逻空档。' : '到灯塔调查足迹与脚步，再用变化后的感官核验规律。',
        ['grey_gull_schedule', 'patrol_tracks', 'patrol_steps', 'patrol_hypothesis', 'patrol_verified', 'tower_cover', 'tower_sound', 'bay_approach', 'water_observation']);
      if (!conditions.signal_ready(state)) return goal('signal', '准备实际可用的求救物',
        hasFact(state, 'signal_method') ? '检查随身的信号物；只有实际携带的物品能够使用。' : '在灯塔附近调查船员能够辨认的信号。',
        ['grey_gull_schedule', 'safe_sea_entry', 'signal_method']);
      if (state.stats.stamina < 5) return goal('recover', '恢复出海所需体力',
        '先确认安全休整地点；每完整休息一小时恢复两点体力。', ['home_shelter', 'market_shelter_permission', 'safe_sea_entry']);
      return goal('sea_ready', '按已核实的航线准备出海',
        '带好求救物，在已确认的海湾核对时间与海况。', ['grey_gull_schedule', 'safe_sea_entry', 'signal_method', 'bay_approach']);
    }
    if (hasFact(state, 'gehrman_whereabouts') && !state.flags.gehrman_intro_done && state.elapsed_minutes < 173) {
      return goal('find_gehrman', '寻找格尔曼·斯帕罗', '按船长提供的行踪寻找他，带上自己核实的记录。',
        ['gehrman_whereabouts', 'captain_requirements', 'church_receipt', 'church_crate_tracks', 'headless_shadow', 'donna_testimony']);
    }
    if (hasFact(state, 'harbor_whistle')) return goal('leave_port', '调查离港的机会',
      hasFact(state, 'captain_schedule') ? '核对船长的准入要求与最后登船时刻。' : '去码头观察船只和人物，弄清准入要求。',
      ['harbor_whistle', 'white_agate_lead', 'captain_refusal', 'sailor_offer', 'captain_requirements', 'captain_schedule']);
    return goal('amnesia', '调查你失忆的原因', '调查住所，寻找白天记忆的缺口；留意门外的声音。',
      ['memory_gap', 'unsent_letter', 'church_receipt', 'bedside_crate', 'last_night_job', 'mechanical_neighbor', 'neighbor_repetition']);
  }

  function timeWarnings(state, minutes) {
    const end = state.elapsed_minutes + minutes;
    return data.known_windows.filter((window) => matches(state, window.requires)).flatMap((window) => [
      ...(window.from !== window.to && state.elapsed_minutes < window.from && end >= window.from ? [{ name: window.name, at: window.from, change: '开始' }] : []),
      ...(state.elapsed_minutes < window.to && end >= window.to ? [{ name: window.name, at: window.to, change: window.from === window.to ? '发生' : '结束' }] : [])
    ]).sort((a, b) => a.at - b.at);
  }

  function seaReadiness(state) {
    const hasSchedule = hasFact(state, 'grey_gull_schedule');
    const knowsSignal = hasFact(state, 'signal_method');
    return [
      { name: '身体与体力', ready: state.flags.is_hunter && state.stats.stamina >= 5 && state.stats.loss_of_control < 100,
        text: state.flags.is_hunter ? `猎人 · 体力 ${state.stats.stamina}/${state.stats.stamina_max} · 失控 ${state.stats.loss_of_control}%` : `普通人 · 体力 ${state.stats.stamina}/${state.stats.stamina_max}，尚无可靠的外海游泳能力` },
      { name: '外海航线', ready: hasSchedule, text: hasSchedule ? clues.grey_gull_schedule.summary : '尚未确认' },
      { name: '下海路线', ready: state.flags.safe_sea_route_known === true,
        text: state.flags.safe_sea_route_known ? clues.safe_sea_entry.summary : '尚未确认' },
      { name: '求救方式', ready: conditions.signal_ready(state), text: knowsSignal ?
        state.inventory.includes('signal_cloth') ? '随身携带信号布' : state.inventory.includes('brass_lantern') && state.lamp_lit ? '随身手提灯已点燃' : '已知求救方法，但当前未携带可用信号物' : '尚未确认' },
      { name: '当前时刻', ready: hasSchedule && state.elapsed_minutes >= data.world_clock.sea_window_from_minute && state.elapsed_minutes <= data.world_clock.sea_window_to_minute,
        text: hasSchedule ? state.elapsed_minutes < data.world_clock.sea_window_from_minute ? '已核实的接近窗口尚未开始' : state.elapsed_minutes > data.world_clock.sea_window_to_minute ? '已核实的接近窗口已经结束' : '仍在已核实的接近窗口内' : '尚未确认船只何时经过' }
    ];
  }

  const text = (state) => {
    const node = nodes[state.node];
    if (state.node === 'home_search') return data.home_regions[state.home_area].text;
    return node.variants?.find((variant) => matches(state, variant.requires))?.text ?? node.text;
  };

  function rememberNarration(state, previous) {
    updateTasks(state);
    state.notifications = [];
    state.movement = null;
    if (previous) {
      for (const id of Object.keys(state.discoveries)) {
        if (!previous.discoveries[id]) state.notifications.push({ kind: 'clue', id, text: `获得线索《${clues[id].name}》` });
      }
      for (const id of state.deductions.filter((id) => !previous.deductions.includes(id))) {
        state.notifications.push({ kind: 'clue', id, text: `线索已组合《${clues[id].name}》；原卡片已归入详情` });
      }
      for (const [key, name, unit, kind] of [['sanity','理智','','sanity'], ['loss_of_control','失控度','%','control'], ['stamina','体力','','stamina'], ['gehrman_trust','格尔曼信任','','trust']]) {
        const delta = state.stats[key] - previous.stats[key];
        if (delta) state.notifications.push({ kind, text: `${name} ${delta > 0 ? '+' : '−'}${Math.abs(delta)}${unit}，当前 ${state.stats[key]}${unit}` });
      }
      const money = state.money - previous.money;
      if (money) state.notifications.push({ kind: 'money', text: `${money > 0 ? '金钱 +' : '支付 −'}${Math.abs(money)}，余额 ${state.money}` });
      for (const [id, task] of Object.entries(state.tasks)) {
        if (!previous.tasks[id]) state.notifications.push({ kind: 'task', text: `新任务《${task.name}》` });
      }
      state.settlement_log.push({ turn: state.turn, minute: state.elapsed_minutes, action: state.action_source, entries: state.notifications,
        dropped: previous.inventory.find((id) => !state.inventory.includes(id) && state.item_locations[id] === place(state)) });
      if (nodes[previous.node].location !== nodes[state.node].location) {
        state.movement = { from: nodes[previous.node].location, to: nodes[state.node].location, minutes: state.elapsed_minutes - previous.elapsed_minutes };
      }
    }
    const pages = [];
    function record(sceneId, lines) {
      const key = sceneId === 'home_search' ? `${sceneId}:${state.home_area}` : sceneId;
      const seen = new Set(state.narrated[key]);
      for (const line of lines) {
        if (seen.has(line)) continue;
        seen.add(line);
        pages.push(line);
      }
      state.narrated[key] = [...seen];
    }

    if (!state.narrated) {
      state.narrated = {};
      if (previous) {
        // Earlier saves only know their current scene and last action.
        record(previous.node, [...text(previous), ...previous.feedback]);
        pages.length = 0;
      }
    }
    if (previous) record(previous.node, state.feedback);
    record(state.node, text(state));
    if (previous) state.settlement_log.at(-1).story = [...pages];
    state.narration = pages;
    return state;
  }

  const clock = (state) => new Date(startTime + state.elapsed_minutes * 60000).toISOString()
    .slice(0, 16).replace('T', ' ');

  return { start, restore, choose, drop, retrieve, moveRoom, moveArea, site, area, areas, mapRoutes, travel, describePlace, focus, timeWarnings, seaReadiness, exploration, combine, quote, trade, acknowledge,
    hasFact, place, actions, text, clock, dialogueMinutes, bagUsed, nodes, items, clues, recipes, homeRegions: data.home_regions };
}
