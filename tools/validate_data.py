#!/usr/bin/env python3
"""验证《血雾班西》项目数据。纯 Python 标准库；在项目根目录运行。"""
from __future__ import annotations
import json
import sys
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
ERRORS = []
WARNINGS = []
CONDITIONS = {
    'flag_true', 'flag_false', 'clue', 'clue_any', 'item', 'item_any', 'item_missing',
    'item_missing_all', 'stat_gte', 'stat_lt', 'stat_lte', 'minute_lt', 'minute_gt',
    'minute_gte', 'minute_lte', 'pathway', 'inventory_space', 'light_active',
    'exclusive_open', 'event_pending', 'node_in', 'light_alert_lt', 'light_alert_gte',
    'deduction', 'money_gte', 'lamp_lit', 'fire_here', 'item_at', 'boarding_valid', 'signal_ready',
}
EFFECTS = {
    'set_flag', 'add_clue', 'add_item', 'remove_item', 'add_stat', 'set_stat',
    'unlock_achievement', 'unlock_skill', 'end', 'advance_to_minute', 'set_stat_min',
    'light_for_minutes', 'resolve_event',
    'add_money', 'set_lamp', 'record_fire',
}


def load(name):
    path = DATA / name
    try:
        with path.open('r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as exc:
        ERRORS.append(f'{name}: 读取失败 - {exc}')
        return {}


def check_unique(collection, label):
    ids = [item.get('id') for item in collection]
    for id_ in ids:
        if not id_:
            ERRORS.append(f'{label}: 项目缺少 id')
    if len(ids) != len(set(ids)):
        ERRORS.append(f'{label}: 存在重复 id')
    return set(ids)


def inspect_effects(effects, ctx, items, clues, achs, known_endings):
    for e in effects:
        ty = e.get('type')
        if ty not in EFFECTS:
            ERRORS.append(f'{ctx}: 未知效果类型 {ty}')
        if ty in ('add_item', 'remove_item') and e.get('id') not in items:
            ERRORS.append(f'{ctx}: 引用不存在的物品 {e.get("id")}')
        if ty == 'add_clue' and e.get('id') not in clues:
            ERRORS.append(f'{ctx}: 引用不存在的线索 {e.get("id")}')
        if ty == 'unlock_achievement' and e.get('id') not in achs:
            ERRORS.append(f'{ctx}: 引用不存在的成就 {e.get("id")}')
        if ty == 'end' and e.get('id') not in known_endings:
            ERRORS.append(f'{ctx}: 引用不存在的结局 {e.get("id")}')
        if ty == 'advance_to_minute' and e.get('value', 0) < 0:
            ERRORS.append(f'{ctx}: 时间不能为负数')
        if ty == 'light_for_minutes' and not 0 < e.get('value', 0) <= 10:
            ERRORS.append(f'{ctx}: 灯火掩护必须在 1 到 10 分钟之间')


def inspect_conditions(conditions, ctx, items, clues, pathways, stats):
    for cond in conditions:
        ty = cond.get('type')
        if ty not in CONDITIONS:
            ERRORS.append(f'{ctx}: 未知条件类型 {ty}')
        if ty == 'clue' and cond.get('id') not in clues:
            ERRORS.append(f'{ctx}: 未知线索 {cond.get("id")}')
        if ty == 'clue_any' and not set(cond.get('ids', [])).issubset(clues):
            ERRORS.append(f'{ctx}: clue_any 包含未知线索')
        if ty in ('item', 'item_missing', 'item_at') and cond.get('id') not in items:
            ERRORS.append(f'{ctx}: 未知道具 {cond.get("id")}')
        if ty in ('item_any', 'item_missing_all') and not set(cond.get('ids', [])).issubset(items):
            ERRORS.append(f'{ctx}: {ty} 包含未知道具')
        if ty == 'pathway' and cond.get('id') not in pathways:
            ERRORS.append(f'{ctx}: 未知途径 {cond.get("id")}')
        if ty in ('stat_gte', 'stat_lt', 'stat_lte') and cond.get('key') not in stats:
            ERRORS.append(f'{ctx}: 未知属性 {cond.get("key")}')


def main():
    sc = load('scenes.json')
    characters = load('characters.json')
    inv = load('items.json')
    achieves = load('achievements.json')
    art = load('assets.json')
    paths = load('pathways.json')
    nodes = sc.get('nodes', [])
    node_ids = check_unique(nodes, '场景节点')
    item_ids = check_unique(inv.get('items', []), '实体道具')
    clue_ids = check_unique(inv.get('clues', []), '线索')
    recipe_ids = check_unique(inv.get('recipes', []), '推理配方')
    regions = sc.get('home_regions', {})
    if set(regions) != {'bedroom', 'living', 'kitchen', 'hall'}:
        ERRORS.append('住宅必须定义卧室、客厅、厨房和门厅')
    facts = clue_ids - recipe_ids
    for recipe in inv.get('recipes', []):
        if recipe['id'] not in clue_ids or not recipe.get('facts') or not set(recipe['facts']).issubset(facts):
            ERRORS.append(f'{recipe["id"]}: 配方必须有有效的原始事实与结果卡')
        if not set(recipe.get('after', [])).issubset(recipe_ids - {recipe['id']}):
            ERRORS.append(f'{recipe["id"]}: 配方依赖无效')
    resolved_recipes = set()
    for _ in recipe_ids:
        resolved_recipes.update(r['id'] for r in inv.get('recipes', []) if set(r.get('after', [])).issubset(resolved_recipes))
    if resolved_recipes != recipe_ids:
        ERRORS.append('配方依赖形成循环')
    for item in inv.get('items', []):
        if not isinstance(item.get('initial_location'), str) or type(item.get('occupies_slots')) is not int or not 1 <= item['occupies_slots'] <= 2:
            ERRORS.append(f'{item["id"]}: 物品需要明确位置和一至两格的体积')
        if type(item.get('sale_price')) is not int or item['sale_price'] < 0:
            ERRORS.append(f'{item["id"]}: 收购价必须是非负整数')
    for clue in inv.get('clues', []):
        if not clue.get('text') or not clue.get('kind') or type(clue.get('sale_price')) is not int or clue['sale_price'] < 0:
            ERRORS.append(f'{clue["id"]}: 线索需要正文、类型与非负收购价')
    ach_ids = check_unique(achieves.get('achievements', []), '成就')
    asset_ids = check_unique(art.get('assets', []), '图片资源')
    backgrounds = {asset['id'] for asset in art.get('assets', []) if asset.get('image_type') == 'background'}
    speakers = set()
    for asset in art.get('assets', []):
        if asset.get('image_type') != 'portrait':
            continue
        aliases = asset.get('speakers', [])
        if not aliases or any(not isinstance(name, str) or not name for name in aliases):
            ERRORS.append(f'{asset["id"]}: 立绘需要有效的对白称呼列表')
        elif speakers.intersection(aliases):
            ERRORS.append(f'{asset["id"]}: 同一对白称呼对应多个立绘')
        speakers.update(aliases)
    check_unique(characters.get('characters', []), '角色')
    path_ids = check_unique(paths.get('pathways', []), '非凡途径')
    if len(path_ids) != 22:
        ERRORS.append(f'世界观要求22条途径，当前{len(path_ids)}条')
    endings = set(sc.get('endings', {}).keys())
    if sc.get('start_node') not in node_ids:
        ERRORS.append('开场节点不存在')
    stats = sc.get('initial_state', {}).get('stats', {})
    dialogue_windows = sc.get('dialogue_windows', {})
    scheduled = sc.get('scheduled_events', [])
    scheduled_ids = check_unique(scheduled, '定时事件')
    all_choices = [choice for node in nodes for choice in node.get('choices', [])]
    all_effects = [
        effect for source in [*nodes, *all_choices, *scheduled]
        for effect in source.get('effects', []) + source.get('on_enter', [])
    ]
    groups = {choice['exclusive_group'] for choice in all_choices if 'exclusive_group' in choice}
    outcomes = {effect.get('id') for effect in all_effects if effect.get('type') == 'resolve_event'}
    areas = {effect.get('id') for effect in all_effects if effect.get('type') == 'light_for_minutes'}
    flags = set(sc.get('initial_state', {}).get('flags', {})) | {
        effect.get('key') for effect in all_effects if effect.get('type') == 'set_flag'
    }
    for id_, window in dialogue_windows.items():
        close = sc.get('world_clock', {}).get(window.get('closes_at'))
        if type(close) is not int or close <= 0:
            ERRORS.append(f'{id_}: 谈话时限必须引用有效的游戏钟')

    def check_conditions(conditions, context):
        inspect_conditions(conditions, context, item_ids, clue_ids, path_ids, stats)
        for condition in conditions:
            kind = condition.get('type')
            if kind == 'exclusive_open' and condition.get('id') not in groups:
                ERRORS.append(f'{context}: 不存在的互斥组')
            if kind == 'event_pending' and condition.get('id') not in (scheduled_ids | outcomes):
                ERRORS.append(f'{context}: 不存在的事件')
            if kind == 'node_in' and (not condition.get('ids') or not set(condition['ids']).issubset(node_ids)):
                ERRORS.append(f'{context}: node_in 必须引用已有场景')
            if kind in ('light_alert_lt', 'light_alert_gte') and condition.get('id') not in areas:
                ERRORS.append(f'{context}: 不存在的灯笼警觉区域')
            if kind == 'deduction' and condition.get('id') not in recipe_ids:
                ERRORS.append(f'{context}: 不存在的推理配方')
            if kind == 'clue' and condition.get('id') in recipe_ids:
                ERRORS.append(f'{context}: 推理结果请使用deduction条件，clue检查原始事实')
            if kind == 'clue_any' and set(condition.get('ids', [])).intersection(recipe_ids):
                ERRORS.append(f'{context}: clue_any只能包含原始事实')
            if kind == 'money_gte' and (type(condition.get('value')) is not int or condition['value'] < 0):
                ERRORS.append(f'{context}: 金钱条件必须为非负整数')

    def check_effects(effects, context):
        inspect_effects(effects, context, item_ids, clue_ids, ach_ids, endings)
        for effect in effects:
            check_conditions(effect.get('when', []), context)
            if effect.get('type') == 'resolve_event':
                if not effect.get('id') or effect.get('value') not in ('completed', 'missed', 'resolved_elsewhere'):
                    ERRORS.append(f'{context}: 事件需要稳定 ID 与有效结算状态')
                if effect.get('id') in scheduled_ids:
                    ERRORS.append(f'{context}: 事件结算不能使用调度器的触发 ID')
            if effect.get('type') == 'light_for_minutes' and not effect.get('id'):
                ERRORS.append(f'{context}: 缺少灯笼警觉区域 ID')
            if effect.get('type') == 'add_clue' and effect.get('id') in recipe_ids:
                ERRORS.append(f'{context}: 结果卡应由组合生成')

    edges = {node['id']:set() for node in nodes if 'id' in node}
    for n in nodes:
        nid = n.get('id')
        if n.get('background') not in backgrounds:
            ERRORS.append(f'{nid}: 未知背景资源 {n.get("background")}')
        if 'dialogue_window' in n and n['dialogue_window'] not in dialogue_windows:
            ERRORS.append(f'{nid}: 引用了不存在的谈话时限')
        choices = n.get('choices', [])
        choice_ids = check_unique(choices, f'{nid} 的选项')
        if n.get('kind') != 'ending' and not choices:
            ERRORS.append(f'{nid}: 剧情节点缺少出口')
        for i, ch in enumerate(choices):
            target = ch.get('next')
            if target not in node_ids:
                ERRORS.append(f'{nid} / 选项{i}: next={target} 不存在')
            else:
                edges[nid].add(target)
            context = f'{nid} / 选项{i}'
            if 'region' in ch and ch['region'] not in regions:
                ERRORS.append(f'{context}: 未知房内区域')
            minutes = ch.get('minutes')
            opens = ch.get('available_from', 0)
            closes = ch.get('available_until', sc['world_clock']['doom_minute'])
            if type(minutes) is not int or minutes < 0:
                ERRORS.append(f'{context}: minutes应为非负整数')
            elif type(opens) is not int or type(closes) is not int or opens < 0 or opens + minutes > closes:
                ERRORS.append(f'{context}: 起止时间必须允许行动在窗口内完成')
            if 'max_uses' in ch and (type(ch['max_uses']) is not int or ch['max_uses'] < 1):
                ERRORS.append(f'{context}: max_uses 必须为正整数')
            if 'permanent_lock' in ch and ch['permanent_lock'] not in flags:
                ERRORS.append(f'{context}: 永久锁未定义')
            if 'exclusive_group' in ch and (not isinstance(ch['exclusive_group'], str) or not ch['exclusive_group']):
                ERRORS.append(f'{context}: exclusive_group 应为非空字符串')
            if ch.get('finish_before_events') and 'available_until' not in ch:
                ERRORS.append(f'{context}: 优先结算的行动需要明确截止时间')
            if ch.get('alternative_to') and (ch['alternative_to'] not in choice_ids or ch['alternative_to'] == ch.get('id')):
                ERRORS.append(f'{nid} / 选项{i}: alternative_to 应指向同场景的另一选项')
            conditions = ch.get('requires', []) + ch.get('visible_when', [])
            check_conditions(conditions, context)
            check_effects(ch.get('effects', []), context)
            for effect in ch.get('effects', []):
                if effect.get('type') == 'add_stat' and effect.get('value', 0) > 0 and effect.get('key') in {
                    'gehrman_trust', 'marena_favor', 'donna_favor'
                } and not (ch.get('once') or ch.get('max_uses') == 1 or ch.get('exclusive_group')):
                    ERRORS.append(f'{context}: 信任和好感收益必须为一次性')
        check_effects(n.get('on_enter', []), f'{nid} / on_enter')
        for redirect in n.get('redirects', []):
            target = redirect.get('next')
            if target not in node_ids:
                ERRORS.append(f'{nid}: 跳转目标 {target} 不存在')
            else:
                edges[nid].add(target)
        for branch in n.get('redirects', []) + n.get('variants', []):
            check_conditions(branch.get('requires', []), nid)
    for s in scheduled:
        context = f'定时事件 {s.get("id")}'
        minute = s.get('at_minute')
        if type(minute) is not int or not 0 < minute <= sc['world_clock']['doom_minute']:
            ERRORS.append(f'{context}: 需要有效的触发分钟')
        check_effects(s.get('effects', []), context)
        check_conditions(s.get('interrupt_when', []), context)
        check_conditions(s.get('notice', {}).get('requires', []), context)
        target = s.get('go_to')
        if target and target not in node_ids:
            ERRORS.append(f'定时事件引用不存在的节点 {target}')
        if target:edges.setdefault(sc.get('start_node'),set()).add(target)
    for rule in sc.get('global_failure_rules', []):
        check_conditions([rule['if']], '全局失败规则')
        target = rule.get('go_to')
        if target not in node_ids:
            ERRORS.append(f'全局失败规则引用不存在的节点 {target}')
        else:edges.setdefault(sc.get('start_node'),set()).add(target)
    seen=set()
    q=deque([sc.get('start_node')])
    while q:
        cur=q.popleft()
        if cur in seen or cur not in node_ids:continue
        seen.add(cur)
        q.extend(edges.get(cur,[]))
    unreachable = sorted(node_ids-seen)
    if unreachable:
        WARNINGS.append(f'以下场景在忽略条件的图上不可达：{", ".join(unreachable)}')
    for entry in art.get('assets', []):
        target=ROOT / entry['path']
        status=entry.get('status')
        if status=='ready' and not target.is_file():
            ERRORS.append(f'资源标为ready但文件不存在：{entry["path"]}')
        if status=='missing' and target.is_file():
            WARNINGS.append(f'资源已存在但仍标为missing：{entry["path"]}')
    print(f'场景节点: {len(nodes)}; 人物: {len(characters.get("characters",[]))}; 道具: {len(item_ids)}; 线索: {len(clue_ids)}; 成就: {len(ach_ids)}; 美术需求: {len(asset_ids)}; 途径: {len(path_ids)}')
    for w in WARNINGS:
        print('警告:', w)
    for e in ERRORS:
        print('错误:', e)
    if ERRORS:
        print(f'校验失败：{len(ERRORS)} 个错误。')
        return 1
    print('校验通过：JSON结构、主要引用和场景图一致。')
    missing = sum(1 for entry in art.get('assets', []) if entry.get('status') == 'missing')
    if missing:
        print(f'待补美术资源：{missing}项。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
