import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import marketReducer from '@/store/slices/marketSlice';
import orderBookReducer from '@/store/slices/orderBookSlice';
import positionsReducer from '@/store/slices/positionsSlice';
import panelsReducer from '@/store/slices/panelsSlice';
import { useUIStore } from '@/store/uiStore';
import { CommandPalette } from '../CommandPalette';

// ── Minimal store + provider ──────────────────────────────────────────────────
function makeStore() {
  return configureStore({
    reducer: {
      market: marketReducer,
      orderBook: orderBookReducer,
      positions: positionsReducer,
      panels: panelsReducer,
    },
  });
}

// UI state is a plain Zustand store, so the real thing can be driven directly
// rather than mocked — these tests now exercise the actual wiring.
beforeEach(() => {
  useUIStore.setState({ showCommandPalette: true });
});

function renderPalette() {
  return render(
    <Provider store={makeStore()}>
      <CommandPalette />
    </Provider>,
  );
}

describe('CommandPalette', () => {
  it('renders a search input when open', () => {
    renderPalette();
    expect(screen.getByPlaceholderText(/type a command/i)).toBeInTheDocument();
  });

  it('shows command buttons by default', () => {
    renderPalette();
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('filters commands by search text', () => {
    renderPalette();
    const input = screen.getByPlaceholderText(/type a command/i);
    fireEvent.change(input, { target: { value: 'dashboard' } });
    const buttons = screen.getAllByRole('button');
    const labels = buttons.map(b => b.textContent?.toLowerCase() ?? '');
    expect(labels.some(l => l.includes('dashboard'))).toBe(true);
  });

  it('shows "No commands found" for an unknown query', () => {
    renderPalette();
    const input = screen.getByPlaceholderText(/type a command/i);
    fireEvent.change(input, { target: { value: 'xyzzy_nonexistent_9999' } });
    expect(screen.getByText(/no commands found/i)).toBeInTheDocument();
  });

  it('navigates results with ArrowDown key without throwing', () => {
    renderPalette();
    const input = screen.getByPlaceholderText(/type a command/i);
    expect(() => {
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowUp' });
    }).not.toThrow();
  });
});
