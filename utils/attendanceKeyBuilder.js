const path = require("path");

const slugify = (value, fallback = "unknown") => {
  if (value === null || value === undefined) {
    return fallback;
  }

  const normalized = value
    .toString()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

  if (!normalized) {
    return fallback;
  }

  const slug = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || fallback;
};

const formatDateParts = (rawDate) => {
  const date = rawDate ? new Date(rawDate) : new Date();
  if (Number.isNaN(date.getTime())) {
    return formatDateParts(new Date());
  }

  const year = date.getFullYear().toString();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const timestamp = [
    year,
    month,
    day,
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ].join("");

  return { year, month, day, timestamp };
};

const buildAttendanceImagePath = ({
  attendanceDate,
  punchType,
  empCode,
  empId,
  employeeName,
  wardName,
  zoneName,
  cityName,
  address,
  latitude,
  longitude,
  capturedAt = new Date(),
}) => {
  const { year, month, day, timestamp } = formatDateParts(attendanceDate || capturedAt);
  const { timestamp: captureStamp } = formatDateParts(capturedAt);

  const safeEmployeeSegment = slugify(
    [empCode || empId, employeeName].filter(Boolean).join("-"),
    empId ? `emp-${empId}` : "employee"
  );

  const locationParts = [wardName, zoneName, cityName]
    .map((part) => (part ? part.toString().trim() : ""))
    .filter(Boolean);

  if (address) {
    locationParts.push(address);
  }

  if (latitude && longitude) {
    locationParts.push(`${latitude},${longitude}`);
  }

  const safeLocationSegment = slugify(
    locationParts.join("-"),
    latitude && longitude
      ? `${slugify(latitude)}-${slugify(longitude)}`
      : "location-unknown"
  );

  const safePunch = slugify(punchType, "punch");

  const fileName = `${safePunch}_${captureStamp}_${safeLocationSegment}.jpg`;
  const relativePath = path
    .join(year, month, day, safeEmployeeSegment, safeLocationSegment, fileName)
    .replace(/\\/g, "/");

  return relativePath;
};

const getAttendanceUploadContext = async (pool, attendanceId) => {
  if (!attendanceId) {
    return null;
  }

  const query = `
    SELECT
      a.attendance_id,
      a.date AS attendance_date,
      e.emp_id,
      e.emp_code,
      e.name AS employee_name,
      w.ward_name,
      z.zone_name,
      c.city_name
    FROM attendance a
    JOIN employee e ON a.emp_id = e.emp_id
    LEFT JOIN wards w ON e.ward_id = w.ward_id
    LEFT JOIN zones z ON w.zone_id = z.zone_id
    LEFT JOIN cities c ON z.city_id = c.city_id
    WHERE a.attendance_id = $1
    LIMIT 1
  `;

  try {
    const result = await pool.query(query, [attendanceId]);
    return result.rows[0] || null;
  } catch (error) {
    console.error("getAttendanceUploadContext error:", error);
    return null;
  }
};

module.exports = {
  buildAttendanceImagePath,
  getAttendanceUploadContext,
};
