const ns = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, text) {
  const element = document.createElementNS(ns, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  if (text) element.textContent = text;
  return element;
}
function canvas(label, className) {
  const box = document.createElement('div');
  box.className = className;
  box.setAttribute('aria-label', label);
  const drawing = svg('svg', { viewBox: '0 0 100 100', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  box.append(drawing);
  return { box, drawing };
}
function pin(box, id, name, x, y, current, select, prefix) {
  const control = document.createElement('button');
  control.type = 'button';
  control.className = `${prefix}-pin ${prefix}-${id}`;
  control.style.left = `${Math.max(14, Math.min(86, x))}%`;
  control.style.top = `${y}%`;
  control.setAttribute('aria-current', current ? 'location' : 'false');
  control.setAttribute('aria-label', `${name}${current ? '，当前位置' : ''}`);
  control.textContent = name;
  control.onclick = () => {
    for (const other of box.querySelectorAll('button')) other.setAttribute('aria-pressed', String(other === control));
    select(id);
  };
  box.append(control);
}
export function portMap(exploration, current, routes, select) {
  const { box, drawing } = canvas('班西港地理示意图，游戏改编布局', 'port-map');
  drawing.append(svg('path', { d: 'M0 0H100V100H0Z', fill: '#122c36' }),
    svg('path', { d: 'M0 0H78L84 19 76 31 86 42 69 59 73 73 58 79 48 100H0Z', fill: '#35332f', stroke: '#9a9571', 'stroke-width': '.7' }),
    svg('path', { d: 'M65 60L86 68M62 65L83 76M76 31L92 33', stroke: '#997e5e', 'stroke-width': '2', fill: 'none' }));
  const known = new Set([current, ...routes.map((route) => route.id)]);
  for (const route of exploration.routes) {
    if (!known.has(route.from) || !known.has(route.to)) continue;
    const from = exploration.sites[route.from], to = exploration.sites[route.to];
    drawing.append(svg('path', { d: `M${from.x} ${from.y}L${to.x} ${to.y}`, stroke: '#b79d72', 'stroke-width': '.55', 'stroke-dasharray': '1.2 1', fill: 'none' }));
  }
  for (const [id, site] of Object.entries(exploration.sites)) {
    if (!known.has(id)) continue;
    drawing.append(svg('path', { d: `M${site.x-2} ${site.y-2}v-3l2-2 2 2v3Z`, fill: '#ccb98c', stroke: '#302920', 'stroke-width': '.4' }));
    pin(box, id, site.name, site.x, site.y, id === current, select, 'site');
  }
  const caption = document.createElement('small');
  caption.className = 'map-caption'; caption.textContent = '班西港 · 游戏改编地理示意图'; box.append(caption);
  return box;
}
export function areaMap(areas, current, select, site) {
  const { box, drawing } = canvas('当前地点区域示意图', 'local-map');
  const layouts = {
    dock: ['M0 0H100V52L0 70Z', 'M42 35V87H58V35M60 55L92 70M60 65L92 80'],
    tavern: ['M7 8H93V90H7ZM7 48H93M34 8V48M66 8V48M36 48V90M67 48V90', 'M38 18H59V35H38ZM73 15H88V39H73ZM12 60H28V80H12Z'],
    market: ['M5 10H92V86H5ZM38 10V86', 'M12 18H27V78H12ZM47 20H62V38H47ZM69 46H87V70H69Z'],
    telegraph: ['M8 9H91V87H8ZM8 47H91M45 9V47M62 47V87', 'M20 22H34V34H20ZM72 55V80M79 55V80M84 55V80'],
    harbor: ['M8 10H92V88H8ZM8 46H92M43 46V88', 'M16 18H35V32H16ZM55 55H83V75H55Z'],
    church: ['M26 6H73V45H87V81H12V45H26Z', 'M49 9V28M42 17H56M12 86H90M79 30L94 55'],
    lighthouse: ['M0 0H65L81 28 69 53 91 77 75 100H0Z', 'M20 7H42V40H20ZM23 10L31 2 39 10M18 50L45 62 69 80'],
    street: ['M0 38H100V62H0Z', 'M19 0V38M48 62V100M80 0V38'],
    sea: ['M0 0H30L20 30 34 60 16 100H0Z', 'M45 23Q60 17 78 23M49 54Q63 48 83 54M43 81Q62 75 91 81']
  };
  const paths = layouts[site];
  drawing.append(svg('path', { d: paths[0], stroke: '#8f8065', 'stroke-width': '.65', fill: '#34363a' }),
    svg('path', { d: paths[1], stroke: '#ac9874', 'stroke-width': '.9', fill: 'none' }));
  for (const area of areas) {
    drawing.append(svg('circle', { cx: area.x, cy: area.y, r: '10', fill: area.id === current ? '#84704e' : '#413d35', stroke: '#b09a76', 'stroke-width': '.5' }));
    pin(box, area.id, area.name, area.x, area.y, area.id === current, select, 'area');
    if (area.id === current) box.querySelector(`.area-${area.id}`).disabled = true;
  }
  return box;
}
