-- NearBite: Atomic Follower Count Functions
-- Execute this in Supabase SQL Editor

-- 1. Increment follower count atomically
CREATE OR REPLACE FUNCTION increment_follower_count(merchant_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE merchants 
  SET follower_count = COALESCE(follower_count, 0) + 1
  WHERE id = merchant_id;
END;
$$ LANGUAGE plpgsql;

-- 2. Decrement follower count atomically (min 0)
CREATE OR REPLACE FUNCTION decrement_follower_count(merchant_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE merchants 
  SET follower_count = GREATEST(COALESCE(follower_count, 0) - 1, 0)
  WHERE id = merchant_id;
END;
$$ LANGUAGE plpgsql;

-- 3. Ensure follower_count column exists with default 0
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'merchants' AND column_name = 'follower_count'
  ) THEN
    ALTER TABLE merchants ADD COLUMN follower_count INTEGER DEFAULT 0;
  END IF;
END $$;

-- 4. Initialize any NULL follower_count to 0
UPDATE merchants SET follower_count = 0 WHERE follower_count IS NULL;

-- 5. Grant execution permissions to authenticated users
GRANT EXECUTE ON FUNCTION increment_follower_count(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION decrement_follower_count(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION increment_follower_count(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION decrement_follower_count(UUID) TO service_role;
