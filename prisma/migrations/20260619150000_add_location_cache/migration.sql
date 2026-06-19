-- Location enrichment cache for OpenStreetMap/Nominatim City→Country lookups.
CREATE TABLE IF NOT EXISTS "LocationCache" (
  "id"        TEXT NOT NULL,
  "cityKey"   TEXT NOT NULL,
  "city"      TEXT NOT NULL,
  "state"     TEXT,
  "country"   TEXT NOT NULL,
  "source"    TEXT NOT NULL DEFAULT 'nominatim',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LocationCache_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LocationCache_cityKey_key" ON "LocationCache"("cityKey");
