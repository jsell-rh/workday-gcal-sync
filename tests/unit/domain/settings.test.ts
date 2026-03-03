import { describe, it, expect } from 'vitest';
import { renderTitle, DEFAULT_SETTINGS } from '../../../src/domain/model/settings';

describe('renderTitle', () => {
  const vars = { type: 'Paid Time Off (PTO)', hours: 8, status: 'Approved' };

  it('renders the default template', () => {
    const result = renderTitle(DEFAULT_SETTINGS.titleTemplate, vars);
    expect(result).toBe('PTO - Paid Time Off (PTO)');
  });

  it('renders a simple template without variables', () => {
    expect(renderTitle('PTO', vars)).toBe('PTO');
  });

  it('renders {type} variable', () => {
    expect(renderTitle('{type}', vars)).toBe('Paid Time Off (PTO)');
  });

  it('renders {hours} variable', () => {
    expect(renderTitle('OOO ({hours}h)', vars)).toBe('OOO (8h)');
  });

  it('renders {status} variable', () => {
    expect(renderTitle('{status} PTO', vars)).toBe('Approved PTO');
  });

  it('renders multiple variables', () => {
    expect(renderTitle('{type} - {hours}h ({status})', vars)).toBe(
      'Paid Time Off (PTO) - 8h (Approved)',
    );
  });

  it('handles repeated variables', () => {
    expect(renderTitle('{type} / {type}', vars)).toBe('Paid Time Off (PTO) / Paid Time Off (PTO)');
  });

  it('leaves unknown placeholders as-is', () => {
    expect(renderTitle('{unknown}', vars)).toBe('{unknown}');
  });

  it('handles empty template', () => {
    expect(renderTitle('', vars)).toBe('');
  });

  it('handles partial hours', () => {
    expect(renderTitle('PTO ({hours}h)', { ...vars, hours: 4 })).toBe('PTO (4h)');
  });

  it('handles empty status', () => {
    expect(renderTitle('{status}', { ...vars, status: '' })).toBe('');
  });
});

describe('DEFAULT_SETTINGS', () => {
  it('has expected default values', () => {
    expect(DEFAULT_SETTINGS.eventVisibility).toBe('busy');
    expect(DEFAULT_SETTINGS.titleTemplate).toBe('PTO - {type}');
    expect(DEFAULT_SETTINGS.calendarIds).toEqual(['primary']);
    expect(DEFAULT_SETTINGS.workdayAbsenceUrl).toContain('myworkday.com');
  });
});
