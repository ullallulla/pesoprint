import { afterEach, expect, test, vi } from 'vite-plus/test';

const posthog = vi.hoisted(() => ({
    init: vi.fn<(key: string, config: object) => void>(),
    capture: vi.fn<(...args: unknown[]) => void>(),
}));
vi.mock('posthog-js', () => ({ default: posthog }));

const CONFIG = { key: 'phc_test', host: 'https://eu.i.posthog.com' };
const DOWNLOAD = {
    model: 'hook',
    model_title: 'Hook',
    category: 'functional',
    file_format: 'stl',
    file_id: '0190b6a0-0000-7000-8000-000000000201',
};

// Each test gets a fresh module: whether PostHog has started is module state.
const load = () => import('./analytics');

afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
});

test('nothing is sent before the visitor allows statistics', async () => {
    const { track } = await load();
    track('model_downloaded', DOWNLOAD);
    await vi.dynamicImportSettled();
    expect(posthog.capture).not.toHaveBeenCalled();
});

test('after Allow, a download is sent straight away with the model and file', async () => {
    const { startAnalytics, track } = await load();
    await startAnalytics(CONFIG);

    track('model_downloaded', DOWNLOAD);
    await vi.waitFor(() => expect(posthog.capture).toHaveBeenCalled());

    expect(posthog.init).toHaveBeenCalledWith('phc_test', expect.objectContaining({ api_host: CONFIG.host }));
    expect(posthog.capture).toHaveBeenCalledWith('model_downloaded', DOWNLOAD, {
        send_instantly: true,
        transport: 'sendBeacon',
    });
});
