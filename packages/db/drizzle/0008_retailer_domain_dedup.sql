-- Phase 4.1: normalized domain dedup for shared retailer model.

UPDATE retailers
SET domain = lower(regexp_replace(domain, '^www\.', '', 'i'))
WHERE domain ~* '^www\.'
   OR domain <> lower(regexp_replace(domain, '^www\.', '', 'i'));

ALTER TABLE store_onboarding
  ADD COLUMN IF NOT EXISTS normalized_domain text;

UPDATE store_onboarding
SET normalized_domain = lower(
  regexp_replace(
    split_part(regexp_replace(input_url, '^https?://', '', 'i'), '/', 1),
    '^www\.',
    '',
    'i'
  )
)
WHERE normalized_domain IS NULL;

CREATE INDEX IF NOT EXISTS store_onboarding_normalized_domain_status_idx
  ON store_onboarding (normalized_domain, status)
  WHERE status IN ('queued', 'discovering');

-- Merge duplicate retailers that share the same normalized domain before the unique index.
CREATE TEMP TABLE retailer_domain_merge ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    id,
    domain,
    ROW_NUMBER() OVER (
      PARTITION BY domain
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS rn
  FROM retailers
)
SELECT loser.id AS from_id, winner.id AS to_id
FROM ranked loser
JOIN ranked winner ON winner.domain = loser.domain AND winner.rn = 1
WHERE loser.rn > 1;

-- org_competitors (unique org_id + retailer_id)
DELETE FROM org_competitors oc
USING retailer_domain_merge m
WHERE oc.retailer_id = m.from_id
  AND EXISTS (
    SELECT 1
    FROM org_competitors oc2
    WHERE oc2.org_id = oc.org_id AND oc2.retailer_id = m.to_id
  );

UPDATE org_competitors oc
SET retailer_id = m.to_id
FROM retailer_domain_merge m
WHERE oc.retailer_id = m.from_id;

-- retailer_listing_pages (unique retailer_id + url)
DELETE FROM retailer_listing_pages lp
USING retailer_domain_merge m
WHERE lp.retailer_id = m.from_id
  AND EXISTS (
    SELECT 1
    FROM retailer_listing_pages lp2
    WHERE lp2.retailer_id = m.to_id AND lp2.url = lp.url
  );

UPDATE retailer_listing_pages lp
SET retailer_id = m.to_id
FROM retailer_domain_merge m
WHERE lp.retailer_id = m.from_id;

-- retailer_endpoints (unique retailer_id + url + method)
DELETE FROM retailer_endpoints re
USING retailer_domain_merge m
WHERE re.retailer_id = m.from_id
  AND EXISTS (
    SELECT 1
    FROM retailer_endpoints re2
    WHERE re2.retailer_id = m.to_id
      AND re2.url = re.url
      AND re2.method = re.method
  );

UPDATE retailer_endpoints re
SET retailer_id = m.to_id
FROM retailer_domain_merge m
WHERE re.retailer_id = m.from_id;

-- retailer_categories (unique retailer_id + raw_path)
DELETE FROM retailer_categories rc
USING retailer_domain_merge m
WHERE rc.retailer_id = m.from_id
  AND EXISTS (
    SELECT 1
    FROM retailer_categories rc2
    WHERE rc2.retailer_id = m.to_id AND rc2.raw_path = rc.raw_path
  );

UPDATE retailer_categories rc
SET retailer_id = m.to_id
FROM retailer_domain_merge m
WHERE rc.retailer_id = m.from_id;

-- Drop duplicate recipe versions (canonical retailer keeps its history).
DELETE FROM retailer_recipe_versions rv
USING retailer_domain_merge m
WHERE rv.retailer_id = m.from_id;

UPDATE crawl_health_reports ch
SET retailer_id = m.to_id
FROM retailer_domain_merge m
WHERE ch.retailer_id = m.from_id;

UPDATE discovery_repairs dr
SET retailer_id = m.to_id
FROM retailer_domain_merge m
WHERE dr.retailer_id = m.from_id;

UPDATE crawl_runs cr
SET retailer_id = m.to_id
FROM retailer_domain_merge m
WHERE cr.retailer_id = m.from_id;

UPDATE retailer_products rp
SET retailer_id = m.to_id
FROM retailer_domain_merge m
WHERE rp.retailer_id = m.from_id;

UPDATE signals s
SET retailer_id = m.to_id
FROM retailer_domain_merge m
WHERE s.retailer_id = m.from_id;

UPDATE store_onboarding so
SET retailer_id = m.to_id
FROM retailer_domain_merge m
WHERE so.retailer_id = m.from_id;

UPDATE orgs o
SET own_retailer_id = m.to_id
FROM retailer_domain_merge m
WHERE o.own_retailer_id = m.from_id;

DELETE FROM retailers r
USING retailer_domain_merge m
WHERE r.id = m.from_id;

CREATE UNIQUE INDEX IF NOT EXISTS retailers_domain_idx ON retailers (domain);
