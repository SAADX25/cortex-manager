'use strict';
(() => {
  let previous = new Map(),
    activeRoot = null,
    cleanup = () => {};
  const glyph = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const bucket = (c) => (c.type === 4 ? 'category' : [2, 13].includes(c.type) ? 'voice' : 'text');
  function capture() {
    previous = new Map();
    if (activeRoot?.isConnected) {
      const box = activeRoot.getBoundingClientRect();
      for (const node of activeRoot.querySelectorAll('[data-drop-id]')) {
        node.getAnimations().forEach((animation) => animation.cancel());
        previous.set(node.dataset.dropId, {
          top: node.getBoundingClientRect().top - box.top + activeRoot.scrollTop,
        });
      }
    }
    cleanup();
  }
  function mount(root, o) {
    cleanup();
    activeRoot = root;
    if (!root) return;
    const items = o.kind === 'role' ? o.inventory.roles : o.inventory.channels,
      find = (id) => items.find((item) => item.id === id),
      allowed = (item) =>
        item &&
        !item.readOnlyReason &&
        !item.moveReadOnlyReason &&
        !o.busy &&
        !o.query &&
        o.inventory.permissions.some(
          (p) => p.name === (o.kind === 'role' ? 'ManageRoles' : 'ManageChannels') && p.granted,
        );
    let source = null,
      marked = null,
      placement = null,
      frame = 0,
      pointerX = 0,
      pointerY = 0,
      hoverTimer = null,
      ghost = null,
      suppressClickUntil = 0,
      pointerGrab = null,
      lastFrame = 0;
    const clearMark = () => {
      marked?.classList.remove('drop-before', 'drop-after', 'drop-inside', 'drop-denied');
      marked = null;
      placement = null;
    };
    const stop = () => {
      if (pointerGrab) {
        const { grip, id } = pointerGrab;
        grip.onpointermove = null;
        grip.onpointerup = null;
        grip.onpointercancel = null;
        if (grip.hasPointerCapture(id)) grip.releasePointerCapture(id);
        pointerGrab = null;
      }
      lastFrame = 0;
      source?.node.classList.remove('is-dragging');
      source = null;
      clearMark();
      cancelAnimationFrame(frame);
      frame = 0;
      clearTimeout(hoverTimer);
      ghost?.remove();
      ghost = null;
      root.classList.remove('arrange-active');
    };
    cleanup = () => {
      stop();
      root.removeEventListener('click', suppressClick, true);
      document.removeEventListener('keydown', cancelOnEscape);
    };
    const scroll = (timestamp) => {
      if (!source) {
        frame = 0;
        return;
      }
      const elapsed = lastFrame ? Math.min(32, timestamp - lastFrame) : 16.67;
      lastFrame = timestamp;
      const box = root.getBoundingClientRect(),
        direction = pointerY < box.top + 38 ? -1 : pointerY > box.bottom - 38 ? 1 : 0;
      if (direction && pointerX >= box.left && pointerX <= box.right) {
        root.scrollTop += (direction * 720 * elapsed) / 1000;
        highlight(pointerX, pointerY);
      }
      frame = requestAnimationFrame(scroll);
    };
    function cancelOnEscape(event) {
      if (event.key === 'Escape' && source) {
        event.preventDefault();
        event.stopPropagation();
        suppressClickUntil = Date.now() + 350;
        stop();
      }
    }
    const canDrop = (from, to, where) => {
      if (!allowed(from) || !allowed(to) || from.id === to.id) return false;
      if (o.kind === 'role') {
        const a = items.findIndex((x) => x.id === from.id),
          b = items.findIndex((x) => x.id === to.id);
        return (
          where !== 'inside' &&
          !items.slice(Math.min(a, b), Math.max(a, b) + 1).some((x) => x.readOnlyReason)
        );
      }
      if (where === 'inside') return from.type !== 4 && to.type === 4;
      return bucket(from) === bucket(to);
    };
    const highlight = (x, y) => {
      pointerX = x;
      pointerY = y;
      const node = document.elementFromPoint(x, y)?.closest('[data-drop-id]');
      if (!node || !root.contains(node)) {
        clearMark();
        return false;
      }
      const target = find(node.dataset.dropId),
        box = node.getBoundingClientRect(),
        where =
          o.kind === 'channel' && source.item.type !== 4 && target.type === 4
            ? 'inside'
            : y < box.top + box.height / 2
              ? 'before'
              : 'after';
      const permitted = canDrop(source.item, target, where);
      if (marked !== node) {
        clearTimeout(hoverTimer);
        hoverTimer = null;
      }
      clearMark();
      marked = node;
      placement = where;
      node.classList.add(permitted ? 'drop-' + where : 'drop-denied');
      pointerY = y;
      if (!frame) frame = requestAnimationFrame(scroll);
      if (where === 'inside' && permitted && !node.parentElement.open && !hoverTimer)
        hoverTimer = setTimeout(() => {
          node.parentElement.open = true;
          hoverTimer = null;
        }, 500);
      return permitted;
    };
    const finish = () => {
      if (!source) return;
      const from = source.item,
        to = find(marked?.dataset.dropId),
        where = placement,
        valid = canDrop(from, to, where);
      suppressClickUntil = Date.now() + 350;
      stop();
      if (valid) o.onMove(from, to, where);
    };
    const decorate = (node, item, category = false) => {
      node.dataset.dropId = item.id;
      node.classList.add('arrange-row');
      if (item.moveReadOnlyReason && !item.readOnlyReason) {
        const lock = document.createElement('span');
        lock.className = 'arrange-grip';
        lock.title = 'القسم محمي؛ النقل معطّل';
        lock.innerHTML = glyph('lock');
        node.append(lock);
      }
      if (
        item.readOnlyReason ||
        item.moveReadOnlyReason ||
        !o.inventory.permissions.some(
          (p) => p.name === (o.kind === 'role' ? 'ManageRoles' : 'ManageChannels') && p.granted,
        )
      )
        return;
      node.draggable = allowed(item);
      node.dataset.dragId = item.id;
      const grip = document.createElement('button');
      grip.type = 'button';
      grip.className = 'arrange-grip';
      grip.setAttribute('aria-label', 'نقل العنصر');
      grip.title = 'نقل العنصر';
      grip.disabled = !allowed(item);
      grip.innerHTML = glyph('grip');
      node.prepend(grip);
      grip.onpointerdown = (e) => {
        if (e.button !== 0 || !allowed(item)) return;
        e.preventDefault();
        e.stopPropagation();
        const x = e.clientX,
          y = e.clientY;
        let started = false;
        grip.setPointerCapture(e.pointerId);
        pointerGrab = { grip, id: e.pointerId };
        grip.onpointermove = (event) => {
          if (!started && Math.hypot(event.clientX - x, event.clientY - y) < 6) return;
          if (!started) {
            started = true;
            source = { item, node };
            node.classList.add('is-dragging');
            root.classList.add('arrange-active');
            ghost = document.createElement('div');
            ghost.className = 'arrange-ghost';
            ghost.textContent = item.name;
            document.body.append(ghost);
          }
          ghost.style.left = event.clientX + 15 + 'px';
          ghost.style.top = event.clientY + 12 + 'px';
          highlight(event.clientX, event.clientY);
        };
        grip.onpointerup = (event) => {
          grip.onpointermove = null;
          grip.onpointerup = null;
          if (grip.hasPointerCapture(event.pointerId)) grip.releasePointerCapture(event.pointerId);
          pointerGrab = null;
          if (started) finish();
        };
        grip.onpointercancel = () => {
          grip.onpointermove = null;
          grip.onpointerup = null;
          stop();
        };
      };

      const label = node.querySelector('.label,.emoji');
      if (label) {
        label.id = 'move-label-' + item.id;
        grip.setAttribute('aria-describedby', label.id);
      }
      grip.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (allowed(item)) o.onMove(item, null, null);
      };
      node.ondragstart = (e) => {
        if (!allowed(item) || !e.dataTransfer) {
          e.preventDefault();
          return;
        }
        source = { item, node };
        suppressClickUntil = Date.now() + 350;
        node.classList.add('is-dragging');
        root.classList.add('arrange-active');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/x-cortex-entity', item.id);
        ghost = document.createElement('div');
        ghost.className = 'arrange-ghost';
        ghost.textContent = item.name;
        document.body.append(ghost);
        e.dataTransfer.setDragImage(ghost, 30, 20);
      };
      node.ondragend = () => {
        suppressClickUntil = Date.now() + 350;
        stop();
      };
    };
    for (const row of [...root.querySelectorAll('.tree-item')]) {
      const item = find(row.dataset.entityId);
      if (!item) continue;
      const wrapper = document.createElement('div');
      wrapper.className = 'arrange-item';
      row.before(wrapper);
      wrapper.append(row);
      decorate(wrapper, item);
    }
    for (const group of root.querySelectorAll('.tree-group')) {
      const item = find(group.dataset.categoryId);
      if (item) decorate(group.querySelector('summary'), item, true);
    }
    const suppressClick = (e) => {
      if (Date.now() < suppressClickUntil) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    root.addEventListener('click', suppressClick, true);
    document.addEventListener('keydown', cancelOnEscape);
    root.ondragover = (e) => {
      if (!source) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = highlight(e.clientX, e.clientY) ? 'move' : 'none';
    };
    root.ondrop = (e) => {
      if (!source) return;
      e.preventDefault();
      finish();
    };
    root.ondragleave = (e) => {
      if (!root.contains(e.relatedTarget)) {
        clearMark();
        clearTimeout(hoverTimer);
        hoverTimer = null;
      }
    };
    const help = document.createElement('small');
    help.className = 'arrange-help';
    help.textContent = o.query
      ? 'امسح البحث لتغيير ترتيب العناصر.'
      : o.busy
        ? 'معاينة نقل؛ التأكيد مطلوب للحفظ.'
        : 'اسحب من المقبض أو اضغطه لاختيار مكان النقل.';
    root.append(help);
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
      for (const node of root.querySelectorAll('[data-drop-id]')) {
        const old = previous.get(node.dataset.dropId),
          now = {
            top:
              node.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop,
          };
        if (old && Math.abs(old.top - now.top) > 1 && Math.abs(old.top - now.top) < 800)
          node.animate(
            [{ transform: `translateY(${old.top - now.top}px)` }, { transform: 'translateY(0)' }],
            { duration: 230, easing: 'cubic-bezier(.2,.8,.2,1)' },
          );
      }
    previous.clear();
  }
  window.CortexArrange = { capture, mount };
})();
