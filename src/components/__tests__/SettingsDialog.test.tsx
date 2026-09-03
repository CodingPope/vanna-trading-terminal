import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useUIStore } from '@/store/uiStore';
import { SettingsDialog } from '../SettingsDialog';

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
