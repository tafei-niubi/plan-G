(function() {
  const html = `
    <div class="scroll-widget">
      <button class="sw-up" title="上翻">
        <svg viewBox="0 0 12 12" width="12" height="12"><path d="M2 8 L6 4 L10 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="sw-track"><div class="sw-thumb"></div></div>
      <button class="sw-down" title="下翻">
        <svg viewBox="0 0 12 12" width="12" height="12"><path d="M2 4 L6 8 L10 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
  `;

  function createWidget(scrollEl) {
    if (!scrollEl) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    const widget = wrap.firstElementChild;
    document.body.appendChild(widget);

    const up = widget.querySelector('.sw-up');
    const down = widget.querySelector('.sw-down');
    const track = widget.querySelector('.sw-track');
    const thumb = widget.querySelector('.sw-thumb');

    let thumbH = 20;

    function updateThumb() {
      const total = scrollEl.scrollHeight;
      const view = scrollEl.clientHeight;
      const ratio = total > 0 ? view / total : 1;
      const trackH = track.clientHeight;
      thumbH = Math.max(20, trackH * ratio);
      thumb.style.height = thumbH + 'px';
      const maxScroll = Math.max(1, total - view);
      const pos = scrollEl.scrollTop / maxScroll;
      thumb.style.top = (pos * (trackH - thumbH)) + 'px';
    }

    // 监听滚动
    scrollEl.addEventListener('scroll', updateThumb);
    window.addEventListener('resize', updateThumb);
    setTimeout(updateThumb, 100);
    setTimeout(updateThumb, 500);

    // ===== 拖动滑块 =====
    let dragging = false;
    let dragStartY = 0;
    let dragStartScrollTop = 0;

    function onThumbDown(e) {
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      dragStartY = e.clientY;
      dragStartScrollTop = scrollEl.scrollTop;
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onThumbMove);
      document.addEventListener('mouseup', onThumbUp);
    }

    function onThumbMove(e) {
      if (!dragging) return;
      const dy = e.clientY - dragStartY;
      const trackH = track.clientHeight;
      const maxThumbTravel = trackH - thumbH;
      if (maxThumbTravel <= 0) return;
      const scrollRange = scrollEl.scrollHeight - scrollEl.clientHeight;
      const scrollDelta = (dy / maxThumbTravel) * scrollRange;
      scrollEl.scrollTop = dragStartScrollTop + scrollDelta;
    }

    function onThumbUp() {
      dragging = false;
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onThumbMove);
      document.removeEventListener('mouseup', onThumbUp);
    }

    thumb.addEventListener('mousedown', onThumbDown);

    // ===== 点击轨道空白 → 跳转到那个位置 =====
    track.addEventListener('mousedown', (e) => {
      if (e.target === thumb) return;   // 点滑块本身走拖动逻辑
      e.preventDefault();
      const trackRect = track.getBoundingClientRect();
      const clickY = e.clientY - trackRect.top;
      // 让滑块中心对齐点击处
      const targetThumbTop = clickY - thumbH / 2;
      const maxThumbTravel = trackRect.height - thumbH;
      const ratio = Math.max(0, Math.min(1, targetThumbTop / maxThumbTravel));
      const scrollRange = scrollEl.scrollHeight - scrollEl.clientHeight;
      scrollEl.scrollTop = ratio * scrollRange;
    });

    // ===== 点/长按上下三角 =====
    let holdTimer = null;
    function startHold(fn) {
      fn();
      holdTimer = setInterval(fn, 80);
    }
    function stopHold() {
      if (holdTimer) { clearInterval(holdTimer); holdTimer = null; }
    }

    up.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startHold(() => scrollEl.scrollBy({ top: -scrollEl.clientHeight * 0.6, behavior: 'smooth' }));
    });
    up.addEventListener('mouseup', stopHold);
    up.addEventListener('mouseleave', stopHold);

    down.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startHold(() => scrollEl.scrollBy({ top: scrollEl.clientHeight * 0.6, behavior: 'smooth' }));
    });
    down.addEventListener('mouseup', stopHold);
    down.addEventListener('mouseleave', stopHold);

    widget.addEventListener('mouseleave', stopHold);
  }

  window.ScrollWidget = { attach: createWidget };
})();
