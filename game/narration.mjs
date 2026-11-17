const PAGE_DURATION = 2000;

export function createNarrator(dialog, portraitFor) {
  const title = dialog.querySelector('h2');
  const portrait = dialog.querySelector('img');
  const passage = dialog.querySelector('.narration-passage');
  const progress = dialog.querySelector('.narration-progress');
  const previous = dialog.querySelector('.narration-previous');
  const pause = dialog.querySelector('.narration-pause');
  const next = dialog.querySelector('.narration-next');
  const skip = dialog.querySelector('.narration-skip');
  let story, index, playing, timer, reveal;

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

  function advance() {
    if (!story) return;
    if (index + 1 === story.pages.length) finish();
    else {
      index += 1;
      renderPage();
    }
  }

  function setTimer() {
    clearTimeout(timer);
    if (playing) timer = setTimeout(advance, PAGE_DURATION);
  }

  function renderPage() {
    const text = story.pages[index];
    const src = portraitFor(text);
    portrait.hidden = !src;
    if (src) portrait.src = src;
    else portrait.removeAttribute('src');
    // Replace only the text span so held keyboard focus stays on the same control.
    const line = document.createElement('span');
    passage.replaceChildren(line);
    passage.ariaLabel = text;
    cancelAnimationFrame(reveal);
    if (story.skipIntro && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const glyphs = Array.from(text);
      const start = performance.now();
      function type(time) {
        const count = Math.min(glyphs.length, 1 + Math.floor((time - start) / 28));
        line.textContent = glyphs.slice(0, count).join('');
        if (count < glyphs.length) reveal = requestAnimationFrame(type);
      }
      reveal = requestAnimationFrame(type);
    } else {
      line.textContent = text;
    }
    dialog.classList.toggle('intro-finale', story.skipIntro && index + 1 === story.pages.length);
    progress.textContent = `${index + 1} / ${story.pages.length}`;
    previous.disabled = index === 0;
    next.textContent = index + 1 === story.pages.length ? story.finishLabel : '下一段';
    setTimer();
  }

  pause.onclick = () => {
    playing = !playing;
    pause.textContent = playing ? '暂停' : '自动播放';
    setTimer();
  };
  previous.onclick = () => {
    if (index > 0) {
      index -= 1;
      renderPage();
    }
  };
  next.onclick = passage.onclick = advance;
  skip.onclick = finish;
  dialog.oncancel = (event) => {
    event.preventDefault();
    dismiss();
  };

  function open({ label, pages, onFinish, skipIntro = false, finishLabel = '继续游戏' }) {
    dismiss();
    if (pages.length === 0) return;
    story = { pages, onFinish, skipIntro, finishLabel };
    index = 0;
    playing = true;
    title.textContent = label;
    dialog.classList.toggle('prologue', skipIntro);
    pause.textContent = playing ? '暂停' : '自动播放';
    skip.hidden = !skipIntro;
    renderPage();
    dialog.showModal();
    next.focus();
  }

  return { open, dismiss, get isOpen() { return dialog.open; } };
}
