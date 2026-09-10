import { signal } from '@preact/signals';

/**
 * How many modal dialogs are currently open.
 *
 * `Esc` does double duty in this app: it stops the belt from anywhere, and it is
 * also the universal "dismiss this dialog" key. Those collided — pressing Esc to
 * close the connection sheet also halted the walk. The rule now is that Esc
 * belongs to the topmost dialog whenever one is open, and to the belt otherwise.
 *
 * That is only safe because `Sheet` refuses to hide Stop: every dialog renders its
 * own Stop while the belt is moving, so the control is on screen the entire time
 * the key is pointing somewhere else. See `installGuards` in state/connection.ts.
 */
export const openDialogs = signal(0);
