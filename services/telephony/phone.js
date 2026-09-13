/**
 * Normalize Indian / international numbers to E.164 for telephony APIs.
 */
function toE164(phone) {
  if (!phone) return '';
  const raw = String(phone).trim();
  if (raw.startsWith('+')) {
    return '+' + raw.replace(/[^0-9]/g, '');
  }
  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return `+${digits}`;
}

function last10Digits(phone) {
  const digits = String(phone || '').replace(/[^0-9]/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

module.exports = { toE164, last10Digits };
