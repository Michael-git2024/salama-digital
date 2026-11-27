import { HttpError } from './errors.js';

const FORBIDDEN_KEYS = new Set([
  'name', 'victim_name', 'survivor_name', 'full_name', 'first_name', 'last_name', 'surname',
  'phone', 'phone_number', 'mobile', 'tel', 'telephone', 'contact',
  'national_id', 'id_number', 'passport', 'passport_number', 'huduma_number',
  'email', 'email_address', 'address', 'home_address', 'exact_location', 'street', 'plot_number',
  'gps', 'coordinates', 'lat', 'lng', 'latitude', 'longitude', 'dob', 'date_of_birth',
]);

const PHONE_RE = /(?:\+254\d{9}|0[17]\d{8})(?!\d)/;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const GPS_RE = /-?\d{1,2}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/;

/**
 * Parse simple CSV text (header row + data rows) into an array of objects.
 */
export function parseCsvRecords(csvText) {
  if (typeof csvText !== 'string' || !csvText.trim()) {
    throw new HttpError(400, 'invalid_csv', 'CSV payload must be a non-empty string.');
  }
  const lines = csvText.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    throw new HttpError(400, 'invalid_csv', 'CSV must include a header row and at least one data row.');
  }
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map((line) => {
    const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cols[i] ?? ''; });
    return obj;
  });
}

/**
 * Extract records from JSON body ({ records: [...] }, { csv: "..." }, or single record object)
 * and reject any record containing direct identifiers.
 */
export function extractAndValidateDeidentified(body) {
  let records;
  if (typeof body?.csv === 'string') {
    records = parseCsvRecords(body.csv);
  } else if (Array.isArray(body?.records)) {
    records = body.records;
  } else if (body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length > 0) {
    records = [body];
  } else {
    throw new HttpError(400, 'invalid_payload', 'Provide records array, csv string, or record object.');
  }

  if (records.length === 0) {
    throw new HttpError(400, 'empty_upload', 'Upload contains no records.');
  }

  for (const rec of records) {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) {
      throw new HttpError(400, 'invalid_record', 'Each record must be an object.');
    }
    for (const [rawKey, val] of Object.entries(rec)) {
      const key = rawKey.trim().toLowerCase().replace(/[\s-]+/g, '_');
      if (FORBIDDEN_KEYS.has(key)) {
        throw new HttpError(
          422,
          'data_protection_violation',
          `Data Protection Violation: Direct identifier field "${rawKey}" is strictly prohibited.`
        );
      }
      if (typeof val === 'string') {
        if (PHONE_RE.test(val) || EMAIL_RE.test(val) || GPS_RE.test(val.trim())) {
          throw new HttpError(
            422,
            'data_protection_violation',
            `Data Protection Violation: Field "${rawKey}" contains a prohibited direct identifier value.`
          );
        }
      }
    }
  }

  return records;
}
