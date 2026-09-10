// src/hooks/__tests__/useAsyncEffect.test.tsx
//
// Bu hook'un TEK isi zamanlama. Yanlis yazilirsa hicbir sey patlamaz — yalnizca
// cozdugu sey sessizce geri gelir (effect'te senkron setState) ya da sokulmus
// bilesene yazilir. Ikisi de ancak DAVRANISLA olculebilir.
import { describe, it, expect, vi } from 'vitest';
import { act } from '@testing-library/react';
import { render } from '@/test/test-utils';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';

describe('useAsyncEffect', () => {
  it('AE1 is, effect FLUSH edilirken DEGIL sonrasinda calisir', async () => {
    const sira: string[] = [];

    function Deneme() {
      useAsyncEffect(() => {
        sira.push('is');
      }, []);
      sira.push('render');
      return null;
    }

    // `render` senkron biter. Is ERTELENDIGI icin bu noktada henuz calismamis
    // olmali — erteleme silinirse burada 'is' zaten listede olur.
    let bitti = false;
    render(<Deneme />);
    expect(sira).toEqual(['render']);

    await act(async () => {
      bitti = true;
    });
    expect(bitti).toBe(true);
    expect(sira).toEqual(['render', 'is']);
  });

  it('AE2 bilesen sokulduysa `alive()` false doner (gec gelen yanit yazmaz)', async () => {
    let alindi: (() => boolean) | null = null;
    let cozumle: (() => void) | null = null;

    function Deneme() {
      useAsyncEffect(async (alive) => {
        alindi = alive;
        await new Promise<void>((r) => {
          cozumle = r;
        });
      }, []);
      return null;
    }

    const { unmount } = render(<Deneme />);
    await act(async () => {});
    expect(alindi).not.toBeNull();
    expect(alindi!()).toBe(true);

    unmount();
    await act(async () => {
      cozumle?.();
    });
    // Istek COZULDU ama bilesen yok: cagiran taraf bunu gorup setState yapmamali.
    expect(alindi!()).toBe(false);
  });

  it('AE3 bagimlilik degisince YENIDEN calisir, degismeyince calismaz', async () => {
    const calisti = vi.fn();

    function Deneme({ q }: { q: string }) {
      useAsyncEffect(async () => {
        calisti(q);
      }, [q]);
      return null;
    }

    const { rerender } = render(<Deneme q="a" />);
    await act(async () => {});
    expect(calisti).toHaveBeenCalledTimes(1);

    // Ayni bagimlilik -> yeniden calismamali.
    await act(async () => {
      rerender(<Deneme q="a" />);
    });
    expect(calisti).toHaveBeenCalledTimes(1);

    // Degisen bagimlilik -> calismali.
    await act(async () => {
      rerender(<Deneme q="b" />);
    });
    expect(calisti).toHaveBeenCalledTimes(2);
    expect(calisti).toHaveBeenLastCalledWith('b');
  });

  it('AE4 sokulma ERTELEME PENCERESINDE olursa is HIC baslamaz', async () => {
    const calisti = vi.fn();

    function Deneme() {
      useAsyncEffect(async () => {
        calisti();
      }, []);
      return null;
    }

    const { unmount } = render(<Deneme />);
    unmount(); // mikro-gorev daha kosmadan
    await act(async () => {});
    expect(calisti).not.toHaveBeenCalled();
  });
});
