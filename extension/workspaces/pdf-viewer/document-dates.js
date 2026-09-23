// Keep the PDF's wall-clock value and explicit UTC offset together. Do not
// convert to the device's time zone or invent seconds/offsets absent in the file.
export function formatPdfDate(value) {
  if (typeof value !== 'string' || value.length > 80) return '';
  const match = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:(Z)|([+-])(\d{2})(?:'?(\d{2})'?)?)?$/.exec(value.trim());
  if (!match) return '';
  const [, year, month = '01', day = '01', hour = '00', minute = '00', second = '00', utc, sign, zoneHour, zoneMinute = '00'] = match;
  const parts = [year, month, day, hour, minute, second].map(Number);
  const date = new Date(0);
  date.setUTCFullYear(parts[0], parts[1] - 1, parts[2]); date.setUTCHours(parts[3], parts[4], parts[5], 0);
  if (date.getUTCFullYear() !== parts[0] || date.getUTCMonth() !== parts[1] - 1 || date.getUTCDate() !== parts[2] ||
      date.getUTCHours() !== parts[3] || date.getUTCMinutes() !== parts[4] || date.getUTCSeconds() !== parts[5]) return '';
  if (sign && (Number(zoneHour) > 23 || Number(zoneMinute) > 59)) return '';
  const zone = utc ? 'UTC' : sign ? `UTC${sign}${Number(zoneHour)}${Number(zoneMinute) ? ':' + zoneMinute : ''}` : '';
  const time = `${hour}:${minute}` + (match[6] !== undefined ? `:${second}` : '');
  return `${year}-${month}-${day} ${time}` + (zone ? ` (${zone})` : '');
}
