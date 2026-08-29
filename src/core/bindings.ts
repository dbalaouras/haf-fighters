/** Rebindable keyboard actions. Mouse buttons are fixed: left = cannon, right = missile. */
export type ActionId =
  | 'afterburner' | 'brake'
  | 'rudderLeft' | 'rudderRight'
  | 'fireGun' | 'fireMissile' | 'swapWeapon' | 'flares' | 'chaff'
  | 'freeLook' | 'camera';

export interface ActionDef {
  id: ActionId;
  label: string;
  default: string;
}

export const ACTIONS: readonly ActionDef[] = [
  { id: 'afterburner', label: 'Afterburner', default: 'KeyW' },
  { id: 'brake', label: 'Brake', default: 'KeyS' },
  // flight is mouse-only, so A/D are free for the rudder and Q can take the swap
  { id: 'rudderLeft', label: 'Rudder left', default: 'KeyA' },
  { id: 'rudderRight', label: 'Rudder right', default: 'KeyD' },
  { id: 'fireGun', label: 'Cannon', default: 'Space' },
  { id: 'fireMissile', label: 'Missile', default: 'KeyR' },
  { id: 'swapWeapon', label: 'Swap missile', default: 'KeyQ' },
  { id: 'flares', label: 'Flares (infrared)', default: 'KeyF' },
  { id: 'chaff', label: 'Chaff (radar)', default: 'KeyE' },
  { id: 'freeLook', label: 'Free look (hold)', default: 'ShiftLeft' },
  { id: 'camera', label: 'Camera', default: 'KeyC' },
];

export type Bindings = Record<ActionId, string>;

export const defaultBindings = (): Bindings =>
  Object.fromEntries(ACTIONS.map((a) => [a.id, a.default])) as Bindings;

/** Human-readable name for a KeyboardEvent.code. */
export function keyLabel(code: string): string {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  if (code.startsWith('Arrow')) return `${code.slice(5)} ↑`.replace('Up ↑', '↑').replace('Down ↑', '↓')
    .replace('Left ↑', '←').replace('Right ↑', '→');
  const named: Record<string, string> = {
    Space: 'Space', ShiftLeft: 'L Shift', ShiftRight: 'R Shift',
    ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl', AltLeft: 'L Alt', AltRight: 'R Alt',
    Tab: 'Tab', Enter: 'Enter', Backspace: 'Bksp', CapsLock: 'Caps',
    BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
    Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`',
    Minus: '-', Equal: '=',
  };
  return named[code] ?? code;
}
