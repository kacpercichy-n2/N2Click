const SNAPSHOT_CLASS = 'task-modal-snapshot';
const CAPTURE_MAX_WIDTH = 1440;
const CAPTURE_MAX_HEIGHT = 900;

let captureGeneration = 0;
let snapshotLayer: HTMLDivElement | null = null;

function isModalLayer(element: Element) {
  return Boolean(
    element.closest(`.${SNAPSHOT_CLASS}, .task-modal-viewport`),
  );
}

function createProcessedSnapshot(source: HTMLCanvasElement, scale: number) {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  canvas.className = 'task-modal-snapshot-canvas';

  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return source;

  context.fillStyle = '#08070d';
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Rozmycie i przyciemnienie są wypalane raz w bitmapę. Podczas późniejszego
  // scrolla modala przeglądarka przesuwa tylko jego warstwę, bez filtrowania DOM.
  context.filter = `blur(${Math.max(1.5, 3.5 * scale)}px) brightness(0.78) saturate(0.82)`;
  context.drawImage(source, 0, 0);
  context.filter = 'none';
  context.fillStyle = 'rgba(4, 3, 8, 0.54)';
  context.fillRect(0, 0, canvas.width, canvas.height);

  return canvas;
}

async function renderSnapshot(layer: HTMLDivElement, generation: number) {
  try {
    const [{ default: html2canvas }] = await Promise.all([
      import('html2canvas'),
      document.fonts?.ready ?? Promise.resolve(),
    ]);
    if (generation !== captureGeneration || !layer.isConnected) return;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const scale = Math.min(
      1,
      CAPTURE_MAX_WIDTH / viewportWidth,
      CAPTURE_MAX_HEIGHT / viewportHeight,
    );
    const source = await html2canvas(document.body, {
      backgroundColor: '#08070d',
      width: viewportWidth,
      height: viewportHeight,
      x: window.scrollX,
      y: window.scrollY,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      scale,
      useCORS: true,
      allowTaint: false,
      imageTimeout: 1200,
      logging: false,
      removeContainer: true,
      ignoreElements: isModalLayer,
    });
    if (generation !== captureGeneration || !layer.isConnected) return;

    layer.replaceChildren(createProcessedSnapshot(source, scale));
    document.documentElement.dataset.modalBackdrop = 'snapshot';
  } catch {
    // Opaque fallback nadal gwarantuje płynność, gdy np. zewnętrzny obraz bez
    // CORS uniemożliwi zbudowanie bitmapy.
    if (generation === captureGeneration && layer.isConnected) {
      document.documentElement.dataset.modalBackdrop = 'fallback';
    }
  }
}

export function mountModalBackdropSnapshot() {
  const generation = ++captureGeneration;
  document.documentElement.dataset.modalBackdrop = 'pending';

  const layer = document.createElement('div');
  layer.className = SNAPSHOT_CLASS;
  layer.setAttribute('aria-hidden', 'true');
  document.body.append(layer);
  snapshotLayer = layer;

  void renderSnapshot(layer, generation);
}

export function unmountModalBackdropSnapshot() {
  captureGeneration += 1;
  delete document.documentElement.dataset.modalBackdrop;
  snapshotLayer?.remove();
  snapshotLayer = null;
}
