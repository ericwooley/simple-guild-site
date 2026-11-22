ALTER TABLE item_catalog ADD COLUMN IF NOT EXISTS item_class text;
ALTER TABLE item_catalog ADD COLUMN IF NOT EXISTS item_subclass text;
ALTER TABLE item_catalog ADD COLUMN IF NOT EXISTS inventory_type text;
ALTER TABLE item_catalog ADD COLUMN IF NOT EXISTS item_level integer;
ALTER TABLE item_catalog ADD COLUMN IF NOT EXISTS required_level integer;
