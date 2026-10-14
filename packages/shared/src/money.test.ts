import { describe, expect, it } from 'vitest';
import { agorotToInput, formatMoney, parseShekels, percentOf, roundToShekel } from './money';
import { normalizeGrade, normalizePhone } from './domain-types';

describe('money', () => {
  it('parses shekel input without floats', () => {
    expect(parseShekels('1,234.5')).toBe(123450);
    expect(parseShekels('₪ 9600')).toBe(960000);
    expect(parseShekels('0.1')).toBe(10);
    expect(parseShekels('0.29')).toBe(29);
    expect(parseShekels('1.234')).toBeNull();
    expect(parseShekels('abc')).toBeNull();
    expect(parseShekels('')).toBeNull();
  });

  it('formats and round-trips', () => {
    expect(formatMoney(960000)).toBe('₪9,600');
    expect(formatMoney(123450)).toBe('₪1,234.50');
    expect(formatMoney(-5000)).toBe('‎-₪50');
    expect(agorotToInput(123405)).toBe('1234.05');
    expect(agorotToInput(960000)).toBe('9600');
  });

  it('rounds to whole shekels half up', () => {
    expect(roundToShekel(149)).toBe(100);
    expect(roundToShekel(150)).toBe(200);
    expect(roundToShekel(-150)).toBe(-200);
  });

  it('computes percentages like the demo (Math.round on shekels)', () => {
    expect(percentOf(960000, 10)).toBe(96000);
    expect(percentOf(960000, 20)).toBe(192000);
    expect(percentOf(999900, 15)).toBe(150000); // 1499.85 -> 1500
    expect(percentOf(100000, 12.5)).toBe(12500); // 125 exactly
    expect(percentOf(333300, 10)).toBe(33300); // 333.30 -> 333
    // Same result as the demo's Math.round(t*pct/100) in shekels for many values.
    for (let t = 0; t < 20000; t += 37) {
      for (const pct of [5, 10, 15, 20, 33]) {
        expect(percentOf(t * 100, pct)).toBe(Math.round((t * pct) / 100) * 100);
      }
    }
  });
});

describe('normalizers', () => {
  it('normalizes grades', () => {
    const g = ["א'", "ב'"];
    expect(normalizeGrade('א', g)).toBe("א'");
    expect(normalizeGrade('ב׳', g)).toBe("ב'");
    expect(normalizeGrade('כיתה א', g)).toBe("א'");
    expect(normalizeGrade('ז', g)).toBeNull();
  });
  it('normalizes phones', () => {
    expect(normalizePhone('050-111 1111')).toBe('0501111111');
    expect(normalizePhone('+972-50-1111111')).toBe('0501111111');
  });
});
