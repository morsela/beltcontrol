import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { Sheet } from '../src/components/Sheet.js';
import { openDialogs } from '../src/state/ui.js';

/**
 * Esc belongs to the topmost dialog while one is open, and to the belt otherwise
 * (state/ui.ts). The belt's handler lives on `document`; these pin down that a press
 * which closes a dialog never arrives there.
 */
describe('Sheet and the Escape key', () => {
  // A host per test, removed whole afterwards. Unmounting through `render(null, …)`
  // races the portal's own deferred render and throws from inside Preact's queue.
  let host: HTMLElement;
  const mount = () => {
    host = document.createElement('div');
    document.body.append(host);
    return host;
  };
  afterEach(() => {
    document.querySelectorAll('.sheet-backdrop').forEach((el) => el.remove());
    host.remove();
  });

  it('keeps an Escape that closes it away from document-level handlers', async () => {
    let closed = 0;
    let reachedDocument = 0;
    const onDoc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') reachedDocument++;
    };
    document.addEventListener('keydown', onDoc);

    render(
      <Sheet title="Test" onClose={() => closed++}>
        <button>inside</button>
      </Sheet>,
      mount()
    );
    // Effects (focus, the keydown listener, the dialog count) run after paint.
    await new Promise((r) => setTimeout(r, 20));
    expect(openDialogs.value).toBeGreaterThan(0);

    const inside = document.querySelector<HTMLElement>('.sheet-body button')!;
    inside.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(closed).toBe(1);
    // The regression: the dialog unmounted in a microtask between the two listeners,
    // dropped the count to zero, and the belt's handler then treated the same press
    // as a Stop. Not reaching the document at all does not depend on that timing.
    expect(reachedDocument).toBe(0);

    document.removeEventListener('keydown', onDoc);
  });

  it('lets other keys through', async () => {
    let seen = 0;
    const onDoc = () => seen++;
    document.addEventListener('keydown', onDoc);
    render(
      <Sheet title="Test" onClose={() => {}}>
        <button>inside</button>
      </Sheet>,
      mount()
    );
    await new Promise((r) => setTimeout(r, 20));
    document
      .querySelector<HTMLElement>('.sheet-body button')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(seen).toBe(1);
    document.removeEventListener('keydown', onDoc);
  });
});
