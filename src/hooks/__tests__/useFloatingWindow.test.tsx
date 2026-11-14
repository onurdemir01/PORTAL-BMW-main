// @vitest-environment jsdom
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useFloatingWindow, ResizeHandle, centeredPos } from '../useFloatingWindow';

function TestWindow({
  autoHeight = false,
  defaultSize = { w: 600, h: 400 },
  minSize = { w: 300, h: 200 },
}: {
  autoHeight?: boolean;
  defaultSize?: { w: number; h: number };
  minSize?: { w: number; h: number };
}) {
  const { ref, pos, size, style, startMove, startResize, recenter } = useFloatingWindow(
    defaultSize,
    minSize,
    { autoHeight },
  );
  return (
    <div
      ref={ref}
      data-testid="floating-box"
      data-pos={`${pos.x},${pos.y}`}
      data-size={`${size.w},${String(size.h)}`}
      style={style}
    >
      <div
        data-testid="drag-header"
        onPointerDown={startMove}
        onMouseDown={(e) => startMove(e as unknown as React.PointerEvent)}
      >
        Header
      </div>
      <button type="button" data-testid="recenter-btn" onClick={recenter}>
        Recenter
      </button>
      <div
        data-testid="resize-trigger"
        onMouseDown={(e) => startResize(e as unknown as React.PointerEvent)}
      />
      <ResizeHandle onPointerDown={startResize} />
    </div>
  );
}

describe('useFloatingWindow and ResizeHandle', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      value: 1280,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, 'innerHeight', {
      value: 800,
      configurable: true,
      writable: true,
    });
  });

  it('calculates centeredPos within viewport bounds', () => {
    const p = centeredPos(600, 400);
    expect(p.x).toBe(340);
    expect(p.y).toBe(200);

    const pLarge = centeredPos(2000, 1500);
    expect(pLarge.x).toBeGreaterThanOrEqual(8);
    expect(pLarge.y).toBeGreaterThanOrEqual(8);
  });

  it('handles move, resize, and recenter in fixed height mode', () => {
    const { getByTestId, container } = render(<TestWindow />);
    const box = getByTestId('floating-box');
    expect(box.getAttribute('data-size')).toBe('600,400');

    vi.spyOn(box, 'getBoundingClientRect').mockImplementation(() => {
      const left = Number.parseFloat(box.style.left) || 340;
      const top = Number.parseFloat(box.style.top) || 200;
      const width = Number.parseFloat(box.style.width) || 600;
      const height = Number.parseFloat(box.style.height) || 400;
      return {
        width,
        height,
        top,
        left,
        right: left + width,
        bottom: top + height,
        x: left,
        y: top,
        toJSON: () => ({}),
      };
    });

    // Move
    const header = getByTestId('drag-header');
    act(() => {
      fireEvent.mouseDown(header, { button: 0, clientX: 350, clientY: 210 });
    });
    act(() => {
      const moveEv = new Event('pointermove');
      Object.assign(moveEv, { clientX: 450, clientY: 260 });
      window.dispatchEvent(moveEv);
    });
    act(() => {
      window.dispatchEvent(new Event('pointerup'));
    });
    expect(box.getAttribute('data-pos')).toBe('440,250');

    // Resize
    const handle = container.querySelector('.cursor-nwse-resize') as HTMLElement;
    expect(handle).toBeTruthy();
    fireEvent.mouseDown(getByTestId('resize-trigger'), { button: 0, clientX: 1040, clientY: 650 });
    act(() => {
      const resizeMove = new Event('pointermove');
      Object.assign(resizeMove, { clientX: 1140, clientY: 750 });
      window.dispatchEvent(resizeMove);
    });
    act(() => {
      window.dispatchEvent(new Event('pointerup'));
    });
    expect(box.getAttribute('data-size')).toBe('700,500');

    // Recenter
    fireEvent.click(getByTestId('recenter-btn'));
    expect(box.getAttribute('data-size')).toBe('600,400');
  });

  it('supports autoHeight mode with ResizeObserver and clamps when taller than viewport', () => {
    let roCallback: (() => void) | null = null;
    const observe = vi.fn();
    const disconnect = vi.fn();
    class MockResizeObserver {
      constructor(cb: () => void) {
        roCallback = cb;
      }
      observe = observe;
      disconnect = disconnect;
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    const { getByTestId, unmount } = render(<TestWindow autoHeight />);
    const box = getByTestId('floating-box');
    expect(box.getAttribute('data-size')).toBe('600,auto');
    expect(observe).toHaveBeenCalled();

    vi.spyOn(box, 'getBoundingClientRect').mockReturnValue({
      width: 600,
      height: 900,
      top: 700,
      left: 340,
      right: 940,
      bottom: 1600,
      x: 340,
      y: 700,
      toJSON: () => ({}),
    });

    act(() => {
      roCallback?.();
    });

    // Recenter in autoHeight mode resets height to auto
    fireEvent.click(getByTestId('recenter-btn'));
    expect(box.getAttribute('data-size')).toBe('600,auto');

    unmount();
    expect(disconnect).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
