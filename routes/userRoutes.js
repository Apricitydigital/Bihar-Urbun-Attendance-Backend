const express = require("express");
const pool = require("../config/db");
const authenticate = require("../middleware/authMiddleware");
const { fetchUserCityAccess } = require("../utils/userCityAccess");

const router = express.Router();

router.get("/allowed-cities", authenticate, async (req, res) => {
  try {
    const scope = await fetchUserCityAccess(req.user, { includeCities: true });

    if (scope.all) {
      // Admin-level access; ensure we return the full current city list
      const { rows } = await pool.query(
        "SELECT city_id, city_name FROM cities ORDER BY city_name ASC"
      );
      return res.json({ all: true, cities: rows });
    }

    if (!scope.cities || scope.cities.length === 0) {
      return res
        .status(403)
        .json({ error: "No city access assigned. Please contact admin." });
    }

    return res.json({
      all: false,
      cities: scope.cities,
    });
  } catch (error) {
    console.error("Failed to fetch allowed cities:", error);
    res.status(500).json({ error: "Unable to fetch allowed cities." });
  }
});

module.exports = router;
