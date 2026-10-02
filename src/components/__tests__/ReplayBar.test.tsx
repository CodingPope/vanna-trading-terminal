import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render as rtlRender, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import marketReducer, { setConnected } from '@/store/slices/marketSlice';
import paperReducer, { receiveAccount } from '@/store/slices/paperSlice';
import orderBookReducer from '@/store/slices/orderBookSlice';
import replayReducer, { receiveAck, receiveStatus, commandSent, feedLost } from '@/store/slices/replaySlice';
import { registerFeed } from '@/services/feedControl';
import type { WebSocketClient, WsMessage } from '@/services/websocket';
import type { ReplayStatus } from '@/schemas';
import { ReplayBar } from '../ReplayBar';

/**
 * These controls exist to tell the truth about a system the browser does not
 * own. Every assertion here is about that: the bar shows what the server says,
 * refuses what the server says it cannot do, and never reports a command as
 * applied before it has been acknowledged.
 */

const STATUS: ReplayStatus = {
  protocolVersion: 1, fixtureId: 'aapl-open:abc123', mode: 'recorded', unit: 'event',
  eventTimeNs: '1789678816585999872', startNs: '1789678816585999000',
  endNs: '1789678916585999872', speed: 1, speeds: [0.5, 1, 2, 5, 'max'],
  playing: true, ended: false, sequence: 12, generation: 1, canSeek: true, canStep: true,
};

function makeStore() {
  return configureStore({
    reducer: { market: marketReducer, paper: paperReducer, orderBook: orderBookReducer, replay: replayReducer },
  });
}

let store: ReturnType<typeof makeStore>;
let sent: WsMessage[];

const render = () => rtlRender(<Provider store={store}><ReplayBar /></Provider>);
const lastCommand = () => sent[sent.length - 1]?.data as { action: string; speed?: unknown; timestampNs?: string };

function connected(status: Partial<ReplayStatus> = {}) {
  store.dispatch(setConnected(true));
  store.dispatch(receiveStatus({ ...STATUS, ...status }));
}

beforeEach(() => {
  store = makeStore();
  sent = [];
  registerFeed({ send: (m: WsMessage) => sent.push(m) } as unknown as WebSocketClient);
});

afterEach(() => {
  registerFeed(null);
  vi.restoreAllMocks();
});

describe('ReplayBar', () => {
  it('says the state is unknown rather than guessing at one', () => {
    store.dispatch(setConnected(true));
    render();
    expect(screen.getByTestId('replay-state')).toHaveTextContent('Replay status unavailable');
    expect(screen.queryByLabelText('Pause replay')).not.toBeInTheDocument();
  });

  it('reports reconnecting when the socket has dropped', () => {
    connected();
    store.dispatch(setConnected(false));
    store.dispatch(feedLost());
    render();
    expect(screen.getByTestId('replay-state')).toHaveTextContent('Reconnecting');
  });

  it('renders the server clock, mode, and fixture, not a local guess', () => {
    connected();
    render();
    expect(screen.getByTestId('replay-provenance')).toHaveTextContent('RECORDED');
    expect(screen.getByTestId('replay-fixture')).toHaveTextContent('aapl-open:abc123');
    // 1789678816585999872ns is 2026-09-17T21:00:16Z. Number() would round the
    // nanoseconds away; the component divides with BigInt first.
    expect(screen.getByTestId('replay-clock')).toHaveTextContent('21:00:16');
  });

  it('sends pause when the server says it is playing', () => {
    connected();
    render();
    fireEvent.click(screen.getByLabelText('Pause replay'));
    expect(lastCommand().action).toBe('pause');
  });

  it('follows server-authoritative state instead of its own click', () => {
    connected();
    render();
    fireEvent.click(screen.getByLabelText('Pause replay'));
    // Still "playing" on screen: nothing has been acknowledged yet.
    expect(screen.getByLabelText('Pause replay')).toBeInTheDocument();
    expect(screen.getByTestId('replay-state')).toHaveTextContent('pause…');

    act(() => { store.dispatch(receiveStatus({ ...STATUS, playing: false })); });
    expect(screen.getByLabelText('Play replay')).toBeInTheDocument();
  });

  it('shows a refusal with the reason the server gave', () => {
    connected();
    render();
    act(() => {
      store.dispatch(commandSent({ commandId: 'seek-1', action: 'seek', sentAt: 0 }));
      store.dispatch(receiveAck({
        commandId: 'seek-1', action: 'seek', accepted: false, code: 'out_of_bounds',
        message: 'Seek target must fall within the session.', duplicate: false, status: STATUS,
      }));
    });
    expect(screen.getByTestId('replay-state')).toHaveTextContent('Seek target must fall within the session.');
    fireEvent.click(screen.getByLabelText('Dismiss replay error'));
    expect(screen.getByTestId('replay-state')).not.toHaveTextContent('Seek target');
  });

  it('offers only the speeds the server supports, and sends the chosen one', () => {
    connected();
    render();
    const speed = screen.getByLabelText('Playback speed');
    expect([...speed.querySelectorAll('option')].map(o => o.textContent))
      .toEqual(['0.5x', '1x', '2x', '5x', 'Max']);
    fireEvent.change(speed, { target: { value: '2' } });
    expect(lastCommand()).toMatchObject({ action: 'speed', speed: 2 });
  });

  it('disables seeking when the source cannot be rewound', () => {
    connected({ mode: 'synthetic', canSeek: false });
    render();
    expect(screen.getByLabelText('Seek through the session')).toBeDisabled();
    expect(screen.getByLabelText('Seek through the session'))
      .toHaveAttribute('title', 'This source cannot be rewound');
  });

  it('seeks in exact nanoseconds, which a JS number could not carry', () => {
    connected();
    render();
    const scrubber = screen.getByLabelText('Seek through the session');
    fireEvent.change(scrubber, { target: { value: '5000' } });
    fireEvent.pointerUp(scrubber);
    const target = lastCommand().timestampNs as string;
    expect(target).toMatch(/^\d+$/);
    expect(BigInt(target)).toBe(BigInt(STATUS.startNs)
      + (BigInt(STATUS.endNs) - BigInt(STATUS.startNs)) / 2n);
  });

  it('labels the scrubber for a screen reader with a time, not a raw number', () => {
    connected();
    render();
    expect(screen.getByLabelText('Seek through the session'))
      .toHaveAttribute('aria-valuetext', expect.stringContaining('21:00:16'));
  });

  it('resets without ceremony when there is nothing to lose', () => {
    connected();
    render();
    fireEvent.click(screen.getByLabelText('Reset replay to the start'));
    expect(lastCommand().action).toBe('reset');
  });

  it('confirms a reset that would discard paper state', () => {
    connected();
    store.dispatch(receiveAccount({
      epoch: 'e1', revision: 1, initialCash: 100000, cash: 99000, realizedPnl: 0, fees: 0,
      paused: false, executions: [], positions: [{ symbol: 'AAPL', quantity: 10, averageCost: 100 }],
      orders: [],
    }));
    render();

    fireEvent.click(screen.getByLabelText('Reset replay to the start'));
    expect(sent).toEqual([]);
    expect(screen.getByRole('alertdialog', { name: 'Confirm replay reset' })).toBeInTheDocument();

    fireEvent.click(screen.getByText('Cancel'));
    expect(sent).toEqual([]);

    fireEvent.click(screen.getByLabelText('Reset replay to the start'));
    fireEvent.click(screen.getByText('Reset'));
    expect(lastCommand().action).toBe('reset');
  });

  it('will not play on past the end of the session', () => {
    connected({ playing: false, ended: true });
    render();
    expect(screen.getByLabelText('Play replay')).toBeDisabled();
    expect(screen.getByLabelText('Step one event')).toBeDisabled();
    expect(screen.getByTestId('replay-state')).toHaveTextContent('End of session');
    // Reset is the way out, so it stays available.
    expect(screen.getByLabelText('Reset replay to the start')).toBeEnabled();
  });

  it('disables every control while the socket is down', () => {
    connected();
    store.dispatch(setConnected(false));
    render();
    expect(screen.getByLabelText('Pause replay')).toBeDisabled();
    expect(screen.getByLabelText('Playback speed')).toBeDisabled();
    expect(screen.getByLabelText('Reset replay to the start')).toBeDisabled();
  });
});
