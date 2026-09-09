import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { retryableLazy } from './retryable-lazy';

it('模块首次失败保留外层页面，重试重新调用 loader 并恢复内容', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const loader = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ default: () => <p>编辑器就绪</p> });
  const Editor = retryableLazy(loader);
  try {
    render(<><h1>流水</h1><Editor /></>);
    expect(await screen.findByRole('alert')).toHaveTextContent('页面内容加载失败');
    expect(screen.getByRole('heading', { name: '流水' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(await screen.findByText('编辑器就绪')).toBeVisible();
    expect(loader).toHaveBeenCalledTimes(2);
  } finally { consoleError.mockRestore(); }
});
