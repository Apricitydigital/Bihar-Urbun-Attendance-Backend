const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const authenticate = require("../middleware/authMiddleware");
const { authorize } = require("../middleware/permissionMiddleware");
const {
    attachCityScope,
    requireCityScope,
    buildCityFilterClause,
} = require("../middleware/cityScope");
const { attachKothiScope, buildKothiFilterClause } = require("../middleware/kothiScope");

// Get all wards (Kothis) with associated Kothis, filtered by city scope
router.get(
    "/",
    authenticate,
    attachKothiScope,
    attachCityScope,
    requireCityScope(),
    async (req, res) => {
        try {
            const scope = req.cityScope || { all: false, ids: [] };
            const kothiScope = req.kothiScope || { all: true, ids: [] };
            
            const cityFilter = buildCityFilterClause(scope, "c", []);
            const kothiFilter = buildKothiFilterClause(kothiScope, "w", cityFilter.params);

            const result = await pool.query(
                `SELECT 
            s.ward_id, s.ward_name,
            z.zone_id, z.zone_name,
            c.city_id, c.city_name,
            w.kothi_id, w.kothi_name
         FROM wards s
         JOIN zones z ON s.zone_id = z.zone_id
         JOIN cities c ON z.city_id = c.city_id
         LEFT JOIN kothis w ON w.ward_id = s.ward_id
         ${cityFilter.clause} ${kothiFilter.clause}
         ORDER BY c.city_name, z.zone_name, s.ward_name, w.kothi_name`,
                kothiFilter.params
            );

            const groupedData = {};
            result.rows.forEach((row) => {
                const { city_id, city_name, zone_id, zone_name, ward_id, ward_name, kothi_id, kothi_name } = row;

                if (!groupedData[city_id]) {
                    groupedData[city_id] = { cityId: city_id, city: city_name, zones: {} };
                }
                if (!groupedData[city_id].zones[zone_id]) {
                    groupedData[city_id].zones[zone_id] = { zoneId: zone_id, zone: zone_name, wards: {} };
                }
                if (!groupedData[city_id].zones[zone_id].wards[ward_id]) {
                    groupedData[city_id].zones[zone_id].wards[ward_id] = {
                        wardId: ward_id,
                        wardName: ward_name,
                        kothis: [],
                    };
                }

                if (kothi_id) {
                    groupedData[city_id].zones[zone_id].wards[ward_id].kothis.push({
                        kothiId: kothi_id,
                        kothiName: kothi_name,
                    });
                }
            });

            const response = Object.values(groupedData).map((city) => ({
                ...city,
                zones: Object.values(city.zones).map((zone) => ({
                    ...zone,
                    wards: Object.values(zone.wards),
                })),
            }));

            res.json(response);
        } catch (error) {
            console.error("Error fetching wards:", error);
            res.status(500).json({ error: "Internal Server Error" });
        }
    }
);

// Create a new ward (Kothi) and assign multiple kothis (Kothis)
router.post("/", authenticate, authorize("master", "manage"), async (req, res) => {
    const { ward_name, zone_id, ward_ids } = req.body; // ward_ids is an array
    if (!ward_name || !zone_id) {
        return res.status(400).json({ error: "Ward name and Zone ID are required" });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        // 1. Create the ward
        const sectorResult = await client.query(
            `INSERT INTO wards (ward_name, zone_id) 
             VALUES ($1, $2) 
             ON CONFLICT (ward_name, zone_id) DO UPDATE SET ward_name = EXCLUDED.ward_name
             RETURNING *`,
            [ward_name, zone_id]
        );
        const ward = sectorResult.rows[0];

        // 2. Assign kothis to this ward
        if (Array.isArray(ward_ids) && ward_ids.length > 0) {
            await client.query(
                `UPDATE kothis SET ward_id = $1 WHERE kothi_id = ANY($2::int[])`,
                [ward.ward_id, ward_ids]
            );
        }

        await client.query("COMMIT");
        res.status(201).json(ward);
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Error creating ward:", error);
        res.status(500).json({ error: "Internal Server Error" });
    } finally {
        client.release();
    }
});

// Update a ward and its kothi assignments
router.put("/:id", authenticate, authorize("master", "manage"), async (req, res) => {
    const { id } = req.params;
    const { ward_name, zone_id, ward_ids } = req.body;

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        // 1. Update ward name/zone
        const result = await client.query(
            `UPDATE wards SET ward_name = $1, zone_id = $2 WHERE ward_id = $3 RETURNING *`,
            [ward_name, zone_id, id]
        );
        if (result.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Ward not found" });
        }

        // 2. Reset existing assignments for this ward
        await client.query(`UPDATE kothis SET ward_id = NULL WHERE ward_id = $1`, [id]);

        // 3. Set new assignments
        if (Array.isArray(ward_ids) && ward_ids.length > 0) {
            await client.query(
                `UPDATE kothis SET ward_id = $1 WHERE kothi_id = ANY($2::int[])`,
                [id, ward_ids]
            );
        }

        await client.query("COMMIT");
        res.json(result.rows[0]);
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Error updating ward:", error);
        res.status(500).json({ error: "Internal Server Error" });
    } finally {
        client.release();
    }
});

// Delete a ward
router.delete("/:id", authenticate, authorize("master", "manage"), async (req, res) => {
    const { id } = req.params;
    try {
        // kothis table handles ON DELETE SET NULL if we set it up that way, otherwise manual nulling
        await pool.query("UPDATE kothis SET ward_id = NULL WHERE ward_id = $1", [id]);
        const result = await pool.query("DELETE FROM wards WHERE ward_id = $1 RETURNING *", [id]);
        if (result.rowCount === 0) return res.status(404).json({ error: "Ward not found" });
        res.json({ message: "Ward deleted successfully" });
    } catch (error) {
        console.error("Error deleting ward:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

module.exports = router;
