type Handler = (event: never) => void;
type Attrs = Record<string, string | number | boolean | undefined | Handler>;
type Child = Node | string | false | null | undefined;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'class') {
      el.className = String(value);
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === false || child === null || child === undefined) continue;
    el.append(child);
  }
  return el;
}

const iconPool = new Map<string, HTMLImageElement>();
let iconsInUse = new Set<HTMLImageElement>();

/** Call before each full re-render so pooled icons can be handed out again. */
export function resetIconPool(): void {
  iconsInUse = new Set();
}

/**
 * Returns an icon image, reusing the element from the previous render when the source is
 * unchanged so re-renders don't make icons blink while they reload. On error, tries
 * `fallback` once before hiding.
 */
export function favicon(src: string, fallback?: string): HTMLImageElement {
  const key = `${src}\n${fallback ?? ''}`;
  const pooled = iconPool.get(key);
  if (pooled && !iconsInUse.has(pooled)) {
    iconsInUse.add(pooled);
    return pooled;
  }
  const img = h('img', { class: 'favicon', src, alt: '', draggable: 'false' });
  img.addEventListener('error', () => {
    if (fallback && img.src !== fallback) img.src = fallback;
    else img.classList.add('missing');
  });
  if (!pooled) iconPool.set(key, img);
  iconsInUse.add(img);
  return img;
}

/**
 * Swaps `target`'s text for an input; resolves with the new value, or
 * undefined if cancelled with Escape.
 */
export function inlineEdit(target: HTMLElement, initial: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const input = h('input', { class: 'inline-edit', value: initial, spellcheck: 'false' });
    const original = target.textContent;
    target.replaceChildren(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (value: string | undefined) => {
      if (done) return;
      done = true;
      target.textContent = original;
      resolve(value);
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(input.value);
      if (e.key === 'Escape') finish(undefined);
    });
    input.addEventListener('blur', () => finish(input.value));
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('dblclick', (e) => e.stopPropagation());
  });
}

export interface MenuItem {
  label: string;
  run: () => void;
  danger?: boolean;
}

export function showMenu(x: number, y: number, items: MenuItem[]): void {
  document.querySelector('.menu')?.remove();
  const menu = h(
    'div',
    { class: 'menu', role: 'menu' },
    ...items.map((item) =>
      h(
        'button',
        {
          class: item.danger ? 'menu-item danger' : 'menu-item',
          role: 'menuitem',
          onclick: () => {
            close();
            item.run();
          },
        },
        item.label,
      ),
    ),
  );
  document.body.append(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 4)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 4)}px`;

  const onDown = (e: Event) => {
    if (!menu.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  function close() {
    menu.remove();
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', close);
  }
  document.addEventListener('mousedown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', close);
}
