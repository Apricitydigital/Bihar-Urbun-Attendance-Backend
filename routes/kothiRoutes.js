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

// Get all kothis with zone names
// router.get("/", async (req, res) => {
//   try {
//     const result = await pool.query(
//       `SELECT w.kothi_id, w.kothi_name, z.zone_id,
//     z.zone_name,
//     c.city_id,
//     c.city_name
// FROM kothis w
// JOIN zones z ON w.zone_id = z.zone_id
// JOIN cities c ON z.city_id = c.city_id;`
//     );
//     res.json(result.rows);
//   } catch (error) {
//     console.error("Error fetching kothis:", error);
//     res.status(500).json({ error: "Internal Server Error" });
//   }
// });

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
        `SELECT w.kothi_id, w.kothi_name, w.ward_id,
              z.zone_id, z.zone_name, c.city_id, c.city_name
       FROM kothis w
       JOIN zones z ON w.zone_id = z.zone_id
       JOIN cities c ON z.city_id = c.city_id
       ${cityFilter.clause} ${kothiFilter.clause}`,
        kothiFilter.params
      );

      const groupedData = {};

      result.rows.forEach((row) => {
        const { city_id, city_name, zone_id, zone_name, kothi_id, kothi_name } =
          row;

        if (!groupedData[city_id]) {
          groupedData[city_id] = {
            cityId: city_id,
            city: city_name,
            zones: {},
          };
        }

        if (!groupedData[city_id].zones[zone_id]) {
          groupedData[city_id].zones[zone_id] = {
            zoneId: zone_id,
            zone: zone_name,
            kothis: [],
          };
        }

        groupedData[city_id].zones[zone_id].kothis.push({
          kothiId: kothi_id,
          kothiName: kothi_name,
          wardId: row.ward_id ?? null,
        });
      });

      // Convert grouped data into an array format
      const responseData = Object.values(groupedData).map((city) => ({
        ...city,
        zones: Object.values(city.zones),
      }));

      res.json(responseData);
    } catch (error) {
      console.error("Error fetching kothis:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

// Get a specific kothi by ID
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT w.kothi_id, w.kothi_name, z.zone_id, z.zone_name 
       FROM kothis w
       JOIN zones z ON w.zone_id = z.zone_id
       WHERE w.kothi_id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Kothi not found" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching kothi:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Create a new kothi
router.post(
  "/",
  authenticate,
  authorize("master", "manage"),
  async (req, res) => {
    const { kothi_name, zone_id, ward_id } = req.body;
    if (!kothi_name || !zone_id) {
      return res
        .status(400)
        .json({ error: "Kothi name and Zone ID are required" });
    }

    try {
      const result = await pool.query(
        `INSERT INTO kothis (kothi_name, zone_id, ward_id) 
       VALUES ($1, $2, $3) 
       ON CONFLICT ON CONSTRAINT unique_ward_per_zone DO NOTHING
       RETURNING *`,
        [kothi_name, zone_id, ward_id]
      );

      if (result.rowCount === 0) {
        console.warn("Record exists, skipping");
        const existing = await pool.query(
          `SELECT * FROM kothis WHERE kothi_name = $1 AND zone_id = $2 LIMIT 1`,
          [kothi_name, zone_id]
        );
        return res
          .status(200)
          .json(existing.rows[0] || { error: "Kothi already exists in this zone" });
      }

      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error("Error creating kothi:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

// Update a kothi
router.put(
  "/:id",
  authenticate,
  authorize("master", "manage"),
  async (req, res) => {
    const { id } = req.params;
    const { kothi_name, zone_id, ward_id } = req.body;

    try {
      const result = await pool.query(
        `UPDATE kothis SET kothi_name = $1, zone_id = $2, ward_id = $3 
       WHERE kothi_id = $4 
       RETURNING *`,
        [kothi_name, zone_id, ward_id, id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Kothi not found" });
      }
      res.json(result.rows[0]);
    } catch (error) {
      console.error("Error updating kothi:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

// Delete a kothi
router.delete(
  "/:id",
  authenticate,
  authorize("master", "manage"),
  async (req, res) => {
    const { id } = req.params;

    try {
      const result = await pool.query(
        `DELETE FROM kothis WHERE kothi_id = $1 RETURNING *`,
        [id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Kothi not found" });
      }
      res.json({ message: "Kothi deleted successfully" });
    } catch (error) {
      console.error("Error deleting kothi:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

module.exports = router;
