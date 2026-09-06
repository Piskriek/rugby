/**
 * MOUNT — dev-only hook that mounts the ragdoll playground into the page.
 *
 * Called from src/main.tsx under `import.meta.env.DEV` ONLY, so the shipped
 * 2D game is untouched in production; `npm run dev` shows the playground.
 *
 * The playground is deliberately isolated: it renders into an overlay canvas
 * above the existing #root and makes no changes to ball handling or camera
 * code (task scope: ragdoll construction + joint torque).
 */
import { mountPlayground } from './playground';

export function mountRagdollDev(): (() => void) | undefined {
  if (!import.meta.env.DEV) return undefined;

  // container that sits above the game UI
  const host = document.createElement('div');
  host.id = 'ragdoll-playground';
  host.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:9999',
    'background:#0c1220', 'display:flex', 'align-items:center', 'justify-content:center',
  ].join(';');

  // header label
  const header = document.createElement('div');
  header.style.cssText = 'position:absolute;top:0;left:0;right:0;padding:8px 14px;color:#9fd9ff;font:600 13px ui-sans-serif,system-ui;display:flex;gap:12px;align-items:center;z-index:20;background:linear-gradient(#000c,#0000);';
  header.innerHTML = '<span>ACTIVE RAGDOLL — PD MOTOR PLAYGROUND</span>';
  host.appendChild(header);

  // canvas region
  const canvasHost = document.createElement('div');
  canvasHost.style.cssText = 'position:absolute;inset:0;';
  host.appendChild(canvasHost);

  document.body.appendChild(host);

  let disposed = false;
  let handles: Awaited<ReturnType<typeof mountPlayground>> | null = null;
  mountPlayground(canvasHost).then((h) => {
    if (disposed) { h.dispose(); return; }
    handles = h;
    // close button
    const close = document.createElement('button');
    close.textContent = '✕ back to game';
    close.style.cssText = 'position:absolute;top:6px;right:10px;z-index:30;padding:5px 10px;border-radius:6px;border:0;cursor:pointer;background:#2563eb;color:#fff;font:600 12px ui-sans-serif;';
    close.onclick = () => unmount();
    host.appendChild(close);
  });

  const unmount = () => {
    if (disposed) return;
    disposed = true;
    handles?.dispose();
    host.remove();
  };
  return unmount;
}
