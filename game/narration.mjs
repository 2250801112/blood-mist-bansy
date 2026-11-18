const PAGE_DURATION = 5000;

function paginate(lines) {
  return lines.flatMap((line) => {
    const sentences = line.match(/[^。！？!?；;]+[。！？!?；;]?[”’」』]?/gu) ?? [line];
    const pages = [];
    let page = '';
    for (const sentence of sentences) {
      if (page && Array.from(page + sentence).length > 90) { pages.push(page); page = ''; }
      const glyphs = Array.from(sentence);
      while (glyphs.length > 90) {
        if (page) { pages.push(page); page = ''; }
        pages.push(glyphs.splice(0, 90).join(''));
      }
      page += glyphs.join('');
    }
    if (page) pages.push(page);
    return pages.map((text) => ({ text, original: line }));
  });
}

export function createNarrator(dialog, portraitFor) {
  const title = dialog.querySelector('h2');
  const portrait = dialog.querySelector('img');
  const passage = dialog.querySelector('.narration-passage');
  const progress = dialog.querySelector('.narration-progress');
  const previous = dialog.querySelector('.narration-previous');
  const pause = dialog.querySelector('.narration-pause');
  const skip = dialog.querySelector('.narration-skip');
  const hint = dialog.querySelector('.narration-hint');
  let story, index, playing = true, timer, reveal, fullText, line, complete = false, pointer;

  function dismiss() {
    clearTimeout(timer);
    cancelAnimationFrame(reveal);
    story = null;
    if (dialog.open) dialog.close();
  }

  function finish() {
    const onFinish = story.onFinish;
    dismiss();
    onFinish?.();
  }

  function setTimer() {
    clearTimeout(timer);
    if (story && complete && playing && !document.hidden && !dialog.querySelector('details').open) {
      timer = setTimeout(advance, PAGE_DURATION);
    }
  }

  function revealAll() {
    cancelAnimationFrame(reveal);
    line.textContent = fullText;
    complete = true;
    setTimer();
  }

  function advance() {
    if (!story) return;
    if (!complete) { revealAll(); return; }
    if (index + 1 === story.pages.length) finish();
    else { index += 1; renderPage(); }
  }

  function renderPage() {
    clearTimeout(timer);
    cancelAnimationFrame(reveal);
    const page = story.pages[index];
    fullText = page.text;
    const src = portraitFor(page.original);
    portrait.hidden = !src;
    if (src) portrait.src = src;
    else portrait.removeAttribute('src');
    line = document.createElement('span');
    passage.replaceChildren(line);
    passage.ariaLabel = fullText;
    complete = false;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const glyphs = Array.from(fullText);
      const start = performance.now();
      function type(time) {
        if (!story) return;
        const count = Math.min(glyphs.length, 1 + Math.floor((time - start) / 24));
        line.textContent = glyphs.slice(0, count).join('');
        if (count < glyphs.length) reveal = requestAnimationFrame(type);
        else { complete = true; setTimer(); }
      }
      reveal = requestAnimationFrame(type);
    } else revealAll();
    dialog.classList.toggle('intro-finale', story.skipIntro && index + 1 === story.pages.length);
    progress.textContent = `${index + 1} / ${story.pages.length}`;
    previous.disabled = index === 0;
  }

  pause.onclick = () => {
    playing = !playing;
    pause.textContent = playing ? '暂停自动播放' : '开启自动播放';
    setTimer();
  };
  previous.onclick = () => {
    if (index > 0) { index -= 1; renderPage(); }
  };
  dialog.querySelector('details').addEventListener('toggle', setTimer);
  dialog.addEventListener('pointerdown', (event) => { pointer = [event.clientX, event.clientY]; });
  dialog.addEventListener('click', (event) => {
    if (event.target.closest('details, .narration-skip')) return;
    if (event.detail && pointer && Math.hypot(event.clientX - pointer[0], event.clientY - pointer[1]) > 8) return;
    advance();
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.target.closest('details, .narration-skip')) return;
    if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); advance(); }
  });
  document.addEventListener('visibilitychange', setTimer);
  skip.onclick = finish;
  dialog.oncancel = (event) => {
    event.preventDefault();
    const settings = dialog.querySelector('details');
    settings.open = !settings.open;
  };

  function open({ label, pages, onFinish, skipIntro = false }) {
    dismiss();
    if (pages.length === 0) { onFinish?.(); return; }
    story = { pages: paginate(pages), onFinish, skipIntro };
    index = 0;
    title.textContent = label;
    dialog.classList.toggle('prologue', skipIntro);
    pause.textContent = playing ? '暂停自动播放' : '开启自动播放';
    skip.hidden = !skipIntro;
    hint.hidden = sessionStorage.getItem('bansy-reading-hint') === 'seen';
    sessionStorage.setItem('bansy-reading-hint', 'seen');
    renderPage();
    dialog.showModal();
    passage.focus();
  }

  return { open, dismiss, get isOpen() { return dialog.open; } };
}
