/**
 * Generates the visibility CTE and WHERE clause components based on user role.
 * 
 * @param {Object} user - req.user
 * @param {Object} cityScope - req.cityScope
 * @param {string} tableAlias - alias for the table to filter (e.g. 'pa', 'pe')
 * @returns {Object} { cte: string, whereClause: string, params: Array }
 */
const buildVisibilityScope = (user, cityScope, tableAlias = 'pa') => {
  const role = user?.role?.toLowerCase();
  let cte = '';
  let whereClause = '1=1';
  let params = [];

  if (role === 'admin') {
    if (!cityScope || cityScope.all) {
      whereClause = '1=1'; // Access to all
    } else if (cityScope.ids && cityScope.ids.length > 0) {
      // Append city IDs array as the first parameter
      params.push(cityScope.ids);
      whereClause = `${tableAlias}.city_id = ANY($1::int[])`;
    } else {
      whereClause = '1=0'; // Scope explicitly empty
    }
  } else if (role === 'supervisor') {
    const supervisorId = user.user_id || user.id || user.userId;
    params.push(supervisorId);

    cte = `
      WITH has_explicit_scope AS (
        SELECT EXISTS (
          SELECT 1 FROM user_city_access WHERE user_id = $1
          UNION ALL
          SELECT 1 FROM user_zone_access WHERE user_id = $1
          UNION ALL
          SELECT 1 FROM user_kothi_access WHERE user_id = $1
        ) AS enabled
      ),
      assigned_kothis AS (
        SELECT kothi_id FROM user_kothi_access WHERE user_id = $1
        UNION
        SELECT kothi_id
        FROM supervisor_kothi
        WHERE supervisor_id = $1
          AND NOT (SELECT enabled FROM has_explicit_scope)
        UNION
        -- Legacy fallback: some old supervisor_ward rows stored ward_id instead of kothi_id.
        -- Expand those legacy ward mappings into actual kothi ward_ids only when explicit RBAC scope is absent.
        SELECT w.kothi_id
        FROM supervisor_ward sw_legacy
        LEFT JOIN kothis w_direct ON w_direct.kothi_id = sw_legacy.kothi_id
        JOIN kothis w ON w.ward_id = sw_legacy.kothi_id
        WHERE sw_legacy.supervisor_id = $1
          AND w_direct.kothi_id IS NULL
          AND NOT (SELECT enabled FROM has_explicit_scope)
      ),
      assigned_wards AS (
        SELECT kothi_id
        FROM supervisor_ward
        WHERE supervisor_id = $1
          AND NOT (SELECT enabled FROM has_explicit_scope)
          AND EXISTS (
            SELECT 1
            FROM kothis w_real
            WHERE w_real.kothi_id = supervisor_ward.kothi_id
          )
        UNION
        SELECT kothi_id
        FROM assigned_kothis
        WHERE NOT EXISTS (
          SELECT 1
          FROM kothis w_child
          WHERE w_child.kothi_id = assigned_kothis.kothi_id
            AND w_child.ward_id IS NOT NULL
        )
        UNION
        SELECT kothi_id
        FROM assigned_kothis
        WHERE NOT (SELECT enabled FROM has_explicit_scope)
          AND EXISTS (
            SELECT 1
            FROM kothis w_child
            WHERE w_child.kothi_id = assigned_kothis.kothi_id
          )
      ),
      assigned_sectors AS (
        -- Wards derived from assigned kothis
        SELECT DISTINCT w.ward_id
        FROM kothis w
        JOIN assigned_kothis a ON a.kothi_id = w.kothi_id
        WHERE w.ward_id IS NOT NULL
        UNION
        -- Direct kothi/ward assignments from legacy tables
        SELECT DISTINCT a.kothi_id AS ward_id
        FROM assigned_wards a
        JOIN wards s ON s.ward_id = a.kothi_id
        UNION
        -- Zone access grants every ward in that zone
        SELECT DISTINCT s.ward_id
        FROM wards s
        JOIN user_zone_access uza ON uza.zone_id = s.zone_id
        WHERE uza.user_id = $1
      ),
      assigned_zones AS (
        -- Direct zone assignments
        SELECT zone_id FROM user_zone_access WHERE user_id = $1
        UNION
        -- Zones inferred from assigned kothis
        SELECT DISTINCT COALESCE(w.zone_id, s.zone_id) AS zone_id
        FROM kothis w
        LEFT JOIN wards s ON s.ward_id = w.ward_id
        JOIN assigned_kothis a ON a.kothi_id = w.kothi_id
        WHERE COALESCE(w.zone_id, s.zone_id) IS NOT NULL
        UNION
        -- Zones inferred from direct kothi/ward assignments
        SELECT DISTINCT COALESCE(w.zone_id, s.zone_id) AS zone_id
        FROM kothis w
        LEFT JOIN wards s ON s.ward_id = w.ward_id
        JOIN assigned_wards a ON a.kothi_id = w.kothi_id
        WHERE COALESCE(w.zone_id, s.zone_id) IS NOT NULL
        UNION
        SELECT DISTINCT s.zone_id
        FROM wards s
        JOIN assigned_sectors sec ON sec.ward_id = s.ward_id
        WHERE s.zone_id IS NOT NULL
        UNION
        -- City-level access: expand to ALL zones ONLY when user has no zone restrictions for that city
        SELECT DISTINCT z.zone_id
        FROM zones z
        JOIN user_city_access uca ON uca.city_id = z.city_id
        WHERE uca.user_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM user_zone_access uza2
            JOIN zones z2 ON uza2.zone_id = z2.zone_id
            WHERE uza2.user_id = $1 AND z2.city_id = uca.city_id
          )
      ),
      -- Full-city access: user has city access AND no zone-level restrictions for that city.
      -- Only these cities appear in the WHERE city-level check to prevent leaking
      -- requests from unassigned zones that share the same city.
      full_city_access AS (
        SELECT uca.city_id
        FROM user_city_access uca
        WHERE uca.user_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM user_zone_access uza2
            JOIN zones z2 ON uza2.zone_id = z2.zone_id
            WHERE uza2.user_id = $1 AND z2.city_id = uca.city_id
          )
      )
    `;
    whereClause = `
      (
        ${tableAlias}.city_id IN (SELECT city_id FROM full_city_access)
        OR ${tableAlias}.zone_id IN (SELECT zone_id FROM assigned_zones)
        OR ${tableAlias}.kothi_id IN (SELECT kothi_id FROM assigned_kothis)
        OR ${tableAlias}.kothi_id IN (SELECT kothi_id FROM assigned_wards)
        OR ${tableAlias}.kothi_id IN (SELECT ward_id FROM assigned_sectors)
        OR EXISTS (
          SELECT 1
          FROM kothis w_scope
          WHERE w_scope.kothi_id = ${tableAlias}.kothi_id
            AND w_scope.ward_id IN (SELECT ward_id FROM assigned_sectors)
        )
      )
    `;
  } else {
    // Unknown role -> deny access
    whereClause = '1=0';
  }

  return { cte, whereClause, params };
};

module.exports = {
  buildVisibilityScope
};
