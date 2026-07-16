const pool = require("../config/db");

const kothiAccessCache = new Map();
let kothiAccessVersion = 0;

const buildCacheKey = (userId) => `${userId || "unknown"}:${kothiAccessVersion}`;

const invalidateKothiAccessCache = () => {
  kothiAccessVersion += 1;
  kothiAccessCache.clear();
};

const normalizeWardIds = (wardIds = []) => {
  const seen = new Set();
  const normalized = [];

  (wardIds || []).forEach((raw) => {
    const value = Number(raw);
    if (Number.isFinite(value) && !seen.has(value)) {
      seen.add(value);
      normalized.push(value);
    }
  });

  return normalized;
};

const fetchUserKothiAccess = async (user, options = {}) => {
  const userId =
    (typeof user === "object" && user !== null ? user.user_id : null) ||
    Number(user) ||
    null;
  const includeMetadata = options.includeKothis || options.withNames;
  const allowZoneFallback =
    options.allowZoneFallback === undefined
      ? true
      : Boolean(options.allowZoneFallback);
  const allowCityFallback =
    options.allowCityFallback === undefined
      ? true
      : Boolean(options.allowCityFallback);

  if (!userId) {
    return { ids: [], kothis: [] };
  }

  const cacheKey = buildCacheKey(userId);
  if (!includeMetadata && kothiAccessCache.has(cacheKey)) {
    return kothiAccessCache.get(cacheKey);
  }

  // 1) Direct Kothi assignments (user + legacy supervisor mappings)
  const directRows = await pool.query(
    `
      SELECT kothi_id FROM user_kothi_access WHERE user_id = $1
      UNION
      SELECT kothi_id FROM supervisor_kothi WHERE supervisor_id = $1
      UNION
      SELECT kothi_id FROM supervisor_ward WHERE supervisor_id = $1
      UNION
      -- Legacy fallback: only treat supervisor_ward.kothi_id as ward_id
      -- when that value does not exist as a real kothi_id.
      SELECT w.kothi_id
      FROM supervisor_ward sw_legacy
      LEFT JOIN kothis w_direct ON w_direct.kothi_id = sw_legacy.kothi_id
      JOIN kothis w ON w.ward_id = sw_legacy.kothi_id
      WHERE sw_legacy.supervisor_id = $1
        AND w_direct.kothi_id IS NULL
    `,
    [userId]
  );
  let wardIds = normalizeWardIds(directRows.rows.map((row) => row.kothi_id));

  // 2) Fallback to zones -> kothis if nothing explicit
  if (wardIds.length === 0 && allowZoneFallback) {
    const zoneRows = await pool.query(
      "SELECT zone_id FROM user_zone_access WHERE user_id = $1",
      [userId]
    );
    const zoneIds = zoneRows.rows
      .map((row) => Number(row.zone_id))
      .filter((id) => Number.isFinite(id));

    if (zoneIds.length > 0) {
      const zoneWardRows = await pool.query(
        "SELECT kothi_id FROM kothis WHERE zone_id = ANY($1)",
        [zoneIds]
      );
      wardIds = normalizeWardIds(zoneWardRows.rows.map((row) => row.kothi_id));
    }
  }

  // 3) Fallback to city -> kothis only when no zone/kothi assignments
  if (wardIds.length === 0 && allowCityFallback) {
    const cityRows = await pool.query(
      "SELECT city_id FROM user_city_access WHERE user_id = $1",
      [userId]
    );
    const cityIds = cityRows.rows
      .map((row) => Number(row.city_id))
      .filter((id) => Number.isFinite(id));

    if (cityIds.length > 0) {
      const cityWardRows = await pool.query(
        `
          SELECT w.kothi_id
          FROM kothis w
          JOIN zones z ON z.zone_id = w.zone_id
          WHERE z.city_id = ANY($1)
        `,
        [cityIds]
      );
      wardIds = normalizeWardIds(cityWardRows.rows.map((row) => row.kothi_id));
    }
  }

  if (includeMetadata) {
    if (wardIds.length === 0) {
      return { ids: [], kothis: [] };
    }

    const { rows } = await pool.query(
      `
        SELECT w.kothi_id,
               w.kothi_name,
               s.ward_id,
               s.ward_name,
               z.zone_id,
               z.zone_name,
               c.city_id,
               c.city_name
        FROM kothis w
        LEFT JOIN wards s ON s.ward_id = w.ward_id
        LEFT JOIN zones z ON z.zone_id = COALESCE(s.zone_id, w.zone_id)
        LEFT JOIN cities c ON c.city_id = z.city_id
        WHERE w.kothi_id = ANY($1)
        ORDER BY w.kothi_name ASC
      `,
      [wardIds]
    );

    return {
      ids: normalizeWardIds(rows.map((row) => row.kothi_id)),
      kothis: rows.map((row) => ({
        kothi_id: row.kothi_id,
        kothi_name: row.kothi_name,
        ward_id: row.ward_id,
        ward_name: row.ward_name,
        zone_id: row.zone_id,
        zone_name: row.zone_name,
        city_id: row.city_id,
        city_name: row.city_name,
      })),
    };
  }

  const payload = { ids: wardIds };
  kothiAccessCache.set(cacheKey, payload);
  return payload;
};

const syncUserKothiAccess = async (
  userId,
  wardIds = [],
  actorId = null,
  client = pool
) => {
  const ids = normalizeWardIds(wardIds);

  await client.query("DELETE FROM user_kothi_access WHERE user_id = $1", [
    userId,
  ]);

  if (ids.length === 0) {
    invalidateKothiAccessCache();
    return;
  }

  await client.query(
    `
      INSERT INTO user_kothi_access (user_id, kothi_id, granted_at, granted_by)
      SELECT $1, UNNEST($2::int[]), NOW(), $3
      ON CONFLICT DO NOTHING
    `,
    [userId, ids, actorId ?? null]
  );

  invalidateKothiAccessCache();
};

module.exports = {
  fetchUserKothiAccess,
  normalizeWardIds, // Exported for use in routes
  syncUserKothiAccess,
  invalidateKothiAccessCache,
};
