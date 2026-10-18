type NavigationOptions = { success?(result: WechatMiniprogram.NavigateToSuccessCallbackResult): void; complete?(): void };
let opening = false;

// Card taps can arrive while WeChat is still completing a tab transition.
// Serialize them, wait for rendering, and retry only the explicitly transient routing failures.
export function openLearningPage(url: string, options: NavigationOptions = {}): void {
  if (opening) { options.complete?.(); return; }
  opening = true;
  const currentPage = () => { const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []; return pages[pages.length - 1]; };
  const origin = currentPage();
  let finished = false;
  const finish = () => { if (!finished) { finished = true; opening = false; options.complete?.(); } };
  const run = (retried = false) => {
    if (origin && currentPage() !== origin) { finish(); return; }
    let retryScheduled = false;
    wx.navigateTo({ url,
      success(result) { try { options.success?.(result); } finally { finish(); } },
      fail(error) {
        const message = error.errMsg || '微信未返回具体原因';
        if (!retried && /is not allowed now|another.*rout|routing|route.*running|正在跳转|路由.*未完成/i.test(message)) {
          retryScheduled = true; setTimeout(() => run(true), 350); return;
        }
        finish();
        // Keep the platform's real failure available instead of losing it behind a generic toast.
        console.warn('[learning-navigation]', url.split('?')[0], message);
        wx.showModal({ title: '页面未打开', content: `微信提示：${message}\n可复制这段提示反馈；若提示页面不存在，请重新扫描最新测试码。`,
          confirmText: '复制提示', cancelText: '知道了', success(result) {
            if (result.confirm) wx.setClipboardData({ data: `学习页面跳转失败\n${url.split('?')[0]}\n${message}` });
          } });
      },
      complete() { if (!retryScheduled) finish(); }
    });
  };
  if (typeof wx.nextTick === 'function') wx.nextTick(() => run()); else run();
}
