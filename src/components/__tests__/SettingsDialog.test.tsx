import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { store } from '@/store/store';
import { useUIStore } from '@/store/uiStore';
import { SettingsDialog } from '../SettingsDialog';

// The dialog now carries the orb legend, which reads live market state, so it
// needs the Redux store as well as the Zustand one.
const render = (ui: React.ReactElement) =>
  rtlRender(<Provider store={store}>{ui}</Provider>);

/**
 * The store carried `settings`, `updateSettings` and `showSettings` from the
 * start, but nothing rendered them — the gear in the header was an empty click
 * handler over unreachable state.
 */

beforeEach(() => {
  useUIStore.setState({
    showSettings: false,
    settings: {
      highContrastMode: false,
      orbScope: 'market' as const,
      soundEnabled: true,
      notificationsEnabled: true,
      defaultTimeframe: '5m',
      riskPerTrade: 1,
    },
  });
});

describe('SettingsDialog', () => {
  it('stays closed until asked for', () => {
    render(<SettingsDialog />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens when showSettings is set', () => {
    useUIStore.setState({ showSettings: true });
    render(<SettingsDialog />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('writes toggles back to the store', () => {
    useUIStore.setState({ showSettings: true });
    render(<SettingsDialog />);

    fireEvent.click(screen.getByRole('switch', { name: 'High contrast' }));

    expect(useUIStore.getState().settings.highContrastMode).toBe(true);
  });

  it('reflects current state rather than defaults', () => {
    useUIStore.setState({
      showSettings: true,
      settings: { ...useUIStore.getState().settings, soundEnabled: false },
    });
    render(<SettingsDialog />);

    expect(screen.getByRole('switch', { name: 'Sound' })).toHaveAttribute('aria-checked', 'false');
  });

  it('changes the default timeframe', () => {
    useUIStore.setState({ showSettings: true });
    render(<SettingsDialog />);

    fireEvent.click(screen.getByRole('button', { name: '15M' }));

    expect(useUIStore.getState().settings.defaultTimeframe).toBe('15m');
  });

  it('changes risk per trade', () => {
    useUIStore.setState({ showSettings: true });
    render(<SettingsDialog />);

    fireEvent.change(screen.getByLabelText('Risk per trade'), { target: { value: '2.5' } });

    expect(useUIStore.getState().settings.riskPerTrade).toBe(2.5);
  });

  it('closes from the close button', () => {
    useUIStore.setState({ showSettings: true });
    render(<SettingsDialog />);

    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));

    expect(useUIStore.getState().showSettings).toBe(false);
  });
});

describe('orb legend', () => {
  it('explains what each visual channel means', () => {
    useUIStore.setState({ showSettings: true });
    render(<SettingsDialog />);

    // Without a key the orb is a decorative blob.
    for (const channel of ['Shape', 'Speed', 'Colour', 'Detail']) {
      expect(screen.getByText(channel)).toBeInTheDocument();
    }
    expect(screen.getByText(/Dispersion/)).toBeInTheDocument();
    expect(screen.getByText(/Volatility/)).toBeInTheDocument();
    expect(screen.getByText(/Breadth/)).toBeInTheDocument();
  });

  it('lets the scope be switched to the focus list', () => {
    useUIStore.setState({ showSettings: true });
    render(<SettingsDialog />);

    expect(useUIStore.getState().settings.orbScope).toBe('market');
    fireEvent.click(screen.getByRole('button', { name: 'Focus list' }));

    expect(useUIStore.getState().settings.orbScope).toBe('focus');
  });

  it('marks the active scope for assistive tech', () => {
    useUIStore.setState({ showSettings: true });
    render(<SettingsDialog />);

    expect(screen.getByRole('button', { name: 'Whole market' }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Focus list' }))
      .toHaveAttribute('aria-pressed', 'false');
  });
});
