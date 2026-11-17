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
  const events = [...data.scheduled_events].sort((a, b) => a.at_minute - b.at_minute);
  const startTime = Date.parse(data.world_clock.start_local.replace(' ', 'T') + ':00Z');
  const bagUsed = (state) => state.inventory.reduce((slots, id) => slots + items[id].occupies_slots, 0);

  function dialogueMinutes(state, id = nodes[state.node].dialogue_window) {
    if (!id) return null;
    const window = data.dialogue_windows[id];
    return Math.max(0, data.world_clock[window.closes_at] - state.elapsed_minutes);
  }

  const conditions = {
    flag_true: (state, rule) => state.flags[rule.key] === true,
    flag_false: (state, rule) => state.flags[rule.key] !== true,
    clue: (state, rule) => state.clues.includes(rule.id),
    clue_any: (state, rule) => rule.ids.some((id) => state.clues.includes(id)),
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
    light_active: (state, rule) => state.elapsed_minutes + rule.value <= state.light_safety_until,
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
    add_clue: (state, effect) => addUnique(state.clues, effect.id),
    add_item: (state, effect) => {
      if (state.inventory.includes(effect.id)) return;
      if (bagUsed(state) + items[effect.id].occupies_slots > state.inventory_limit) {
        throw new Error(`背包无法放入 ${effect.id}`);
      }
      state.inventory.push(effect.id);
    },
    remove_item: (state, effect) => { state.inventory = state.inventory.filter((id) => id !== effect.id); },
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
    if (state.node !== destination) apply(state, nodes[destination].on_enter);
    state.node = destination;
  }

  function start(identity) {
    const state = {
      ...structuredClone(data.initial_state),
      identity, id: crypto.randomUUID(), node: null, turn: 0,
      action_use_counts: {}, chosen_exclusive_options: {}, resolved_events: {},
      light_alert_by_area: {}, achievements: [], feedback: [],
      light_safety_until: -1
    };
    enter(state, data.start_node);
    return rememberNarration(state);
  }

  function finishTime(state, choice) {
    return Math.max(state.elapsed_minutes + choice.minutes,
      ...(choice.effects ?? []).filter((effect) => effect.type === 'advance_to_minute').map((effect) => effect.value));
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
      if (alert.level === 1 && state.elapsed_minutes >= alert.expires_at) alert.level = 2;
    }
  }

  function dispatch(state, event, historical = false) {
    if (state.resolved_events[event.id]) return null;
    state.resolved_events[event.id] = 'occurred';
    apply(state, event.effects);
    if (historical || state.ending) return null;
    if (event.notice && matches(state, event.notice.requires)) state.feedback.push(...event.notice.text);
    return event.go_to && matches(state, event.interrupt_when) ? event.go_to : null;
  }

  function choose(state, id) {
    const choice = actions(state).find((action) => action.id === id);
    if (!choice?.available) return null;
    const next = structuredClone(state);
    next.turn += 1;
    next.feedback = [];
    const changes = choice.effects ?? [];
    const travelEnd = state.elapsed_minutes + choice.duration;
    // A boarding operation completed on the departure minute gets its berth first.
    for (const event of events) {
      if (event.at_minute > travelEnd || state.elapsed_minutes >= event.at_minute) continue;
      if (choice.finish_before_events && event.at_minute === travelEnd) continue;
      next.elapsed_minutes = event.at_minute;
      updateLight(next);
      const interruption = dispatch(next, event);
      if (interruption) {
        enter(next, interruption);
        return rememberNarration(next, state);
      }
    }
    next.elapsed_minutes = travelEnd;
    updateLight(next);
    const ref = `${state.node}:${id}`;
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
    return rememberNarration(next, state);
  }

  function restore(state) {
    if (state.ending || state.action_use_counts) return state;
    // Upgrade runs from before the world timetable without resetting earned rewards.
    const next = structuredClone(state);
    next.action_use_counts = {};
    next.chosen_exclusive_options = {};
    next.resolved_events = {};
    next.light_alert_by_area = {};
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
      updateLight(next);
    }
    for (const event of events) {
      if (event.at_minute <= next.elapsed_minutes) dispatch(next, event, true);
    }
    enter(next, next.node === 'dock_board' ? 'dock' : next.node);
    return next;
  }

  function drop(state, item) {
    if (state.ending || !nodes[state.node].safe_inventory || !state.inventory.includes(item)) return null;
    const next = structuredClone(state);
    next.turn += 1;
    effects.remove_item(next, { id: item });
    next.feedback = [`你放下了「${items[item].name}」。`];
    return rememberNarration(next, state);
  }

  const text = (state) => {
    const node = nodes[state.node];
    return node.variants?.find((variant) => matches(state, variant.requires))?.text ?? node.text;
  };

  function rememberNarration(state, previous) {
    const pages = [];
    function record(sceneId, lines) {
      const seen = new Set(state.narrated[sceneId]);
      for (const line of lines) {
        if (seen.has(line)) continue;
        seen.add(line);
        pages.push(line);
      }
      state.narrated[sceneId] = [...seen];
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
    state.narration = pages;
    return state;
  }

  const clock = (state) => new Date(startTime + state.elapsed_minutes * 60000).toISOString()
    .slice(0, 16).replace('T', ' ');

  return { start, restore, choose, drop, actions, text, clock, dialogueMinutes, bagUsed, nodes, items, clues };
}
