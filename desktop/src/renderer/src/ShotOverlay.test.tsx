// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ShotOverlay } from './ShotOverlay';

const IMAGE = 'data:image/png;base64,AAAA';

function installBsub() {
  const api = {
    shotInit: vi.fn(async () => ({ dataUrl: IMAGE, width: 800, height: 600 })),
    shotDone: vi.fn(async () => undefined)
  };
  Object.defineProperty(window, 'bsub', { configurable: true, value: api });
  return api;
}

async function drag(from: [number, number], to: [number, number]) {
  const root = document.querySelector('.shot-root') as HTMLElement;
  fireEvent.mouseDown(root, { clientX: from[0], clientY: from[1], button: 0 });
  fireEvent.mouseMove(root, { clientX: to[0], clientY: to[1] });
  fireEvent.mouseUp(root, { clientX: to[0], clientY: to[1] });
  await waitFor(() => expect(document.querySelector('.shot-toolbar')).toBeTruthy());
}

describe('ShotOverlay', () => {
  afterEach(cleanup);

  it('加载后铺满截图，并给出操作提示', async () => {
    installBsub();
    render(<ShotOverlay />);
    const img = (await screen.findByAltText('屏幕截图')) as HTMLImageElement;
    expect(img.src).toBe(IMAGE);
    expect(screen.getByText(/拖动鼠标框选区域/)).toBeTruthy();
  });

  it('拖出选框后出现三个动作，选「提取文字」回传 ocr', async () => {
    const api = installBsub();
    render(<ShotOverlay />);
    await screen.findByAltText('屏幕截图');

    await drag([100, 100], [300, 220]);
    expect(screen.getByText('识别图片')).toBeTruthy();
    expect(screen.getByText('对话')).toBeTruthy();
    expect(screen.getByText('200 × 120')).toBeTruthy();

    fireEvent.click(screen.getByText('提取文字'));
    expect(api.shotDone).toHaveBeenCalledWith({
      action: 'ocr',
      selection: { x: 100, y: 100, width: 200, height: 120 }
    });
  });

  it('「识别图片」与「对话」各自回传动作', async () => {
    const api = installBsub();
    const first = render(<ShotOverlay />);
    await screen.findByAltText('屏幕截图');
    await drag([10, 10], [110, 90]);
    fireEvent.click(screen.getByText('识别图片'));
    expect(api.shotDone).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'image' })
    );
    first.unmount();

    const second = installBsub();
    render(<ShotOverlay />);
    await screen.findByAltText('屏幕截图');
    await drag([10, 10], [110, 90]);
    fireEvent.click(screen.getByText('对话'));
    expect(second.shotDone).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'chat' }));
  });

  it('太小的拖动不算选区', async () => {
    installBsub();
    render(<ShotOverlay />);
    await screen.findByAltText('屏幕截图');
    const root = document.querySelector('.shot-root') as HTMLElement;
    fireEvent.mouseDown(root, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.mouseMove(root, { clientX: 102, clientY: 101 });
    fireEvent.mouseUp(root, { clientX: 102, clientY: 101 });
    expect(document.querySelector('.shot-toolbar')).toBeNull();
    expect(screen.getByText(/拖动鼠标框选区域/)).toBeTruthy();
  });

  it('Esc 取消（回传 null）', async () => {
    const api = installBsub();
    render(<ShotOverlay />);
    await screen.findByAltText('屏幕截图');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(api.shotDone).toHaveBeenCalledWith(null);
  });

  it('没有拿到屏幕画面时立即取消', async () => {
    const api = installBsub();
    api.shotInit.mockResolvedValueOnce(null as never);
    render(<ShotOverlay />);
    await waitFor(() => expect(api.shotDone).toHaveBeenCalledWith(null));
    expect(screen.getByText(/没有拿到屏幕画面/)).toBeTruthy();
  });
});
