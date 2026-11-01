import { describe, expect, it } from 'vitest';
import { formatWhatsAppNumber, createWhatsAppLink } from '../reportPdf';
import { personalizeMessage, calculateSmsUnits } from '../../pages/communication/BulkSms';
// @ts-ignore
import { formatPhoneNumber } from '../../../api/communication/send-sms.js';

describe('Communication Utilities', () => {
  describe('Phone Number Normalization', () => {
    it('normalizes local 10-digit Ghana numbers to 233 format', () => {
      expect(formatWhatsAppNumber('0244123456')).toBe('233244123456');
      expect(formatPhoneNumber('0244123456')).toBe('233244123456');
    });

    it('normalizes 9-digit numbers missing leading zero to 233 format', () => {
      expect(formatWhatsAppNumber('244123456')).toBe('233244123456');
      expect(formatPhoneNumber('244123456')).toBe('233244123456');
    });

    it('preserves existing international formatted numbers', () => {
      expect(formatWhatsAppNumber('+233244123456')).toBe('233244123456');
      expect(formatWhatsAppNumber('233244123456')).toBe('233244123456');
      expect(formatPhoneNumber('233244123456')).toBe('233244123456');
    });

    it('rejects invalid or too short phone numbers', () => {
      expect(formatWhatsAppNumber('12345')).toBeNull();
      expect(formatWhatsAppNumber('')).toBeNull();
      expect(formatWhatsAppNumber(null)).toBeNull();
      expect(formatPhoneNumber('123')).toBeNull();
      expect(formatPhoneNumber('')).toBeNull();
    });
  });

  describe('WhatsApp Link Generation', () => {
    it('creates correct manual WhatsApp link without automated API tokens', () => {
      const link = createWhatsAppLink('0244123456', 'Hello Parent');
      expect(link).toBe('https://wa.me/233244123456?text=Hello%20Parent');
    });

    it('creates link with general share URL when phone number is missing', () => {
      const link = createWhatsAppLink('', 'Report Card Ready');
      expect(link).toBe('https://wa.me/?text=Report%20Card%20Ready');
    });
  });

  describe('Message Personalization', () => {
    it('replaces all dynamic tags with student details', () => {
      const template = 'Dear {parent_name}, the terminal report for {student_name} ({class_name}) at {school_name} for {exam_name} is ready.';
      const personalized = personalizeMessage(template, {
        parent_name: 'Mr. Kwame Mensah',
        student_name: 'Kofi Mensah',
        class_name: 'Basic 5',
        school_name: 'Achimota Basic School',
        exam_name: '2nd Term Exam 2026',
      });

      expect(personalized).toBe(
        'Dear Mr. Kwame Mensah, the terminal report for Kofi Mensah (Basic 5) at Achimota Basic School for 2nd Term Exam 2026 is ready.'
      );
    });

    it('uses sensible fallbacks when variable values are omitted', () => {
      const template = 'Dear {parent_name}, report for {student_name} is ready.';
      const personalized = personalizeMessage(template, {});
      expect(personalized).toBe('Dear Parent/Guardian, report for Student is ready.');
    });
  });

  describe('SMS Unit & Character Calculation', () => {
    it('calculates single GSM SMS unit (up to 160 characters)', () => {
      const res = calculateSmsUnits('School fees reminder: Please clear balance.');
      expect(res.units).toBe(1);
      expect(res.isUnicode).toBe(false);
      expect(res.chars).toBe(43);
    });

    it('calculates multi-part GSM SMS units (153 chars per concatenated part)', () => {
      const longMessage = 'A'.repeat(165);
      const res = calculateSmsUnits(longMessage);
      expect(res.units).toBe(2);
      expect(res.isUnicode).toBe(false);
    });

    it('handles Unicode characters with 70 chars per unit', () => {
      const unicodeMessage = 'School Notice 📚: Please review term report 🌟';
      const res = calculateSmsUnits(unicodeMessage);
      expect(res.isUnicode).toBe(true);
      expect(res.units).toBe(1);
    });
  });
});
